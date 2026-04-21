import type { Logger } from 'pino';

import type { AccountPool } from './index.js';
import type { AccountRegistry } from '../registry/index.js';

/**
 * Best-effort startup validation. If `whoami` exists, we call it for each account to
 * validate token/network. Fail hard only if all accounts fail to even respond.
 */
export async function validateAccountsOnStartup(opts: {
  pool: AccountPool;
  registry: AccountRegistry;
  logger: Logger;
}): Promise<void> {
  const { pool, registry, logger } = opts;

  if (process.env.FIGMA_MULTI_MCP_SKIP_STARTUP_VALIDATION === '1') {
    logger.warn('Skipping startup validation due to FIGMA_MULTI_MCP_SKIP_STARTUP_VALIDATION=1');
    return;
  }

  const { client } = await pool.getHealthyClientForDiscovery();
  const tools = await client.listTools();
  const hasWhoami = tools.tools.some((t) => t.name === 'whoami');

  if (!hasWhoami) {
    logger.warn('Upstream does not expose whoami; skipping startup token validation');
    return;
  }

  // Keep startup light: validate only the first healthy account.
  // This avoids eagerly spawning/validating every account (Phase 2 lazy-spawn goal).
  const first = registry.listAccountNames()[0];
  if (!first) return;

  try {
    await pool.callTool(first, 'whoami', {}, { timeoutMs: 15_000 });
  } catch (err) {
    logger.warn({ account: first, err }, 'startup whoami validation failed');
  }
}

