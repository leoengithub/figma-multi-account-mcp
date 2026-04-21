import { describe, expect, it } from 'vitest';

import { sanitizeUpstreamPayload } from '../../src/utils/sanitize.js';

describe('sanitizeUpstreamPayload', () => {
  it('redacts figd_* tokens anywhere in payload', () => {
    const input = {
      message: 'bad token figd_abc123',
      nested: {
        arr: ['ok', 'figd_xyz789'],
      },
    };
    const out = sanitizeUpstreamPayload(input);
    expect(out.message).toContain('figd_[REDACTED]');
    expect(out.nested.arr[1]).toContain('figd_[REDACTED]');
  });
});

