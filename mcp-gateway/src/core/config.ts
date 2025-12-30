/**
 * Configuration management for MCP Gateway
 * Loads from YAML file with environment variable overrides
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from './errors.js';

// Schema for per-tool policy rules
const ToolPolicySchema = z.object({
  allow: z.boolean().default(false),
  max_bytes: z.number().positive().optional(),
  timeout_ms: z.number().positive().optional(),
  arg_allowlist: z.record(z.union([z.string(), z.array(z.string()), z.boolean(), z.number()])).optional(),
});

// Schema for policy configuration
const PolicyConfigSchema = z.object({
  default_deny: z.boolean().default(true),
  allow_tools: z.array(z.string()).default([]),
  deny_tools: z.array(z.string()).default([]),
  per_tool: z.record(ToolPolicySchema).default({}),
  global_timeout_ms: z.number().positive().default(30000),
  global_max_bytes: z.number().positive().default(10 * 1024 * 1024), // 10MB default
});

// Schema for filesystem connector config
const FilesystemConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowed_paths: z.array(z.string()).default([]),
  denied_paths: z.array(z.string()).default([]),
  max_file_size: z.number().positive().default(5 * 1024 * 1024), // 5MB default
});

// Schema for HTTP fetch connector config
const HttpFetchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowed_domains: z.array(z.string()).default([]),
  denied_domains: z.array(z.string()).default([]),
  max_response_bytes: z.number().positive().default(5 * 1024 * 1024), // 5MB
  timeout_ms: z.number().positive().default(10000),
  allowed_methods: z.array(z.enum(['GET', 'HEAD'])).default(['GET']),
});

// Schema for PostgreSQL connector config
const PostgresConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  user: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
  ssl: z.boolean().default(false),
  max_rows: z.number().positive().default(1000),
  query_timeout_ms: z.number().positive().default(30000),
});

// Schema for audit configuration
const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  file_path: z.string().optional(),
  include_args: z.boolean().default(false), // For privacy, hash args by default
  include_result: z.boolean().default(false),
});

// Schema for server configuration
const ServerConfigSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  http_port: z.number().default(3000),
  http_host: z.string().default('127.0.0.1'),
});

// Main configuration schema
const GatewayConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  policy: PolicyConfigSchema.default({}),
  audit: AuditConfigSchema.default({}),
  connectors: z.object({
    filesystem: FilesystemConfigSchema.default({}),
    http_fetch: HttpFetchConfigSchema.default({}),
    postgres: PostgresConfigSchema.default({}),
  }).default({}),
  actor: z.string().default('local-user'),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;
export type FilesystemConfig = z.infer<typeof FilesystemConfigSchema>;
export type HttpFetchConfig = z.infer<typeof HttpFetchConfigSchema>;
export type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

/**
 * Load configuration from YAML file with environment overrides
 */
export function loadConfig(configPath?: string): GatewayConfig {
  const path = configPath || process.env.MCP_CONFIG_PATH || './config.yaml';

  let fileConfig: Record<string, unknown> = {};

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      fileConfig = parseYaml(content) || {};
    } catch (err) {
      throw new ConfigError(`Failed to parse config file ${path}: ${err}`);
    }
  }

  // Apply environment variable overrides
  const envOverrides = getEnvOverrides();
  const mergedConfig = deepMerge(fileConfig, envOverrides);

  try {
    return GatewayConfigSchema.parse(mergedConfig);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new ConfigError(`Invalid configuration: ${issues}`);
    }
    throw err;
  }
}

/**
 * Get configuration overrides from environment variables
 */
function getEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    server: {},
    audit: {},
    connectors: {
      postgres: {},
    },
  };

  if (process.env.MCP_TRANSPORT) {
    (overrides.server as Record<string, unknown>).transport = process.env.MCP_TRANSPORT;
  }
  if (process.env.MCP_HTTP_PORT) {
    (overrides.server as Record<string, unknown>).http_port = parseInt(process.env.MCP_HTTP_PORT, 10);
  }
  if (process.env.MCP_HTTP_HOST) {
    (overrides.server as Record<string, unknown>).http_host = process.env.MCP_HTTP_HOST;
  }
  if (process.env.MCP_AUDIT_FILE) {
    (overrides.audit as Record<string, unknown>).file_path = process.env.MCP_AUDIT_FILE;
  }
  if (process.env.MCP_LOG_LEVEL) {
    overrides.log_level = process.env.MCP_LOG_LEVEL;
  }
  if (process.env.MCP_ACTOR) {
    overrides.actor = process.env.MCP_ACTOR;
  }

  // PostgreSQL overrides
  const pgConfig = overrides.connectors as Record<string, Record<string, unknown>>;
  if (process.env.POSTGRES_HOST) {
    pgConfig.postgres.host = process.env.POSTGRES_HOST;
  }
  if (process.env.POSTGRES_PORT) {
    pgConfig.postgres.port = parseInt(process.env.POSTGRES_PORT, 10);
  }
  if (process.env.POSTGRES_USER) {
    pgConfig.postgres.user = process.env.POSTGRES_USER;
  }
  if (process.env.POSTGRES_PASSWORD) {
    pgConfig.postgres.password = process.env.POSTGRES_PASSWORD;
  }
  if (process.env.POSTGRES_DATABASE) {
    pgConfig.postgres.database = process.env.POSTGRES_DATABASE;
  }
  if (process.env.POSTGRES_SSL) {
    pgConfig.postgres.ssl = process.env.POSTGRES_SSL === 'true';
  }

  return overrides;
}

/**
 * Deep merge two objects, with source taking precedence
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Create a default configuration for testing
 */
export function createDefaultConfig(): GatewayConfig {
  return GatewayConfigSchema.parse({});
}
