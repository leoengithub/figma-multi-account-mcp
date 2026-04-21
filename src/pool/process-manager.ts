import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Logger } from 'pino';

import { accountUnavailable, npxNotFound } from '../utils/errors.js';
import type { ResolvedAccount } from '../registry/index.js';

export type AccountState = 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export interface ManagedProcess {
  get state(): AccountState;
  get pid(): number | null;
  client(): Client;
  close(): Promise<void>;
}

function assertCommandAvailable(command: string): void {
  if (command === 'npx' && !process.env.PATH) {
    throw npxNotFound(process.env.PATH);
  }
}

function minimalEnvForChild(token: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot; // windows
  env.FIGMA_API_KEY = token;
  return env;
}

export async function spawnAccountProcess(opts: {
  account: ResolvedAccount;
  command: string;
  args: string[];
  logger: Logger;
}): Promise<ManagedProcess> {
  const { account, command, args, logger } = opts;

  assertCommandAvailable(command);

  const transport = new StdioClientTransport({
    command,
    args,
    env: minimalEnvForChild(account.token),
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'figma-multi-mcp', version: '0.1.0' },
    { capabilities: {} }
  );

  let state: AccountState = 'DEGRADED';

  transport.onerror = (err) => {
    logger.warn({ account: account.name, err }, 'upstream transport error');
  };
  transport.onclose = () => {
    logger.warn({ account: account.name }, 'upstream transport closed');
    state = 'UNAVAILABLE';
  };

  try {
    await transport.start();
    await client.connect(transport);
  } catch (err: unknown) {
    throw accountUnavailable(account.name, err instanceof Error ? err.message : String(err));
  }

  return {
    get state() {
      return state;
    },
    get pid() {
      return transport.pid;
    },
    client() {
      if (state === 'UNAVAILABLE') throw accountUnavailable(account.name);
      return client;
    },
    async close() {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    },
  };
}

