/**
 * Audit logging for MCP Gateway
 * Records all tool invocations with metadata for compliance and debugging
 */

import { createHash, randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AuditConfig } from './config.js';

export interface AuditEvent {
  timestamp: string;
  request_id: string;
  tool: string;
  actor: string;
  args_sha256: string;
  decision: 'allow' | 'deny';
  reason: string;
  duration_ms: number;
  result_bytes: number;
  error_code?: string;
}

export interface AuditContext {
  requestId: string;
  tool: string;
  actor: string;
  args: unknown;
  startTime: number;
}

export class AuditLogger {
  private config: AuditConfig;
  private actor: string;
  private fileInitialized = false;

  constructor(config: AuditConfig, actor: string) {
    this.config = config;
    this.actor = actor;
    this.initializeFile();
  }

  private initializeFile(): void {
    if (!this.config.file_path || this.fileInitialized) return;

    try {
      const dir = dirname(this.config.file_path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.fileInitialized = true;
    } catch (err) {
      console.error(`[audit] Failed to initialize audit file: ${err}`);
    }
  }

  /**
   * Create a new audit context for a tool invocation
   */
  createContext(tool: string, args: unknown): AuditContext {
    return {
      requestId: randomUUID(),
      tool,
      actor: this.actor,
      args,
      startTime: Date.now(),
    };
  }

  /**
   * Hash arguments for privacy-preserving audit
   */
  private hashArgs(args: unknown): string {
    const str = JSON.stringify(args ?? {});
    return createHash('sha256').update(str).digest('hex');
  }

  /**
   * Calculate result size in bytes
   */
  private getResultBytes(result: unknown): number {
    if (result === undefined || result === null) return 0;
    return Buffer.byteLength(JSON.stringify(result), 'utf-8');
  }

  /**
   * Log an audit event
   */
  log(
    ctx: AuditContext,
    decision: 'allow' | 'deny',
    reason: string,
    result?: unknown,
    errorCode?: string
  ): void {
    if (!this.config.enabled) return;

    const event: AuditEvent = {
      timestamp: new Date().toISOString(),
      request_id: ctx.requestId,
      tool: ctx.tool,
      actor: ctx.actor,
      args_sha256: this.hashArgs(ctx.args),
      decision,
      reason,
      duration_ms: Date.now() - ctx.startTime,
      result_bytes: this.getResultBytes(result),
      ...(errorCode && { error_code: errorCode }),
    };

    this.writeEvent(event);
  }

  /**
   * Log a successful tool execution
   */
  logSuccess(ctx: AuditContext, result: unknown): void {
    this.log(ctx, 'allow', 'execution_success', result);
  }

  /**
   * Log a policy denial
   */
  logDenied(ctx: AuditContext, reason: string): void {
    this.log(ctx, 'deny', reason, undefined, 'POLICY_DENIED');
  }

  /**
   * Log an error during execution
   */
  logError(ctx: AuditContext, errorCode: string, errorMessage: string): void {
    this.log(ctx, 'allow', `error: ${errorMessage}`, undefined, errorCode);
  }

  /**
   * Write event to configured outputs
   */
  private writeEvent(event: AuditEvent): void {
    const eventJson = JSON.stringify(event);

    // Always write to stdout for debugging/collection
    console.log(`[audit] ${eventJson}`);

    // Optionally write to file
    if (this.config.file_path && this.fileInitialized) {
      try {
        appendFileSync(this.config.file_path, eventJson + '\n');
      } catch (err) {
        console.error(`[audit] Failed to write to audit file: ${err}`);
      }
    }
  }
}

/**
 * Create a no-op audit logger for testing
 */
export function createNoOpAuditLogger(): AuditLogger {
  return new AuditLogger({ enabled: false, include_args: false, include_result: false }, 'test-user');
}
