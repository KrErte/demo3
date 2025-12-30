/**
 * Filesystem Connector
 * Provides fs.readFile and fs.listDir tools with path allowlist enforcement
 */

import { readFile, readdir, stat } from 'fs/promises';
import { resolve, normalize, dirname } from 'path';
import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';
import type { FilesystemConfig } from '../core/config.js';
import { SecurityError, ConnectorError } from '../core/errors.js';

/**
 * Check if a path is within allowed paths
 */
function isPathAllowed(targetPath: string, allowedPaths: string[], deniedPaths: string[]): boolean {
  const normalizedTarget = normalize(resolve(targetPath));

  // Check denied paths first (takes precedence)
  for (const denied of deniedPaths) {
    const normalizedDenied = normalize(resolve(denied));
    if (normalizedTarget.startsWith(normalizedDenied)) {
      return false;
    }
  }

  // Check allowed paths
  if (allowedPaths.length === 0) {
    return false; // No allowed paths means nothing is allowed
  }

  for (const allowed of allowedPaths) {
    const normalizedAllowed = normalize(resolve(allowed));
    if (normalizedTarget.startsWith(normalizedAllowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate and normalize a path, preventing path traversal attacks
 */
function validatePath(path: string, allowedPaths: string[], deniedPaths: string[]): string {
  // Resolve to absolute path
  const normalizedPath = normalize(resolve(path));

  // Check for path traversal attempts
  if (path.includes('..')) {
    // Re-check after normalization to ensure it's still in allowed paths
    if (!isPathAllowed(normalizedPath, allowedPaths, deniedPaths)) {
      throw new SecurityError(`Path traversal attempt detected: ${path}`);
    }
  }

  if (!isPathAllowed(normalizedPath, allowedPaths, deniedPaths)) {
    throw new SecurityError(`Path not in allowed paths: ${path}`);
  }

  return normalizedPath;
}

/**
 * Create filesystem connector tools
 */
export function createFilesystemTools(config: FilesystemConfig): ToolDefinition[] {
  if (!config.enabled) {
    return [];
  }

  const tools: ToolDefinition[] = [];

  // fs.readFile tool
  const readFileSchema = z.object({
    path: z.string().describe('Absolute or relative path to the file to read'),
    encoding: z.enum(['utf-8', 'utf8', 'base64', 'hex']).default('utf-8').describe('File encoding'),
  });

  tools.push({
    name: 'fs.readFile',
    description: 'Read the contents of a file. Only works for files in allowed paths.',
    inputSchema: readFileSchema,
    handler: async (args) => {
      const { path, encoding } = readFileSchema.parse(args);
      const normalizedPath = validatePath(path, config.allowed_paths, config.denied_paths);

      try {
        // Check file size before reading
        const stats = await stat(normalizedPath);
        if (stats.size > config.max_file_size) {
          throw new SecurityError(
            `File size ${stats.size} exceeds max allowed ${config.max_file_size} bytes`
          );
        }

        if (!stats.isFile()) {
          throw new ConnectorError('filesystem', `Path is not a file: ${path}`);
        }

        const bufferEncoding = encoding === 'utf8' ? 'utf-8' : encoding;
        const content = await readFile(normalizedPath, { encoding: bufferEncoding as BufferEncoding });
        return {
          path: normalizedPath,
          content,
          size: stats.size,
          encoding: bufferEncoding,
        };
      } catch (err) {
        if (err instanceof SecurityError || err instanceof ConnectorError) {
          throw err;
        }
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          throw new ConnectorError('filesystem', `File not found: ${path}`);
        }
        if (error.code === 'EACCES') {
          throw new ConnectorError('filesystem', `Permission denied: ${path}`);
        }
        throw new ConnectorError('filesystem', `Failed to read file: ${error.message}`);
      }
    },
  });

  // fs.listDir tool
  const listDirSchema = z.object({
    path: z.string().describe('Absolute or relative path to the directory to list'),
    recursive: z.boolean().default(false).describe('Whether to list recursively'),
    maxDepth: z.number().min(1).max(10).default(3).describe('Maximum recursion depth'),
  });

  tools.push({
    name: 'fs.listDir',
    description: 'List contents of a directory. Only works for directories in allowed paths.',
    inputSchema: listDirSchema,
    handler: async (args) => {
      const { path, recursive, maxDepth } = listDirSchema.parse(args);
      const normalizedPath = validatePath(path, config.allowed_paths, config.denied_paths);

      try {
        const stats = await stat(normalizedPath);
        if (!stats.isDirectory()) {
          throw new ConnectorError('filesystem', `Path is not a directory: ${path}`);
        }

        const entries = await listDirectory(normalizedPath, recursive, maxDepth, 0, config);
        return {
          path: normalizedPath,
          entries,
          count: entries.length,
        };
      } catch (err) {
        if (err instanceof SecurityError || err instanceof ConnectorError) {
          throw err;
        }
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          throw new ConnectorError('filesystem', `Directory not found: ${path}`);
        }
        if (error.code === 'EACCES') {
          throw new ConnectorError('filesystem', `Permission denied: ${path}`);
        }
        throw new ConnectorError('filesystem', `Failed to list directory: ${error.message}`);
      }
    },
  });

  return tools;
}

/**
 * Recursively list directory contents
 */
async function listDirectory(
  dirPath: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number,
  config: FilesystemConfig
): Promise<Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }>> {
  const entries: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }> = [];

  const dirEntries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of dirEntries) {
    const entryPath = resolve(dirPath, entry.name);

    // Skip entries in denied paths
    if (!isPathAllowed(entryPath, config.allowed_paths, config.denied_paths)) {
      continue;
    }

    if (entry.isFile()) {
      const stats = await stat(entryPath);
      entries.push({
        name: entry.name,
        path: entryPath,
        type: 'file',
        size: stats.size,
      });
    } else if (entry.isDirectory()) {
      entries.push({
        name: entry.name,
        path: entryPath,
        type: 'directory',
      });

      if (recursive && currentDepth < maxDepth) {
        const subEntries = await listDirectory(
          entryPath,
          recursive,
          maxDepth,
          currentDepth + 1,
          config
        );
        entries.push(...subEntries);
      }
    }
  }

  return entries;
}
