# Connector Development Guide

This guide explains how to implement custom connectors for MCP Gateway.

## Connector Architecture

A connector is a module that provides one or more tools. Each tool has:

1. **Name**: Unique identifier (e.g., `myservice.getData`)
2. **Description**: Human-readable explanation for AI agents
3. **Input Schema**: Zod schema defining valid arguments
4. **Handler**: Async function that executes the tool

```
┌─────────────────────────────────────────────────────────┐
│                      Connector                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Tool 1    │  │   Tool 2    │  │   Tool 3    │     │
│  │  - schema   │  │  - schema   │  │  - schema   │     │
│  │  - handler  │  │  - handler  │  │  - handler  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Basic Structure

Create a new file in `src/connectors/`:

```typescript
// src/connectors/myConnector.ts

import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';
import { ConnectorError, SecurityError } from '../core/errors.js';

// Configuration type for this connector
export interface MyConnectorConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  maxResults: number;
}

// Tool input schema
const getDataSchema = z.object({
  query: z.string().min(1).max(1000).describe('Search query'),
  limit: z.number().min(1).max(100).default(10).describe('Max results'),
});

// Create tools for this connector
export function createMyTools(config: MyConnectorConfig): ToolDefinition[] {
  // Return empty array if disabled
  if (!config.enabled) {
    return [];
  }

  const tools: ToolDefinition[] = [];

  // Define a tool
  tools.push({
    name: 'my.getData',
    description: 'Fetches data from MyService based on a search query.',
    inputSchema: getDataSchema,
    handler: async (args) => {
      // Parse and validate args (Zod schema already validated by gateway)
      const { query, limit } = getDataSchema.parse(args);

      // Implement your tool logic
      try {
        const response = await fetch(`${config.baseUrl}/search`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, limit }),
        });

        if (!response.ok) {
          throw new ConnectorError('my', `API returned ${response.status}`);
        }

        const data = await response.json();

        // Return structured result
        return {
          query,
          results: data.results.slice(0, config.maxResults),
          total: data.total,
        };
      } catch (err) {
        if (err instanceof ConnectorError) throw err;
        throw new ConnectorError('my', `Failed to fetch: ${err}`);
      }
    },
  });

  return tools;
}
```

## Register the Connector

Update `src/connectors/index.ts`:

```typescript
import { createMyTools, type MyConnectorConfig } from './myConnector.js';

// In loadConnectorTools function:
export function loadConnectorTools(config: GatewayConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // ... existing connectors ...

  // Add your connector
  if (config.connectors.my) {
    const myTools = createMyTools(config.connectors.my as MyConnectorConfig);
    tools.push(...myTools);
  }

  return tools;
}
```

## Add Configuration Schema

Update `src/core/config.ts`:

```typescript
const MyConnectorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().default('https://api.myservice.com'),
  maxResults: z.number().positive().default(100),
});

// Add to main config schema
const GatewayConfigSchema = z.object({
  // ... existing fields ...
  connectors: z.object({
    // ... existing connectors ...
    my: MyConnectorConfigSchema.default({}),
  }),
});
```

## Security Best Practices

### 1. Validate All Inputs

Use Zod schemas with strict constraints:

```typescript
const schema = z.object({
  // Limit string length
  query: z.string().min(1).max(1000),

  // Constrain numbers
  limit: z.number().int().min(1).max(100),

  // Use enums for choices
  format: z.enum(['json', 'csv', 'xml']),

  // Validate URLs
  url: z.string().url(),
});
```

### 2. Implement Allowlists

For any external resource access:

```typescript
function isAllowed(resource: string, allowlist: string[]): boolean {
  return allowlist.some(allowed => {
    if (allowed.startsWith('*')) {
      return resource.endsWith(allowed.slice(1));
    }
    return resource === allowed;
  });
}

// In handler:
if (!isAllowed(targetUrl, config.allowedUrls)) {
  throw new SecurityError(`URL not in allowlist: ${targetUrl}`);
}
```

### 3. Use Appropriate Error Types

```typescript
import {
  ConnectorError,   // General connector failures
  SecurityError,    // Security violations
  ValidationError,  // Input validation failures
  TimeoutError,     // Timeout exceeded
} from '../core/errors.js';

// Examples:
throw new ConnectorError('my', 'API rate limit exceeded');
throw new SecurityError('Resource access denied by policy');
throw new ValidationError('Invalid date format', 'startDate');
```

### 4. Handle Sensitive Data

Never log or return secrets:

```typescript
handler: async (args) => {
  // DON'T do this:
  console.log('API key:', config.apiKey);

  // DO this:
  console.log('Calling API...');

  // DON'T return sensitive data:
  return {
    data: result,
    // apiKey: config.apiKey,  // NEVER
  };
}
```

### 5. Implement Timeouts

Wrap external calls with timeout handling:

```typescript
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Schema Patterns

