import { describe, expect, it } from 'vitest';

import {
  downloadFeatureUnlockCode,
  isDownloadFeatureUnlockCode,
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
});
