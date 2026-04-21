import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Logger } from 'pino';

import type { AccountRegistry, ResolvedAccount } from '../registry/index.js';
import type { Config } from '../registry/config-loader.js';
import { accountUnavailable } from '../utils/errors.js';
import { spawnAccountProcess, type ManagedProcess } from './process-manager.js';

type ClientEntry = {
  process: ManagedProcess;
  // Serialize calls per upstream stdio transport.
  queue: Promise<unknown>;
};

export interface AccountPool {
  listAccounts(): ResolvedAccount[];
  getClient(accountName: string): Promise<Client>;
  callTool(accountName: string, toolName: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<unknown>;
  close(): Promise<void>;
  getHealthyClientForDiscovery(): Promise<{ accountName: string; client: Client }>;
}

export async function createAccountPool(opts: {
  config: Config;
  registry: AccountRegistry;
  logger: Logger;
}): Promise<AccountPool> {
  const { config, registry, logger } = opts;
  const accounts = registry.listAccountNames().map((name) => registry.resolve(name));

  const entries = new Map<string, ClientEntry>();

  async function ensureEntry(account: ResolvedAccount): Promise<ClientEntry> {
    const existing = entries.get(account.name);
    if (existing) return existing;

    const cmd = config.mcpCommand?.[0] ?? 'npx';
    const args = (config.mcpCommand?.slice(1) ?? ['-y', 'figma-developer-mcp', '--stdio']) as string[];

    const proc = await spawnAccountProcess({
      account,
      command: cmd,
      args,
      logger,
    });

    const entry: ClientEntry = { process: proc, queue: Promise.resolve() };
    entries.set(account.name, entry);
    return entry;
  }

  async function withSerialized<T>(entry: ClientEntry, fn: () => Promise<T>): Promise<T> {
    const next = entry.queue.then(fn, fn);
    entry.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  return {
    listAccounts() {
      return accounts;
    },
    async getClient(accountName: string) {
      const account = registry.resolve(accountName);
      const entry = await ensureEntry(account);
      return entry.process.client();
    },
    async callTool(accountName, toolName, args, { signal, timeoutMs }) {
      const account = registry.resolve(accountName);
      const entry = await ensureEntry(account);

      return withSerialized(entry, async () => {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });

        try {
          const client = entry.process.client();
          const result = await client.callTool(
            { name: toolName, arguments: args },
            undefined,
            { signal: controller.signal, timeout: timeoutMs }
          );
          return result;
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
        }
      });
    },
    async getHealthyClientForDiscovery() {
      const errors: Array<{ account: string; error: string }> = [];
      for (const account of accounts) {
        try {
          const entry = await ensureEntry(account);
          return { accountName: account.name, client: entry.process.client() };
        } catch (err: unknown) {
          errors.push({
            account: account.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      throw accountUnavailable('all', JSON.stringify(errors));
    },
    async close() {
      await Promise.all(
        Array.from(entries.values()).map(async (e) => {
          await e.process.close();
        })
      );
    },
  };
}

