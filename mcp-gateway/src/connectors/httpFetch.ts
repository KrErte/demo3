/**
 * HTTP Fetch Connector
 * Provides web.fetch tool with domain allowlist and safety limits
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/mcp.js';
import type { HttpFetchConfig } from '../core/config.js';
import { SecurityError, ConnectorError, MaxBytesExceededError, TimeoutError } from '../core/errors.js';

/**
 * Check if a domain is allowed
 */
function isDomainAllowed(url: string, allowedDomains: string[], deniedDomains: string[]): boolean {
  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  // Check denied domains first (takes precedence)
  for (const denied of deniedDomains) {
    const normalizedDenied = denied.toLowerCase();
    if (hostname === normalizedDenied || hostname.endsWith('.' + normalizedDenied)) {
      return false;
    }
  }

  // Check allowed domains
  if (allowedDomains.length === 0) {
    return false; // No allowed domains means nothing is allowed
  }

  for (const allowed of allowedDomains) {
    const normalizedAllowed = allowed.toLowerCase();
    // Match exact domain or subdomain
    if (hostname === normalizedAllowed || hostname.endsWith('.' + normalizedAllowed)) {
      return true;
    }
    // Handle wildcard prefix
    if (normalizedAllowed.startsWith('*.')) {
      const baseDomain = normalizedAllowed.slice(2);
      if (hostname === baseDomain || hostname.endsWith('.' + baseDomain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate URL for safety
 */
function validateUrl(url: string, config: HttpFetchConfig): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SecurityError(`Invalid URL: ${url}`);
  }

  // Only allow http and https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SecurityError(`Invalid protocol: ${parsed.protocol}. Only http and https are allowed.`);
  }

  // Block localhost and internal IPs in production
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const blockedPatterns = [
    /^10\./,           // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./,     // 192.168.0.0/16
    /^169\.254\./,     // Link-local
  ];

  if (blockedHosts.includes(hostname)) {
    throw new SecurityError(`Access to ${hostname} is blocked for security reasons`);
  }

  for (const pattern of blockedPatterns) {
    if (pattern.test(hostname)) {
      throw new SecurityError(`Access to internal IP ranges is blocked: ${hostname}`);
    }
  }

  // Check domain allowlist
  if (!isDomainAllowed(url, config.allowed_domains, config.denied_domains)) {
    throw new SecurityError(`Domain not in allowed list: ${hostname}`);
  }

  return parsed;
}

/**
 * Create HTTP fetch connector tools
 */
export function createHttpFetchTools(config: HttpFetchConfig): ToolDefinition[] {
  if (!config.enabled) {
    return [];
  }

  const tools: ToolDefinition[] = [];

  // web.fetch tool (GET only for safety)
  const fetchSchema = z.object({
    url: z.string().url().describe('The URL to fetch'),
    headers: z.record(z.string()).optional().describe('Optional HTTP headers'),
  });

  tools.push({
    name: 'web.fetch',
    description: 'Fetch content from a URL (GET only). Only works for allowed domains.',
    inputSchema: fetchSchema,
    handler: async (args) => {
      const { url, headers } = fetchSchema.parse(args);
      const validatedUrl = validateUrl(url, config);

      // Prepare headers - block potentially dangerous headers
      const safeHeaders: Record<string, string> = {};
      const blockedHeaders = ['authorization', 'cookie', 'x-api-key', 'api-key'];

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (!blockedHeaders.includes(key.toLowerCase())) {
            safeHeaders[key] = value;
          }
        }
      }

      // Add user agent
      safeHeaders['User-Agent'] = 'MCP-Gateway/1.0';

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout_ms);

        const response = await fetch(validatedUrl.toString(), {
          method: 'GET',
          headers: safeHeaders,
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeoutId);

        // Check content length before reading
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > config.max_response_bytes) {
          throw new MaxBytesExceededError(config.max_response_bytes, parseInt(contentLength, 10));
        }

        // Read response with size limit
        const reader = response.body?.getReader();
        if (!reader) {
          throw new ConnectorError('http_fetch', 'No response body');
        }

        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > config.max_response_bytes) {
            reader.cancel();
            throw new MaxBytesExceededError(config.max_response_bytes, totalSize);
          }

          chunks.push(value);
        }

        // Combine chunks and decode
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const decoder = new TextDecoder('utf-8');
        const body = decoder.decode(combined);

        // Extract useful headers
        const responseHeaders: Record<string, string> = {};
        const includeHeaders = ['content-type', 'content-length', 'last-modified', 'etag'];
        for (const header of includeHeaders) {
          const value = response.headers.get(header);
          if (value) {
            responseHeaders[header] = value;
          }
        }

        return {
          url: response.url,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body,
          size: totalSize,
        };
      } catch (err) {
        if (err instanceof SecurityError || err instanceof MaxBytesExceededError) {
          throw err;
        }
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            throw new TimeoutError('web.fetch', config.timeout_ms);
          }
          throw new ConnectorError('http_fetch', `Fetch failed: ${err.message}`);
        }
        throw new ConnectorError('http_fetch', 'Unknown fetch error');
      }
    },
  });

  return tools;
}
