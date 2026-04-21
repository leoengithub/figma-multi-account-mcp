import type { Config } from './config-loader.js';
import { accountNotFound } from '../utils/errors.js';

export interface ResolvedAccount {
  name: string;
  token: string;
  label?: string;
}

export interface AccountRegistry {
  listAccountNames(): string[];
  resolve(name: string): ResolvedAccount;
}

export function createAccountRegistry(opts: { config: Config }): AccountRegistry {
  const { config } = opts;

  return {
    listAccountNames() {
      return Object.keys(config.accounts).sort();
    },
    resolve(name: string) {
      const entry = config.accounts[name];
      if (!entry) {
        throw accountNotFound(name);
      }
      return {
        name,
        token: entry.token,
        ...(entry.label ? { label: entry.label } : {}),
      };
    },
  };
}

