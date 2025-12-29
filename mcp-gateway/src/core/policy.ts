/**
 * Policy engine for MCP Gateway
 * Enforces allow/deny rules, argument validation, timeouts, and byte limits
 */

import type { PolicyConfig, ToolPolicy } from './config.js';
import { PolicyDeniedError, MaxBytesExceededError, TimeoutError } from './errors.js';

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  effectivePolicy: EffectivePolicy;
}

export interface EffectivePolicy {
  timeoutMs: number;
  maxBytes: number;
  argAllowlist?: Record<string, unknown>;
}

export class PolicyEngine {
  private config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = config;
  }

  /**
   * Check if a tool invocation is allowed by policy
   */
  checkPolicy(tool: string, args: Record<string, unknown>): PolicyDecision {
    const effectivePolicy = this.getEffectivePolicy(tool);

    // Check explicit deny list first
    if (this.config.deny_tools.includes(tool)) {
      return {
        allowed: false,
        reason: `Tool "${tool}" is in deny_tools list`,
        effectivePolicy,
      };
    }

    // Check per-tool policy
    const toolPolicy = this.config.per_tool[tool];
    if (toolPolicy) {
      if (toolPolicy.allow === false) {
        return {
          allowed: false,
          reason: `Tool "${tool}" is explicitly denied in per_tool policy`,
          effectivePolicy,
        };
      }

      // Check argument allowlist if specified
      if (toolPolicy.arg_allowlist) {
        const argCheck = this.checkArgAllowlist(args, toolPolicy.arg_allowlist);
        if (!argCheck.allowed) {
          return {
            allowed: false,
            reason: argCheck.reason,
            effectivePolicy,
          };
        }
      }

      if (toolPolicy.allow === true) {
        return {
          allowed: true,
          reason: 'Allowed by per_tool policy',
          effectivePolicy,
        };
      }
    }

    // Check allow list
    if (this.config.allow_tools.includes(tool)) {
      return {
        allowed: true,
        reason: `Tool "${tool}" is in allow_tools list`,
        effectivePolicy,
      };
    }

    // Default deny if default_deny is true
    if (this.config.default_deny) {
      return {
        allowed: false,
        reason: `Tool "${tool}" not in allow_tools and default_deny is enabled`,
        effectivePolicy,
      };
    }

    return {
      allowed: true,
      reason: 'Allowed by default (default_deny is false)',
      effectivePolicy,
    };
  }

  /**
   * Get effective policy settings for a tool (merges global and per-tool)
   */
  getEffectivePolicy(tool: string): EffectivePolicy {
    const toolPolicy = this.config.per_tool[tool] || {};

    return {
      timeoutMs: toolPolicy.timeout_ms ?? this.config.global_timeout_ms,
      maxBytes: toolPolicy.max_bytes ?? this.config.global_max_bytes,
      argAllowlist: toolPolicy.arg_allowlist,
    };
  }

  /**
   * Check if arguments match the allowlist
   * Simple implementation: checks if provided arg keys are in allowlist
   * and optionally validates exact values
   */
  private checkArgAllowlist(
    args: Record<string, unknown>,
    allowlist: Record<string, unknown>
  ): { allowed: boolean; reason: string } {
    for (const [key, value] of Object.entries(args)) {
      // Check if key is allowed
      if (!(key in allowlist)) {
        return {
          allowed: false,
          reason: `Argument "${key}" is not in arg_allowlist`,
        };
      }

      const allowedValue = allowlist[key];

      // If allowlist value is true, any value is allowed for this key
      if (allowedValue === true) {
        continue;
      }

      // If allowlist value is an array, check if value is in array
      if (Array.isArray(allowedValue)) {
        if (!allowedValue.includes(value)) {
          return {
            allowed: false,
            reason: `Argument "${key}" value not in allowed values: ${JSON.stringify(allowedValue)}`,
          };
        }
        continue;
      }

      // If allowlist value is a string starting with "regex:", match against regex
      if (typeof allowedValue === 'string' && allowedValue.startsWith('regex:')) {
        const pattern = allowedValue.slice(6);
        const regex = new RegExp(pattern);
        if (typeof value !== 'string' || !regex.test(value)) {
          return {
            allowed: false,
            reason: `Argument "${key}" does not match pattern: ${pattern}`,
          };
        }
        continue;
      }

      // Otherwise, require exact match
      if (value !== allowedValue) {
        return {
          allowed: false,
          reason: `Argument "${key}" must equal: ${JSON.stringify(allowedValue)}`,
        };
      }
    }

    return { allowed: true, reason: 'Arguments match allowlist' };
  }

  /**
   * Enforce policy on a tool call - throws if denied
   */
  enforce(tool: string, args: Record<string, unknown>): EffectivePolicy {
    const decision = this.checkPolicy(tool, args);
    if (!decision.allowed) {
      throw new PolicyDeniedError(tool, decision.reason);
    }
    return decision.effectivePolicy;
  }

  /**
   * Check if result exceeds max bytes
   */
  enforceMaxBytes(result: unknown, maxBytes: number): void {
    const size = Buffer.byteLength(JSON.stringify(result), 'utf-8');
    if (size > maxBytes) {
      throw new MaxBytesExceededError(maxBytes, size);
    }
  }

  /**
   * Execute a handler with timeout enforcement
   */
  async executeWithTimeout<T>(
    tool: string,
    handler: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(tool, timeoutMs));
      }, timeoutMs);

      handler()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

/**
 * Create a default restrictive policy
 */
export function createDefaultPolicy(): PolicyConfig {
  return {
    default_deny: true,
    allow_tools: [],
    deny_tools: [],
    per_tool: {},
    global_timeout_ms: 30000,
    global_max_bytes: 10 * 1024 * 1024,
  };
}
