import { Gauge, Globe2, Headphones, RotateCw, ShieldAlert, SlidersHorizontal, Volume2, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  AudioDeviceInfo,
  AudioExportFormat,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioSharedBackend,
  AudioStatus,
  ChannelBalanceState,
  PlaybackSpeedMode,
} from '../../../../shared/types/audio';
import type { Locale } from '../../../i18n/locales';
import type { TranslationKey } from '../../../i18n/locales';
import {
  detectRendererPlatform,
  isAdvancedNativeOutputPlatform,
  isExclusiveNativeOutputPlatform,
  isNativeSharedOutputPlatform,
} from '../../../../shared/utils/audioPlatformCapabilities';

export const automixTemporarilyDisabled = false;
export const playbackAdvancedPanelExpandedStorageKey =
  'echo:settings:playback:advanced-panel-expanded';
export const playbackSeekedEvent = 'playback:seeked';

export const dispatchPlaybackSeeked = (positionSeconds: number, trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(playbackSeekedEvent, { detail: { positionSeconds, trackId } }));
};

export const defaultSettingsChannelBalance: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
};

export const hasNonMonoChannelBalanceEffect = (state: ChannelBalanceState): boolean =>
  Math.abs(state.balance) > 0.001 ||
  Math.abs(state.leftGainDb) > 0.001 ||
  Math.abs(state.rightGainDb) > 0.001 ||
  Math.abs(state.leftDelayMs ?? 0) > 0.001 ||
  Math.abs(state.rightDelayMs ?? 0) > 0.001 ||
  state.swapLeftRight ||
  state.invertLeft ||
  state.invertRight ||
  state.constantPower === false;

export const deviceMatchesAudioStatus = (device: AudioDeviceInfo, status: AudioStatus | null): boolean => {
  if (!status) {
    return false;
  }

  if (status.outputMode === 'system') {
    return false;
  }

  const modeMatches = device.outputMode === status.outputMode;
  if (!modeMatches) {
    return false;
  }

  return status.outputDeviceId === device.id || status.outputDeviceName === device.name;
};

export const playbackSpeedModes: Array<{ mode: PlaybackSpeedMode; label: string }> = [
  { mode: 'nightcore', label: 'Nightcore' },
  { mode: 'daycore', label: 'Daycore' },
  { mode: 'speed', label: '普通变速' },
];

export const playbackNoSoundGuideSteps: Array<{
  id: string;
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}> = [
  {
    id: 'output-mode',
    icon: Zap,
    titleKey: 'settings.playback.noSoundGuide.step.outputMode.title',
    bodyKey: 'settings.playback.noSoundGuide.step.outputMode',
  },
  {
    id: 'backend',
    icon: SlidersHorizontal,
    titleKey: 'settings.playback.noSoundGuide.step.backend.title',
    bodyKey: 'settings.playback.noSoundGuide.step.backend',
  },
  {
    id: 'device',
    icon: Headphones,
    titleKey: 'settings.playback.noSoundGuide.step.device.title',
    bodyKey: 'settings.playback.noSoundGuide.step.device',
  },
  {
    id: 'windows-volume',
    icon: Volume2,
    titleKey: 'settings.playback.noSoundGuide.step.windowsVolume.title',
    bodyKey: 'settings.playback.noSoundGuide.step.windowsVolume',
  },
  {
    id: 'sample-rate',
    icon: Gauge,
    titleKey: 'settings.playback.noSoundGuide.step.sampleRate.title',
    bodyKey: 'settings.playback.noSoundGuide.warningSampleRate',
  },
  {
    id: 'drivers',
    icon: ShieldAlert,
    titleKey: 'settings.playback.noSoundGuide.step.drivers.title',
    bodyKey: 'settings.playback.noSoundGuide.warningDrivers',
  },
  {
    id: 'restart',
    icon: RotateCw,
    titleKey: 'settings.playback.noSoundGuide.step.restart.title',
    bodyKey: 'settings.playback.noSoundGuide.step.restart',
  },
  {
    id: 'streaming',
    icon: Globe2,
    titleKey: 'settings.playback.noSoundGuide.step.streaming.title',
    bodyKey: 'settings.playback.noSoundGuide.streamingNote',
  },
];


export type ShufflePlaybackModeOption = {
  id: 'library' | 'avoid-recent' | 'pseudo-random';
  avoidRecentCount: number;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
};

export const shufflePlaybackModeOptions: ShufflePlaybackModeOption[] = [
  {
    id: 'library',
    avoidRecentCount: 0,
    labelKey: 'settings.playback.shuffleCredibility.mode.library',
    descriptionKey: 'settings.playback.shuffleCredibility.mode.library.description',
  },
  {
    id: 'avoid-recent',
    avoidRecentCount: 25,
    labelKey: 'settings.playback.shuffleCredibility.mode.avoidRecent',
    descriptionKey: 'settings.playback.shuffleCredibility.mode.avoidRecent.description',
  },
  {
    id: 'pseudo-random',
    avoidRecentCount: 100,
    labelKey: 'settings.playback.shuffleCredibility.mode.pseudoRandom',
    descriptionKey: 'settings.playback.shuffleCredibility.mode.pseudoRandom.description',
  },
];

