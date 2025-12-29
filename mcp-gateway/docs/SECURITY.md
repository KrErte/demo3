# Security Guide

MCP Gateway is designed with security as a primary concern. This document covers the threat model, security features, and deployment best practices.

## Threat Model

### Assumed Threats

1. **Malicious Tool Arguments**: AI agents or users may provide arguments designed to access unauthorized resources
2. **Data Exfiltration**: Attempts to read sensitive files, query unauthorized data, or access internal services
3. **Resource Exhaustion**: Large responses, slow queries, or infinite loops consuming system resources
4. **Privilege Escalation**: Attempts to perform write operations through read-only interfaces
5. **Injection Attacks**: SQL injection, path traversal, SSRF

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    UNTRUSTED ZONE                           │
│  ┌─────────────┐                                            │
│  │  AI Agent   │  ──► Tool requests with arbitrary args     │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP GATEWAY                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Validation │─►│   Policy    │─►│   Audit     │         │
│  │   Layer     │  │   Engine    │  │   Logger    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                              │                              │
│                              ▼                              │
│                    ┌─────────────┐                          │
│                    │ Connectors  │ (sandboxed execution)    │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TRUSTED ZONE                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Filesystem  │  │   HTTP      │  │  Database   │         │
│  │ (allowlist) │  │ (allowlist) │  │ (read-only) │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Security Features

### 1. Default Deny Policy

All tools are denied by default. You must explicitly allow each tool:

```yaml
policy:
  default_deny: true  # ALWAYS keep this true in production
  allow_tools:
    - fs.readFile     # Only these tools can be called
```

### 2. Filesystem Protection

**Path Allowlist**: Only explicitly allowed paths can be accessed

```yaml
connectors:
  filesystem:
    allowed_paths:
      - /app/data        # Only this directory
    denied_paths:
      - /app/data/secrets  # Except this subdirectory
```

**Path Traversal Prevention**:
- All paths are normalized and resolved to absolute paths
- `..` sequences are resolved before checking allowlist
- Symlink targets are validated

### 3. HTTP/SSRF Protection

**Domain Allowlist**: Only explicitly allowed domains can be fetched

```yaml
connectors:
  http_fetch:
    allowed_domains:
      - api.github.com
      - "*.example.com"  # Wildcards supported
```

**Internal Network Blocking**: The following are always blocked:
- `localhost`, `127.0.0.1`, `::1`
- Private IP ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- Link-local addresses: `169.254.x.x`

**Dangerous Headers Stripped**: Authorization, Cookie, API keys are removed from requests

### 4. SQL Injection Prevention

**SELECT-Only Enforcement**:

```
✓ SELECT * FROM users
✓ WITH cte AS (SELECT ...) SELECT ...
✓ EXPLAIN SELECT ...

✗ INSERT INTO users ...
✗ UPDATE users SET ...
✗ DELETE FROM users
✗ DROP TABLE users
✗ SELECT ...; DROP TABLE users  (multi-statement blocked)
```

**Blocked Keywords**: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXECUTE, CALL, COPY, LOAD, SET, LOCK

**Blocked Functions**: PG_READ_FILE, PG_WRITE_FILE, LO_IMPORT, LO_EXPORT

### 5. Resource Limits

```yaml
policy:
  global_timeout_ms: 30000   # 30 second default timeout
  global_max_bytes: 10485760  # 10MB response limit
  per_tool:
    db.query:
      timeout_ms: 60000      # Per-tool override
      max_bytes: 52428800    # 50MB for this tool
```

### 6. Audit Logging

Every tool call is logged with:
- Timestamp and unique request ID
- Tool name and actor identity
- SHA-256 hash of arguments (privacy-preserving)
- Allow/deny decision with reason
- Execution duration
- Response size
- Error codes if applicable

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "tool": "db.query",
  "actor": "ai-agent-1",
  "args_sha256": "a1b2c3d4e5f6...",
  "decision": "deny",
  "reason": "SQL keyword \"DELETE\" is not allowed",
  "duration_ms": 2,
  "result_bytes": 0,
  "error_code": "SECURITY_ERROR"
}
```

## Production Deployment

### 1. Use Read-Only Database Users

```sql
-- Create a read-only PostgreSQL user
CREATE USER mcp_readonly WITH PASSWORD 'strong-random-password';
GRANT CONNECT ON DATABASE mydb TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;

-- Prevent future table access (optional extra safety)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO mcp_readonly;
```

### 2. Network Isolation

Run MCP Gateway in an isolated network segment:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  AI Client  │────►│ MCP Gateway │────►│  Database   │
│  (public)   │     │  (DMZ)      │     │ (private)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 3. Container Security

```dockerfile
FROM node:20-slim
WORKDIR /app

# Run as non-root
RUN useradd -r -u 1001 mcpuser
USER mcpuser

# Copy only production files
COPY --chown=mcpuser:mcpuser dist/ ./dist/
COPY --chown=mcpuser:mcpuser package*.json ./
COPY --chown=mcpuser:mcpuser config.yaml ./

# Install production dependencies only
RUN npm ci --production

# Read-only filesystem (mount config/data as volumes)
CMD ["node", "dist/server.js"]
```

### 4. Secrets Management

Never put secrets in config files:

```yaml
connectors:
  postgres:
    enabled: true
    host: db.internal
    # password: NEVER_PUT_HERE
```

Use environment variables:

```bash
export POSTGRES_PASSWORD="$(vault read -field=password secret/mcp-gateway/postgres)"
```

### 5. TLS for HTTP Transport

When using HTTP transport in production, always use a reverse proxy with TLS:

```nginx
server {
    listen 443 ssl http2;
    server_name mcp-gateway.example.com;

    ssl_certificate /etc/ssl/certs/gateway.crt;
    ssl_certificate_key /etc/ssl/private/gateway.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

### 6. Rate Limiting

Add rate limiting at the reverse proxy level:

```nginx
limit_req_zone $binary_remote_addr zone=mcp:10m rate=10r/s;

location / {
    limit_req zone=mcp burst=20 nodelay;
    proxy_pass http://127.0.0.1:3000;
}
```

### 7. Monitoring & Alerting

Monitor audit logs for:
- High rate of policy denials (potential attack)
- Unusual tool patterns
- Timeout spikes
- Large response sizes

```bash
# Example: Alert on >100 denials per minute
tail -f audit.jsonl | jq -r 'select(.decision == "deny") | .tool' | \
  uniq -c | awk '$1 > 100 {print "ALERT: High denial rate"}'
```

## Security Checklist

Before deploying to production:

- [ ] `default_deny: true` is set
- [ ] Only necessary tools are in `allow_tools`
- [ ] Filesystem `allowed_paths` is minimal
- [ ] HTTP `allowed_domains` is minimal
- [ ] Database user is read-only
- [ ] Secrets are in environment variables, not config
- [ ] Audit logging is enabled and monitored
- [ ] TLS is enabled for HTTP transport
- [ ] Rate limiting is configured
- [ ] Container runs as non-root
- [ ] Network isolation is in place

## Reporting Security Issues

If you discover a security vulnerability, please report it privately before public disclosure.
