/**
 * Connector Registry
 * Aggregates all available connectors and provides unified tool registration
 */

import type { GatewayConfig } from '../core/config.js';
import type { ToolDefinition } from '../core/mcp.js';
import { createFilesystemTools } from './filesystem.js';
import { createHttpFetchTools } from './httpFetch.js';
import { createPostgresTools } from './postgresReadOnly.js';

/**
 * Connector interface for implementing new connectors
 */
export interface Connector {
  name: string;
  description: string;
  createTools: (config: unknown) => ToolDefinition[];
}

/**
 * Built-in connectors
 */
export const builtinConnectors: Connector[] = [
  {
    name: 'filesystem',
    description: 'File system access with path allowlist',
    createTools: (config) => createFilesystemTools(config as GatewayConfig['connectors']['filesystem']),
  },
  {
    name: 'http_fetch',
    description: 'HTTP fetch with domain allowlist',
    createTools: (config) => createHttpFetchTools(config as GatewayConfig['connectors']['http_fetch']),
  },
  {
    name: 'postgres',
    description: 'PostgreSQL read-only database access',
    createTools: (config) => createPostgresTools(config as GatewayConfig['connectors']['postgres']),
  },
];

/**
 * Load all tools from enabled connectors based on configuration
 */
export function loadConnectorTools(config: GatewayConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Load filesystem tools
  const fsTools = createFilesystemTools(config.connectors.filesystem);
  tools.push(...fsTools);
  if (fsTools.length > 0) {
    console.log(`[connectors] Loaded ${fsTools.length} filesystem tools`);
  }

  // Load HTTP fetch tools
  const httpTools = createHttpFetchTools(config.connectors.http_fetch);
  tools.push(...httpTools);
  if (httpTools.length > 0) {
    console.log(`[connectors] Loaded ${httpTools.length} http_fetch tools`);
  }

  // Load PostgreSQL tools
  const pgTools = createPostgresTools(config.connectors.postgres);
  tools.push(...pgTools);
  if (pgTools.length > 0) {
    console.log(`[connectors] Loaded ${pgTools.length} postgres tools`);
  }

  console.log(`[connectors] Total tools loaded: ${tools.length}`);
  return tools;
}

/**
 * Get connector by name
 */
export function getConnector(name: string): Connector | undefined {
  return builtinConnectors.find(c => c.name === name);
}

/**
 * List all available connectors
 */
export function listConnectors(): Array<{ name: string; description: string }> {
  return builtinConnectors.map(c => ({
    name: c.name,
    description: c.description,
  }));
}

// Re-export individual connector creators for direct use
export { createFilesystemTools } from './filesystem.js';
export { createHttpFetchTools } from './httpFetch.js';
export { createPostgresTools } from './postgresReadOnly.js';
