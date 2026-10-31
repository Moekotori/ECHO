import type { AppSettings } from '../../../../shared/types/appSettings';
import type { MvSettings, NetworkMvProviderId } from '../../../../shared/types/mv';

export const mvNetworkProviders: NetworkMvProviderId[] = ['bilibili', 'youtube'];

export const mvProviderLabels: Record<NetworkMvProviderId, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
};

export const mvQualityCaps: MvSettings['maxQuality'][] = ['720p', '1080p', '1440p', '2160p', 'max'];

export const mvSyncModes = ['stable', 'balanced', 'precise'] satisfies Array<NonNullable<MvSettings['syncMode']>>;

export const mvImmersiveBackgroundDefaults = {
  immersiveBackgroundScalePercent: 115,
  immersiveBackgroundOffsetXPercent: 50,
  immersiveBackgroundOffsetYPercent: 50,
  immersiveBackgroundBlurPx: 0,
  immersiveBackgroundBrightnessPercent: 100,
  immersiveBackgroundOverlayOpacityPercent: 0,
} satisfies Partial<MvSettings>;

const hasOwn = <T extends object>(value: T, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const formatMvThreshold = (threshold: number | undefined): string =>
  `${Math.round((threshold ?? 0.7) * 100)}%`;

export const mvThresholdFromPercent = (value: number): number =>
  Math.max(30, Math.min(100, Math.round(value))) / 100;

export const normalizeMvProviderOrder = (value: NetworkMvProviderId[] | undefined): NetworkMvProviderId[] => {
  const ordered = (value ?? mvNetworkProviders).filter(
    (provider): provider is NetworkMvProviderId => mvNetworkProviders.includes(provider),
  );
  const missing = mvNetworkProviders.filter((provider) => !ordered.includes(provider));
  return [...ordered, ...missing];
};

export const appSettingsPatchFromMvSettingsPatch = (patch: Partial<MvSettings>): Partial<AppSettings> => {
  const appPatch: Partial<AppSettings> = {};

  if (hasOwn(patch, 'enabled')) {
    appPatch.mvEnabled = patch.enabled;
  }
  if (hasOwn(patch, 'enabledProviders') && patch.enabledProviders) {
    appPatch.mvEnabledProviders = patch.enabledProviders;
  }
  if (hasOwn(patch, 'providerOrder') && patch.providerOrder) {
    appPatch.mvProviderOrder = patch.providerOrder;
  }
  if (hasOwn(patch, 'autoSearch') && patch.autoSearch !== undefined) {
    appPatch.mvAutoSearch = patch.autoSearch;
  }
  if (hasOwn(patch, 'autoPreload')) {
    appPatch.mvAutoPreload = patch.autoPreload;
  }
  if (hasOwn(patch, 'autoApplyThreshold')) {
    appPatch.mvAutoApplyThreshold = patch.autoApplyThreshold;
  }
  if (hasOwn(patch, 'titleOnlySearch')) {
    appPatch.mvTitleOnlySearch = patch.titleOnlySearch;
  }
  if (hasOwn(patch, 'preferHighestViewCount')) {
    appPatch.mvPreferHighestViewCount = patch.preferHighestViewCount;
  }
  if (hasOwn(patch, 'immersiveBackground')) {
    appPatch.mvImmersiveBackground = patch.immersiveBackground;
  }
  if (hasOwn(patch, 'immersiveBackgroundScalePercent')) {
    appPatch.mvImmersiveBackgroundScalePercent = patch.immersiveBackgroundScalePercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOffsetXPercent')) {
    appPatch.mvImmersiveBackgroundOffsetXPercent = patch.immersiveBackgroundOffsetXPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOffsetYPercent')) {
    appPatch.mvImmersiveBackgroundOffsetYPercent = patch.immersiveBackgroundOffsetYPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundBlurPx')) {
    appPatch.mvImmersiveBackgroundBlurPx = patch.immersiveBackgroundBlurPx;
  }
  if (hasOwn(patch, 'immersiveBackgroundBrightnessPercent')) {
    appPatch.mvImmersiveBackgroundBrightnessPercent = patch.immersiveBackgroundBrightnessPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOverlayOpacityPercent')) {
    appPatch.mvImmersiveBackgroundOverlayOpacityPercent = patch.immersiveBackgroundOverlayOpacityPercent;
  }
  if (hasOwn(patch, 'lyricsReadabilityEnhanced')) {
    appPatch.mvLyricsReadabilityEnhanced = patch.lyricsReadabilityEnhanced;
  }
  if (hasOwn(patch, 'restartAudioOnLoad')) {
    appPatch.mvRestartAudioOnLoad = patch.restartAudioOnLoad;
  }
  if (hasOwn(patch, 'syncMode')) {
    appPatch.mvSyncMode = patch.syncMode;
  }
  if (hasOwn(patch, 'replayAudioOnChange')) {
    appPatch.mvReplayAudioOnChange = patch.replayAudioOnChange;
  }
  if (hasOwn(patch, 'maxQuality') && patch.maxQuality) {
    appPatch.mvMaxQuality = patch.maxQuality;
  }
  if (hasOwn(patch, 'allow60fps') && patch.allow60fps !== undefined) {
    appPatch.mvAllow60fps = patch.allow60fps;
  }

  return appPatch;
};

export const normalizeExternalAppSettingsPatch = (
  patch: Partial<AppSettings> | Partial<MvSettings>,
): Partial<AppSettings> => ({
  ...(patch as Partial<AppSettings>),
  ...appSettingsPatchFromMvSettingsPatch(patch as Partial<MvSettings>),
});
