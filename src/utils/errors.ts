export type ProxyErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_SELECTION_REQUIRED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'NPX_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'CALL_CANCELLED';

export class ProxyError extends Error {
  readonly code: ProxyErrorCode;
  readonly data: Record<string, unknown> | undefined;

  constructor(code: ProxyErrorCode, message: string, data?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'ProxyError';
  }
}

export function accountNotFound(name: string): ProxyError {
  return new ProxyError('ACCOUNT_NOT_FOUND', `Account "${name}" not found.`, { name });
}

export function accountSelectionRequired(availableAccounts: string[]): ProxyError {
  return new ProxyError(
    'ACCOUNT_SELECTION_REQUIRED',
    `No Figma account selected. Please specify one of: ${availableAccounts.join(', ')}.`,
    {
      availableAccounts,
      hint: 'Pass the account name as the `account` argument on your next call. It will be remembered for the rest of this session.',
    }
  );
}

export function accountUnavailable(name: string, reason?: string): ProxyError {
  return new ProxyError(
    'ACCOUNT_UNAVAILABLE',
    `Account "${name}" is unavailable${reason ? `: ${reason}` : ''}.`,
    { name, reason }
  );
}

export function npxNotFound(pathValue?: string): ProxyError {
  return new ProxyError(
    'NPX_NOT_FOUND',
    'npx was not found on PATH. Please install Node.js (>= 18) so npx is available.',
    { PATH: pathValue ?? null }
  );
}

export function validationError(message: string, details?: Record<string, unknown>): ProxyError {
  return new ProxyError('VALIDATION_ERROR', message, details);
}

export function upstreamTimeout(toolName: string, timeoutMs: number): ProxyError {
  return new ProxyError(
    'UPSTREAM_TIMEOUT',
    `Upstream did not respond within ${timeoutMs}ms.`,
    { toolName, timeoutMs }
  );
}

export function callCancelled(): ProxyError {
  return new ProxyError('CALL_CANCELLED', 'Call was cancelled by the client.');
}

