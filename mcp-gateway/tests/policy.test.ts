import { describe, it, expect } from 'vitest';
import { PolicyEngine, createDefaultPolicy } from '../src/core/policy.js';
import { PolicyDeniedError, MaxBytesExceededError, TimeoutError } from '../src/core/errors.js';

describe('PolicyEngine', () => {
  describe('checkPolicy', () => {
    it('denies all tools by default when default_deny is true', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: [],
        deny_tools: [],
        per_tool: {},
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('any.tool', {});
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('default_deny');
    });

    it('allows tools in allow_tools list', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: ['fs.readFile'],
        deny_tools: [],
        per_tool: {},
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {});
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('allow_tools');
    });

    it('denies tools in deny_tools list', () => {
      const engine = new PolicyEngine({
        default_deny: false,
        allow_tools: ['fs.readFile'],
        deny_tools: ['fs.readFile'],
        per_tool: {},
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {});
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('deny_tools');
    });

    it('respects per_tool allow setting', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: [],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: true,
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {});
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('per_tool');
    });

    it('respects per_tool deny setting', () => {
      const engine = new PolicyEngine({
        default_deny: false,
        allow_tools: ['fs.readFile'],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: false,
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {});
      expect(decision.allowed).toBe(false);
    });
  });

  describe('arg_allowlist', () => {
    it('allows args matching allowlist', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: [],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: true,
            arg_allowlist: {
              path: true,
              encoding: ['utf-8', 'base64'],
            },
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {
        path: '/any/path',
        encoding: 'utf-8',
      });
      expect(decision.allowed).toBe(true);
    });

    it('denies args not in allowlist', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: [],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: true,
            arg_allowlist: {
              path: true,
            },
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {
        path: '/any/path',
        unknownArg: 'value',
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('unknownArg');
    });

    it('denies args with invalid values', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: [],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: true,
            arg_allowlist: {
              encoding: ['utf-8', 'base64'],
            },
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const decision = engine.checkPolicy('fs.readFile', {
        encoding: 'binary',
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('encoding');
    });
  });

  describe('enforce', () => {
    it('throws PolicyDeniedError when denied', () => {
      const engine = new PolicyEngine(createDefaultPolicy());

      expect(() => engine.enforce('any.tool', {})).toThrow(PolicyDeniedError);
    });

    it('returns effective policy when allowed', () => {
      const engine = new PolicyEngine({
        default_deny: true,
        allow_tools: ['fs.readFile'],
        deny_tools: [],
        per_tool: {
          'fs.readFile': {
            allow: true,
            timeout_ms: 5000,
            max_bytes: 1024,
          },
        },
        global_timeout_ms: 30000,
        global_max_bytes: 1000000,
      });

      const policy = engine.enforce('fs.readFile', {});
      expect(policy.timeoutMs).toBe(5000);
      expect(policy.maxBytes).toBe(1024);
    });
  });

  describe('enforceMaxBytes', () => {
    it('throws MaxBytesExceededError when result too large', () => {
      const engine = new PolicyEngine(createDefaultPolicy());

      const largeResult = { data: 'x'.repeat(1000) };
      expect(() => engine.enforceMaxBytes(largeResult, 100)).toThrow(MaxBytesExceededError);
    });

    it('does not throw when result within limit', () => {
      const engine = new PolicyEngine(createDefaultPolicy());

      const smallResult = { data: 'small' };
      expect(() => engine.enforceMaxBytes(smallResult, 1000)).not.toThrow();
    });
  });

  describe('executeWithTimeout', () => {
    it('returns result when handler completes in time', async () => {
      const engine = new PolicyEngine(createDefaultPolicy());

      const result = await engine.executeWithTimeout(
        'test.tool',
        async () => 'success',
        1000
      );
      expect(result).toBe('success');
    });

    it('throws TimeoutError when handler exceeds timeout', async () => {
      const engine = new PolicyEngine(createDefaultPolicy());

      await expect(
        engine.executeWithTimeout(
          'test.tool',
          async () => new Promise(resolve => setTimeout(resolve, 100)),
          10
        )
      ).rejects.toThrow(TimeoutError);
    });
  });
});
