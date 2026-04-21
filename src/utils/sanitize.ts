import { redactFigmaTokens } from './logger.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-redacts `figd_*` tokens from all string fields in an arbitrary payload.
 * This must be applied before returning upstream errors/results to the client.
 */
export function sanitizeUpstreamPayload<T>(value: T): T {
  if (typeof value === 'string') return redactFigmaTokens(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeUpstreamPayload) as T;
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = sanitizeUpstreamPayload(v);
  }
  return out as T;
}

