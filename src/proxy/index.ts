import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';

import type { AccountRegistry } from '../registry/index.js';
import type { Config } from '../registry/config-loader.js';
import type { AccountPool } from '../pool/index.js';
import type { ContextStore } from '../context/store.js';
import type { ScopeResolver } from '../context/scope-resolver.js';
import { sanitizeUpstreamPayload } from '../utils/sanitize.js';
import {
  accountSelectionRequired,
  callCancelled,
  ProxyError,
  upstreamTimeout,
  validationError,
} from '../utils/errors.js';

export interface ProxyRouter {
  routeToolCall(
    toolName: string,
    rawArgs: unknown,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<{ isError?: boolean; content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown> }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createProxyRouter(opts: {
  config: Config;
  logger: Logger;
  registry: AccountRegistry;
  pool: AccountPool;
  contextStore: ContextStore;
  scopeResolver: ScopeResolver;
}): ProxyRouter {
  const { config, logger, registry, pool, contextStore, scopeResolver } = opts;

  return {
    async routeToolCall(toolName, rawArgs, extra) {
      try {
        if (extra.signal.aborted) throw callCancelled();

        const args = rawArgs ?? {};
        if (!isRecord(args)) throw validationError('Tool arguments must be an object.');

        const { account, ...forwardArgs } = args;
        const explicitAccount = typeof account === 'string' && account.length > 0 ? account : undefined;

        const scopeKey = scopeResolver.resolve(extra);
        const sticky = contextStore.get(scopeKey);
        const selected =
          explicitAccount ??
          sticky ??
          config.default ??
          undefined;

        if (!selected) {
          throw accountSelectionRequired(registry.listAccountNames());
        }

        if (explicitAccount) {
          contextStore.set(scopeKey, selected);
        }

        const timeoutMs = config.callTimeoutMs ?? 30_000;

        const result = await pool.callTool(
          selected,
          toolName,
          forwardArgs,
          { signal: extra.signal, timeoutMs }
        );

        return sanitizeUpstreamPayload(result) as any;
      } catch (err: unknown) {
        const e = err instanceof ProxyError ? err : undefined;
        const isAbort =
          err instanceof DOMException && err.name === 'AbortError';

        const payload: Record<string, unknown> = e
          ? { code: e.code, message: e.message, ...(e.data ?? {}) }
          : isAbort
            ? { code: 'CALL_CANCELLED', message: 'Call was cancelled by the client.' }
            : { code: 'UPSTREAM_ERROR', message: err instanceof Error ? err.message : String(err) };

        // Distinguish our own timeout vs upstream cancellation
        if (!e && isAbort) {
          // already handled
        } else if (!e && /timeout/i.test(payload.message as string)) {
          const timeout = config.callTimeoutMs ?? 30_000;
          Object.assign(payload, upstreamTimeout('unknown', timeout));
        }

        logger.warn({ err: payload, toolName }, 'tool call failed');

        const structured = sanitizeUpstreamPayload(payload);
        return {
          isError: true,
          content: [{ type: 'text', text: structured.message as string }],
          structuredContent: structured,
        };
      }
    },
  };
}

