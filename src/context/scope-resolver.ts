import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

export interface ScopeResolver {
  resolve(extra: RequestHandlerExtra<ServerRequest, ServerNotification>): string;
}

export function createScopeResolver(): ScopeResolver {
  return {
    resolve(extra) {
      // The MCP SDK exposes a transport sessionId which is the most stable identifier we have.
      if (extra.sessionId) return `session:${extra.sessionId}`;
      return 'global';
    },
  };
}

