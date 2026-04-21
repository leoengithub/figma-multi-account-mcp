import { loadConfig } from './registry/config-loader.js';
import { createAccountRegistry } from './registry/index.js';
import { createLogger } from './utils/logger.js';
import { createAccountPool } from './pool/index.js';
import { createContextStore } from './context/store.js';
import { createScopeResolver } from './context/scope-resolver.js';
import { createProxyRouter } from './proxy/index.js';
import { startProxyServer } from './server.js';
import { validateAccountsOnStartup } from './pool/startup-validation.js';
import { parseCliFlags, printHelp } from './utils/cli.js';

async function main() {
  const logger = createLogger();
  const config = await loadConfig({ logger });
  const registry = createAccountRegistry({ config });

  const flags = parseCliFlags(process.argv);
  if (flags.help) {
    printHelp();
    return;
  }
  if (flags.listAccounts) {
    process.stdout.write(registry.listAccountNames().join('\n') + '\n');
    return;
  }

  logger.info(
    { accounts: registry.listAccountNames(), default: config.default ?? null },
    'figma-multi-mcp starting'
  );

  const pool = await createAccountPool({ config, registry, logger });
  const contextStore = createContextStore({
    ttlMs: config.stickyContextTtlMs ?? 60 * 60 * 1000,
  });

  if (flags.clearContext) {
    if (flags.clearContextKey) contextStore.clear(flags.clearContextKey);
    else contextStore.clearAll();
    process.stdout.write('ok\n');
    await pool.close();
    return;
  }

  const scopeResolver = createScopeResolver();
  const router = createProxyRouter({
    config,
    logger,
    registry,
    pool,
    contextStore,
    scopeResolver,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const timeoutMs = 5000;
    const timeout = setTimeout(() => {
      logger.warn({ timeoutMs }, 'forced shutdown');
      process.exit(1);
    }, timeoutMs);

    try {
      await pool.close();
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      clearTimeout(timeout);
      logger.warn({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await validateAccountsOnStartup({ pool, registry, logger });
  await startProxyServer({ logger, registry, pool, router });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

