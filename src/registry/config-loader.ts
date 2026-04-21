import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from 'pino';

const AccountConfigSchema = z.object({
  token: z.string().min(1),
  label: z.string().min(1).optional(),
});

const ConfigSchema = z.object({
  accounts: z.record(AccountConfigSchema),
  default: z.string().min(1).optional(),
  mcpCommand: z.array(z.string().min(1)).optional(),
  callTimeoutMs: z.number().int().positive().optional(),
  stickyContextTtlMs: z.number().int().positive().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_MCP_COMMAND = ['npx', '-y', 'figma-developer-mcp', '--stdio'] as const;

type PartialConfig = Omit<Partial<Config>, 'accounts'> & {
  accounts?: Config['accounts'];
};

type ParsedPartialConfig = Omit<Partial<Config>, 'accounts'> & {
  accounts?: Config['accounts'] | undefined;
};

function envKeyForAccount(account: string): string {
  return `FIGMA_API_KEY_${account.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`;
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
}

function mergeConfig(base: Config, override: PartialConfig): Config {
  return {
    ...base,
    ...override,
    accounts: {
      ...base.accounts,
      ...(override.accounts ?? {}),
    },
  };
}

function toPartialConfig(parsed: ParsedPartialConfig): PartialConfig {
  const { accounts, ...rest } = parsed;
  return accounts ? { ...rest, accounts } : rest;
}

export async function loadConfig(opts: { logger: Logger }): Promise<Config> {
  const logger = opts.logger;
  const projectLocalPath = path.resolve(process.cwd(), '.figma-mcp.local.json');
  const homePath = path.join(os.homedir(), '.figma-mcp', 'config.json');

  const base: Config = {
    accounts: {},
    mcpCommand: [...DEFAULT_MCP_COMMAND],
    callTimeoutMs: 30_000,
    stickyContextTtlMs: 60 * 60 * 1000,
  };

  const localRaw = await readJsonIfExists(projectLocalPath);
  const homeRaw = await readJsonIfExists(homePath);

  let merged = base;
  if (homeRaw) {
    merged = mergeConfig(merged, toPartialConfig(ConfigSchema.partial().parse(homeRaw)));
  }
  if (localRaw) {
    merged = mergeConfig(merged, toPartialConfig(ConfigSchema.partial().parse(localRaw)));
  }

  // env var overrides for configured accounts
  const accountsFromEnv: Record<string, { token: string }> = {};
  for (const accountName of Object.keys(merged.accounts)) {
    const key = envKeyForAccount(accountName);
    const token = process.env[key];
    if (token) accountsFromEnv[accountName] = { token };
  }

  // env-only accounts: FIGMA_API_KEY_<ACCOUNT>
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('FIGMA_API_KEY_') || !v) continue;
    const accountName = k
      .slice('FIGMA_API_KEY_'.length)
      .toLowerCase()
      .replaceAll('_', '-');
    if (!accountName) continue;
    accountsFromEnv[accountName] = { token: v };
  }

  merged = mergeConfig(merged, { accounts: accountsFromEnv });

  // Apply defaults if absent
  const final = ConfigSchema.parse({
    ...merged,
    mcpCommand:
      merged.mcpCommand && merged.mcpCommand.length > 0
        ? merged.mcpCommand
        : [...DEFAULT_MCP_COMMAND],
    callTimeoutMs: merged.callTimeoutMs ?? 30_000,
    stickyContextTtlMs: merged.stickyContextTtlMs ?? 60 * 60 * 1000,
  });

  if (Object.keys(final.accounts).length === 0) {
    logger.warn(
      { lookedAt: [projectLocalPath, homePath] },
      'No accounts configured yet'
    );
  }

  return final;
}
