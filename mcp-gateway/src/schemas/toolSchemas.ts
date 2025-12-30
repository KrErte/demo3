/**
 * Tool Schema Definitions
 * Centralized schema definitions for all tools using Zod
 */

import { z } from 'zod';

/**
 * Common schema types
 */
export const PathSchema = z.string().min(1).describe('File or directory path');
export const UrlSchema = z.string().url().describe('Valid URL');
export const SqlSchema = z.string().min(1).describe('SQL query');

/**
 * Filesystem tool schemas
 */
export const FsReadFileArgsSchema = z.object({
  path: PathSchema.describe('Absolute or relative path to the file to read'),
  encoding: z.enum(['utf-8', 'utf8', 'base64', 'hex']).default('utf-8').describe('File encoding'),
});

export const FsListDirArgsSchema = z.object({
  path: PathSchema.describe('Absolute or relative path to the directory to list'),
  recursive: z.boolean().default(false).describe('Whether to list recursively'),
  maxDepth: z.number().min(1).max(10).default(3).describe('Maximum recursion depth'),
});

/**
 * HTTP fetch tool schemas
 */
export const WebFetchArgsSchema = z.object({
  url: UrlSchema.describe('The URL to fetch'),
  headers: z.record(z.string()).optional().describe('Optional HTTP headers'),
});

/**
 * PostgreSQL tool schemas
 */
export const DbQueryArgsSchema = z.object({
  sql: SqlSchema.describe('The SELECT SQL query to execute'),
  params: z.array(z.unknown()).optional().describe('Query parameters for prepared statement'),
});

export const DbSchemaArgsSchema = z.object({
  table: z.string().optional().describe('Optional table name to get schema for'),
  schema: z.string().default('public').describe('Database schema name'),
});

/**
 * Result schemas for documentation/validation
 */
export const FsReadFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  encoding: z.string(),
});

export const FsListDirResultSchema = z.object({
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    size: z.number().optional(),
  })),
  count: z.number(),
});

export const WebFetchResultSchema = z.object({
  url: z.string(),
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
  size: z.number(),
});

export const DbQueryResultSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().nullable(),
  fields: z.array(z.object({
    name: z.string(),
    dataTypeId: z.number(),
  })),
  truncated: z.boolean(),
  maxRows: z.number(),
});

export const DbSchemaResultSchema = z.object({
  schema: z.string(),
  tables: z.array(z.object({
    table_name: z.string(),
    table_type: z.string(),
  })).optional(),
  table: z.string().optional(),
  columns: z.array(z.object({
    column_name: z.string(),
    data_type: z.string(),
    is_nullable: z.string(),
    column_default: z.string().nullable(),
    character_maximum_length: z.number().nullable(),
  })).optional(),
});

/**
 * Export all schemas as a registry
 */
export const toolSchemas = {
  'fs.readFile': {
    input: FsReadFileArgsSchema,
    output: FsReadFileResultSchema,
  },
  'fs.listDir': {
    input: FsListDirArgsSchema,
    output: FsListDirResultSchema,
  },
  'web.fetch': {
    input: WebFetchArgsSchema,
    output: WebFetchResultSchema,
  },
  'db.query': {
    input: DbQueryArgsSchema,
    output: DbQueryResultSchema,
  },
  'db.schema': {
    input: DbSchemaArgsSchema,
    output: DbSchemaResultSchema,
  },
} as const;

export type ToolName = keyof typeof toolSchemas;
