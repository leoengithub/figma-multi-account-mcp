import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

import { loadConfig } from '../../src/registry/config-loader.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

describe('loadConfig', () => {
  it('loads env-only accounts from FIGMA_API_KEY_*', async () => {
    const logger = makeLogger();

    process.env.FIGMA_API_KEY_WORK = 'figd_test_work';
    process.env.FIGMA_API_KEY_PERSONAL = 'figd_test_personal';

    const config = await loadConfig({ logger });
    expect(Object.keys(config.accounts).sort()).toEqual(['personal', 'work']);
  });
});

