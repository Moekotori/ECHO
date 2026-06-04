import { describe, expect, it } from 'vitest';
import { sanitizeAccountData } from './sanitizeAccountData';

describe('sanitizeAccountData', () => {
  it('redacts account secrets recursively', () => {
    const safe = sanitizeAccountData({
      cookie: 'a=b',
      token: 'secret-token',
      nested: {
        session: 'secret-session',
        csrf: 'secret-csrf',
        authorization: 'Bearer abc123',
        password: 'secret-password',
      },
    });

    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(safe).toEqual({
      cookie: '[redacted]',
      token: '[redacted]',
      nested: {
        session: '[redacted]',
        csrf: '[redacted]',
        authorization: '[redacted]',
        password: '[redacted]',
      },
    });
  });
});
