import { describe, expect, it } from 'vitest';

import {
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
  downloadFeatureUnlockPluginId,
  downloadFeatureUnlockVersion,
  finalThemeUnlockVersion,
  isDownloadFeatureUnlockCode,
  isFinalThemeUnlockCode,
  proOnlyThemePresets,
} from './featureUnlocks';

describe('feature unlock codes', () => {
  it('uses a fixed plugin marker for downloads unlocks', () => {
    expect(downloadFeatureUnlockPluginId).toBe('echo.downloads-unlock');
    expect(downloadFeatureUnlockVersion).toBe('plugin:echo.downloads-unlock:v1');
  });

  it('only accepts the hidden downloads acknowledgement key', () => {
    expect(isDownloadFeatureUnlockCode('legacy-download-key')).toBe(false);
    expect(isDownloadFeatureUnlockCode('legacy passphrase')).toBe(false);
    expect(isDownloadFeatureUnlockCode('zimin')).toBe(false);
    expect(isDownloadFeatureUnlockCode('genshin impact')).toBe(true);
    expect(isDownloadFeatureUnlockCode('  Genshin Impact  ')).toBe(true);
    expect(isDownloadFeatureUnlockCode('')).toBe(false);
  });

  it('uses the donator plugin marker for Pro theme unlocks and rejects all text keys', () => {
    expect(finalThemeUnlockVersion).toBe('plugin:echo.connect-donator-unlock:pro-themes-v1');
    expect(isFinalThemeUnlockCode('FINAL-8K-7Q4M-H2ND-2026')).toBe(false);
    expect(isFinalThemeUnlockCode('final-8k-7q4m-h2nd-2026')).toBe(false);
    expect(isFinalThemeUnlockCode(' FINAL-8K-7Q4M-H2ND-2026 ')).toBe(false);
    expect(isFinalThemeUnlockCode('finalaudio')).toBe(false);
    expect(isFinalThemeUnlockCode('')).toBe(false);
  });

  it('uses a fixed account verifier marker for Connect donator unlocks', () => {
    expect(connectDonatorUnlockPluginId).toBe('echo.connect-donator-unlock');
    expect(connectDonatorUnlockVersion).toBe('plugin:echo.connect-donator-unlock:v1');
  });

  it('locks premium built-in themes behind the donator unlock', () => {
    expect(proOnlyThemePresets).toEqual(['nyanCat', 'darkSideMoon', 'FINAL']);
  });
});
