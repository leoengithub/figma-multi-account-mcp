import { loadConfig } from './registry/config-loader.js';
import { createAccountRegistry } from './registry/index.js';
import { createLogger } from './utils/logger.js';
import { createAccountPool } from './pool/index.js';
import { createContextStore } from './context/store.js';
import { createScopeResolver } from './context/scope-resolver.js';
import { createProxyRouter } from './proxy/index.js';
import { startProxyServer } from './server.js';
import { validateAccountsOnStartup } from './pool/startup-validation.js';

async function main() {
  const logger = createLogger();
  const config = await loadConfig({ logger });
  const registry = createAccountRegistry({ config });

  logger.info(
    { accounts: registry.listAccountNames(), default: config.default ?? null },
    'figma-multi-mcp starting'
  );

  const pool = await createAccountPool({ config, registry, logger });
  const contextStore = createContextStore({
    ttlMs: config.stickyContextTtlMs ?? 60 * 60 * 1000,
  });
  const scopeResolver = createScopeResolver();
  const router = createProxyRouter({
    config,
    logger,
    registry,
    pool,
    contextStore,
    scopeResolver,
  });

  const shutdown = async () => {
    try {
      await pool.close();
    } catch (err) {
      logger.warn({ err }, 'shutdown failed');
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await validateAccountsOnStartup({ pool, registry, logger });
  await startProxyServer({ logger, registry, pool, router });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

