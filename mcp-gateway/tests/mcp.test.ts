import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { MCPGateway, type ToolDefinition } from '../src/core/mcp.js';
import { createDefaultConfig } from '../src/core/config.js';

describe('MCPGateway', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('registerTool', () => {
    it('registers a tool successfully', () => {
      const config = createDefaultConfig();
      const gateway = new MCPGateway(config);

      const tool: ToolDefinition = {
        name: 'test.tool',
        description: 'A test tool',
        inputSchema: z.object({ input: z.string() }),
        handler: async () => 'result',
      };

      gateway.registerTool(tool);
      expect(gateway.listTools()).toContain('test.tool');
    });

    it('throws error on duplicate registration', () => {
      const config = createDefaultConfig();
      const gateway = new MCPGateway(config);

      const tool: ToolDefinition = {
        name: 'test.tool',
        description: 'A test tool',
        inputSchema: z.object({}),
        handler: async () => 'result',
      };

      gateway.registerTool(tool);
      expect(() => gateway.registerTool(tool)).toThrow('already registered');
    });
  });

  describe('registerTools', () => {
    it('registers multiple tools', () => {
      const config = createDefaultConfig();
      const gateway = new MCPGateway(config);

      const tools: ToolDefinition[] = [
        {
          name: 'test.tool1',
          description: 'Tool 1',
          inputSchema: z.object({}),
          handler: async () => 'result1',
        },
        {
          name: 'test.tool2',
          description: 'Tool 2',
          inputSchema: z.object({}),
          handler: async () => 'result2',
        },
      ];

      gateway.registerTools(tools);
      expect(gateway.listTools()).toEqual(['test.tool1', 'test.tool2']);
    });
  });

  describe('getToolMetadata', () => {
    it('returns tool metadata with JSON schema', () => {
      const config = createDefaultConfig();
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'A test tool',
        inputSchema: z.object({
          required: z.string(),
          optional: z.number().optional(),
        }),
        handler: async () => 'result',
      });

      const metadata = gateway.getToolMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe('test.tool');
      expect(metadata[0].description).toBe('A test tool');
      expect(metadata[0].inputSchema.type).toBe('object');
      expect(metadata[0].inputSchema.properties).toHaveProperty('required');
      expect(metadata[0].inputSchema.required).toContain('required');
    });
  });

  describe('invokeTool', () => {
    it('returns error for unknown tool', async () => {
      const config = createDefaultConfig();
      const gateway = new MCPGateway(config);

      const result = await gateway.invokeTool('unknown.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
    });

    it('returns error for validation failure', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: false,
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({ required: z.string() }),
        handler: async () => 'result',
      });

      const result = await gateway.invokeTool('test.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('returns error when policy denies', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: true,
          allow_tools: [],
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({}),
        handler: async () => 'result',
      });

      const result = await gateway.invokeTool('test.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');
    });

    it('executes handler when allowed', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: true,
          allow_tools: ['test.tool'],
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({ value: z.string() }),
        handler: async (args) => ({ echo: (args as { value: string }).value }),
      });

      const result = await gateway.invokeTool('test.tool', { value: 'hello' });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ echo: 'hello' });
    });

    it('returns error when handler throws', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: false,
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error('Handler failed');
        },
      });

      const result = await gateway.invokeTool('test.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Handler failed');
    });

    it('enforces timeout', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: true,
          allow_tools: ['test.tool'],
          per_tool: {
            'test.tool': {
              allow: true,
              timeout_ms: 10,
            },
          },
          global_timeout_ms: 10,
          global_max_bytes: 1000000,
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({}),
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'result';
        },
      });

      const result = await gateway.invokeTool('test.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('enforces max bytes', async () => {
      const config = {
        ...createDefaultConfig(),
        policy: {
          ...createDefaultConfig().policy,
          default_deny: true,
          allow_tools: ['test.tool'],
          per_tool: {
            'test.tool': {
              allow: true,
              max_bytes: 10,
            },
          },
          global_timeout_ms: 30000,
          global_max_bytes: 10,
        },
      };
      const gateway = new MCPGateway(config);

      gateway.registerTool({
        name: 'test.tool',
        description: 'Test',
        inputSchema: z.object({}),
        handler: async () => ({ data: 'x'.repeat(100) }),
      });

      const result = await gateway.invokeTool('test.tool', {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MAX_BYTES_EXCEEDED');
    });
  });
});
