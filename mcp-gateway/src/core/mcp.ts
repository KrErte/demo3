/**
 * MCP Core - Tool registration and invocation pipeline
 * Handles: validation -> policy check -> execute -> audit -> return
 */

import { z } from 'zod';
import type { GatewayConfig } from './config.js';
import { PolicyEngine } from './policy.js';
import { AuditLogger, type AuditContext } from './audit.js';
import { ValidationError, errorToCode, isGatewayError } from './errors.js';

/**
 * Tool definition interface
 */
export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TArgs>;
  handler: (args: TArgs) => Promise<TResult>;
}

/**
 * Tool metadata for MCP protocol
 */
export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool invocation result
 */
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  requestId: string;
}

/**
 * MCP Gateway core - manages tools and handles invocations
 */
export class MCPGateway {
  private tools: Map<string, ToolDefinition> = new Map();
  private policy: PolicyEngine;
  private audit: AuditLogger;
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.policy = new PolicyEngine(config.policy);
    this.audit = new AuditLogger(config.audit, config.actor);
  }

  /**
   * Register a tool with the gateway
   */
  registerTool<TArgs extends Record<string, unknown>, TResult>(
    tool: ToolDefinition<TArgs, TResult>
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    console.log(`[mcp] Registered tool: ${tool.name}`);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get all registered tool metadata for MCP protocol
   */
  getToolMetadata(): ToolMetadata[] {
    const metadata: ToolMetadata[] = [];

    for (const tool of this.tools.values()) {
      metadata.push({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      });
    }

    return metadata;
  }

  /**
   * List all registered tool names
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Invoke a tool through the full pipeline
   */
  async invokeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const ctx = this.audit.createContext(toolName, args);

    try {
      // 1. Check if tool exists
      const tool = this.tools.get(toolName);
      if (!tool) {
        this.audit.logDenied(ctx, `Tool "${toolName}" not found`);
        return {
          success: false,
          error: { code: 'TOOL_NOT_FOUND', message: `Tool "${toolName}" not found` },
          requestId: ctx.requestId,
        };
      }

      // 2. Validate arguments
      const validation = this.validateArgs(tool, args);
      if (!validation.success) {
        this.audit.logDenied(ctx, `Validation failed: ${validation.error}`);
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: validation.error! },
          requestId: ctx.requestId,
        };
      }

      // 3. Check policy
      const effectivePolicy = this.policy.enforce(toolName, args);

      // 4. Execute with timeout
      const result = await this.policy.executeWithTimeout(
        toolName,
        () => tool.handler(validation.data!),
        effectivePolicy.timeoutMs
      );

      // 5. Check max bytes
      this.policy.enforceMaxBytes(result, effectivePolicy.maxBytes);

      // 6. Audit success
      this.audit.logSuccess(ctx, result);

      return {
        success: true,
        result,
        requestId: ctx.requestId,
      };
    } catch (err) {
      const errorCode = errorToCode(err);
      const message = err instanceof Error ? err.message : 'Unknown error';

      if (isGatewayError(err) && err.code === 'POLICY_DENIED') {
        this.audit.logDenied(ctx, message);
      } else {
        this.audit.logError(ctx, errorCode, message);
      }

      return {
        success: false,
        error: { code: errorCode, message },
        requestId: ctx.requestId,
      };
    }
  }

  /**
   * Validate tool arguments against schema
   */
  private validateArgs(
    tool: ToolDefinition,
    args: Record<string, unknown>
  ): { success: boolean; data?: Record<string, unknown>; error?: string } {
    try {
      const data = tool.inputSchema.parse(args);
      return { success: true, data: data as Record<string, unknown> };
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        return { success: false, error: issues };
      }
      return { success: false, error: 'Validation failed' };
    }
  }

  /**
   * Get the policy engine for testing/inspection
   */
  getPolicyEngine(): PolicyEngine {
    return this.policy;
  }

  /**
   * Get the audit logger for testing/inspection
   */
  getAuditLogger(): AuditLogger {
    return this.audit;
  }
}

/**
 * Convert a Zod schema to JSON Schema (simplified)
 */
function zodToJsonSchema(schema: z.ZodType): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
} {
  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      properties[key] = zodFieldToJsonSchema(zodField);

      // Check if field is required (not optional)
      if (!isOptional(zodField)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 && { required }),
    };
  }

  // Default fallback
  return {
    type: 'object',
    properties: {},
  };
}

/**
 * Convert a single Zod field to JSON Schema
 */
function zodFieldToJsonSchema(field: z.ZodType): Record<string, unknown> {
  // Unwrap optional/nullable
  let current = field;
  let isNullable = false;

  if (current instanceof z.ZodOptional) {
    current = current.unwrap();
  }
  if (current instanceof z.ZodNullable) {
    current = current.unwrap();
    isNullable = true;
  }

  let schema: Record<string, unknown> = {};

  if (current instanceof z.ZodString) {
    schema = { type: 'string' };
  } else if (current instanceof z.ZodNumber) {
    schema = { type: 'number' };
  } else if (current instanceof z.ZodBoolean) {
    schema = { type: 'boolean' };
  } else if (current instanceof z.ZodArray) {
    schema = {
      type: 'array',
      items: zodFieldToJsonSchema(current.element),
    };
  } else if (current instanceof z.ZodEnum) {
    schema = {
      type: 'string',
      enum: current.options,
    };
  } else if (current instanceof z.ZodObject) {
    schema = zodToJsonSchema(current);
  } else if (current instanceof z.ZodDefault) {
    schema = zodFieldToJsonSchema(current._def.innerType);
  } else {
    // Fallback
    schema = { type: 'string' };
  }

  if (isNullable) {
    schema.nullable = true;
  }

  // Extract description if present
  if ('description' in current._def && current._def.description) {
    schema.description = current._def.description;
  }

  return schema;
}

/**
 * Check if a Zod field is optional
 */
function isOptional(field: z.ZodType): boolean {
  if (field instanceof z.ZodOptional) return true;
  if (field instanceof z.ZodDefault) return true;
  return false;
}
