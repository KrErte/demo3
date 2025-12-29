#!/usr/bin/env node
/**
 * MCP Gateway Server
 * Main entry point - supports stdio and HTTP transports
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { loadConfig, type GatewayConfig } from './core/config.js';
import { MCPGateway } from './core/mcp.js';
import { loadConnectorTools } from './connectors/index.js';
import 'dotenv/config';

/**
 * Initialize the MCP Gateway with configuration
 */
function createGateway(config: GatewayConfig): MCPGateway {
  const gateway = new MCPGateway(config);

  // Load all connector tools based on configuration
  const tools = loadConnectorTools(config);
  gateway.registerTools(tools);

  return gateway;
}

/**
 * Create and configure the MCP server
 */
function createMCPServer(gateway: MCPGateway): Server {
  const server = new Server(
    {
      name: 'mcp-gateway',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = gateway.getToolMetadata();
    return { tools };
  });

  // Handle tool call request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const result = await gateway.invokeTool(name, args as Record<string, unknown> || {});

    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.result, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: result.error,
              requestId: result.requestId,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start server with stdio transport
 */
async function startStdioServer(gateway: MCPGateway): Promise<void> {
  const server = createMCPServer(gateway);
  const transport = new StdioServerTransport();

  console.error('[server] Starting MCP Gateway with stdio transport...');
  console.error(`[server] Registered tools: ${gateway.listTools().join(', ')}`);

  await server.connect(transport);
  console.error('[server] MCP Gateway connected via stdio');
}

/**
 * Start server with HTTP/SSE transport
 */
async function startHttpServer(gateway: MCPGateway, config: GatewayConfig): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', tools: gateway.listTools() });
  });

  // List tools endpoint
  app.get('/tools', (req, res) => {
    const tools = gateway.getToolMetadata();
    res.json({ tools });
  });

  // Invoke tool endpoint
  app.post('/tools/:name', async (req, res) => {
    const { name } = req.params;
    const args = req.body || {};

    try {
      const result = await gateway.invokeTool(name, args);
      if (result.success) {
        res.json({
          success: true,
          result: result.result,
          requestId: result.requestId,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          requestId: result.requestId,
        });
      }
    } catch (err) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    }
  });

  // SSE endpoint for real-time communication (simplified)
  app.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', tools: gateway.listTools() })}\n\n`);

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  const { http_host, http_port } = config.server;
  app.listen(http_port, http_host, () => {
    console.log(`[server] MCP Gateway HTTP server listening on http://${http_host}:${http_port}`);
    console.log(`[server] Registered tools: ${gateway.listTools().join(', ')}`);
    console.log(`[server] Endpoints:`);
    console.log(`  - GET  /health    - Health check`);
    console.log(`  - GET  /tools     - List available tools`);
    console.log(`  - POST /tools/:name - Invoke a tool`);
    console.log(`  - GET  /sse       - SSE event stream`);
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Load configuration
    const configPath = process.argv[2] || process.env.MCP_CONFIG_PATH;
    const config = loadConfig(configPath);

    console.error(`[server] Log level: ${config.log_level}`);
    console.error(`[server] Transport: ${config.server.transport}`);
    console.error(`[server] Actor: ${config.actor}`);

    // Create gateway
    const gateway = createGateway(config);

    // Start appropriate transport
    if (config.server.transport === 'http') {
      await startHttpServer(gateway, config);
    } else {
      await startStdioServer(gateway);
    }
  } catch (err) {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  }
}

// Run
main().catch((err) => {
  console.error('[server] Unhandled error:', err);
  process.exit(1);
});