### Optional Parameters with Defaults

```typescript
const schema = z.object({
  required: z.string(),
  optional: z.string().optional(),
  withDefault: z.number().default(10),
});
```

### Array Parameters

```typescript
const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  tags: z.array(z.string()).default([]),
});
```

### Nested Objects

```typescript
const schema = z.object({
  filter: z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    status: z.enum(['active', 'inactive']).optional(),
  }),
});
```

### Union Types

```typescript
const schema = z.object({
  target: z.union([
    z.object({ type: z.literal('user'), userId: z.string() }),
    z.object({ type: z.literal('team'), teamId: z.string() }),
  ]),
});
```

## Testing Connectors

Create tests in `tests/`:

```typescript
// tests/myConnector.test.ts

import { describe, it, expect, vi } from 'vitest';
import { createMyTools } from '../src/connectors/myConnector.js';

describe('MyConnector', () => {
  it('returns empty array when disabled', () => {
    const tools = createMyTools({ enabled: false, baseUrl: '', maxResults: 10 });
    expect(tools).toHaveLength(0);
  });

  it('creates tools when enabled', () => {
    const tools = createMyTools({
      enabled: true,
      baseUrl: 'https://api.example.com',
      maxResults: 10
    });
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('my.getData');
  });

  it('validates input schema', async () => {
    const tools = createMyTools({
      enabled: true,
      baseUrl: 'https://api.example.com',
      maxResults: 10
    });

    const tool = tools[0];

    // Should throw on invalid input
    await expect(tool.handler({ query: '' })).rejects.toThrow();
  });
});
```

## Example: Slack Connector

Complete example of a read-only Slack connector:

```typescript
// src/connectors/slack.ts

import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';
import { ConnectorError, SecurityError } from '../core/errors.js';

export interface SlackConfig {
  enabled: boolean;
  token?: string;
  allowedChannels: string[];
  maxMessages: number;
}

const listChannelsSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
});

const getMessagesSchema = z.object({
  channel: z.string().min(1).describe('Channel ID (e.g., C1234567890)'),
  limit: z.number().min(1).max(100).default(20),
});

export function createSlackTools(config: SlackConfig): ToolDefinition[] {
  if (!config.enabled || !config.token) {
    return [];
  }

  const callSlackAPI = async (method: string, params: Record<string, unknown>) => {
    const url = new URL(`https://slack.com/api/${method}`);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new ConnectorError('slack', `Slack API error: ${data.error}`);
    }

    return data;
  };

  return [
    {
      name: 'slack.listChannels',
      description: 'List Slack channels the bot has access to',
      inputSchema: listChannelsSchema,
      handler: async (args) => {
        const { limit } = listChannelsSchema.parse(args);
        const data = await callSlackAPI('conversations.list', { limit });

        return {
          channels: data.channels
            .filter((c: { id: string }) =>
              config.allowedChannels.length === 0 ||
              config.allowedChannels.includes(c.id)
            )
            .map((c: { id: string; name: string; is_private: boolean }) => ({
              id: c.id,
              name: c.name,
              isPrivate: c.is_private,
            })),
        };
      },
    },
    {
      name: 'slack.getMessages',
      description: 'Get recent messages from a Slack channel',
      inputSchema: getMessagesSchema,
      handler: async (args) => {
        const { channel, limit } = getMessagesSchema.parse(args);

        // Security: check channel allowlist
        if (config.allowedChannels.length > 0 &&
            !config.allowedChannels.includes(channel)) {
          throw new SecurityError(`Channel ${channel} not in allowed list`);
        }

        const effectiveLimit = Math.min(limit, config.maxMessages);
        const data = await callSlackAPI('conversations.history', {
          channel,
          limit: effectiveLimit
        });

        return {
          channel,
          messages: data.messages.map((m: { ts: string; text: string; user: string }) => ({
            timestamp: m.ts,
            text: m.text,
            user: m.user,
          })),
        };
      },
    },
  ];
}
```

## Connector Checklist

Before submitting a new connector:

- [ ] Configuration schema defined with sensible defaults
- [ ] All tools have clear names and descriptions
- [ ] Input schemas validate all parameters
- [ ] Security allowlists implemented where needed
- [ ] Errors use appropriate error types
- [ ] No sensitive data in logs or responses
- [ ] Timeout handling for external calls
- [ ] Unit tests written
- [ ] Documentation added to this guide
