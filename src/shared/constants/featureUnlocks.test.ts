import { describe, expect, it } from 'vitest';

import {
  downloadFeatureUnlockCode,
  isDownloadFeatureUnlockCode,
  isFinalThemeUnlockCode,
} from './featureUnlocks';

describe('feature unlock codes', () => {
  it('accepts the existing download unlock code', () => {
    expect(isDownloadFeatureUnlockCode(downloadFeatureUnlockCode)).toBe(true);
  });

  it('accepts the genshin impact download unlock passphrase', () => {
    expect(isDownloadFeatureUnlockCode('genshin impact')).toBe(true);
    expect(isDownloadFeatureUnlockCode(' Genshin Impact ')).toBe(true);
  });

  it('rejects unknown download unlock input', () => {
    expect(isDownloadFeatureUnlockCode('zimin')).toBe(false);
    expect(isDownloadFeatureUnlockCode('')).toBe(false);
  });

  it('accepts only the exact FINAL theme unlock key', () => {
    expect(isFinalThemeUnlockCode('FINAL-8K-7Q4M-H2ND-2026')).toBe(true);
    expect(isFinalThemeUnlockCode('final-8k-7q4m-h2nd-2026')).toBe(false);
    expect(isFinalThemeUnlockCode(' FINAL-8K-7Q4M-H2ND-2026 ')).toBe(false);
    expect(isFinalThemeUnlockCode('finalaudio')).toBe(false);
    expect(isFinalThemeUnlockCode('')).toBe(false);
  });
});
