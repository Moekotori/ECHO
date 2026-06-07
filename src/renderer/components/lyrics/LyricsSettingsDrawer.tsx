import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Captions,
  Check,
  ChevronDown,
  Database,
  EyeOff,
  FolderOpen,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  Languages,
  Lock,
  Monitor,
  Music2,
  Palette,
  Rows3,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TimerReset,
  Trash2,
  Type,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { DesktopLyricsState, DesktopLyricsStylePatch } from '../../../shared/types/desktopLyrics';
import type { LibraryTrack } from '../../../shared/types/library';
import type { MvSettings } from '../../../shared/types/mv';
import type { LyricsProviderId, LyricsSearchCandidate, LyricsSource, LyricsTrackSnapshotRequest, TrackLyrics } from '../../../shared/types/lyrics';
import { neteaseDjRadioPlaylistPrefix } from '../../../shared/types/streaming';
import { registerAppearanceFontFile } from '../../preferences/appearancePreferences';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { useOptionalPlaybackQueue } from '../../stores/PlaybackQueueProvider';
import {
  recordLyricsSourceQualityCandidates,
  recordLyricsSourceQualityOutcome,
} from './lyricsSourceQualityMemory';

type LyricsSettingsDrawerProps = {
  currentTrackTools?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
};

type LyricsSettingsPanelProps = {
  className?: string;
  currentTrackTools?: ReactNode;
  variant?: 'drawer' | 'settings';
};

type LocalFontData = {
  family: string;
};

type NavigatorWithLocalFonts = Navigator & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

type LyricsFontPickerTarget = 'lyrics' | 'desktopLyrics';

const drawerExitAnimationMs = 320;

type LyricsDrawerSettings = Pick<
  AppSettings,
  | 'lyricsNetworkEnabled'
  | 'lyricsAutoSearch'
  | 'lyricsAutoAcceptScore'
  | 'lyricsRestartOnApplyEnabled'
  | 'lyricsAutoSaveSidecarEnabled'
  | 'lyricsDefaultOffsetMs'
  | 'lyricsGlobalSyncOffsetMs'
  | 'lyricsTimelineCorrectionEnabled'
  | 'lyricsOffsetControlsEnabled'
  | 'lyricsSmartAlignmentEnabled'
  | 'lyricsPreferredProvider'
  | 'lyricsEnabledProviders'
  | 'lyricsProviderOrder'
  | 'lyricsDeepSearchEnabled'
  | 'lyricsEnabled'
  | 'lyricsHeaderHidden'
  | 'lyricsMvAutoShowTrackInfoDisabled'
  | 'lyricsCandidatePanelAutoOpenEnabled'
  | 'lyricsEmptyStateHidden'
  | 'lyricsPlayerBarDrawerEnabled'
  | 'lyricsPlayerBarDrawerAutoEnableForMv'
  | 'lyricsPlayerBarDrawerAutoHideEnabled'
  | 'lyricsPlayerBarDrawerOpacityPercent'
  | 'lyricsPlayerBarDrawerColorMode'
  | 'lyricsPlayerBarDrawerColor'
  | 'lyricsRomanizationEnabled'
  | 'lyricsUtatenKanaEnabled'
  | 'lyricsTranslationEnabled'
  | 'lyricsWordHighlightEnabled'
  | 'lyricsWordHighlightClarityPercent'
  | 'lyricsFontSizePx'
  | 'lyricsSecondaryFontSizePx'
  | 'lyricsFontFamily'
  | 'lyricsFontFilePath'
  | 'lyricsTextDirection'
  | 'lyricsLineSpacingPercent'
  | 'lyricsLineMaxChars'
  | 'lyricsContextOpacityPercent'
  | 'lyricsColor'
  | 'lyricsSmartReadableColorsEnabled'
  | 'lyricsHighResolutionNetworkCoverEnabled'
  | 'lyricsBackgroundMode'
  | 'lyricsCustomWallpaperPath'
  | 'lyricsCoverOpacityPercent'
  | 'lyricsCoverBlurPx'
  | 'lyricsCoverBrightnessPercent'
  | 'lyricsBackgroundScalePercent'
  | 'desktopLyricsFontFamily'
  | 'desktopLyricsFontFilePath'
  | 'desktopLyricsOpacityPercent'
  | 'desktopLyricsTextDirection'
  | 'desktopLyricsRomanizationEnabled'
  | 'desktopLyricsTranslationEnabled'
>;

const fallbackSettings: LyricsDrawerSettings = {
  lyricsNetworkEnabled: true,
  lyricsAutoSearch: true,
  lyricsAutoAcceptScore: 0.5,
  lyricsRestartOnApplyEnabled: false,
  lyricsAutoSaveSidecarEnabled: false,
  lyricsDefaultOffsetMs: 0,
  lyricsGlobalSyncOffsetMs: 0,
  lyricsTimelineCorrectionEnabled: true,
  lyricsOffsetControlsEnabled: true,
  lyricsSmartAlignmentEnabled: true,
  lyricsPreferredProvider: 'lrclib',
  lyricsEnabledProviders: ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'],
  lyricsProviderOrder: ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'],
  lyricsDeepSearchEnabled: true,
  lyricsEnabled: true,
  lyricsHeaderHidden: false,
  lyricsMvAutoShowTrackInfoDisabled: true,
  lyricsCandidatePanelAutoOpenEnabled: false,
  lyricsEmptyStateHidden: true,
  lyricsPlayerBarDrawerEnabled: true,
  lyricsPlayerBarDrawerAutoEnableForMv: true,
  lyricsPlayerBarDrawerAutoHideEnabled: false,
  lyricsPlayerBarDrawerOpacityPercent: 78,
  lyricsPlayerBarDrawerColorMode: 'default',
  lyricsPlayerBarDrawerColor: '#232120',
  lyricsRomanizationEnabled: true,
  lyricsUtatenKanaEnabled: false,
  lyricsTranslationEnabled: true,
  lyricsWordHighlightEnabled: true,
  lyricsWordHighlightClarityPercent: 70,
  lyricsFontSizePx: 40,
  lyricsSecondaryFontSizePx: 22,
  lyricsFontFamily: 'Microsoft YaHei',
  lyricsFontFilePath: null,
  lyricsTextDirection: 'horizontal',
  lyricsLineSpacingPercent: 110,
  lyricsLineMaxChars: 0,
  lyricsContextOpacityPercent: 49,
  lyricsColor: '#314054',
  lyricsSmartReadableColorsEnabled: false,
  lyricsHighResolutionNetworkCoverEnabled: false,
  lyricsBackgroundMode: 'theme',
  lyricsCustomWallpaperPath: null,
  lyricsCoverOpacityPercent: 100,
  lyricsCoverBlurPx: 10,
  lyricsCoverBrightnessPercent: 100,
  lyricsBackgroundScalePercent: 100,
  desktopLyricsFontFamily: 'Microsoft YaHei',
  desktopLyricsFontFilePath: null,
  desktopLyricsOpacityPercent: 96,
  desktopLyricsTextDirection: 'horizontal',
  desktopLyricsRomanizationEnabled: true,
  desktopLyricsTranslationEnabled: true,
};

const colorSwatches = ['#314054', '#FFFFFF', '#F6D365', '#8FCFBD', '#A8C7FA', '#FF8A80'];
const fallbackLyricsFontFamilies = [
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'PingFang SC',
  'PingFang TC',
  'Noto Sans SC',
  'Noto Sans TC',
  'Source Han Sans SC',
  'Source Han Sans TC',
  'SimHei',
  'SimSun',
  'Segoe UI',
  'Arial',
  'Inter',
  'Outfit',
];
const defaultLyricsEnabledProviders: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'];
const defaultLyricsProviderOrder: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'];
type OnlineLyricsProviderId = Extract<LyricsProviderId, 'lrclib' | 'amll-ttml' | 'netease' | 'qqmusic' | 'kugou' | 'kuwo'>;
const onlineLyricsProviderIds: OnlineLyricsProviderId[] = ['lrclib', 'amll-ttml', 'netease', 'qqmusic', 'kugou', 'kuwo'];
const isOnlineLyricsProvider = (provider: LyricsProviderId): provider is OnlineLyricsProviderId => onlineLyricsProviderIds.includes(provider as OnlineLyricsProviderId);
const lyricsSourceOptions = [
  { id: 'lrclib', labelKey: 'lyricsSettings.provider.lrclib', descriptionKey: 'lyricsSettings.provider.lrclibDescription' },
  { id: 'amll-ttml', labelKey: 'lyricsSettings.provider.amllTtml', descriptionKey: 'lyricsSettings.provider.amllTtmlDescription' },
  { id: 'netease', labelKey: 'lyricsSettings.provider.netease', descriptionKey: 'lyricsSettings.provider.chineseCatalogDescription' },
  { id: 'qqmusic', labelKey: 'lyricsSettings.provider.qqmusic', descriptionKey: 'lyricsSettings.provider.chineseCatalogDescription' },
  { id: 'kugou', labelKey: 'lyricsSettings.provider.kugou', descriptionKey: 'lyricsSettings.provider.chineseCatalogDescription' },
  { id: 'kuwo', labelKey: 'lyricsSettings.provider.kuwo', descriptionKey: 'lyricsSettings.provider.chineseCatalogDescription' },
] satisfies Array<{ id: LyricsProviderId; labelKey: TranslationKey; descriptionKey: TranslationKey }>;
const lyricsSourceOptionById = new Map(lyricsSourceOptions.map((source) => [source.id, source]));

const lyricsProviderLabelKeys: Record<LyricsSource, TranslationKey> = {
  none: 'lyricsSettings.provider.none',
  local: 'lyricsSettings.provider.local',
  lrclib: 'lyricsSettings.provider.lrclib',
  'amll-ttml': 'lyricsSettings.provider.amllTtml',
  netease: 'lyricsSettings.provider.netease',
  qqmusic: 'lyricsSettings.provider.qqmusic',
  kugou: 'lyricsSettings.provider.kugou',
  kuwo: 'lyricsSettings.provider.kuwo',
  musixmatch: 'lyricsSettings.provider.musixmatch',
  genius: 'lyricsSettings.provider.genius',
  manual: 'lyricsSettings.provider.manual',
  cached: 'lyricsSettings.provider.cached',
};

const providerLabelFor = (
  provider: LyricsSource | null | undefined,
  t: (key: TranslationKey, options?: Record<string, string | number>) => string = translateFallback,
): string => t(provider ? lyricsProviderLabelKeys[provider] : 'lyricsSettings.provider.none');

const lyricsTitleLabelFor = (
  lyrics: Pick<TrackLyrics, 'title'> | null | undefined,
  fallback: string,
): string => {
  const title = lyrics?.title?.trim();
  return title && title.length > 0 ? title : fallback;
};

const dispatchSettingsChanged = (patch?: Partial<AppSettings> | Partial<MvSettings>): void => {
  window.dispatchEvent(patch ? new CustomEvent('settings:changed', { detail: patch }) : new Event('settings:changed'));
};

const dispatchLyricsDisplaySettingsChanged = (patch: Partial<AppSettings>): void => {
  window.dispatchEvent(new CustomEvent('lyrics:display-settings-changed', { detail: patch }));
};

const desktopLyricsFontPanelOpenStorageKey = 'echo-next.lyrics.desktop-font-panel-open';
const lyricsDisplayPanelOpenStorageKey = 'echo-next.lyrics.display-panel-open';
const lyricsStyleControlsOpenStorageKey = 'echo-next.lyrics.style-controls-open';
const lyricsBackgroundTuningOpenStorageKey = 'echo-next.lyrics.background-tuning-open';
const lyricsSourcePanelOpenStorageKey = 'echo-next.lyrics.source-panel-open';

