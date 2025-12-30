/**
 * Custom error classes for MCP Gateway
 */

export class GatewayError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PolicyDeniedError extends GatewayError {
  public readonly tool: string;
  public readonly reason: string;

  constructor(tool: string, reason: string) {
    super(`Policy denied: ${reason}`, 'POLICY_DENIED', 403);
    this.name = 'PolicyDeniedError';
    this.tool = tool;
    this.reason = reason;
  }
}

export class ValidationError extends GatewayError {
  public readonly field: string;

  constructor(message: string, field: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class TimeoutError extends GatewayError {
  public readonly timeoutMs: number;

  constructor(tool: string, timeoutMs: number) {
    super(`Tool ${tool} timed out after ${timeoutMs}ms`, 'TIMEOUT', 408);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ConnectorError extends GatewayError {
  public readonly connector: string;

  constructor(connector: string, message: string) {
    super(`Connector ${connector}: ${message}`, 'CONNECTOR_ERROR', 500);
    this.name = 'ConnectorError';
    this.connector = connector;
  }
}

export class ConfigError extends GatewayError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500);
    this.name = 'ConfigError';
  }
}

export class MaxBytesExceededError extends GatewayError {
  public readonly maxBytes: number;
  public readonly actualBytes: number;

  constructor(maxBytes: number, actualBytes: number) {
    super(`Response exceeded max bytes: ${actualBytes} > ${maxBytes}`, 'MAX_BYTES_EXCEEDED', 413);
    this.name = 'MaxBytesExceededError';
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

export class SecurityError extends GatewayError {
  constructor(message: string) {
    super(message, 'SECURITY_ERROR', 403);
    this.name = 'SecurityError';
  }
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}

export function errorToCode(error: unknown): string {
  if (isGatewayError(error)) {
    return error.code;
  }
  if (error instanceof Error) {
    return 'INTERNAL_ERROR';
  }
  return 'UNKNOWN_ERROR';
}
