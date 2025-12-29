import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger, createNoOpAuditLogger } from '../src/core/audit.js';

describe('AuditLogger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('createContext', () => {
    it('creates context with unique request ID', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');

      const ctx1 = logger.createContext('test.tool', { foo: 'bar' });
      const ctx2 = logger.createContext('test.tool', { foo: 'bar' });

      expect(ctx1.requestId).toBeDefined();
      expect(ctx2.requestId).toBeDefined();
      expect(ctx1.requestId).not.toBe(ctx2.requestId);
    });

    it('includes tool name and actor', () => {
      const logger = new AuditLogger({ enabled: true }, 'my-actor');

      const ctx = logger.createContext('my.tool', { arg: 'value' });

      expect(ctx.tool).toBe('my.tool');
      expect(ctx.actor).toBe('my-actor');
    });
  });

  describe('log', () => {
    it('writes JSON event to console when enabled', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', { foo: 'bar' });

      logger.log(ctx, 'allow', 'test reason', { result: 'data' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('[audit]');
      expect(logCall).toContain('test.tool');
      expect(logCall).toContain('test-actor');
    });

    it('does not log when disabled', () => {
      const logger = new AuditLogger({ enabled: false }, 'test-actor');
      const ctx = logger.createContext('test.tool', {});

      logger.log(ctx, 'allow', 'test reason');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('hashes arguments for privacy', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', { secret: 'password123' });

      logger.log(ctx, 'allow', 'test reason');

      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).not.toContain('password123');
      expect(logCall).toContain('args_sha256');
    });

    it('includes duration_ms', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', {});

      // Small delay to ensure duration > 0
      logger.log(ctx, 'allow', 'test reason');

      const logCall = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logCall.replace('[audit] ', ''));
      expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('logSuccess', () => {
    it('logs with allow decision', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', {});

      logger.logSuccess(ctx, { result: 'success' });

      const logCall = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logCall.replace('[audit] ', ''));
      expect(parsed.decision).toBe('allow');
      expect(parsed.reason).toBe('execution_success');
    });
  });

  describe('logDenied', () => {
    it('logs with deny decision', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', {});

      logger.logDenied(ctx, 'policy violation');

      const logCall = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logCall.replace('[audit] ', ''));
      expect(parsed.decision).toBe('deny');
      expect(parsed.reason).toBe('policy violation');
      expect(parsed.error_code).toBe('POLICY_DENIED');
    });
  });

  describe('logError', () => {
    it('logs with error code', () => {
      const logger = new AuditLogger({ enabled: true }, 'test-actor');
      const ctx = logger.createContext('test.tool', {});

      logger.logError(ctx, 'TIMEOUT', 'Request timed out');

      const logCall = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logCall.replace('[audit] ', ''));
      expect(parsed.decision).toBe('allow');
      expect(parsed.error_code).toBe('TIMEOUT');
    });
  });

  describe('createNoOpAuditLogger', () => {
    it('returns logger that does not log', () => {
      const logger = createNoOpAuditLogger();
      const ctx = logger.createContext('test.tool', {});

      logger.log(ctx, 'allow', 'test');
      logger.logSuccess(ctx, {});
      logger.logDenied(ctx, 'reason');
      logger.logError(ctx, 'CODE', 'message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});
