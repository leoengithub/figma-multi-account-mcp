import { describe, expect, it } from 'vitest';

import { accountSelectionRequired } from '../../src/utils/errors.js';

describe('errors', () => {
  it('ACCOUNT_SELECTION_REQUIRED includes machine-readable fields', () => {
    const err = accountSelectionRequired(['work', 'personal']);
    expect(err.code).toBe('ACCOUNT_SELECTION_REQUIRED');
    expect(err.data?.availableAccounts).toEqual(['work', 'personal']);
    expect(err.data?.hint).toBeTypeOf('string');
    expect(err.data?.code).toBe('ACCOUNT_SELECTION_REQUIRED');
  });
});

