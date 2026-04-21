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

  const { client } = await pool.getHealthyClientForDiscovery();
  const tools = await client.listTools();
  const hasWhoami = tools.tools.some((t) => t.name === 'whoami');

  if (!hasWhoami) {
    logger.warn('Upstream does not expose whoami; skipping startup token validation');
    return;
  }

  const accounts = registry.listAccountNames();
  let successes = 0;
  await Promise.all(
    accounts.map(async (name) => {
      try {
        await pool.callTool(name, 'whoami', {}, { timeoutMs: 15_000 });
        successes += 1;
      } catch (err) {
        logger.warn({ account: name, err }, 'startup whoami validation failed');
      }
    })
  );

  if (successes === 0) {
    throw new Error('All accounts failed startup validation (whoami).');
  }
}

