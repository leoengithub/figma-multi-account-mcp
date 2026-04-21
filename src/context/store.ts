export interface ContextStore {
  get(scopeKey: string): string | undefined;
  set(scopeKey: string, accountName: string): void;
  clear(scopeKey: string): void;
}

type Entry = {
  accountName: string;
  expiresAtMs: number;
};

export function createContextStore(opts: { ttlMs: number; now?: () => number }): ContextStore {
  const ttlMs = opts.ttlMs;
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();

  function touch(scopeKey: string, entry: Entry) {
    entry.expiresAtMs = now() + ttlMs;
    entries.set(scopeKey, entry);
  }

  return {
    get(scopeKey: string) {
      const entry = entries.get(scopeKey);
      if (!entry) return undefined;
      if (entry.expiresAtMs <= now()) {
        entries.delete(scopeKey);
        return undefined;
      }
      // sliding TTL
      touch(scopeKey, entry);
      return entry.accountName;
    },
    set(scopeKey: string, accountName: string) {
      touch(scopeKey, { accountName, expiresAtMs: now() + ttlMs });
    },
    clear(scopeKey: string) {
      entries.delete(scopeKey);
    },
  };
}

