/**
 * PostgreSQL Read-Only Connector
 * Provides db.query (SELECT only) and db.schema tools with SQL injection prevention
 */

import pg from 'pg';
import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';
import type { PostgresConfig } from '../core/config.js';
import { SecurityError, ConnectorError, TimeoutError } from '../core/errors.js';

const { Pool } = pg;

/**
 * SQL keywords that indicate write operations (blocked)
 */
const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'EXECUTE',
  'CALL',
  'COPY',
  'LOAD',
  'SET',
  'LOCK',
  'UNLOCK',
];

/**
 * Validate that a SQL query is read-only
 */
function validateReadOnlyQuery(sql: string): void {
  // Normalize SQL for checking
  const normalizedSql = sql
    .replace(/--.*$/gm, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .toUpperCase();

  // Block semicolons to prevent query chaining
  if (normalizedSql.includes(';')) {
    const parts = normalizedSql.split(';').filter(p => p.trim().length > 0);
    if (parts.length > 1) {
      throw new SecurityError('Multiple statements not allowed. Only single SELECT queries are permitted.');
    }
  }

  // Check for blocked keywords at word boundaries
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalizedSql)) {
      throw new SecurityError(`SQL keyword "${keyword}" is not allowed. Only SELECT queries are permitted.`);
    }
  }

  // Verify query starts with SELECT, WITH, or EXPLAIN
  const allowedStarts = ['SELECT', 'WITH', 'EXPLAIN'];
  const queryStart = normalizedSql.split(/\s+/)[0];
  if (!allowedStarts.includes(queryStart)) {
    throw new SecurityError(
      `Query must start with SELECT, WITH, or EXPLAIN. Got: ${queryStart}`
    );
  }

  // Block dangerous functions
  const dangerousFunctions = [
    'PG_READ_FILE',
    'PG_WRITE_FILE',
    'PG_FILE_WRITE',
    'LO_IMPORT',
    'LO_EXPORT',
    'COPY',
  ];
  for (const func of dangerousFunctions) {
    if (normalizedSql.includes(func)) {
      throw new SecurityError(`Function "${func}" is not allowed for security reasons.`);
    }
  }
}

/**
 * Create a database connection pool
 */
function createPool(config: PostgresConfig): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

/**
 * Create PostgreSQL connector tools
 */
export function createPostgresTools(config: PostgresConfig): ToolDefinition[] {
  if (!config.enabled) {
    return [];
  }

  if (!config.database || !config.user) {
    console.warn('[postgres] Connector enabled but database or user not configured');
    return [];
  }

  const pool = createPool(config);

  const tools: ToolDefinition[] = [];

  // db.query tool (SELECT only)
  const querySchema = z.object({
    sql: z.string().describe('The SELECT SQL query to execute'),
    params: z.array(z.unknown()).optional().describe('Query parameters for prepared statement'),
  });

  tools.push({
    name: 'db.query',
    description: 'Execute a read-only SQL query (SELECT only). Use parameterized queries for safety.',
    inputSchema: querySchema,
    handler: async (args) => {
      const { sql, params } = querySchema.parse(args);

      // Validate query is read-only
      validateReadOnlyQuery(sql);

      try {
        const client = await pool.connect();
        try {
          // Set statement timeout
          await client.query(`SET statement_timeout = ${config.query_timeout_ms}`);

          // Execute query with parameters
          const result = await client.query(sql, params || []);

          // Limit rows returned
          const rows = result.rows.slice(0, config.max_rows);
          const truncated = result.rows.length > config.max_rows;

          return {
            rows,
            rowCount: result.rowCount,
            fields: result.fields.map(f => ({
              name: f.name,
              dataTypeId: f.dataTypeID,
            })),
            truncated,
            maxRows: config.max_rows,
          };
        } finally {
          client.release();
        }
      } catch (err) {
        if (err instanceof SecurityError) {
          throw err;
        }
        const pgError = err as { code?: string; message?: string };
        if (pgError.code === '57014') {
          throw new TimeoutError('db.query', config.query_timeout_ms);
        }
        throw new ConnectorError('postgres', `Query failed: ${pgError.message || 'Unknown error'}`);
      }
    },
  });

  // db.schema tool (introspection)
  const schemaSchema = z.object({
    table: z.string().optional().describe('Optional table name to get schema for'),
    schema: z.string().default('public').describe('Database schema name'),
  });

  tools.push({
    name: 'db.schema',
    description: 'Get database schema information. Lists tables or columns for a specific table.',
    inputSchema: schemaSchema,
    handler: async (args) => {
      const { table, schema } = schemaSchema.parse(args);

      try {
        const client = await pool.connect();
        try {
          await client.query(`SET statement_timeout = ${config.query_timeout_ms}`);

          if (table) {
            // Get columns for specific table
            const result = await client.query(
              `SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position`,
              [schema, table]
            );

            return {
              table,
              schema,
              columns: result.rows,
            };
          } else {
            // List all tables
            const result = await client.query(
              `SELECT
                table_name,
                table_type
              FROM information_schema.tables
              WHERE table_schema = $1
              ORDER BY table_name`,
              [schema]
            );

            return {
              schema,
              tables: result.rows,
            };
          }
        } finally {
          client.release();
        }
      } catch (err) {
        const pgError = err as { message?: string };
        throw new ConnectorError('postgres', `Schema query failed: ${pgError.message || 'Unknown error'}`);
      }
    },
  });

  // Cleanup on process exit
  process.on('beforeExit', () => {
    pool.end().catch(console.error);
  });

  return tools;
}
