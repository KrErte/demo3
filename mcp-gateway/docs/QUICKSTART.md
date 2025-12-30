# Quick Start Guide

Get MCP Gateway running in 5 minutes.

## Prerequisites

- Node.js 20 or later
- npm

## Installation

```bash
# Clone or navigate to the project
cd mcp-gateway

# Install dependencies
npm install

# Build the project
npm run build
```

## Basic Configuration

Create a `config.yaml` file in the project root:

```yaml
# Minimal configuration for local file access
server:
  transport: stdio

policy:
  default_deny: true
  allow_tools:
    - fs.readFile
    - fs.listDir

connectors:
  filesystem:
    enabled: true
    allowed_paths:
      - ./data
      - /tmp

audit:
  enabled: true

actor: local-user
log_level: info
```

## Running the Server

### Stdio Mode (for MCP Clients)

```bash
npm start
```

The server will listen on stdin/stdout for MCP protocol messages.

### HTTP Mode (for REST API access)

Update your config:

```yaml
server:
  transport: http
  http_port: 3000
  http_host: 127.0.0.1
```

Then run:

```bash
npm start
```

Access the API:

```bash
# Health check
curl http://localhost:3000/health

# List tools
curl http://localhost:3000/tools

# Invoke a tool
curl -X POST http://localhost:3000/tools/fs.readFile \
  -H "Content-Type: application/json" \
  -d '{"path": "./data/example.txt"}'
```

## Connecting to Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "gateway": {
      "command": "node",
      "args": ["/path/to/mcp-gateway/dist/server.js"],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/mcp-gateway/config.yaml"
      }
    }
  }
}
```

## Example Tool Calls

### Read a File

```json
{
  "tool": "fs.readFile",
  "arguments": {
    "path": "./data/example.txt",
    "encoding": "utf-8"
  }
}
```

Response:

```json
{
  "path": "/absolute/path/to/data/example.txt",
  "content": "File contents here...",
  "size": 1234,
  "encoding": "utf-8"
}
```

### List a Directory

```json
{
  "tool": "fs.listDir",
  "arguments": {
    "path": "./data",
    "recursive": true,
    "maxDepth": 2
  }
}
```

### Fetch a URL

First, enable and configure HTTP fetch:

```yaml
connectors:
  http_fetch:
    enabled: true
    allowed_domains:
      - api.github.com
      - jsonplaceholder.typicode.com
```

Then call:

```json
{
  "tool": "web.fetch",
  "arguments": {
    "url": "https://jsonplaceholder.typicode.com/posts/1"
  }
}
```

### Query PostgreSQL

Enable and configure PostgreSQL:

```yaml
connectors:
  postgres:
    enabled: true
    host: localhost
    port: 5432
    database: mydb
    user: readonly_user
    # password via POSTGRES_PASSWORD env var
```

Then call:

```json
{
  "tool": "db.query",
  "arguments": {
    "sql": "SELECT id, name FROM users WHERE active = $1 LIMIT 10",
    "params": [true]
  }
}
```

## Example Policy Configurations

### Minimal (Read-Only Files)

```yaml
policy:
  default_deny: true
  allow_tools:
    - fs.readFile
    - fs.listDir

connectors:
  filesystem:
    enabled: true
    allowed_paths:
      - ./public
```

### Web Research

```yaml
policy:
  default_deny: true
  allow_tools:
    - web.fetch

connectors:
  http_fetch:
    enabled: true
    allowed_domains:
      - "*.wikipedia.org"
      - "*.github.com"
      - api.openai.com
    max_response_bytes: 1048576  # 1MB
    timeout_ms: 15000
```

### Database Analytics

```yaml
policy:
  default_deny: true
  allow_tools:
    - db.query
    - db.schema
  per_tool:
    db.query:
      allow: true
      timeout_ms: 60000
      max_bytes: 52428800  # 50MB for large exports

connectors:
  postgres:
    enabled: true
    max_rows: 10000
    query_timeout_ms: 60000
```

## Environment Variables

Override configuration with environment variables:

```bash
# Transport
export MCP_TRANSPORT=http
export MCP_HTTP_PORT=8080

# Config path
export MCP_CONFIG_PATH=/etc/mcp-gateway/config.yaml

# Audit
export MCP_AUDIT_FILE=/var/log/mcp-gateway/audit.jsonl

# Actor identity
export MCP_ACTOR=production-service

# PostgreSQL
export POSTGRES_HOST=db.example.com
export POSTGRES_USER=readonly
export POSTGRES_PASSWORD=secret
export POSTGRES_DATABASE=analytics
```

## Troubleshooting

### Tool not found

Check that:
1. The connector is enabled in config
2. The tool is in `policy.allow_tools` or has `per_tool` config with `allow: true`

### Permission denied

Check:
1. For filesystem: path is in `allowed_paths`
2. For HTTP: domain is in `allowed_domains`
3. For PostgreSQL: user has SELECT permissions

### Timeout errors

Increase timeout in config:

```yaml
policy:
  per_tool:
    db.query:
      timeout_ms: 120000  # 2 minutes
```

### Audit logs

Check stdout or the configured audit file:

```bash
tail -f audit.jsonl | jq .
```

## Next Steps

- Read [SECURITY.md](SECURITY.md) for production deployment
- Read [CONNECTORS.md](CONNECTORS.md) to add custom data sources