export const getShufflePlaybackModeId = (avoidRecentCount: number): ShufflePlaybackModeOption['id'] => {
  if (avoidRecentCount <= 0) {
    return 'library';
  }
  if (avoidRecentCount >= 50) {
    return 'pseudo-random';
  }
  return 'avoid-recent';
};

export const mouseGestureTrackSwitchSettingId = 'settings-row-mouse-gesture-track-switch';

export const mouseGestureTrackSwitchCopy = {
  title: {
    'zh-CN': '鼠标手势切歌',
    'zh-TW': '滑鼠手勢切歌',
    'ja-JP': 'マウスジェスチャーで曲を切り替える',
    'en-US': 'Switch tracks with mouse gestures',
    'ko-KR': '마우스 제스처로 곡 전환',
  },
  description: {
    'zh-CN': '在底部播放栏或歌词页按住鼠标左键横划，切换上一首或下一首。竖划、点按钮和歌词文字不会切歌。',
    'zh-TW': '在底部播放列或歌詞頁按住滑鼠左鍵橫向滑動，切換上一首或下一首。直向滑動、點按鈕和歌詞文字不會切歌。',
    'ja-JP': '下部プレーヤーまたは歌詞ページを左ボタンで横にドラッグすると前後の曲へ切り替わります。縦方向、ボタン、歌詞テキストは対象外です。',
    'en-US': 'Drag horizontally with the left mouse button on the bottom player or lyrics page to change tracks. Vertical drags, buttons, and lyric text stay put.',
    'ko-KR': '하단 플레이어나 가사 페이지에서 마우스 왼쪽 버튼으로 가로로 드래그하면 곡이 바뀝니다. 세로 드래그, 버튼, 가사 글자는 바뀌지 않습니다.',
  },
} as const satisfies Record<'title' | 'description', Record<Locale, string>>;

export const audioExportFormatOptions: Array<{ format: AudioExportFormat; label: string }> = [
  { format: 'mp3', label: 'MP3' },
  { format: 'wav', label: 'WAV' },
  { format: 'flac', label: 'FLAC' },
  { format: 'ogg', label: 'OGG' },
];

export const normalizeSharedBackend = (value: unknown): AudioSharedBackend =>
  value === 'windows' || value === 'directsound' || value === 'alsa' ? value : 'auto';

export const normalizeLatencyProfile = (value: unknown): AudioLatencyProfile =>
  value === 'stable' || value === 'lowLatency' ? value : 'balanced';

export const playbackOutputModes: AudioOutputMode[] = ['system', 'shared', 'exclusive', 'asio'];

export const isPlaybackOutputMode = (value: unknown): value is AudioOutputMode =>
  playbackOutputModes.includes(value as AudioOutputMode);

export const detectSettingsPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

export const getPlaybackOutputModesForPlatform = (platform: NodeJS.Platform | 'unknown'): AudioOutputMode[] =>
  playbackOutputModes.filter((mode) => {
    if (mode === 'system') {
      return true;
    }

    if (mode === 'shared') {
      return isNativeSharedOutputPlatform(platform);
    }

    return mode === 'exclusive'
      ? isExclusiveNativeOutputPlatform(platform)
      : isAdvancedNativeOutputPlatform(platform);
  });

export const getPlaybackOutputModeLabel = (
  mode: AudioOutputMode,
  translate: (key: TranslationKey) => string,
  platform: NodeJS.Platform | 'unknown' = 'unknown',
): string => {
  if (platform === 'darwin' && (mode === 'shared' || mode === 'exclusive' || mode === 'system')) {
    return mode === 'exclusive' ? 'CoreAudio Exclusive' : 'CoreAudio Shared';
  }
  return translate(`settings.playback.outputMode.${mode}` as TranslationKey);
};

export const getSharedBackendOptionsForPlatform = (
  platform: NodeJS.Platform | 'unknown',
): Array<[AudioSharedBackend, TranslationKey]> => {
  if (platform === 'linux') {
    return [
      ['auto', 'settings.playback.sharedBackend.auto'],
      ['alsa', 'settings.playback.sharedBackend.alsa'],
    ];
  }

  if (platform === 'win32') {
    return [
      ['auto', 'settings.playback.sharedBackend.wasapi'],
      ['directsound', 'settings.playback.sharedBackend.directSound'],
    ];
  }

  return [];
};

export const getSharedBackendDescriptionKey = (platform: NodeJS.Platform | 'unknown'): TranslationKey =>
  platform === 'linux' ? 'settings.playback.sharedBackend.linuxDescription' : 'settings.playback.sharedBackend.description';

export const getCompatiblePlaybackDevices = (
  devices: AudioDeviceInfo[],
  outputMode: AudioOutputMode,
  platform: NodeJS.Platform | 'unknown' = 'win32',
): AudioDeviceInfo[] => {
  if (outputMode === 'system') {
    return [];
  }

  const deviceMode = outputMode === 'exclusive' && platform === 'darwin' ? 'shared' : outputMode;
  return devices.filter((device) => device.outputMode === deviceMode);
};
