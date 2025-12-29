# MCP Gateway

A **Compliance-First MCP Gateway** that hosts multiple connectors (adapters) while enforcing policy, auditing, and safe execution.

## Why MCP Gateway?

Traditional MCP servers expose tools directly to AI agents without guardrails. MCP Gateway provides:

- **Policy Enforcement**: Define what tools can be called, with what arguments, by whom
- **Audit Logging**: Every tool invocation is logged with request ID, timing, and decision reason
- **Safe Defaults**: Default-deny policy, read-only operations, allowlists for paths/domains/queries
- **Pluggable Connectors**: Easily add new data sources with built-in security controls
- **Production Ready**: Timeouts, byte limits, error handling, and compliance features

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with stdio transport (for MCP clients)
npm start

# Or run in development mode
npm run dev
```

## Configuration

Create a `config.yaml` file (see [config.yaml](config.yaml) for full example):

```yaml
server:
  transport: stdio  # or 'http' for remote access

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
```

## Available Connectors

| Connector | Tools | Description |
|-----------|-------|-------------|
| **filesystem** | `fs.readFile`, `fs.listDir` | Read files and list directories with path allowlist |
| **http_fetch** | `web.fetch` | Fetch URLs with domain allowlist (GET only) |
| **postgres** | `db.query`, `db.schema` | Read-only PostgreSQL queries (SELECT only) |

## Policy System

The policy engine provides fine-grained control:

```yaml
policy:
  default_deny: true        # Deny unless explicitly allowed
  allow_tools: [...]        # Global allow list
  deny_tools: [...]         # Global deny list (takes precedence)
  per_tool:
    fs.readFile:
      allow: true
      max_bytes: 1048576    # 1MB max response
      timeout_ms: 5000
      arg_allowlist:        # Restrict argument values
        encoding: ["utf-8", "base64"]
```

## Audit Logging

Every tool call generates an audit event:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "tool": "fs.readFile",
  "actor": "local-user",
  "args_sha256": "abc123...",
  "decision": "allow",
  "reason": "Allowed by per_tool policy",
  "duration_ms": 45,
  "result_bytes": 1024
}
```

## Adding a New Connector

1. Create a new file in `src/connectors/`:

```typescript
import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';

export function createMyTools(config: MyConfig): ToolDefinition[] {
  return [{
    name: 'my.tool',
    description: 'Description of what this tool does',
    inputSchema: z.object({
      param: z.string(),
    }),
    handler: async (args) => {
      // Implement tool logic
      return { result: 'data' };
    },
  }];
}
```

2. Register in `src/connectors/index.ts`

See [docs/CONNECTORS.md](docs/CONNECTORS.md) for detailed guide.

## Security

MCP Gateway is designed with security-first principles:

- **Default Deny**: Nothing is allowed unless explicitly configured
- **Path Traversal Prevention**: File paths are validated and normalized
- **SQL Injection Prevention**: Only SELECT queries allowed, dangerous keywords blocked
- **SSRF Prevention**: Internal IPs blocked for HTTP fetch
- **Timeout Enforcement**: All operations have configurable timeouts
- **Byte Limits**: Response sizes are capped to prevent resource exhaustion

See [docs/SECURITY.md](docs/SECURITY.md) for threat model and deployment guidance.

## Documentation

- [QUICKSTART.md](docs/QUICKSTART.md) - Get running in 5 minutes
- [SECURITY.md](docs/SECURITY.md) - Security model and best practices
- [CONNECTORS.md](docs/CONNECTORS.md) - How to implement custom connectors

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Development mode with hot reload
npm run dev
```

## License

MIT
