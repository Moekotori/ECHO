import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '../../../i18n/locales';
import { getPlaybackOutputModeLabel, getPlaybackRecommendationText } from './playbackSettingsModel';
import { zhCN } from '../../../i18n/locales/zhCN';

const translate = (key: TranslationKey): string => zhCN[key] ?? key;

describe('platform playback guidance', () => {
  it('distinguishes the system fallback from native shared output on macOS', () => {
    expect(getPlaybackOutputModeLabel('system', translate, 'darwin')).toBe(translate('settings.playback.outputMode.system'));
    expect(getPlaybackOutputModeLabel('shared', translate, 'darwin')).toBe('CoreAudio Shared');
    expect(getPlaybackOutputModeLabel('exclusive', translate, 'darwin')).toBe('CoreAudio Exclusive');
  });

  it('uses macOS output names in recommendations while preserving Windows guidance', () => {
    for (const key of [
      'settings.playback.recommendedPath.shared.title',
      'settings.playback.recommendedPath.device.body',
      'settings.playback.recommendedPath.advanced.body',
      'settings.playback.outputMode.description',
    ] as const) {
      expect(getPlaybackRecommendationText(key, translate, 'darwin')).not.toMatch(/WASAPI|ASIO/);
      expect(getPlaybackRecommendationText(key, translate, 'win32')).toBe(translate(key));
    }
  });
});
