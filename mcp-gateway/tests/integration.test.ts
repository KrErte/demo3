import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { MCPGateway, type ToolDefinition } from '../src/core/mcp.js';
import { loadConfig, type GatewayConfig } from '../src/core/config.js';
import { createFilesystemTools } from '../src/connectors/filesystem.js';

const TEST_DIR = join(process.cwd(), 'test-data');
const TEST_FILE = join(TEST_DIR, 'test.txt');
const TEST_CONTENT = 'Hello, MCP Gateway!';

describe('Integration Tests', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Create test directory and file
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, TEST_CONTENT);
  });

  afterAll(() => {
    // Clean up test directory
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('End-to-end tool invocation', () => {
    it('executes filesystem read through full pipeline', async () => {
      // Create config
      const config: GatewayConfig = {
        server: { transport: 'stdio', http_port: 3000, http_host: '127.0.0.1' },
        policy: {
          default_deny: true,
          allow_tools: ['fs.readFile'],
          deny_tools: [],
          per_tool: {},
          global_timeout_ms: 5000,
          global_max_bytes: 1000000,
        },
        audit: { enabled: true },
        connectors: {
          filesystem: {
            enabled: true,
            allowed_paths: [TEST_DIR],
            denied_paths: [],
            max_file_size: 1000000,
          },
          http_fetch: {
            enabled: false,
            allowed_domains: [],
            denied_domains: [],
            max_response_bytes: 1000000,
            timeout_ms: 10000,
            allowed_methods: ['GET'],
          },
          postgres: {
            enabled: false,
            host: 'localhost',
            port: 5432,
            ssl: false,
            max_rows: 1000,
            query_timeout_ms: 30000,
          },
        },
        actor: 'test-user',
        log_level: 'info',
      };

      // Create gateway
      const gateway = new MCPGateway(config);

      // Load filesystem tools
      const tools = createFilesystemTools(config.connectors.filesystem);
      gateway.registerTools(tools);

      // Invoke tool
      const result = await gateway.invokeTool('fs.readFile', {
        path: TEST_FILE,
        encoding: 'utf-8',
      });

      // Verify result
      expect(result.success).toBe(true);
      expect(result.requestId).toBeDefined();

      const data = result.result as { content: string; size: number };
      expect(data.content).toBe(TEST_CONTENT);
      expect(data.size).toBe(TEST_CONTENT.length);

      // Verify audit log was written
      expect(consoleLogSpy).toHaveBeenCalled();
      const auditCalls = consoleLogSpy.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('[audit]')
      );
      expect(auditCalls.length).toBeGreaterThan(0);
    });

    it('denies access to paths outside allowlist', async () => {
      const config: GatewayConfig = {
        server: { transport: 'stdio', http_port: 3000, http_host: '127.0.0.1' },
        policy: {
          default_deny: true,
          allow_tools: ['fs.readFile'],
          deny_tools: [],
          per_tool: {},
          global_timeout_ms: 5000,
          global_max_bytes: 1000000,
        },
        audit: { enabled: true },
        connectors: {
          filesystem: {
            enabled: true,
            allowed_paths: ['/tmp/nonexistent'],
            denied_paths: [],
            max_file_size: 1000000,
          },
          http_fetch: {
            enabled: false,
            allowed_domains: [],
            denied_domains: [],
            max_response_bytes: 1000000,
            timeout_ms: 10000,
            allowed_methods: ['GET'],
          },
          postgres: {
            enabled: false,
            host: 'localhost',
            port: 5432,
            ssl: false,
            max_rows: 1000,
            query_timeout_ms: 30000,
          },
        },
        actor: 'test-user',
        log_level: 'info',
      };

      const gateway = new MCPGateway(config);
      const tools = createFilesystemTools(config.connectors.filesystem);
      gateway.registerTools(tools);

      const result = await gateway.invokeTool('fs.readFile', {
        path: TEST_FILE,
        encoding: 'utf-8',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SECURITY_ERROR');
    });

    it('policy denial produces audit log with deny decision', async () => {
      const config: GatewayConfig = {
        server: { transport: 'stdio', http_port: 3000, http_host: '127.0.0.1' },
        policy: {
          default_deny: true,
          allow_tools: [], // Nothing allowed
          deny_tools: [],
          per_tool: {},
          global_timeout_ms: 5000,
          global_max_bytes: 1000000,
        },
        audit: { enabled: true },
        connectors: {
          filesystem: {
            enabled: true,
            allowed_paths: [TEST_DIR],
            denied_paths: [],
            max_file_size: 1000000,
          },
          http_fetch: {
            enabled: false,
            allowed_domains: [],
            denied_domains: [],
            max_response_bytes: 1000000,
            timeout_ms: 10000,
            allowed_methods: ['GET'],
          },
          postgres: {
            enabled: false,
            host: 'localhost',
            port: 5432,
            ssl: false,
            max_rows: 1000,
            query_timeout_ms: 30000,
          },
        },
        actor: 'test-user',
        log_level: 'info',
      };

      const gateway = new MCPGateway(config);
      const tools = createFilesystemTools(config.connectors.filesystem);
      gateway.registerTools(tools);

      const result = await gateway.invokeTool('fs.readFile', {
        path: TEST_FILE,
        encoding: 'utf-8',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');

      // Check audit log contains deny
      const auditCalls = consoleLogSpy.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('[audit]')
      );
      expect(auditCalls.length).toBeGreaterThan(0);

      const auditLog = auditCalls[0][0];
      expect(auditLog).toContain('"decision":"deny"');
    });

    it('handles multiple tool calls with different policies', async () => {
      const config: GatewayConfig = {
        server: { transport: 'stdio', http_port: 3000, http_host: '127.0.0.1' },
        policy: {
          default_deny: true,
          allow_tools: ['fs.listDir'],
          deny_tools: ['fs.readFile'],
          per_tool: {},
          global_timeout_ms: 5000,
          global_max_bytes: 1000000,
        },
        audit: { enabled: true },
        connectors: {
          filesystem: {
            enabled: true,
            allowed_paths: [TEST_DIR],
            denied_paths: [],
            max_file_size: 1000000,
          },
          http_fetch: {
            enabled: false,
            allowed_domains: [],
            denied_domains: [],
            max_response_bytes: 1000000,
            timeout_ms: 10000,
            allowed_methods: ['GET'],
          },
          postgres: {
            enabled: false,
            host: 'localhost',
            port: 5432,
            ssl: false,
            max_rows: 1000,
            query_timeout_ms: 30000,
          },
        },
        actor: 'test-user',
        log_level: 'info',
      };

      const gateway = new MCPGateway(config);
      const tools = createFilesystemTools(config.connectors.filesystem);
      gateway.registerTools(tools);

      // listDir should work
      const listResult = await gateway.invokeTool('fs.listDir', { path: TEST_DIR });
      expect(listResult.success).toBe(true);

      // readFile should be denied
      const readResult = await gateway.invokeTool('fs.readFile', {
        path: TEST_FILE,
        encoding: 'utf-8',
      });
      expect(readResult.success).toBe(false);
      expect(readResult.error?.code).toBe('POLICY_DENIED');
    });
  });

  describe('Custom tool registration', () => {
    it('registers and executes custom tools', async () => {
      const config: GatewayConfig = {
        server: { transport: 'stdio', http_port: 3000, http_host: '127.0.0.1' },
        policy: {
          default_deny: true,
          allow_tools: ['custom.echo'],
          deny_tools: [],
          per_tool: {},
          global_timeout_ms: 5000,
          global_max_bytes: 1000000,
        },
        audit: { enabled: true },
        connectors: {
          filesystem: { enabled: false, allowed_paths: [], denied_paths: [], max_file_size: 1000000 },
          http_fetch: {
            enabled: false,
            allowed_domains: [],
            denied_domains: [],
            max_response_bytes: 1000000,
            timeout_ms: 10000,
            allowed_methods: ['GET'],
          },
          postgres: {
            enabled: false,
            host: 'localhost',
            port: 5432,
            ssl: false,
            max_rows: 1000,
            query_timeout_ms: 30000,
          },
        },
        actor: 'test-user',
        log_level: 'info',
      };

      const gateway = new MCPGateway(config);

      // Register custom tool
      const echoTool: ToolDefinition = {
        name: 'custom.echo',
        description: 'Echoes the input message',
        inputSchema: z.object({
          message: z.string(),
          uppercase: z.boolean().default(false),
        }),
        handler: async (args) => {
          const { message, uppercase } = args as { message: string; uppercase: boolean };
          return {
            echo: uppercase ? message.toUpperCase() : message,
          };
        },
      };

      gateway.registerTool(echoTool);

      // Test normal call
      const result1 = await gateway.invokeTool('custom.echo', { message: 'hello' });
      expect(result1.success).toBe(true);
      expect((result1.result as { echo: string }).echo).toBe('hello');

      // Test with uppercase
      const result2 = await gateway.invokeTool('custom.echo', { message: 'hello', uppercase: true });
      expect(result2.success).toBe(true);
      expect((result2.result as { echo: string }).echo).toBe('HELLO');
    });
  });
});
