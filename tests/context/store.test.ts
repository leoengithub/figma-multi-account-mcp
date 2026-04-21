import { describe, expect, it } from 'vitest';

import { createContextStore } from '../../src/context/store.js';

describe('ContextStore', () => {
  it('expires entries after ttl', () => {
    let t = 1000;
    const store = createContextStore({ ttlMs: 10, now: () => t });
    store.set('scope', 'work');
    expect(store.get('scope')).toBe('work');
    t += 11;
    expect(store.get('scope')).toBeUndefined();
  });

  it('uses sliding ttl on get', () => {
    let t = 1000;
    const store = createContextStore({ ttlMs: 10, now: () => t });
    store.set('scope', 'work');
    t += 5;
    expect(store.get('scope')).toBe('work'); // refresh
    t += 6;
    expect(store.get('scope')).toBe('work'); // still alive because refreshed
  });
});