const readDesktopLyricsFontPanelOpen = (): boolean => {
  try {
    return window.localStorage.getItem(desktopLyricsFontPanelOpenStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeDesktopLyricsFontPanelOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(desktopLyricsFontPanelOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; desktop lyrics settings remain usable without storage.
  }
};

const readLyricsDisplayPanelOpen = (): boolean => {
  try {
    const stored = window.localStorage.getItem(lyricsDisplayPanelOpenStorageKey);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

const writeLyricsDisplayPanelOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(lyricsDisplayPanelOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; lyrics display settings remain usable without storage.
  }
};

const readLyricsStyleControlsOpen = (): boolean => {
  try {
    const stored = window.localStorage.getItem(lyricsStyleControlsOpenStorageKey);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

const writeLyricsStyleControlsOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(lyricsStyleControlsOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; lyrics display settings still work without storage.
  }
};

const readLyricsBackgroundTuningOpen = (): boolean => {
  try {
    return window.localStorage.getItem(lyricsBackgroundTuningOpenStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeLyricsBackgroundTuningOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(lyricsBackgroundTuningOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; background tuning remains usable without storage.
  }
};

const readLyricsSourcePanelOpen = (): boolean => {
  try {
    return window.localStorage.getItem(lyricsSourcePanelOpenStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeLyricsSourcePanelOpen = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(lyricsSourcePanelOpenStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI preference only; online lyrics source settings remain usable without storage.
  }
};

const pickSavedLyricsPatch = (
  settings: LyricsDrawerSettings,
  patch: Partial<AppSettings>,
): Partial<AppSettings> => {
  const settingsRecord = settings as Record<string, unknown>;
  const patchRecord = patch as Record<string, unknown>;
  const savedPatch: Record<string, unknown> = {};

  for (const key of Object.keys(patchRecord)) {
    savedPatch[key] = Object.prototype.hasOwnProperty.call(settingsRecord, key)
      ? settingsRecord[key]
      : patchRecord[key];
  }

  return savedPatch as Partial<AppSettings>;
};

const patchValuesMatch = (left: Partial<AppSettings>, right: Partial<AppSettings>): boolean => {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);

  for (const key of keys) {
    const leftValue = leftRecord[key];
    const rightValue = rightRecord[key];
    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      if (leftValue.length !== rightValue.length || leftValue.some((value, index) => value !== rightValue[index])) {
        return false;
      }
      continue;
    }

    if (!Object.is(leftValue, rightValue)) {
      return false;
    }
  }

  return true;
};

const dispatchLyricsAction = (action: 'search' | 'rematch', query?: string): void => {
  const eventName = action === 'search' ? 'lyrics:search-requested' : 'lyrics:rematch-requested';
  const normalizedQuery = query?.trim();
  window.dispatchEvent(normalizedQuery ? new CustomEvent(eventName, { detail: { query: normalizedQuery } }) : new Event(eventName));
};

const formatDuration = (durationSeconds: number | null): string => {
  if (!durationSeconds) {
    return '--:--';
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatScore = (score: number): string => `${Math.round(score * 100)}%`;
const thresholdFromPercent = (value: string): number => Math.max(30, Math.min(100, Math.round(Number(value)))) / 100;
const sanitizeFontFamily = (value: string): string => value.replace(/[\r\n;]/g, '').trim();

const LyricsFontPickerModal = ({
  currentFont,
  fonts,
  isBusy,
  onChooseFile,
  onClose,
  onSelect,
  query,
  setQuery,
}: {
  currentFont: string;
  fonts: string[];
  isBusy: boolean;
  onChooseFile: () => void;
  onClose: () => void;
  onSelect: (fontFamily: string) => void;
  query: string;
  setQuery: (query: string) => void;
}): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFonts = normalizedQuery ? fonts.filter((font) => font.toLowerCase().includes(normalizedQuery)) : fonts;

  return (
    <div className="settings-modal-backdrop lyrics-font-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-font-modal lyrics-font-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('lyricsSettings.fontPicker.aria')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-font-modal-header">
          <h3>{t('lyricsSettings.fontPicker.title')}</h3>
          <button className="settings-icon-button" type="button" onClick={onClose} aria-label={t('lyricsSettings.fontPicker.close')}>
            <X size={15} />
          </button>
        </header>
        <label className="settings-font-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder={t('lyricsSettings.fontPicker.searchPlaceholder')} />
        </label>
        <button className="settings-font-file-button" type="button" disabled={isBusy} onClick={onChooseFile}>
          <FolderOpen size={15} aria-hidden="true" />
          {t('lyricsSettings.fontPicker.chooseFile')}
        </button>
        <div className="settings-font-list">
          {filteredFonts.map((font) => (
            <button
              className={`settings-font-option ${font === currentFont ? 'active' : ''}`}
              key={font}
              type="button"
              style={{ fontFamily: `"${font}", var(--echo-font-family)` }}
              onClick={() => onSelect(font)}
            >
              <span>{font}</span>
              <em>{t('lyricsSettings.fontPicker.preview')}</em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

const riskLabel = (
  risk: LyricsSearchCandidate['risk'],
  t: (key: TranslationKey, options?: Record<string, string | number>) => string = translateFallback,
): string => {
  if (risk === 'low') return t('lyricsSettings.candidate.risk.low');
  if (risk === 'medium') return t('lyricsSettings.candidate.risk.medium');
  return t('lyricsSettings.candidate.risk.high');
};

type LyricsCandidateDisplayKind = 'instrumental' | 'synced' | 'plain' | 'lyrics';

const lyricsCandidateDisplayKind = (candidate: LyricsSearchCandidate): LyricsCandidateDisplayKind => {
  if (candidate.instrumental) return 'instrumental';
  if (candidate.hasSynced) return 'synced';
  if (candidate.hasPlain) return 'plain';
  return 'lyrics';
};

const lyricsCandidateDisplayLabelKeys: Record<LyricsCandidateDisplayKind, TranslationKey> = {
  instrumental: 'lyricsSettings.candidate.type.instrumental',
  synced: 'lyricsSettings.candidate.type.synced',
  plain: 'lyricsSettings.candidate.type.plain',
  lyrics: 'lyricsSettings.candidate.type.lyrics',
};

const lyricsCandidateReasonLabelKeys: Partial<Record<string, TranslationKey>> = {
  title_exact: 'lyricsSettings.candidate.reason.titleExact',
  title_similar: 'lyricsSettings.candidate.reason.titleSimilar',
  artist_exact: 'lyricsSettings.candidate.reason.artistExact',
  artist_mismatch: 'lyricsSettings.candidate.reason.artistMismatch',
  album_match: 'lyricsSettings.candidate.reason.albumMatch',
  duration_exact: 'lyricsSettings.candidate.reason.durationExact',
  duration_close: 'lyricsSettings.candidate.reason.durationClose',
  duration_mismatch: 'lyricsSettings.candidate.reason.durationMismatch',
  version_match: 'lyricsSettings.candidate.reason.versionMatch',
  version_conflict: 'lyricsSettings.candidate.reason.versionConflict',
  cover_intent: 'lyricsSettings.candidate.reason.coverIntent',
  candidate_only_cover: 'lyricsSettings.candidate.reason.candidateOnlyCover',
  candidate_only_duration: 'lyricsSettings.candidate.reason.candidateOnlyDuration',
  synced_duration_safe: 'lyricsSettings.candidate.reason.syncedDurationSafe',
  embedded_tag_priority: 'lyricsSettings.candidate.reason.embeddedTag',
  local_sidecar_priority: 'lyricsSettings.candidate.reason.localSidecar',
  auto_accept: 'lyricsSettings.candidate.reason.autoAccept',
  rejected_by_user: 'lyricsSettings.candidate.reason.rejectedByUser',
};

const visibleCandidateReasonLabels = (
  candidate: LyricsSearchCandidate,
  t: (key: TranslationKey, options?: Record<string, string | number>) => string = translateFallback,
): string[] =>
  (candidate.reasons ?? [])
    .map((reason) => lyricsCandidateReasonLabelKeys[reason])
    .filter((key): key is TranslationKey => Boolean(key))
    .map((key) => t(key))
    .slice(0, 3);

const sourceFilterKey = (candidate: LyricsSearchCandidate): string => `${candidate.provider}:${candidate.sourceLabel}`;
const searchableLyricsProviderIds: LyricsProviderId[] = ['local', 'lrclib', 'amll-ttml', 'netease', 'qqmusic', 'kugou', 'kuwo'];
const searchableLyricsProviderSet = new Set<string>(searchableLyricsProviderIds);

const isNeteaseDjRadioTrack = (track: LibraryTrack | null): boolean =>
  track?.mediaType === 'streaming' &&
  track.provider === 'netease' &&
  (
    track.fieldSources?.streamingSourcePlaylistId?.startsWith(neteaseDjRadioPlaylistPrefix) ||
    track.fieldSources?.streamingAlbumId?.startsWith(neteaseDjRadioPlaylistPrefix)
  );

const isNeteaseStreamingTrack = (
  track: LibraryTrack | null,
): track is LibraryTrack & { provider: 'netease'; providerTrackId: string } =>
  track?.mediaType === 'streaming' &&
  track.provider === 'netease' &&
  typeof track.providerTrackId === 'string' &&
  track.providerTrackId.trim().length > 0;

const resolveNeteaseDjRadioTrack = async (track: LibraryTrack | null): Promise<boolean> => {
  if (isNeteaseDjRadioTrack(track)) {
    return true;
  }
  if (!isNeteaseStreamingTrack(track)) {
    return false;
  }

  const sourceInfo = await window.echo?.streaming
    ?.getTrackSourceInfo?.({ provider: 'netease', providerTrackId: track.providerTrackId })
    .catch(() => null);
  return sourceInfo?.isNeteaseDjRadio === true;
};

const lyricsSnapshotRequestForTrack = (track: LibraryTrack): LyricsTrackSnapshotRequest => ({
  trackId: track.id,
  title: track.title.trim() || 'Untitled',
  artist: track.artist.trim() || track.albumArtist.trim() || 'Unknown Artist',
  album: track.album.trim() || null,
  albumArtist: track.albumArtist.trim() || null,
  durationSeconds: track.duration > 0 ? track.duration : null,
  mediaType: track.mediaType ?? 'local',
  sourceId: track.mediaType === 'streaming' ? track.providerTrackId ?? null : track.sourceId ?? null,
  stableKey: track.stableKey ?? track.id,
});

const mergeLyricsCandidates = (
  current: LyricsSearchCandidate[],
  next: LyricsSearchCandidate[],
): LyricsSearchCandidate[] => {
  const merged = new Map<string, LyricsSearchCandidate>();
  for (const candidate of [...current, ...next]) {
    const key = `${candidate.provider}:${candidate.providerLyricsId ?? candidate.id}`;
    const existing = merged.get(key);
    if (!existing || candidate.score > existing.score) {
      merged.set(key, candidate);
    }
  }

  return Array.from(merged.values()).sort((left, right) => right.score - left.score);
};

const isAutoApplyRiskAllowed = (candidate: LyricsSearchCandidate): boolean => {
  const risk = candidate.risk ?? 'low';
  if (risk === 'low') {
    return true;
  }

  const reasons = new Set(candidate.reasons ?? []);
  const titleScore = candidate.titleScore ?? (reasons.has('title_exact') ? 1 : 0);
  const artistScore = candidate.artistScore ?? (reasons.has('artist_exact') ? 1 : 0);
  const hasOnlyDurationMismatch =
    reasons.has('duration_mismatch') &&
    !reasons.has('artist_mismatch') &&
    !reasons.has('version_conflict') &&
    !reasons.has('rejected_by_user') &&
    !reasons.has('candidate_only_cover') &&
    !reasons.has('cover_intent');

  return hasOnlyDurationMismatch && titleScore >= 0.98 && artistScore >= 0.98;
};

const selectAutoApplyLyricsCandidate = (
  candidates: LyricsSearchCandidate[],
  settings: Pick<LyricsDrawerSettings, 'lyricsAutoAcceptScore' | 'lyricsAutoSearch'>,
): LyricsSearchCandidate | null => {
  if (!settings.lyricsAutoSearch) {
    return null;
  }

  const threshold = Number.isFinite(settings.lyricsAutoAcceptScore)
    ? Math.max(0.3, Math.min(1, settings.lyricsAutoAcceptScore))
    : fallbackSettings.lyricsAutoAcceptScore;

  return candidates.find(
    (candidate) =>
      candidate.score >= threshold &&
      isAutoApplyRiskAllowed(candidate) &&
      (candidate.hasSynced || candidate.hasPlain || candidate.instrumental),
  ) ?? null;
};

const dispatchLyricsCandidateApplied = (trackId: string, lyrics: TrackLyrics): void => {
  window.dispatchEvent(new CustomEvent('lyrics:candidate-applied', { detail: { trackId, lyrics } }));
};

const restartCurrentPlaybackForLyrics = async (): Promise<void> => {
  const playback = window.echo?.playback;
  if (!playback) {
    return;
  }

  await playback.seek(0);
  await playback.play();
};

const selectLyricsSettings = (settings: AppSettings): LyricsDrawerSettings => ({
  lyricsNetworkEnabled: settings.lyricsNetworkEnabled,
  lyricsAutoSearch: settings.lyricsAutoSearch,
  lyricsAutoAcceptScore: settings.lyricsAutoAcceptScore,
  lyricsRestartOnApplyEnabled: settings.lyricsRestartOnApplyEnabled === true,
  lyricsAutoSaveSidecarEnabled: settings.lyricsAutoSaveSidecarEnabled === true,
  lyricsDefaultOffsetMs: settings.lyricsDefaultOffsetMs,
  lyricsGlobalSyncOffsetMs: settings.lyricsGlobalSyncOffsetMs,
  lyricsTimelineCorrectionEnabled: settings.lyricsTimelineCorrectionEnabled !== false,
  lyricsOffsetControlsEnabled: settings.lyricsOffsetControlsEnabled !== false,
  lyricsSmartAlignmentEnabled: settings.lyricsSmartAlignmentEnabled !== false,
  lyricsPreferredProvider: settings.lyricsPreferredProvider,
  lyricsEnabledProviders: settings.lyricsEnabledProviders?.length ? settings.lyricsEnabledProviders : defaultLyricsEnabledProviders,
  lyricsProviderOrder: settings.lyricsProviderOrder?.length ? settings.lyricsProviderOrder : defaultLyricsProviderOrder,
  lyricsDeepSearchEnabled: settings.lyricsDeepSearchEnabled !== false,
  lyricsEnabled: settings.lyricsEnabled,
  lyricsHeaderHidden: settings.lyricsHeaderHidden,
  lyricsMvAutoShowTrackInfoDisabled: settings.lyricsMvAutoShowTrackInfoDisabled !== false,
  lyricsCandidatePanelAutoOpenEnabled: settings.lyricsCandidatePanelAutoOpenEnabled === true,
  lyricsEmptyStateHidden: settings.lyricsEmptyStateHidden,
  lyricsPlayerBarDrawerEnabled: settings.lyricsPlayerBarDrawerEnabled !== false,
  lyricsPlayerBarDrawerAutoEnableForMv: settings.lyricsPlayerBarDrawerAutoEnableForMv !== false,
  lyricsPlayerBarDrawerAutoHideEnabled: settings.lyricsPlayerBarDrawerAutoHideEnabled === true,
  lyricsPlayerBarDrawerOpacityPercent: settings.lyricsPlayerBarDrawerOpacityPercent ?? fallbackSettings.lyricsPlayerBarDrawerOpacityPercent,
  lyricsPlayerBarDrawerColorMode: settings.lyricsPlayerBarDrawerColorMode ?? fallbackSettings.lyricsPlayerBarDrawerColorMode,
  lyricsPlayerBarDrawerColor: settings.lyricsPlayerBarDrawerColor ?? fallbackSettings.lyricsPlayerBarDrawerColor,
  lyricsRomanizationEnabled: settings.lyricsRomanizationEnabled,
  lyricsUtatenKanaEnabled: settings.lyricsUtatenKanaEnabled === true,
  lyricsTranslationEnabled: settings.lyricsTranslationEnabled,
  lyricsWordHighlightEnabled: settings.lyricsWordHighlightEnabled !== false,
  lyricsWordHighlightClarityPercent: settings.lyricsWordHighlightClarityPercent ?? fallbackSettings.lyricsWordHighlightClarityPercent,
  lyricsFontSizePx: settings.lyricsFontSizePx,
  lyricsSecondaryFontSizePx: settings.lyricsSecondaryFontSizePx ?? fallbackSettings.lyricsSecondaryFontSizePx,
  lyricsFontFamily: settings.lyricsFontFamily ?? fallbackSettings.lyricsFontFamily,
  lyricsFontFilePath: settings.lyricsFontFilePath ?? fallbackSettings.lyricsFontFilePath,
  lyricsTextDirection: settings.lyricsTextDirection ?? fallbackSettings.lyricsTextDirection,
  lyricsLineSpacingPercent: settings.lyricsLineSpacingPercent ?? fallbackSettings.lyricsLineSpacingPercent,
  lyricsLineMaxChars: settings.lyricsLineMaxChars ?? fallbackSettings.lyricsLineMaxChars,
  lyricsContextOpacityPercent: settings.lyricsContextOpacityPercent ?? fallbackSettings.lyricsContextOpacityPercent,
  lyricsColor: settings.lyricsColor,
  lyricsSmartReadableColorsEnabled: settings.lyricsSmartReadableColorsEnabled === true,
  lyricsHighResolutionNetworkCoverEnabled: settings.lyricsHighResolutionNetworkCoverEnabled === true,
  lyricsBackgroundMode: settings.lyricsBackgroundMode,
  lyricsCustomWallpaperPath: settings.lyricsCustomWallpaperPath,
  lyricsCoverOpacityPercent: settings.lyricsCoverOpacityPercent,
  lyricsCoverBlurPx: settings.lyricsCoverBlurPx,
  lyricsCoverBrightnessPercent: settings.lyricsCoverBrightnessPercent,
  lyricsBackgroundScalePercent: settings.lyricsBackgroundScalePercent,
  desktopLyricsFontFamily: settings.desktopLyricsFontFamily ?? fallbackSettings.desktopLyricsFontFamily,
  desktopLyricsFontFilePath: settings.desktopLyricsFontFilePath ?? fallbackSettings.desktopLyricsFontFilePath,
  desktopLyricsOpacityPercent: settings.desktopLyricsOpacityPercent ?? fallbackSettings.desktopLyricsOpacityPercent,
  desktopLyricsTextDirection: settings.desktopLyricsTextDirection ?? fallbackSettings.desktopLyricsTextDirection,
  desktopLyricsRomanizationEnabled: settings.desktopLyricsRomanizationEnabled ?? fallbackSettings.desktopLyricsRomanizationEnabled,
  desktopLyricsTranslationEnabled: settings.desktopLyricsTranslationEnabled ?? fallbackSettings.desktopLyricsTranslationEnabled,
});

export const LyricsSettingsPanel = ({ className, currentTrackTools, variant = 'drawer' }: LyricsSettingsPanelProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [settings, setSettings] = useState<LyricsDrawerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [currentLyricsProviderLabel, setCurrentLyricsProviderLabel] = useState(providerLabelFor(null, t));
  const [currentLyricsTitleLabel, setCurrentLyricsTitleLabel] = useState(providerLabelFor(null, t));
  const [draggingSourceId, setDraggingSourceId] = useState<LyricsProviderId | null>(null);
  const [isLyricsDisplayPanelOpen, setIsLyricsDisplayPanelOpen] = useState(readLyricsDisplayPanelOpen);
  const [isLyricsStyleControlsOpen, setIsLyricsStyleControlsOpen] = useState(readLyricsStyleControlsOpen);
  const [fontFamilies, setFontFamilies] = useState<string[]>(fallbackLyricsFontFamilies);
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
  const [fontPickerTarget, setFontPickerTarget] = useState<LyricsFontPickerTarget>('lyrics');
  const [fontPickerQuery, setFontPickerQuery] = useState('');
  const [isBackgroundControlsOpen, setIsBackgroundControlsOpen] = useState(true);
  const [isBackgroundModeMenuOpen, setIsBackgroundModeMenuOpen] = useState(false);
  const [isBackgroundTuningOpen, setIsBackgroundTuningOpen] = useState(readLyricsBackgroundTuningOpen);
  const [lyricsReadabilityEnhanced, setLyricsReadabilityEnhanced] = useState(false);
  const [lyricsSearchQuery, setLyricsSearchQuery] = useState('');
  const [lyricsCandidates, setLyricsCandidates] = useState<LyricsSearchCandidate[]>([]);
  const [activeLyricsCandidateSource, setActiveLyricsCandidateSource] = useState('all');
  const [lyricsCandidateStatus, setLyricsCandidateStatus] = useState<string | null>(null);
  const [isLyricsCandidateLoading, setIsLyricsCandidateLoading] = useState(false);
  const [desktopLyricsState, setDesktopLyricsState] = useState<DesktopLyricsState | null>(null);
  const [isDesktopLyricsBusy, setIsDesktopLyricsBusy] = useState(false);
  const [isDesktopLyricsFontPanelOpen, setIsDesktopLyricsFontPanelOpen] = useState(readDesktopLyricsFontPanelOpen);
  const [isLyricsSourcePanelOpen, setIsLyricsSourcePanelOpen] = useState(readLyricsSourcePanelOpen);
  const [applyingLyricsCandidateId, setApplyingLyricsCandidateId] = useState<string | null>(null);
  const [isMarkingInstrumental, setIsMarkingInstrumental] = useState(false);
  const [currentLyricsKind, setCurrentLyricsKind] = useState<TrackLyrics['kind'] | null>(null);
  const saveRequestIdRef = useRef(0);
  const debouncedSaveRequestIdRef = useRef(0);
  const debouncedSaveTimerRef = useRef<number | null>(null);
  const pendingDebouncedSettingsRef = useRef<Partial<AppSettings>>({});
  const playbackQueue = useOptionalPlaybackQueue();
  const currentQueueTrack = playbackQueue?.currentTrack ?? null;

  const effectiveSettings = settings ?? fallbackSettings;
  const lyricsBackgroundModeOptions = useMemo(
    () => [
      { mode: 'theme', label: t('lyricsSettings.background.mode.theme') },
      { mode: 'cover', label: t('lyricsSettings.background.mode.cover') },
      { mode: 'coverColor', label: t('lyricsSettings.background.mode.coverColor') },
      { mode: 'customWallpaper', label: t('lyricsSettings.background.mode.customWallpaper') },
    ] satisfies Array<{ mode: AppSettings['lyricsBackgroundMode']; label: string }>,
    [t],
  );
  const lyricsBackgroundModeLabel =
    lyricsBackgroundModeOptions.find((option) => option.mode === effectiveSettings.lyricsBackgroundMode)?.label ??
    t('lyricsSettings.background.mode.theme');
  // Settings should expose every persistent lyrics preference; only current-track tools stay drawer-only.
  const showCurrentTrackTools = variant === 'drawer';
  const showPersistentControls = variant === 'drawer' || variant === 'settings';
  const lyricsContextOpacityPercent = effectiveSettings.lyricsContextOpacityPercent ?? fallbackSettings.lyricsContextOpacityPercent;
  const lyricsLineMaxChars = effectiveSettings.lyricsLineMaxChars ?? fallbackSettings.lyricsLineMaxChars ?? 0;
  const lyricsFontFamily = effectiveSettings.lyricsFontFamily ?? fallbackSettings.lyricsFontFamily ?? 'Microsoft YaHei';
  const desktopLyricsFontFamily =
    desktopLyricsState?.settings.desktopLyricsFontFamily ??
    effectiveSettings.desktopLyricsFontFamily ??
    fallbackSettings.desktopLyricsFontFamily ??
    'Microsoft YaHei';
  const desktopLyricsFontFilePath =
    desktopLyricsState?.settings.desktopLyricsFontFilePath ??
    effectiveSettings.desktopLyricsFontFilePath ??
    fallbackSettings.desktopLyricsFontFilePath ??
    null;
  const desktopLyricsOpacityPercent =
    desktopLyricsState?.settings.desktopLyricsOpacityPercent ??
    effectiveSettings.desktopLyricsOpacityPercent ??
    fallbackSettings.desktopLyricsOpacityPercent ??
    96;
  const desktopLyricsRomanizationEnabled =
    desktopLyricsState?.settings.desktopLyricsRomanizationEnabled ??
    effectiveSettings.desktopLyricsRomanizationEnabled ??
    fallbackSettings.desktopLyricsRomanizationEnabled;
  const desktopLyricsTranslationEnabled =
    desktopLyricsState?.settings.desktopLyricsTranslationEnabled ??
    effectiveSettings.desktopLyricsTranslationEnabled ??
    fallbackSettings.desktopLyricsTranslationEnabled;
  const desktopLyricsTextDirection =
    desktopLyricsState?.settings.desktopLyricsTextDirection ??
    effectiveSettings.desktopLyricsTextDirection ??
    fallbackSettings.desktopLyricsTextDirection ??
    'horizontal';
  const wordHighlightClarityPercent = effectiveSettings.lyricsWordHighlightClarityPercent ?? fallbackSettings.lyricsWordHighlightClarityPercent ?? 70;
  const wordHighlightClarityLabel =
    wordHighlightClarityPercent === fallbackSettings.lyricsWordHighlightClarityPercent ? t('lyricsSettings.status.normal') : `${wordHighlightClarityPercent}%`;
  const enabledProviderSet = new Set(effectiveSettings.lyricsEnabledProviders ?? defaultLyricsEnabledProviders);
  const orderedLyricsSourceOptions = useMemo(() => {
    const orderedIds = [
      ...effectiveSettings.lyricsProviderOrder.filter(isOnlineLyricsProvider),
      ...onlineLyricsProviderIds.filter((provider) => !effectiveSettings.lyricsProviderOrder.includes(provider)),
    ];

    return orderedIds
      .map((provider) => lyricsSourceOptionById.get(provider))
      .filter((source): source is (typeof lyricsSourceOptions)[number] => Boolean(source));
  }, [effectiveSettings.lyricsProviderOrder]);
  const orderedOnlineProviderIds = useMemo<LyricsProviderId[]>(() => orderedLyricsSourceOptions.map((source) => source.id), [orderedLyricsSourceOptions]);
  const activeSearchProviders = useMemo<LyricsProviderId[]>(() => {
    const enabled = effectiveSettings.lyricsEnabledProviders?.length
      ? effectiveSettings.lyricsEnabledProviders
      : defaultLyricsEnabledProviders;
    const order = effectiveSettings.lyricsProviderOrder?.length
      ? effectiveSettings.lyricsProviderOrder
      : defaultLyricsProviderOrder;
    const ordered = [
      ...order.filter((provider) => enabled.includes(provider)),
      ...enabled.filter((provider) => !order.includes(provider)),
    ];

    return ordered.filter(
      (provider): provider is LyricsProviderId =>
        searchableLyricsProviderSet.has(provider) &&
        (provider === 'local' || effectiveSettings.lyricsNetworkEnabled),
    );
  }, [effectiveSettings.lyricsEnabledProviders, effectiveSettings.lyricsNetworkEnabled, effectiveSettings.lyricsProviderOrder]);
  const thresholdPercent = Math.round(effectiveSettings.lyricsAutoAcceptScore * 100);
  const miniPlayerOpacityPercent = effectiveSettings.lyricsPlayerBarDrawerOpacityPercent ?? fallbackSettings.lyricsPlayerBarDrawerOpacityPercent;
  const miniPlayerColor = effectiveSettings.lyricsPlayerBarDrawerColor ?? fallbackSettings.lyricsPlayerBarDrawerColor ?? '#232120';
  const hasDesktopLyricsBridge = Boolean(window.echo?.desktopLyrics);
  const desktopLyricsVisible = desktopLyricsState?.visible === true;
  const desktopLyricsLocked = desktopLyricsState?.locked === true;
  const offsetSeconds = useMemo(() => (effectiveSettings.lyricsDefaultOffsetMs / 1000).toFixed(1), [effectiveSettings.lyricsDefaultOffsetMs]);
  const isSecondaryLyricsSizeOpen = effectiveSettings.lyricsRomanizationEnabled || effectiveSettings.lyricsTranslationEnabled;
  const globalSyncOffsetSeconds = useMemo(
    () => (effectiveSettings.lyricsGlobalSyncOffsetMs / 1000).toFixed(2),
    [effectiveSettings.lyricsGlobalSyncOffsetMs],
  );
  const lyricsCandidateSourceOptions = useMemo(() => {
    const order = new Map<LyricsSearchCandidate['provider'], number>([
      ['local', 0],
      ['lrclib', 1],
      ['amll-ttml', 2],
      ['netease', 3],
      ['qqmusic', 4],
      ['kugou', 5],
      ['kuwo', 6],
      ['musixmatch', 7],
      ['genius', 8],
      ['manual', 9],
    ]);
    const sourceMap = new Map<string, { key: string; label: string; count: number; order: number }>();

    for (const candidate of lyricsCandidates) {
      const key = sourceFilterKey(candidate);
      const existing = sourceMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        sourceMap.set(key, {
          key,
          label: candidate.sourceLabel,
          count: 1,
          order: order.get(candidate.provider) ?? 99,
        });
      }
    }

    return [
      { key: 'all', label: t('lyricsSettings.candidate.allSources'), count: lyricsCandidates.length, order: -1 },
      ...Array.from(sourceMap.values()).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
    ];
  }, [lyricsCandidates, t]);
  const visibleLyricsCandidates = useMemo(
    () =>
      activeLyricsCandidateSource === 'all'
        ? lyricsCandidates
        : lyricsCandidates.filter((candidate) => sourceFilterKey(candidate) === activeLyricsCandidateSource),
    [activeLyricsCandidateSource, lyricsCandidates],
  );

  const toggleDesktopLyricsFontPanel = useCallback(() => {
    setIsDesktopLyricsFontPanelOpen((value) => {
      const nextValue = !value;
      writeDesktopLyricsFontPanelOpen(nextValue);
      return nextValue;
    });
  }, []);

  const toggleLyricsDisplayPanel = useCallback(() => {
    setIsLyricsDisplayPanelOpen((value) => {
      const nextValue = !value;
      writeLyricsDisplayPanelOpen(nextValue);
      return nextValue;
    });
  }, []);

  const toggleLyricsStyleControls = useCallback(() => {
    setIsLyricsStyleControlsOpen((value) => {
      const nextValue = !value;
      writeLyricsStyleControlsOpen(nextValue);
      return nextValue;
    });
  }, []);

  const toggleBackgroundTuning = useCallback(() => {
    setIsBackgroundTuningOpen((value) => {
      const nextValue = !value;
      writeLyricsBackgroundTuningOpen(nextValue);
      return nextValue;
    });
  }, []);

  const toggleLyricsSourcePanel = useCallback(() => {
    setIsLyricsSourcePanelOpen((value) => {
      const nextValue = !value;
      writeLyricsSourcePanelOpen(nextValue);
      return nextValue;
    });
  }, []);

  useEffect(() => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setDesktopLyricsState(null);
      return undefined;
    }

    let disposed = false;
    void desktopLyrics.getState()
      .then((state) => {
        if (!disposed) {
          setDesktopLyricsState(state);
        }
      })
      .catch(() => undefined);

    const unsubscribe = desktopLyrics.onStateChanged?.((state) => {
      setDesktopLyricsState(state);
    }) ?? (() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!showPersistentControls || (!isLyricsStyleControlsOpen && !isFontPickerOpen)) {
      return undefined;
    }

    const queryLocalFonts = (navigator as NavigatorWithLocalFonts).queryLocalFonts;

    if (!queryLocalFonts) {
      return undefined;
    }

    let cancelled = false;
    void queryLocalFonts()
      .then((fonts) => {
        if (cancelled) {
          return;
        }

        const families = Array.from(
          new Set([
            ...fallbackLyricsFontFamilies,
            ...fonts.map((font) => sanitizeFontFamily(font.family)).filter(Boolean),
          ]),
        ).sort((a, b) => a.localeCompare(b));
        setFontFamilies(families);
      })
      .catch(() => setFontFamilies(fallbackLyricsFontFamilies));

    return () => {
      cancelled = true;
    };
  }, [isFontPickerOpen, isLyricsStyleControlsOpen, showPersistentControls]);

  const loadCurrentLyricsProvider = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    const audio = window.echo?.audio;
    const lyrics = window.echo?.lyrics;
    if (!lyrics || (!playback && !audio)) {
      setCurrentLyricsProviderLabel(providerLabelFor(null, t));
      setCurrentLyricsTitleLabel(providerLabelFor(null, t));
      return;
    }

    try {
      const [playbackStatus, audioStatus] = await Promise.all([
        playback?.getStatus().catch(() => null) ?? Promise.resolve(null),
        audio?.getStatus().catch(() => null) ?? Promise.resolve(null),
      ]);
      const trackId = playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? null;
      if (!trackId) {
        setCurrentLyricsProviderLabel(t('lyricsSettings.status.noPlayingTrack'));
        setCurrentLyricsTitleLabel(t('lyricsSettings.status.noPlayingTrack'));
        setCurrentLyricsKind(null);
        return;
      }

      const trackLyrics = await lyrics.getForTrack(trackId);
      setCurrentLyricsProviderLabel(providerLabelFor(trackLyrics?.provider, t));
      setCurrentLyricsTitleLabel(lyricsTitleLabelFor(trackLyrics, providerLabelFor(trackLyrics?.provider, t)));
      setCurrentLyricsKind(trackLyrics?.kind ?? null);
    } catch {
      setCurrentLyricsProviderLabel(providerLabelFor(null, t));
      setCurrentLyricsTitleLabel(providerLabelFor(null, t));
      setCurrentLyricsKind(null);
    }
  }, [t]);

  const loadSettings = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app) {
      setError('Desktop bridge unavailable');
      setSettings(fallbackSettings);
      return;
    }

    try {
      setError(null);
      const nextSettings = await app.getSettings();
      setSettings(selectLyricsSettings(nextSettings));
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    }
  }, []);

  const loadMvSettings = useCallback(async (): Promise<void> => {
    try {
      const mvSettings = await window.echo?.mv?.getSettings?.();
      setLyricsReadabilityEnhanced(mvSettings?.lyricsReadabilityEnhanced === true);
    } catch {
      setLyricsReadabilityEnhanced(false);
    }
  }, []);

  const refreshDrawerSummary = useCallback(async (): Promise<void> => {
    await Promise.all([loadSettings(), loadCurrentLyricsProvider(), loadMvSettings()]);
  }, [loadCurrentLyricsProvider, loadMvSettings, loadSettings]);

  const resolveCurrentTrackId = useCallback(async (): Promise<string | null> => {
    const playback = window.echo?.playback;
    const audio = window.echo?.audio;
    const [playbackStatus, audioStatus] = await Promise.all([
      playback?.getStatus().catch(() => null) ?? Promise.resolve(null),
      audio?.getStatus().catch(() => null) ?? Promise.resolve(null),
    ]);

    return playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? null;
  }, []);

  const resolveCurrentLyricsTarget = useCallback(async (): Promise<{
    trackId: string | null;
    snapshot: LyricsTrackSnapshotRequest | null;
  }> => {
    const currentTrackId = await resolveCurrentTrackId();
    const snapshotTrack =
      currentQueueTrack && (!currentTrackId || currentQueueTrack.id === currentTrackId)
        ? currentQueueTrack
        : null;
    const shouldUseSnapshot = await resolveNeteaseDjRadioTrack(snapshotTrack);

    return {
      trackId: currentTrackId ?? snapshotTrack?.id ?? null,
      snapshot: shouldUseSnapshot && snapshotTrack
        ? lyricsSnapshotRequestForTrack(snapshotTrack)
        : null,
    };
  }, [currentQueueTrack, resolveCurrentTrackId]);

  const patchSettings = useCallback(async (patch: Partial<AppSettings>, optimistic = true): Promise<void> => {
    const app = window.echo?.app;
    if (!app) {
      setError('Desktop bridge unavailable');
      return;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    if (optimistic) {
      setSettings((current) => ({ ...(current ?? fallbackSettings), ...(patch as Partial<LyricsDrawerSettings>) }));
      dispatchSettingsChanged(patch);
      dispatchLyricsDisplaySettingsChanged(patch);
    }

    setIsBusy(true);
    try {
      const nextSettings = await app.setSettings(patch);
      if (requestId === saveRequestIdRef.current) {
        const nextLyricsSettings = selectLyricsSettings(nextSettings);
        const savedPatch = pickSavedLyricsPatch(nextLyricsSettings, patch);
        setSettings(nextLyricsSettings);
        setError(null);
        if (!optimistic || !patchValuesMatch(patch, savedPatch)) {
          dispatchSettingsChanged(savedPatch);
          dispatchLyricsDisplaySettingsChanged(savedPatch);
        }
      }
    } catch (settingsError) {
      if (requestId === saveRequestIdRef.current) {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
        dispatchSettingsChanged();
      }
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setIsBusy(false);
      }
    }
  }, []);

  const flushDebouncedSettings = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const patch = pendingDebouncedSettingsRef.current;
    pendingDebouncedSettingsRef.current = {};
    debouncedSaveTimerRef.current = null;

    if (!app || Object.keys(patch).length === 0) {
      return;
    }

    const requestId = debouncedSaveRequestIdRef.current + 1;
    debouncedSaveRequestIdRef.current = requestId;

    try {
      const nextSettings = await app.setSettings(patch);
      if (requestId === debouncedSaveRequestIdRef.current) {
        const nextLyricsSettings = selectLyricsSettings(nextSettings);
        const savedPatch = pickSavedLyricsPatch(nextLyricsSettings, patch);
        setSettings(nextLyricsSettings);
        setError(null);
        dispatchSettingsChanged(savedPatch);
        if (!patchValuesMatch(patch, savedPatch)) {
          dispatchLyricsDisplaySettingsChanged(savedPatch);
        }
      }
    } catch (settingsError) {
      if (requestId === debouncedSaveRequestIdRef.current) {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
        dispatchSettingsChanged();
      }
    }
  }, []);

  const patchSettingsDebounced = useCallback(
    (patch: Partial<AppSettings>, options: { broadcastSettings?: boolean } = {}): void => {
      const app = window.echo?.app;
      if (!app) {
        setError('Desktop bridge unavailable');
        return;
      }

      pendingDebouncedSettingsRef.current = {
        ...pendingDebouncedSettingsRef.current,
        ...patch,
      };
      setSettings((current) => ({ ...(current ?? fallbackSettings), ...(patch as Partial<LyricsDrawerSettings>) }));
      if (options.broadcastSettings) {
        dispatchSettingsChanged(patch);
      }
      dispatchLyricsDisplaySettingsChanged(patch);

      if (debouncedSaveTimerRef.current !== null) {
        window.clearTimeout(debouncedSaveTimerRef.current);
      }

      debouncedSaveTimerRef.current = window.setTimeout(() => {
        void flushDebouncedSettings();
      }, 240);
    },
    [flushDebouncedSettings],
  );

  const toggleLyricsHeaderHidden = useCallback(
    (hidden: boolean): void => {
      void patchSettings({ lyricsHeaderHidden: hidden });
    },
    [patchSettings],
  );

  const toggleMvAutoShowTrackInfoDisabled = useCallback((): void => {
    const nextDisabled = !effectiveSettings.lyricsMvAutoShowTrackInfoDisabled;
    if (!nextDisabled) {
      void patchSettings({ lyricsMvAutoShowTrackInfoDisabled: false });
      return;
    }

    void (async (): Promise<void> => {
      let isMvEnabled = true;
      try {
        const mvSettings = await window.echo?.mv?.getSettings?.();
        isMvEnabled = mvSettings?.enabled !== false;
      } catch {
        isMvEnabled = true;
      }

      await patchSettings({
        lyricsMvAutoShowTrackInfoDisabled: true,
        lyricsHeaderHidden: isMvEnabled,
      });
    })();
  }, [effectiveSettings.lyricsMvAutoShowTrackInfoDisabled, patchSettings]);

  const toggleLyricsReadabilityEnhanced = useCallback((): void => {
    const mv = window.echo?.mv;
    if (!mv?.setSettings) {
      setError('Desktop bridge unavailable');
      return;
    }

    const nextValue = !lyricsReadabilityEnhanced;
    const patch: Partial<MvSettings> = { lyricsReadabilityEnhanced: nextValue };
    setLyricsReadabilityEnhanced(nextValue);
    dispatchSettingsChanged(patch);

    void mv
      .setSettings(patch)
      .then((nextSettings) => {
        const savedValue = nextSettings.lyricsReadabilityEnhanced === true;
        setLyricsReadabilityEnhanced(savedValue);
        dispatchSettingsChanged({ lyricsReadabilityEnhanced: savedValue });
        setError(null);
      })
      .catch((settingsError) => {
        setLyricsReadabilityEnhanced(!nextValue);
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
        dispatchSettingsChanged();
      });
  }, [lyricsReadabilityEnhanced]);

  const patchDesktopLyricsStyle = useCallback((patch: DesktopLyricsStylePatch): void => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setError('Desktop lyrics bridge unavailable');
      return;
    }

    setIsDesktopLyricsBusy(true);
    setSettings((current) => ({ ...(current ?? fallbackSettings), ...(patch as Partial<LyricsDrawerSettings>) }));
    setDesktopLyricsState((current) =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              ...patch,
            },
          }
        : current,
    );

    void desktopLyrics.setStyle(patch)
      .then((state) => {
        setDesktopLyricsState(state);
        setSettings((current) => ({
          ...(current ?? fallbackSettings),
          desktopLyricsFontFamily: state.settings.desktopLyricsFontFamily ?? fallbackSettings.desktopLyricsFontFamily,
          desktopLyricsFontFilePath: state.settings.desktopLyricsFontFilePath ?? fallbackSettings.desktopLyricsFontFilePath,
        }));
        setError(null);
      })
      .catch((desktopLyricsError) => {
        setError(desktopLyricsError instanceof Error ? desktopLyricsError.message : String(desktopLyricsError));
      })
      .finally(() => setIsDesktopLyricsBusy(false));
  }, []);

  const setDesktopLyricsVisible = useCallback((visible: boolean): void => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setError('Desktop lyrics bridge unavailable');
      return;
    }

    setIsDesktopLyricsBusy(true);
    void (visible ? desktopLyrics.show() : desktopLyrics.hide())
      .then((state) => {
        setDesktopLyricsState(state);
        setError(null);
      })
      .catch((desktopLyricsError) => {
        setError(desktopLyricsError instanceof Error ? desktopLyricsError.message : String(desktopLyricsError));
      })
      .finally(() => setIsDesktopLyricsBusy(false));
  }, []);

  const setDesktopLyricsLocked = useCallback((locked: boolean): void => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setError('Desktop lyrics bridge unavailable');
      return;
    }

    setIsDesktopLyricsBusy(true);
    void desktopLyrics.setLocked(locked)
      .then((state) => {
        setDesktopLyricsState(state);
        setError(null);
      })
      .catch((desktopLyricsError) => {
        setError(desktopLyricsError instanceof Error ? desktopLyricsError.message : String(desktopLyricsError));
      })
      .finally(() => setIsDesktopLyricsBusy(false));
  }, []);

  const resetDesktopLyricsPosition = useCallback((): void => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      setError('Desktop lyrics bridge unavailable');
      return;
    }

    setIsDesktopLyricsBusy(true);
    void desktopLyrics.resetBounds()
      .then((state) => {
        setDesktopLyricsState(state);
        setError(null);
      })
      .catch((desktopLyricsError) => {
        setError(desktopLyricsError instanceof Error ? desktopLyricsError.message : String(desktopLyricsError));
      })
      .finally(() => setIsDesktopLyricsBusy(false));
  }, []);

  useEffect(() => {
    return () => {
      if (debouncedSaveTimerRef.current !== null) {
        window.clearTimeout(debouncedSaveTimerRef.current);
        debouncedSaveTimerRef.current = null;
      }

      const patch = pendingDebouncedSettingsRef.current;
      pendingDebouncedSettingsRef.current = {};
      if (Object.keys(patch).length > 0) {
        const savePromise = window.echo?.app?.setSettings?.(patch);
        void savePromise?.catch(() => undefined);
      }
    };
  }, []);

  const openFontPicker = useCallback((target: LyricsFontPickerTarget): void => {
    setFontPickerTarget(target);
    setFontPickerQuery('');
    setIsFontPickerOpen(true);
  }, []);

  const applySelectedFontFamily = useCallback((value: string): void => {
    const fontFamily = sanitizeFontFamily(value);
    const currentFontFamily = fontPickerTarget === 'desktopLyrics' ? desktopLyricsFontFamily : lyricsFontFamily;
    if (!fontFamily || fontFamily === currentFontFamily) {
      setIsFontPickerOpen(false);
      return;
    }

    setFontFamilies((current) => Array.from(new Set([...current, fontFamily])).sort((a, b) => a.localeCompare(b)));
    setIsFontPickerOpen(false);
    if (fontPickerTarget === 'desktopLyrics') {
      patchDesktopLyricsStyle({ desktopLyricsFontFamily: fontFamily, desktopLyricsFontFilePath: null });
      return;
    }

    void patchSettings({ lyricsFontFamily: fontFamily, lyricsFontFilePath: null });
  }, [desktopLyricsFontFamily, fontPickerTarget, lyricsFontFamily, patchDesktopLyricsStyle, patchSettings]);

  const chooseFontFileForTarget = useCallback(async (target: LyricsFontPickerTarget): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseFontFile) {
      setError('Desktop bridge unavailable');
      return;
    }

    setIsBusy(true);
    try {
      const fontFile = await app.chooseFontFile();
      if (!fontFile) {
        return;
      }

      const fontFamily = await registerAppearanceFontFile(target, fontFile);
      setFontFamilies((current) => Array.from(new Set([...current, fontFamily])).sort((a, b) => a.localeCompare(b)));
      setIsFontPickerOpen(false);
      if (target === 'desktopLyrics') {
        patchDesktopLyricsStyle({
          desktopLyricsFontFamily: fontFamily,
          desktopLyricsFontFilePath: fontFile.path,
        });
      } else {
        await patchSettings({ lyricsFontFamily: fontFamily, lyricsFontFilePath: fontFile.path });
      }
    } catch (fontError) {
      setError(fontError instanceof Error ? fontError.message : String(fontError));
    } finally {
      setIsBusy(false);
    }
  }, [patchDesktopLyricsStyle, patchSettings]);

  const chooseWallpaper = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.chooseLyricsWallpaper) {
      setError('Desktop bridge unavailable');
      return;
    }

    setIsBusy(true);
    try {
      const wallpaperPath = await app.chooseLyricsWallpaper();
      if (wallpaperPath) {
        const nextSettings = await app.setSettings({
          lyricsBackgroundMode: 'customWallpaper',
          lyricsCustomWallpaperPath: wallpaperPath,
        });
        const nextLyricsSettings = selectLyricsSettings(nextSettings);
        setSettings(nextLyricsSettings);
        dispatchSettingsChanged({
          lyricsBackgroundMode: nextLyricsSettings.lyricsBackgroundMode,
          lyricsCustomWallpaperPath: nextLyricsSettings.lyricsCustomWallpaperPath,
        });
        dispatchLyricsDisplaySettingsChanged({
          lyricsBackgroundMode: nextLyricsSettings.lyricsBackgroundMode,
          lyricsCustomWallpaperPath: nextLyricsSettings.lyricsCustomWallpaperPath,
        });
      }
      setError(null);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const patchLyricsProviderOrder = useCallback((onlineOrder: LyricsProviderId[]): void => {
    void patchSettings({ lyricsProviderOrder: ['local', ...onlineOrder] });
  }, [patchSettings]);

  const moveLyricsSource = useCallback((sourceId: LyricsProviderId, targetId: LyricsProviderId): void => {
    if (sourceId === targetId) {
      return;
    }

    const nextOrder = [...orderedOnlineProviderIds];
    const sourceIndex = nextOrder.indexOf(sourceId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const [source] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, source);
    patchLyricsProviderOrder(nextOrder);
  }, [orderedOnlineProviderIds, patchLyricsProviderOrder]);

  const applyLyricsCandidateToTarget = useCallback(
    async (
      target: { trackId: string; snapshot: LyricsTrackSnapshotRequest | null },
      candidateId: string,
      candidate: LyricsSearchCandidate | null,
      candidatePool: LyricsSearchCandidate[],
    ): Promise<boolean> => {
      if (!effectiveSettings.lyricsEnabled) {
        setLyricsCandidateStatus(null);
        return false;
      }

      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi?.applyCandidate && !lyricsApi?.applyCandidateForSnapshot) {
        setError('Desktop bridge unavailable');
        return false;
      }

      setApplyingLyricsCandidateId(candidateId);
      try {
        const trackLyrics = target.snapshot && lyricsApi.applyCandidateForSnapshot
          ? await lyricsApi.applyCandidateForSnapshot(target.snapshot, candidateId)
          : await lyricsApi.applyCandidate(target.trackId, candidateId);
        const appliedCandidate = candidatePool.find((item) => item.id === candidateId) ?? candidate;
        if (appliedCandidate) {
          recordLyricsSourceQualityOutcome(appliedCandidate, 'applied');
        }
        setCurrentLyricsProviderLabel(providerLabelFor(trackLyrics.provider, t));
        setCurrentLyricsTitleLabel(lyricsTitleLabelFor(trackLyrics, providerLabelFor(trackLyrics.provider, t)));
        setCurrentLyricsKind(trackLyrics.kind);
        setLyricsCandidates([]);
        setActiveLyricsCandidateSource('all');
        setLyricsCandidateStatus(t('lyricsSettings.status.applied'));
        setError(null);
        dispatchLyricsCandidateApplied(target.trackId, trackLyrics);
        if (effectiveSettings.lyricsRestartOnApplyEnabled === true) {
          await restartCurrentPlaybackForLyrics();
        }
        return true;
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : String(applyError));
        return false;
      } finally {
        setApplyingLyricsCandidateId(null);
      }
    },
    [effectiveSettings.lyricsEnabled, effectiveSettings.lyricsRestartOnApplyEnabled, t],
  );

  const searchLyricsCandidates = useCallback(
    async (searchText?: string): Promise<void> => {
      if (!effectiveSettings.lyricsEnabled) {
        setLyricsCandidateStatus(null);
        return;
      }

      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi?.searchCandidates && !lyricsApi?.searchCandidatesForSnapshot) {
        setError('Desktop bridge unavailable');
        return;
      }

      setIsLyricsCandidateLoading(true);
      setLyricsCandidateStatus(t('lyricsSettings.status.searchingCandidates'));
      setLyricsCandidates([]);
      setActiveLyricsCandidateSource('all');

      try {
        const { trackId: currentTrackId, snapshot } = await resolveCurrentLyricsTarget();
        if (!currentTrackId) {
          setLyricsCandidateStatus(t('lyricsSettings.status.noPlayingTrack'));
          return;
        }

        let collectedCandidates: LyricsSearchCandidate[] = [];
        const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ['local'];
        const normalizedSearchText = searchText?.trim();
        await Promise.allSettled(
          providers.map(async (provider) => {
            const providerCandidates = snapshot && lyricsApi.searchCandidatesForSnapshot
              ? await lyricsApi.searchCandidatesForSnapshot(snapshot, normalizedSearchText || undefined, provider)
              : normalizedSearchText
                ? await lyricsApi.searchCandidates(currentTrackId, normalizedSearchText, provider)
                : await lyricsApi.searchCandidates(currentTrackId, undefined, provider);
            recordLyricsSourceQualityCandidates(providerCandidates);
            collectedCandidates = mergeLyricsCandidates(collectedCandidates, providerCandidates);
            setLyricsCandidates(collectedCandidates);
            setActiveLyricsCandidateSource('all');
            if (collectedCandidates.length > 0) {
              setLyricsCandidateStatus(null);
            }
          }),
        );

        setLyricsCandidates(collectedCandidates);
        setActiveLyricsCandidateSource('all');
        const autoCandidate = normalizedSearchText
          ? null
          : selectAutoApplyLyricsCandidate(collectedCandidates, effectiveSettings);
        if (autoCandidate) {
          const applied = await applyLyricsCandidateToTarget(
            { trackId: currentTrackId, snapshot },
            autoCandidate.id,
            autoCandidate,
            collectedCandidates,
          );
          if (applied) {
            return;
          }
        }
        setLyricsCandidateStatus(collectedCandidates.length ? null : t('lyricsSettings.status.noCandidates'));
        setError(null);
      } catch (candidateError) {
        setLyricsCandidateStatus(t('lyricsSettings.status.noCandidates'));
        setError(candidateError instanceof Error ? candidateError.message : String(candidateError));
      } finally {
        setIsLyricsCandidateLoading(false);
      }
    },
    [activeSearchProviders, applyLyricsCandidateToTarget, effectiveSettings, resolveCurrentLyricsTarget, t],
  );

  const rematchLyricsCandidates = useCallback(async (): Promise<void> => {
    if (!effectiveSettings.lyricsEnabled) {
      setLyricsCandidateStatus(null);
      return;
    }

    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi?.searchCandidates && !lyricsApi?.searchCandidatesForSnapshot) {
      setError('Desktop bridge unavailable');
      return;
    }

    setIsLyricsCandidateLoading(true);
    setLyricsCandidateStatus(t('lyricsSettings.status.rematchingCandidates'));
    setLyricsCandidates([]);
    setActiveLyricsCandidateSource('all');

    try {
      const { trackId: currentTrackId, snapshot } = await resolveCurrentLyricsTarget();
      if (!currentTrackId) {
        setLyricsCandidateStatus(t('lyricsSettings.status.noPlayingTrack'));
        return;
      }

      await lyricsApi.clearCache?.(currentTrackId);
      let collectedCandidates: LyricsSearchCandidate[] = [];
      const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ['local'];
      await Promise.allSettled(
        providers.map(async (provider) => {
          const providerCandidates = snapshot && lyricsApi.searchCandidatesForSnapshot
            ? await lyricsApi.searchCandidatesForSnapshot(snapshot, undefined, provider)
            : await lyricsApi.searchCandidates(currentTrackId, undefined, provider);
          recordLyricsSourceQualityCandidates(providerCandidates);
          collectedCandidates = mergeLyricsCandidates(collectedCandidates, providerCandidates);
          setLyricsCandidates(collectedCandidates);
          setActiveLyricsCandidateSource('all');
          if (collectedCandidates.length > 0) {
            setLyricsCandidateStatus(null);
          }
        }),
      );

      setLyricsCandidates(collectedCandidates);
      setActiveLyricsCandidateSource('all');
      const autoCandidate = selectAutoApplyLyricsCandidate(collectedCandidates, effectiveSettings);
      if (autoCandidate) {
        const applied = await applyLyricsCandidateToTarget(
          { trackId: currentTrackId, snapshot },
          autoCandidate.id,
          autoCandidate,
          collectedCandidates,
        );
        if (applied) {
          return;
        }
      }
      setLyricsCandidateStatus(collectedCandidates.length ? null : t('lyricsSettings.status.noCandidates'));
      setError(null);
    } catch (candidateError) {
      setLyricsCandidateStatus(t('lyricsSettings.status.noCandidates'));
      setError(candidateError instanceof Error ? candidateError.message : String(candidateError));
    } finally {
      setIsLyricsCandidateLoading(false);
    }
  }, [activeSearchProviders, applyLyricsCandidateToTarget, effectiveSettings, resolveCurrentLyricsTarget, t]);

  const applyLyricsCandidate = useCallback(
    async (candidateId: string): Promise<void> => {
      if (!effectiveSettings.lyricsEnabled) {
        setLyricsCandidateStatus(null);
        return;
      }

      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi?.applyCandidate && !lyricsApi?.applyCandidateForSnapshot) {
        setError('Desktop bridge unavailable');
        return;
      }

      setApplyingLyricsCandidateId(candidateId);
      try {
        const { trackId: currentTrackId, snapshot } = await resolveCurrentLyricsTarget();
        if (!currentTrackId) {
          setLyricsCandidateStatus(t('lyricsSettings.status.noPlayingTrack'));
          return;
        }

        const candidate = lyricsCandidates.find((item) => item.id === candidateId);
        await applyLyricsCandidateToTarget(
          { trackId: currentTrackId, snapshot },
          candidateId,
          candidate ?? null,
          lyricsCandidates,
        );
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : String(applyError));
      } finally {
        setApplyingLyricsCandidateId(null);
      }
    },
    [applyLyricsCandidateToTarget, effectiveSettings.lyricsEnabled, lyricsCandidates, resolveCurrentLyricsTarget, t],
  );

  const markCurrentTrackInstrumental = useCallback(async (): Promise<void> => {
    if (!effectiveSettings.lyricsEnabled) {
      setLyricsCandidateStatus(null);
      return;
    }

    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi?.markInstrumental) {
      setError('Desktop bridge unavailable');
      return;
    }

    setIsMarkingInstrumental(true);
    try {
      const currentTrackId = await resolveCurrentTrackId();
      if (!currentTrackId) {
        setLyricsCandidateStatus(t('lyricsSettings.status.noPlayingTrack'));
        return;
      }

      const trackLyrics = await lyricsApi.markInstrumental(currentTrackId);
      setCurrentLyricsProviderLabel(providerLabelFor(trackLyrics.provider, t));
      setCurrentLyricsTitleLabel(lyricsTitleLabelFor(trackLyrics, providerLabelFor(trackLyrics.provider, t)));
      setCurrentLyricsKind(trackLyrics.kind);
      setLyricsCandidates([]);
      setActiveLyricsCandidateSource('all');
      setLyricsCandidateStatus(t('lyricsSettings.status.markedInstrumental'));
      setError(null);
      dispatchLyricsCandidateApplied(currentTrackId, trackLyrics);
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : String(markError));
    } finally {
      setIsMarkingInstrumental(false);
    }
  }, [effectiveSettings.lyricsEnabled, resolveCurrentTrackId, t]);

  useEffect(() => {
    void refreshDrawerSummary();
  }, [refreshDrawerSummary]);

  useEffect(() => {
    const handleCurrentLyricsProviderChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ provider?: LyricsSource | null; title?: string | null }>).detail;
      const provider = detail?.provider;
      setCurrentLyricsProviderLabel(providerLabelFor(provider, t));
      setCurrentLyricsTitleLabel(detail?.title?.trim() || providerLabelFor(provider, t));
    };

    window.addEventListener('lyrics:current-provider-changed', handleCurrentLyricsProviderChanged);
    return () => window.removeEventListener('lyrics:current-provider-changed', handleCurrentLyricsProviderChanged);
  }, [t]);

  return (
    <div className={`lyrics-settings-panel ${className ?? ''}`.trim()}>
      {showCurrentTrackTools ? (
        <button className="audio-engine-meter lyrics-engine-meter" type="button" disabled={isBusy} onClick={() => void refreshDrawerSummary()}>
          <div className="audio-engine-meter__top">
            <span className="audio-engine-meter__icon">
              <Captions size={17} />
            </span>
            <div>
            <span>{t('lyricsSettings.engine.title')}</span>
              <strong>{currentLyricsTitleLabel}</strong>
            </div>
            <RefreshCw size={15} />
          </div>
          <div className="audio-engine-meter__grid">
            <span>
              <em>{t('lyricsSettings.engine.provider')}</em>
              <strong>{currentLyricsProviderLabel}</strong>
            </span>
            <span>
              <em>{t('lyricsSettings.engine.autoMatch')}</em>
              <strong>{effectiveSettings.lyricsAutoSearch ? t('lyricsSettings.status.on') : t('lyricsSettings.status.off')}</strong>
            </span>
            <span>
              <em>{t('lyricsSettings.engine.threshold')}</em>
              <strong>{thresholdPercent}%</strong>
            </span>
          </div>
        </button>
      ) : null}

      {showCurrentTrackTools ? (
        <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
          <div className="audio-drawer-section-title">
            <Search size={17} />
            <h3>{t('lyricsSettings.currentTrack.title')}</h3>
          </div>

          <form
            className="audio-device-pill lyrics-search-pill"
            onSubmit={(event) => {
              event.preventDefault();
              dispatchLyricsAction('search', lyricsSearchQuery);
              void searchLyricsCandidates(lyricsSearchQuery);
            }}
          >
            <Search size={15} />
            <span>
              <strong>{t('lyricsSettings.currentTrack.searchLyrics')}</strong>
              <small>{t('lyricsSettings.currentTrack.searchHint')}</small>
            </span>
            <div className="lyrics-search-pill__field">
              <input
                type="search"
                value={lyricsSearchQuery}
                disabled={isBusy || isLyricsCandidateLoading || !effectiveSettings.lyricsEnabled}
                placeholder={t('lyricsSettings.currentTrack.searchPlaceholder')}
                aria-label={t('lyricsSettings.currentTrack.searchInput')}
                onChange={(event) => setLyricsSearchQuery(event.currentTarget.value)}
              />
            </div>
            <button type="submit" disabled={isBusy || isLyricsCandidateLoading || !effectiveSettings.lyricsEnabled}>
              {t('lyricsSettings.action.search')}
            </button>
          </form>

          {(lyricsCandidateStatus || lyricsCandidates.length > 0) ? (
            <div className="lyrics-drawer-candidates" aria-label={t('lyricsSettings.candidate.results')}>
              {lyricsCandidateStatus ? <p className="lyrics-match-status">{lyricsCandidateStatus}</p> : null}
              {lyricsCandidates.length > 0 ? (
                <>
                  <div className="lyrics-source-filters" aria-label={t('lyricsSettings.candidate.sourceFilters')}>
                    {lyricsCandidateSourceOptions.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        data-active={activeLyricsCandidateSource === option.key}
                        onClick={() => setActiveLyricsCandidateSource(option.key)}
                      >
                        {option.label}
                        <small>{option.count}</small>
                      </button>
                    ))}
                  </div>
                  <div className="lyrics-candidate-list">
                    {visibleLyricsCandidates.map((candidate) => {
                      const candidateKind = lyricsCandidateDisplayKind(candidate);
                      return (
                        <button
                          className={`lyrics-candidate lyrics-candidate--${candidateKind}`}
                          type="button"
                          key={candidate.id}
                          data-lyrics-kind={candidateKind}
                          disabled={Boolean(applyingLyricsCandidateId)}
                          onClick={() => void applyLyricsCandidate(candidate.id)}
                        >
                          <span>
                            <strong>{candidate.title}</strong>
                            <em>
                              {candidate.artist}
                              {candidate.album ? ` / ${candidate.album}` : ''} / {formatDuration(candidate.durationSeconds)}
                            </em>
                          </span>
                          <span className="lyrics-candidate-badges">
                            <small className={`lyrics-risk-badge lyrics-risk-badge--${candidate.risk ?? 'high'}`}>
                              {riskLabel(candidate.risk, t)}
                            </small>
                            <small className={`lyrics-kind-badge lyrics-kind-badge--${candidateKind}`}>
                              {t(lyricsCandidateDisplayLabelKeys[candidateKind])}
                            </small>
                            <small>{candidate.sourceLabel}</small>
                            <small>{formatScore(candidate.score)}</small>
                            {visibleCandidateReasonLabels(candidate, t).map((reason) => (
                              <small className="lyrics-reason-badge" key={reason}>
                                {reason}
                              </small>
                            ))}
                            {applyingLyricsCandidateId === candidate.id ? <small>{t('lyricsSettings.status.applying')}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <button
            className="audio-device-pill"
            type="button"
            disabled={isBusy || isLyricsCandidateLoading || !effectiveSettings.lyricsEnabled}
            onClick={() => {
              dispatchLyricsAction('rematch');
              void rematchLyricsCandidates();
            }}
          >
            <RotateCcw size={15} />
            <span>
              <strong>{t('lyricsSettings.currentTrack.rematch')}</strong>
              <small>{t('lyricsSettings.currentTrack.rematchHint')}</small>
            </span>
            <em>{t('lyricsSettings.action.match')}</em>
          </button>

          <button
            className="audio-device-pill"
            type="button"
            disabled={
              isBusy ||
              isLyricsCandidateLoading ||
              isMarkingInstrumental ||
              !effectiveSettings.lyricsEnabled ||
              currentLyricsKind === 'instrumental'
            }
            onClick={() => void markCurrentTrackInstrumental()}
          >
            <Music2 size={15} />
            <span>
              <strong>{currentLyricsKind === 'instrumental' ? t('lyricsSettings.currentTrack.instrumentalMarked') : t('lyricsSettings.currentTrack.markInstrumental')}</strong>
              <small>{t('lyricsSettings.currentTrack.markInstrumentalHint')}</small>
            </span>
            <em>{t('lyricsSettings.action.music')}</em>
          </button>

          <label className="audio-toggle-row">
            <span>
              <RotateCcw size={17} />
              <strong>{t('lyricsSettings.currentTrack.restartOnApply')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsRestartOnApplyEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsRestartOnApplyEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.currentTrack.restartOnApplyDescription')}</p>
        </section>
      ) : null}

        <section className={`audio-drawer-section audio-drawer-options audio-drawer-options--open lyrics-display-panel${isLyricsDisplayPanelOpen ? ' lyrics-display-panel--open' : ''}`}>
          <button
            className="lyrics-display-collapse-button"
            type="button"
            aria-expanded={isLyricsDisplayPanelOpen}
            onClick={toggleLyricsDisplayPanel}
          >
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.title')}</strong>
              <small>{t('lyricsSettings.display.enableLyricsDescription')}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>

          {isLyricsDisplayPanelOpen ? (
          <>
          <label className="audio-toggle-row">
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.enableLyrics')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsEnabled}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.enableLyricsDescription')}</p>

          {showPersistentControls ? (
            <>
              <label className="audio-toggle-row">
                <span>
                  <Monitor size={17} />
                  <strong>{t('lyricsSettings.display.desktopLyrics')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={desktopLyricsVisible}
                  disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                  onChange={(event) => setDesktopLyricsVisible(event.currentTarget.checked)}
                />
              </label>
              <p>{t('lyricsSettings.display.desktopLyricsDescription')}</p>

              <div className={`lyrics-font-panel lyrics-desktop-font-panel${isDesktopLyricsFontPanelOpen ? ' lyrics-desktop-font-panel--open' : ''}`}>
                <button
                  className="lyrics-desktop-font-collapse-button"
                  type="button"
                  aria-expanded={isDesktopLyricsFontPanelOpen}
                  onClick={toggleDesktopLyricsFontPanel}
                >
                  <span>
                    <Type size={15} />
                    <strong>{t('lyricsSettings.display.desktopFont')}</strong>
                    <small style={{ fontFamily: `"${desktopLyricsFontFamily}", "Microsoft YaHei", var(--echo-font-family)` }}>
                      {desktopLyricsFontFamily}
                    </small>
                  </span>
                  <em title={desktopLyricsFontFilePath ?? undefined}>
                    {desktopLyricsFontFilePath ? t('lyricsSettings.font.custom') : t('lyricsSettings.font.system')}
                  </em>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>

                {isDesktopLyricsFontPanelOpen ? (
                  <div className="lyrics-desktop-font-panel-body">
                    <button
                      className="lyrics-font-picker-button"
                      type="button"
                      disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                      onClick={() => openFontPicker('desktopLyrics')}
                    >
                      <span style={{ fontFamily: `"${desktopLyricsFontFamily}", "Microsoft YaHei", var(--echo-font-family)` }}>
                        {desktopLyricsFontFamily}
                      </span>
                      <em>{t('lyricsSettings.display.defaultMicrosoftYahei')}</em>
                    </button>
                    <div className="lyrics-font-actions">
                      <button
                        className="audio-device-pill"
                        type="button"
                        disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                        onClick={() => openFontPicker('desktopLyrics')}
                      >
                        <Check size={15} />
                        <span>
                          <strong>{t('lyricsSettings.font.applySystem')}</strong>
                          <small>{t('lyricsSettings.font.desktopOnly')}</small>
                        </span>
                        <em>{t('lyricsSettings.action.fonts')}</em>
                      </button>
                      <button
                        className="audio-device-pill"
                        type="button"
                        disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                        onClick={() => void chooseFontFileForTarget('desktopLyrics')}
                      >
                        <Upload size={15} />
                        <span>
                          <strong>{t('lyricsSettings.font.importDesktop')}</strong>
                          <small>TTF / OTF / WOFF / WOFF2</small>
                        </span>
                        <em>{t('lyricsSettings.action.choose')}</em>
                      </button>
                      <button
                        className="audio-device-pill"
                        type="button"
                        disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                        onClick={() => {
                          setIsFontPickerOpen(false);
                          patchDesktopLyricsStyle({
                            desktopLyricsFontFamily: fallbackSettings.desktopLyricsFontFamily,
                            desktopLyricsFontFilePath: fallbackSettings.desktopLyricsFontFilePath,
                          });
                        }}
                      >
                        <RotateCcw size={15} />
                        <span>
                          <strong>{t('lyricsSettings.font.restoreDesktopDefault')}</strong>
                          <small>{fallbackSettings.desktopLyricsFontFamily}</small>
                        </span>
                        <em>{t('lyricsSettings.action.reset')}</em>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <label className="audio-toggle-row">
                <span>
                  <Languages size={17} />
                  <strong>{t('lyricsSettings.display.desktopRomanization')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={desktopLyricsRomanizationEnabled}
                  disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                  onChange={(event) => patchDesktopLyricsStyle({ desktopLyricsRomanizationEnabled: event.currentTarget.checked })}
                />
              </label>
              <label className="audio-toggle-row">
                <span>
                  <Languages size={17} />
                  <strong>{t('lyricsSettings.display.desktopTranslation')}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={desktopLyricsTranslationEnabled}
                  disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                  onChange={(event) => patchDesktopLyricsStyle({ desktopLyricsTranslationEnabled: event.currentTarget.checked })}
                />
              </label>
              <div className="lyrics-color-panel__header">
                <span>
                  <Rows3 size={15} />
                  <strong>{t('lyricsSettings.display.desktopTextDirection')}</strong>
                </span>
                <em>{t(desktopLyricsTextDirection === 'vertical' ? 'lyricsSettings.direction.vertical' : 'lyricsSettings.direction.horizontal')}</em>
              </div>
              <div className="lyrics-background-segmented" aria-label={t('lyricsSettings.display.desktopTextDirection')}>
                {(['horizontal', 'vertical'] as const).map((direction) => (
                  <button
                    type="button"
                    key={direction}
                    aria-pressed={desktopLyricsTextDirection === direction}
                    disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                    onClick={() => patchDesktopLyricsStyle({ desktopLyricsTextDirection: direction })}
                  >
                    {t(direction === 'vertical' ? 'lyricsSettings.direction.vertical' : 'lyricsSettings.direction.horizontal')}
                  </button>
                ))}
              </div>

              <label className="mv-threshold-control lyrics-desktop-opacity-control">
                <span className="mv-threshold-copy">
                  <strong>{t('lyricsSettings.display.desktopOpacity')}</strong>
                  <em>{t('lyricsSettings.display.desktopOpacityDescription', { opacity: desktopLyricsOpacityPercent })}</em>
                </span>
                <span className="mv-threshold-slider">
                  <input
                    type="range"
                    min="35"
                    max="100"
                    step="1"
                    value={desktopLyricsOpacityPercent}
                    aria-label={t('lyricsSettings.display.desktopOpacity')}
                    disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                    onChange={(event) =>
                      patchDesktopLyricsStyle({ desktopLyricsOpacityPercent: Number(event.currentTarget.value) })}
                  />
                  <output>{desktopLyricsOpacityPercent}%</output>
                </span>
              </label>

              {desktopLyricsVisible ? (
                <>
                  <label className="audio-toggle-row">
                    <span>
                      <Lock size={17} />
                      <strong>{t('lyricsSettings.display.lockDesktopLyrics')}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={desktopLyricsLocked}
                      disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                      onChange={(event) => setDesktopLyricsLocked(event.currentTarget.checked)}
                    />
                  </label>
                  <p>{t('lyricsSettings.display.lockDesktopLyricsDescription')}</p>
                  <button
                    className="audio-device-pill"
                    type="button"
                    disabled={isBusy || isDesktopLyricsBusy || !hasDesktopLyricsBridge}
                    onClick={resetDesktopLyricsPosition}
                  >
                    <RotateCcw size={15} />
                    <span>
                      <strong>{t('lyricsSettings.display.resetDesktopPosition')}</strong>
                      <small>{t('lyricsSettings.display.resetDesktopPositionHint')}</small>
                    </span>
                    <em>{t('lyricsSettings.action.reset')}</em>
                  </button>
                </>
              ) : null}
            </>
          ) : null}

          {showPersistentControls ? (
          <label className="mv-threshold-control lyrics-match-threshold-control">
            <span className="mv-threshold-copy">
              <strong>{t('lyricsSettings.display.matchThreshold')}</strong>
              <em>{t('lyricsSettings.display.matchThresholdDescription', { threshold: thresholdPercent })}</em>
            </span>
            <span className="mv-threshold-slider">
              <input
                type="range"
                min="30"
                max="100"
                step="1"
                value={thresholdPercent}
                aria-label={t('lyricsSettings.display.matchThreshold')}
                disabled={isBusy}
                onChange={(event) => patchSettingsDebounced({ lyricsAutoAcceptScore: thresholdFromPercent(event.currentTarget.value) })}
              />
              <strong>{thresholdPercent}%</strong>
            </span>
          </label>
          ) : null}

          <label className="audio-toggle-row">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.display.hideTrackInfo')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsHeaderHidden}
              disabled={isBusy}
              onChange={(event) => toggleLyricsHeaderHidden(event.currentTarget.checked)}
            />
          </label>
          {effectiveSettings.lyricsHeaderHidden ? (
            <label className="audio-toggle-row">
              <span>
                <EyeOff size={17} />
                <strong>{t('lyricsSettings.display.disableMvTrackInfoAutoShow')}</strong>
              </span>
              <input
                type="checkbox"
                checked={effectiveSettings.lyricsMvAutoShowTrackInfoDisabled}
                disabled={isBusy}
                onChange={toggleMvAutoShowTrackInfoDisabled}
              />
            </label>
          ) : null}
          <label className="audio-toggle-row">
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.autoOpenCandidatePanel')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsCandidatePanelAutoOpenEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsCandidatePanelAutoOpenEnabled: event.currentTarget.checked })}
            />
          </label>
          <label className="audio-toggle-row">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.display.miniPlayer')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsPlayerBarDrawerEnabled}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsPlayerBarDrawerEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.miniPlayerDescription')}</p>
          <p>{t('lyricsSettings.display.miniPlayerHint')}</p>
          <label className="audio-toggle-row">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.display.miniPlayerAutoMv')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsPlayerBarDrawerAutoEnableForMv !== false}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsPlayerBarDrawerAutoEnableForMv: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.miniPlayerAutoMvDescription')}</p>
          <label className="audio-toggle-row">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.display.miniPlayerAutoHide')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsPlayerBarDrawerAutoHideEnabled === true}
              disabled={
                isBusy ||
                (effectiveSettings.lyricsPlayerBarDrawerEnabled !== true &&
                  effectiveSettings.lyricsPlayerBarDrawerAutoEnableForMv === false)
              }
              onChange={(event) => void patchSettings({ lyricsPlayerBarDrawerAutoHideEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.miniPlayerAutoHideDescription')}</p>

          {effectiveSettings.lyricsPlayerBarDrawerEnabled ? (
            <div className="audio-drawer-mini-grid lyrics-mini-player-options">
              <label className="lyrics-drawer-range">
                <span>
                  <strong>
                    <EyeOff size={15} />
                    {t('lyricsSettings.display.miniPlayerOpacity')}
                  </strong>
                  <em>{miniPlayerOpacityPercent}%</em>
                </span>
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={1}
                  value={miniPlayerOpacityPercent}
                  disabled={isBusy}
                  onChange={(event) =>
                    patchSettingsDebounced(
                      { lyricsPlayerBarDrawerOpacityPercent: Number(event.currentTarget.value) },
                      { broadcastSettings: true },
                    )
                  }
                />
              </label>

              <div className="lyrics-color-panel lyrics-mini-player-color-panel">
                <div className="lyrics-color-panel__header">
                  <span>
                    <Palette size={15} />
                    <strong>{t('lyricsSettings.display.miniPlayerColor')}</strong>
                  </span>
                  <em>
                    {effectiveSettings.lyricsPlayerBarDrawerColorMode === 'cover'
                      ? t('lyricsSettings.background.mode.cover')
                      : effectiveSettings.lyricsPlayerBarDrawerColorMode === 'custom'
                        ? miniPlayerColor
                        : t('lyricsSettings.display.miniPlayerDefaultDark')}
                  </em>
                </div>
                <div className="lyrics-background-segmented lyrics-mini-player-color-modes" aria-label={t('lyricsSettings.display.miniPlayerColorMode')}>
                  {[
                    ['default', t('lyricsSettings.display.miniPlayerDefaultDark')],
                    ['custom', t('lyricsSettings.font.custom')],
                    ['cover', t('lyricsSettings.background.mode.cover')],
                  ].map(([mode, label]) => (
                    <button
                      type="button"
                      key={mode}
                      aria-pressed={effectiveSettings.lyricsPlayerBarDrawerColorMode === mode}
                      disabled={isBusy}
                      onClick={() => void patchSettings({ lyricsPlayerBarDrawerColorMode: mode as AppSettings['lyricsPlayerBarDrawerColorMode'] })}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {effectiveSettings.lyricsPlayerBarDrawerColorMode === 'custom' ? (
                  <>
                    <div className="lyrics-color-panel__header lyrics-mini-player-custom-color">
                      <span>
                        <Palette size={15} />
                        <strong>{t('lyricsSettings.display.customColor')}</strong>
                      </span>
                      <label className="lyrics-color-input" title={t('lyricsSettings.display.chooseMiniPlayerColor')}>
                        <input
                          type="color"
                          value={miniPlayerColor}
                          disabled={isBusy}
                          onChange={(event) => void patchSettings({ lyricsPlayerBarDrawerColor: event.currentTarget.value })}
                        />
                        <em>{miniPlayerColor}</em>
                      </label>
                    </div>
                    <div className="lyrics-color-swatches" aria-label={t('lyricsSettings.display.miniPlayerPalette')}>
                      {colorSwatches.map((color) => (
                        <button
                          className="lyrics-color-swatch"
                          type="button"
                          key={color}
                          style={{ backgroundColor: color }}
                          aria-label={t('lyricsSettings.display.useMiniPlayerColor', { color })}
                          aria-pressed={miniPlayerColor.toUpperCase() === color}
                          disabled={isBusy}
                          onClick={() => void patchSettings({ lyricsPlayerBarDrawerColor: color })}
                        >
                          {miniPlayerColor.toUpperCase() === color ? <Check size={13} /> : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {effectiveSettings.lyricsPlayerBarDrawerColorMode === 'cover' ? (
                  <p>{t('lyricsSettings.display.coverMiniPlayerHint')}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <label className="audio-toggle-row">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.display.hideEmptyState')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsEmptyStateHidden}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsEmptyStateHidden: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.hideEmptyStateDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.showRomanization')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsRomanizationEnabled}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsRomanizationEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.showRomanizationDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.preferUtatenKana')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsUtatenKanaEnabled === true}
              disabled={isBusy || !effectiveSettings.lyricsRomanizationEnabled || !effectiveSettings.lyricsNetworkEnabled}
              onChange={(event) => void patchSettings({ lyricsUtatenKanaEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.preferUtatenKanaDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <Captions size={17} />
              <strong>{t('lyricsSettings.display.showTranslation')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsTranslationEnabled}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsTranslationEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.display.showTranslationDescription')}</p>

          <div className="lyrics-word-highlight-settings">
            <label className="audio-toggle-row lyrics-word-highlight-toggle">
              <span>
                <Captions size={17} />
                <strong>{t('lyricsSettings.wordHighlight.title')}</strong>
              </span>
              <input
                type="checkbox"
                checked={effectiveSettings.lyricsWordHighlightEnabled !== false}
                disabled={isBusy}
                onChange={(event) => void patchSettings({ lyricsWordHighlightEnabled: event.currentTarget.checked })}
              />
            </label>
            {showPersistentControls ? (
              <label className="lyrics-drawer-range lyrics-word-clarity-range">
                <span>
                  <strong>
                    <SlidersHorizontal size={15} />
                    {t('lyricsSettings.wordHighlight.clarity')}
                  </strong>
                  <em>{wordHighlightClarityLabel}</em>
                </span>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={1}
                  value={wordHighlightClarityPercent}
                  disabled={isBusy || effectiveSettings.lyricsWordHighlightEnabled === false}
                  onChange={(event) => patchSettingsDebounced({ lyricsWordHighlightClarityPercent: Number(event.currentTarget.value) })}
                />
              </label>
            ) : null}
          </div>
          <div className="lyrics-word-highlight-notes">
            <p>{t('lyricsSettings.wordHighlight.description')}</p>
            {showPersistentControls ? <p>{t('lyricsSettings.wordHighlight.clarityDescription')}</p> : null}
          </div>

          {showPersistentControls ? (
          <>
          <button
            className={`lyrics-style-collapse-button${isLyricsStyleControlsOpen ? ' lyrics-style-collapse-button--open' : ''}`}
            type="button"
            aria-expanded={isLyricsStyleControlsOpen}
            onClick={toggleLyricsStyleControls}
          >
            <span>
              <Type size={17} />
              <strong>{t('lyricsSettings.style.showControls')}</strong>
              <small>{t('lyricsSettings.style.showControlsDescription')}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          </>
          ) : null}

          {showPersistentControls ? (
          <div className="lyrics-font-panel" hidden={!isLyricsStyleControlsOpen}>
            <div className="lyrics-color-panel__header">
              <span>
                <Type size={15} />
                <strong>{t('lyricsSettings.style.lyricsFont')}</strong>
              </span>
              <em title={effectiveSettings.lyricsFontFilePath ?? undefined}>
                {effectiveSettings.lyricsFontFilePath ? t('lyricsSettings.font.custom') : t('lyricsSettings.font.system')}
              </em>
            </div>
            <button
              className="lyrics-font-picker-button"
              type="button"
              disabled={isBusy}
              onClick={() => openFontPicker('lyrics')}
            >
              <span style={{ fontFamily: `"${lyricsFontFamily}", var(--echo-font-family)` }}>{lyricsFontFamily}</span>
              <em>{t('lyricsSettings.font.chooseInstalled')}</em>
            </button>
            <div className="lyrics-font-actions">
              <button
                className="audio-device-pill"
                type="button"
                disabled={isBusy}
                onClick={() => openFontPicker('lyrics')}
              >
                <Check size={15} />
                <span>
                  <strong>{t('lyricsSettings.font.applySystem')}</strong>
                  <small>{t('lyricsSettings.font.lyricsOnly')}</small>
                </span>
                <em>{t('lyricsSettings.action.fonts')}</em>
              </button>
              <button className="audio-device-pill" type="button" disabled={isBusy} onClick={() => void chooseFontFileForTarget('lyrics')}>
                <Upload size={15} />
                <span>
                  <strong>{t('lyricsSettings.font.importFile')}</strong>
                  <small>TTF / OTF / WOFF / WOFF2</small>
                </span>
                <em>{t('lyricsSettings.action.choose')}</em>
              </button>
              <button
                className="audio-device-pill"
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const fallbackFontFamily = fallbackSettings.lyricsFontFamily ?? 'Microsoft YaHei';
                  setIsFontPickerOpen(false);
                  void patchSettings({
                    lyricsFontFamily: fallbackFontFamily,
                    lyricsFontFilePath: fallbackSettings.lyricsFontFilePath,
                  });
                }}
              >
                <RotateCcw size={15} />
                <span>
                  <strong>{t('lyricsSettings.font.restoreLyricsDefault')}</strong>
                  <small>{fallbackSettings.lyricsFontFamily}</small>
                </span>
                <em>{t('lyricsSettings.action.reset')}</em>
              </button>
            </div>
          </div>
          ) : null}

          {showPersistentControls ? (
            <div className="lyrics-style-range-grid" hidden={!isLyricsStyleControlsOpen}>
              <div className="lyrics-color-panel lyrics-text-direction-panel">
                <div className="lyrics-color-panel__header">
                  <span>
                    <Rows3 size={15} />
                    <strong>{t('lyricsSettings.style.textDirection')}</strong>
                  </span>
                  <em>{t(effectiveSettings.lyricsTextDirection === 'vertical' ? 'lyricsSettings.direction.vertical' : 'lyricsSettings.direction.horizontal')}</em>
                </div>
                <div className="lyrics-background-segmented" aria-label={t('lyricsSettings.style.textDirection')}>
                  {(['horizontal', 'vertical'] as const).map((direction) => (
                    <button
                      type="button"
                      key={direction}
                      aria-pressed={(effectiveSettings.lyricsTextDirection ?? 'horizontal') === direction}
                      disabled={isBusy}
                      onClick={() => void patchSettings({ lyricsTextDirection: direction })}
                    >
                      {t(direction === 'vertical' ? 'lyricsSettings.direction.vertical' : 'lyricsSettings.direction.horizontal')}
                    </button>
                  ))}
                </div>
              </div>
          {isSecondaryLyricsSizeOpen ? (
            <label className="lyrics-drawer-range lyrics-secondary-size-range">
              <span>
                <strong>
                  <Type size={15} />
                  {t('lyricsSettings.style.secondaryFontSize')}
                </strong>
                <em>{effectiveSettings.lyricsSecondaryFontSizePx}px</em>
              </span>
              <input
                type="range"
                min={12}
                max={32}
                step={1}
                value={effectiveSettings.lyricsSecondaryFontSizePx}
                onChange={(event) => patchSettingsDebounced({ lyricsSecondaryFontSizePx: Number(event.currentTarget.value) })}
              />
            </label>
          ) : null}

          <label className="lyrics-drawer-range">
            <span>
              <strong>
                <Type size={15} />
                {t('lyricsSettings.style.fontSize')}
              </strong>
              <em>{effectiveSettings.lyricsFontSizePx}px</em>
            </span>
            <input
              type="range"
              min={22}
              max={56}
              step={1}
              value={effectiveSettings.lyricsFontSizePx}
              onChange={(event) => patchSettingsDebounced({ lyricsFontSizePx: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="lyrics-drawer-range">
            <span>
              <strong>
                <SlidersHorizontal size={15} />
                {t('lyricsSettings.style.lineSpacing')}
              </strong>
              <em>{effectiveSettings.lyricsLineSpacingPercent}%</em>
            </span>
            <input
              type="range"
              min={60}
              max={150}
              step={1}
              value={effectiveSettings.lyricsLineSpacingPercent}
              onChange={(event) => patchSettingsDebounced({ lyricsLineSpacingPercent: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="lyrics-drawer-range">
            <span>
              <strong>
                <Type size={15} />
                {t('lyricsSettings.style.lineMaxChars')}
              </strong>
              <em>{lyricsLineMaxChars > 0 ? t('lyricsSettings.style.lineMaxCharsValue', { count: lyricsLineMaxChars }) : t('lyricsSettings.status.auto')}</em>
            </span>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={lyricsLineMaxChars}
              onChange={(event) => patchSettingsDebounced({ lyricsLineMaxChars: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="lyrics-drawer-range">
            <span>
              <strong>
                <EyeOff size={15} />
                {t('lyricsSettings.style.contextOpacity')}
              </strong>
              <em>{lyricsContextOpacityPercent}%</em>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={lyricsContextOpacityPercent}
              onChange={(event) => patchSettingsDebounced({ lyricsContextOpacityPercent: Number(event.currentTarget.value) })}
            />
          </label>
            </div>
          ) : null}

          {showPersistentControls ? (
          <div className="lyrics-color-panel" hidden={!isLyricsStyleControlsOpen}>
            <div className="lyrics-color-panel__header">
              <span>
                <Palette size={15} />
                <strong>{t('lyricsSettings.style.lyricsColor')}</strong>
              </span>
              <label className="lyrics-color-input" title={t('lyricsSettings.style.chooseLyricsColor')}>
                <input
                  type="color"
                  value={effectiveSettings.lyricsColor}
                  onChange={(event) => patchSettingsDebounced({ lyricsColor: event.currentTarget.value })}
                />
                <em>{effectiveSettings.lyricsColor}</em>
              </label>
            </div>
            <div className="lyrics-color-swatches" aria-label={t('lyricsSettings.style.lyricsColorPalette')}>
              {colorSwatches.map((color) => (
                <button
                  className="lyrics-color-swatch"
                  type="button"
                  key={color}
                  style={{ backgroundColor: color }}
                  aria-label={t('lyricsSettings.style.useColor', { color })}
                  aria-pressed={effectiveSettings.lyricsColor.toUpperCase() === color}
                  disabled={isBusy}
                  onClick={() => void patchSettings({ lyricsColor: color })}
                >
                  {effectiveSettings.lyricsColor.toUpperCase() === color ? <Check size={13} /> : null}
                </button>
              ))}
              <button
                className="lyrics-color-reset"
                type="button"
                disabled={isBusy}
                onClick={() => void patchSettings({ lyricsColor: fallbackSettings.lyricsColor })}
              >
                <RotateCcw size={14} />
                {t('lyricsSettings.action.reset')}
              </button>
            </div>
            <div
              className="lyrics-color-preview"
              style={{ '--lyrics-preview-color': effectiveSettings.lyricsColor } as CSSProperties}
            >
              <span>{t('lyricsSettings.preview.primary')}</span>
              <small>{t('lyricsSettings.preview.secondary')}</small>
            </div>
          </div>
          ) : null}
          </>
          ) : null}
        </section>

        {showPersistentControls ? (
        <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
          <div className="audio-drawer-section-title">
            <ImageIcon size={17} />
            <h3>{t('lyricsSettings.background.title')}</h3>
          </div>

          <label className="audio-toggle-row lyrics-smart-readable-toggle">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.background.smartReadable')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsSmartReadableColorsEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsSmartReadableColorsEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.background.smartReadableDescription')}</p>

          <label className="audio-toggle-row lyrics-readability-toggle">
            <span>
              <EyeOff size={17} />
              <strong>{t('lyricsSettings.background.readability')}</strong>
            </span>
            <input type="checkbox" checked={lyricsReadabilityEnhanced} onChange={toggleLyricsReadabilityEnhanced} />
          </label>
          <p>{t('lyricsSettings.background.readabilityDescription')}</p>

          <label className="audio-toggle-row lyrics-background-toggle">
            <span>
              <ImageIcon size={17} />
              <strong>{t('lyricsSettings.background.showControls')}</strong>
            </span>
            <input type="checkbox" checked={isBackgroundControlsOpen} onChange={(event) => setIsBackgroundControlsOpen(event.currentTarget.checked)} />
          </label>

          <div className="lyrics-background-controls" hidden={!isBackgroundControlsOpen}>
            <div
              className="lyrics-background-select"
              onBlur={(event) => {
                const nextFocus = event.relatedTarget;
                if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                  setIsBackgroundModeMenuOpen(false);
                }
              }}
            >
              <span>{t('lyricsSettings.background.modeAria')}</span>
              <button
                className="lyrics-background-select__trigger"
                type="button"
                aria-label={t('lyricsSettings.background.modeAria')}
                aria-haspopup="listbox"
                aria-expanded={isBackgroundModeMenuOpen}
                disabled={isBusy}
                onClick={() => setIsBackgroundModeMenuOpen((open) => !open)}
              >
                <strong>{lyricsBackgroundModeLabel}</strong>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {isBackgroundModeMenuOpen ? (
                <div className="lyrics-background-select__menu" role="listbox" aria-label={t('lyricsSettings.background.modeAria')}>
                  {lyricsBackgroundModeOptions.map((option) => (
                    <button
                      className="lyrics-background-select__option"
                      type="button"
                      role="option"
                      aria-selected={effectiveSettings.lyricsBackgroundMode === option.mode}
                      data-mode={option.mode}
                      key={option.mode}
                      onClick={() => {
                        setIsBackgroundModeMenuOpen(false);
                        if (option.mode === 'customWallpaper' && !effectiveSettings.lyricsCustomWallpaperPath) {
                          void chooseWallpaper();
                          return;
                        }

                        void patchSettings({ lyricsBackgroundMode: option.mode });
                      }}
                    >
                      <span>{option.label}</span>
                      {effectiveSettings.lyricsBackgroundMode === option.mode ? <Check size={15} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p>{t('lyricsSettings.background.modeDescription')}</p>

            <label className="audio-toggle-row lyrics-background-network-cover-toggle">
              <span>
                <ImageIcon size={17} />
                <strong>{t('lyricsSettings.background.highResolutionCover')}</strong>
              </span>
              <input
                type="checkbox"
                checked={effectiveSettings.lyricsHighResolutionNetworkCoverEnabled === true}
                disabled={isBusy || effectiveSettings.lyricsBackgroundMode !== 'cover'}
                onChange={(event) => void patchSettings({ lyricsHighResolutionNetworkCoverEnabled: event.currentTarget.checked })}
              />
            </label>
            <p>{t('lyricsSettings.background.highResolutionCoverDescription')}</p>

            <div className={`lyrics-cover-tuning${isBackgroundTuningOpen ? ' lyrics-cover-tuning--open' : ''}`}>
              <button
                className="lyrics-background-tuning-collapse-button"
                type="button"
                aria-expanded={isBackgroundTuningOpen}
                onClick={toggleBackgroundTuning}
              >
                <span>
                  <ImageIcon size={17} />
                  <strong>{t('lyricsSettings.background.tuning')}</strong>
                  <small>{t('lyricsSettings.background.tuningDescription')}</small>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>

            {isBackgroundTuningOpen ? (
              <div className="lyrics-cover-tuning-body">
                <label className="lyrics-drawer-range">
                  <span>
                    <strong>{t('lyricsSettings.background.scale')}</strong>
                    <em>{effectiveSettings.lyricsBackgroundScalePercent}%</em>
                  </span>
                  <input
                    type="range"
                    min={70}
                    max={180}
                    step={1}
                    value={effectiveSettings.lyricsBackgroundScalePercent}
                    onChange={(event) => patchSettingsDebounced({ lyricsBackgroundScalePercent: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="lyrics-drawer-range">
                  <span>
                    <strong>{t('lyricsSettings.background.opacity')}</strong>
                    <em>{effectiveSettings.lyricsCoverOpacityPercent}%</em>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={effectiveSettings.lyricsCoverOpacityPercent}
                    onChange={(event) => patchSettingsDebounced({ lyricsCoverOpacityPercent: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="lyrics-drawer-range">
                  <span>
                    <strong>{t('lyricsSettings.background.blur')}</strong>
                    <em>{effectiveSettings.lyricsCoverBlurPx}px</em>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={effectiveSettings.lyricsCoverBlurPx}
                    onChange={(event) => patchSettingsDebounced({ lyricsCoverBlurPx: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="lyrics-drawer-range">
                  <span>
                    <strong>{t('lyricsSettings.background.brightness')}</strong>
                    <em>{effectiveSettings.lyricsCoverBrightnessPercent}%</em>
                  </span>
                  <input
                    type="range"
                    min={40}
                    max={140}
                    step={1}
                    value={effectiveSettings.lyricsCoverBrightnessPercent}
                    onChange={(event) => patchSettingsDebounced({ lyricsCoverBrightnessPercent: Number(event.currentTarget.value) })}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="lyrics-wallpaper-actions">
            <button className="audio-device-pill" type="button" disabled={isBusy} onClick={() => void chooseWallpaper()}>
              <Upload size={15} />
              <span>
                <strong>{t('lyricsSettings.background.chooseWallpaper')}</strong>
                <small>{effectiveSettings.lyricsCustomWallpaperPath ? t('lyricsSettings.background.wallpaperSaved') : 'JPG / PNG / WEBP'}</small>
              </span>
              <em>{t('lyricsSettings.action.choose')}</em>
            </button>
            {effectiveSettings.lyricsCustomWallpaperPath ? (
              <button
                className="audio-device-pill"
                type="button"
                disabled={isBusy}
                onClick={() => void patchSettings({ lyricsBackgroundMode: 'theme', lyricsCustomWallpaperPath: null })}
              >
                <Trash2 size={15} />
                <span>
                  <strong>{t('lyricsSettings.background.clearWallpaper')}</strong>
                  <small>{t('lyricsSettings.background.clearWallpaperHint')}</small>
                </span>
                <em>Clear</em>
              </button>
            ) : null}
          </div>
          {effectiveSettings.lyricsCustomWallpaperPath ? (
            <p className="lyrics-wallpaper-path" title={effectiveSettings.lyricsCustomWallpaperPath}>
              {effectiveSettings.lyricsCustomWallpaperPath}
            </p>
          ) : null}
          </div>
        </section>
        ) : null}

        <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
          <div className="audio-drawer-section-title">
            <Globe2 size={17} />
            <h3>{t('lyricsSettings.online.title')}</h3>
          </div>

          <label className="audio-toggle-row">
            <span>
              <Globe2 size={17} />
              <strong>{t('lyricsSettings.online.enable')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsNetworkEnabled}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsNetworkEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.online.enableDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <Zap size={17} />
              <strong>{t('lyricsSettings.online.deepSearch')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsDeepSearchEnabled}
              disabled={isBusy || !effectiveSettings.lyricsNetworkEnabled}
              onChange={(event) => void patchSettings({ lyricsDeepSearchEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.online.deepSearchDescription')}</p>

          {showPersistentControls ? (
          <div className={`lyrics-source-panel${isLyricsSourcePanelOpen ? ' lyrics-source-panel--open' : ''}`}>
            <button
              className="lyrics-source-collapse-button"
              type="button"
              aria-expanded={isLyricsSourcePanelOpen}
              onClick={toggleLyricsSourcePanel}
            >
              <span>
                <Globe2 size={15} />
                <strong>{t('lyricsSettings.online.sources')}</strong>
                <small>{t('lyricsSettings.online.sourcesDescription')}</small>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>

            {isLyricsSourcePanelOpen ? (
              <div className="lyrics-source-panel-body">
                <div className="lyrics-source-grid" aria-label={t('lyricsSettings.online.sources')}>
                  {orderedLyricsSourceOptions.map((source) => (
                    <label
                      className="lyrics-source-option"
                      data-enabled={enabledProviderSet.has(source.id)}
                      data-dragging={draggingSourceId === source.id}
                      draggable={!isBusy}
                      key={source.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', source.id);
                        setDraggingSourceId(source.id);
                      }}
                      onDragOver={(event) => {
                        if (draggingSourceId && draggingSourceId !== source.id) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedId = (event.dataTransfer.getData('text/plain') || draggingSourceId) as LyricsProviderId | null;
                        if (draggedId) {
                          moveLyricsSource(draggedId, source.id);
                        }
                        setDraggingSourceId(null);
                      }}
                      onDragEnd={() => setDraggingSourceId(null)}
                    >
                      <span className="lyrics-source-drag-handle" aria-hidden="true">
                        <GripVertical size={15} />
                      </span>
                      <input
                        type="checkbox"
                        checked={enabledProviderSet.has(source.id)}
                        disabled={isBusy}
                        onChange={(event) => {
                          const current = new Set(effectiveSettings.lyricsEnabledProviders ?? defaultLyricsEnabledProviders);
                          if (event.currentTarget.checked) {
                            current.add(source.id);
                          } else {
                            current.delete(source.id);
                          }

                          current.add('local');
                          const nextProviders: LyricsProviderId[] = ['local', ...orderedOnlineProviderIds.filter((provider) => current.has(provider))];
                          void patchSettings({ lyricsEnabledProviders: nextProviders });
                        }}
                      />
                      <span>
                        <strong>{t(source.labelKey)}</strong>
                        <small>{t(source.descriptionKey)}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <p>{t('lyricsSettings.online.sourcesDescription')}</p>
              </div>
            ) : null}
          </div>
          ) : null}

          <label className="audio-toggle-row">
            <span>
              <Database size={17} />
              <strong>{t('lyricsSettings.online.autoSearch')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsAutoSearch}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsAutoSearch: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.online.autoSearchDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <FolderOpen size={17} />
              <strong>{t('lyricsSettings.online.autoSaveSidecar')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsAutoSaveSidecarEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsAutoSaveSidecarEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.online.autoSaveSidecarDescription')}</p>
        </section>

        {showPersistentControls ? (
        <section className="audio-drawer-section audio-drawer-options audio-drawer-options--open">
          <div className="audio-drawer-section-title">
            <TimerReset size={17} />
            <h3>{t('lyricsSettings.timing.title')}</h3>
          </div>

          <div className="lyrics-delay-range-grid">
          <label className="lyrics-drawer-range">
            <span>
              <strong>{t('lyricsSettings.timing.defaultOffset')}</strong>
              <em>{offsetSeconds}s</em>
            </span>
            <input
              type="range"
              min={-10000}
              max={10000}
              step={500}
              value={effectiveSettings.lyricsDefaultOffsetMs}
              onChange={(event) => void patchSettings({ lyricsDefaultOffsetMs: Number(event.currentTarget.value) })}
            />
          </label>

          <label className="lyrics-drawer-range">
            <span>
              <strong>{t('lyricsSettings.timing.globalOffset')}</strong>
              <em>{globalSyncOffsetSeconds}s</em>
            </span>
            <input
              type="range"
              min={-1000}
              max={1000}
              step={25}
              value={effectiveSettings.lyricsGlobalSyncOffsetMs}
              onChange={(event) => void patchSettings({ lyricsGlobalSyncOffsetMs: Number(event.currentTarget.value) })}
            />
          </label>
          </div>

          <label className="audio-toggle-row">
            <span>
              <TimerReset size={17} />
              <strong>{t('lyricsSettings.timing.timelineCorrection')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsTimelineCorrectionEnabled !== false}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsTimelineCorrectionEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.timing.timelineCorrectionDescription')}</p>

          <label className="audio-toggle-row">
            <span>
              <TimerReset size={17} />
              <strong>{t('lyricsSettings.timing.showPerTrackOffset')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsOffsetControlsEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsOffsetControlsEnabled: event.currentTarget.checked })}
            />
          </label>

          <label className="audio-toggle-row">
            <span>
              <TimerReset size={17} />
              <strong>{t('lyricsSettings.timing.smartAlignment')}</strong>
            </span>
            <input
              type="checkbox"
              checked={effectiveSettings.lyricsSmartAlignmentEnabled === true}
              disabled={isBusy}
              onChange={(event) => void patchSettings({ lyricsSmartAlignmentEnabled: event.currentTarget.checked })}
            />
          </label>
          <p>{t('lyricsSettings.timing.smartAlignmentDescription')}</p>

          {showCurrentTrackTools && currentTrackTools ? (
            <div className="lyrics-current-track-tools-panel">
              {currentTrackTools}
            </div>
          ) : null}

          <button
            className="audio-device-pill"
            type="button"
            disabled={isBusy}
            onClick={() => void patchSettings({ lyricsAutoAcceptScore: 0.5, lyricsDefaultOffsetMs: 0, lyricsGlobalSyncOffsetMs: 0 })}
          >
            <RotateCcw size={15} />
            <span>
              <strong>{t('lyricsSettings.timing.restoreDefaults')}</strong>
              <small>{t('lyricsSettings.timing.restoreDefaultsHint')}</small>
            </span>
            <em>{t('lyricsSettings.action.reset')}</em>
          </button>
        </section>
        ) : null}

        {isFontPickerOpen ? (
          <LyricsFontPickerModal
            currentFont={fontPickerTarget === 'desktopLyrics' ? desktopLyricsFontFamily : lyricsFontFamily}
            fonts={fontFamilies}
            isBusy={isBusy}
            onChooseFile={() => void chooseFontFileForTarget(fontPickerTarget)}
            onClose={() => setIsFontPickerOpen(false)}
            onSelect={applySelectedFontFamily}
            query={fontPickerQuery}
            setQuery={setFontPickerQuery}
          />
        ) : null}

        {error ? <p className="audio-drawer-error">{error}</p> : null}
    </div>
  );
};

export const LyricsSettingsDrawer = ({ currentTrackTools, isOpen, onClose }: LyricsSettingsDrawerProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isMotionOpen, setIsMotionOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setIsMotionOpen(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    setIsMotionOpen(false);
    if (!shouldRender) {
      return undefined;
    }

    const timer = window.setTimeout(() => setShouldRender(false), drawerExitAnimationMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="audio-drawer-root lyrics-settings-drawer-root no-drag" role="presentation" data-open={isMotionOpen}>
      <button className="audio-drawer-scrim" type="button" aria-label={t('lyricsSettings.drawer.close')} onClick={onClose} />
      <aside className="audio-drawer lyrics-settings-drawer" aria-label={t('lyricsSettings.drawer.aria')}>
        <div className="audio-drawer-scroll">
          <header className="audio-drawer-header">
          <div>
            <SlidersHorizontal size={18} />
            <h2>{t('lyricsSettings.drawer.title')}</h2>
          </div>
          <button className="audio-drawer-close" type="button" aria-label={t('lyricsSettings.drawer.close')} title={t('lyricsSettings.drawer.close')} onClick={onClose}>
            <X size={20} />
          </button>
          </header>
          <LyricsSettingsPanel currentTrackTools={currentTrackTools} />
        </div>
      </aside>
    </div>
  );
};
