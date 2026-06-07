import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  FastForward,
  Disc3,
  Music2,
  Rewind,
  RotateCcw,
  TimerReset,
  Upload,
  X,
} from "lucide-react";
import type { AudioStatus } from "../../shared/types/audio";
import type { AppSettings } from "../../shared/types/appSettings";
import type { AirPlayReceiverStatus } from "../../shared/types/connect";
import type { LibraryTrack } from "../../shared/types/library";
import type {
  LyricsProviderId,
  LyricsSearchCandidate,
  LyricsTrackSnapshotRequest,
  TrackLyrics,
} from "../../shared/types/lyrics";
import type { MvSettings } from "../../shared/types/mv";
import type {
  StreamingLyricsResult,
  StreamingProviderName,
} from "../../shared/types/streaming";
import { neteaseDjRadioPlaylistPrefix, streamingProviderNames } from "../../shared/types/streaming";
import type { PlaybackStatus } from "../../shared/types/playback";
import { decodeTextFileBytes } from "../../shared/utils/decodeTextFile";
import { LyricsView, getActiveLyricIndex, getEstimatedPlainLyricIndex } from "../components/lyrics/LyricsView";
import { MvPanel, type MvAudioClock } from "../components/lyrics/MvPanel";
import {
  readLyricsSourceQualitySummaries,
  recordLyricsSourceQualityCandidates,
  recordLyricsSourceQualityOutcome,
  type LyricsSourceQualityProviderSummary,
} from "../components/lyrics/lyricsSourceQualityMemory";
import {
  evaluateLyricsSmartAlignment,
  type LyricsSmartAlignmentAnchor,
  type LyricsSmartAlignmentCandidate,
  type LyricsSmartAlignmentEvaluation,
  type LyricsSmartAlignmentOutputMode,
} from "../components/lyrics/lyricsSmartAlignment";
import {
  createReadableLyricsColorVars,
  sampleImageUrl,
  type ReadableColorSample,
  type ReadableLyricsCssVars,
} from "../components/lyrics/lyricsReadableColor";
import type { LyricLine, LyricsState } from "../components/lyrics/lyricsTypes";
import { PlayerStatusChips } from "../components/player/PlayerStatusChips";
import { titleFromPath } from "../components/player/playerFormat";
import { usePlaybackQueue } from "../stores/PlaybackQueueProvider";
import { beginPlaybackSeekSnapshot, refreshPlaybackStatus, useSharedPlaybackStatus } from "../stores/playbackStatusStore";
import { logLyricsConsole } from "../diagnostics/lyricsConsole";
import { openAlbumDetailForTrack } from "../utils/albumNavigation";
import { serializeFontList } from "../preferences/appearancePreferences";

type LyricsPageProps = {
  initialLyrics?: LyricLine[];
  usePlayerDrawerHeader?: boolean;
};

type LyricsSmartAlignmentAutoState = {
  trackId: string;
  previousOffsetMs: number;
  offsetMs: number;
};

type LyricsMvPanelBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type LyricsMvPanelBoundaryState = {
  failed: boolean;
};

class LyricsMvPanelBoundary extends Component<LyricsMvPanelBoundaryProps, LyricsMvPanelBoundaryState> {
  state: LyricsMvPanelBoundaryState = { failed: false };

  static getDerivedStateFromError(): LyricsMvPanelBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previousProps: LyricsMvPanelBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <section
          className="lyrics-mv-panel lyrics-mv-panel--fallback"
          aria-label="MV"
          data-mv-enabled="false"
          data-view-mode="mv"
          data-mv-crashed="true"
        >
          <div className="lyrics-mv-fallback">
            <strong>MV temporarily unavailable</strong>
            <span>Lyrics remain available for the current playback.</span>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

type TrackWithLargeCover = LibraryTrack & {
  coverLarge?: string | null;
};

type CandidateSourceFilter = "all" | LyricsProviderId;

type CandidateSourceQualitySummary = {
  key: LyricsProviderId;
  label: string;
  count: number;
  bestScore: number;
  averageScore: number;
  lowRiskCount: number;
  syncedCount: number;
  recentCandidateCount: number;
  recentAppliedCount: number;
  recentAverageScore: number;
  order: number;
};

type LyricsDisplaySettings = Pick<
  AppSettings,
  | "lyricsEnabled"
  | "lyricsNetworkEnabled"
  | "lyricsEnabledProviders"
  | "lyricsProviderOrder"
  | "lyricsHeaderHidden"
  | "lyricsMvAutoShowTrackInfoDisabled"
  | "lyricsCandidatePanelAutoOpenEnabled"
  | "lyricsEmptyStateHidden"
  | "lyricsFontSizePx"
  | "lyricsFontFamily"
  | "lyricsFontFilePath"
  | "lyricsTextDirection"
  | "lyricsColor"
  | "lyricsBackgroundMode"
  | "lyricsCustomWallpaperPath"
  | "lyricsRomanizationEnabled"
  | "lyricsUtatenKanaEnabled"
  | "lyricsTranslationEnabled"
  | "lyricsWordHighlightEnabled"
  | "lyricsWordHighlightClarityPercent"
  | "lyricsAutoSearch"
  | "lyricsAutoAcceptScore"
  | "lyricsRestartOnApplyEnabled"
  | "lyricsGlobalSyncOffsetMs"
  | "lyricsTimelineCorrectionEnabled"
  | "lyricsOffsetControlsEnabled"
  | "lyricsSmartAlignmentEnabled"
  | "lyricsSecondaryFontSizePx"
  | "lyricsLineSpacingPercent"
  | "lyricsLineMaxChars"
  | "lyricsContextOpacityPercent"
  | "lyricsCoverOpacityPercent"
  | "lyricsSmartReadableColorsEnabled"
  | "lyricsHighResolutionNetworkCoverEnabled"
  | "lyricsCoverBlurPx"
  | "lyricsCoverBrightnessPercent"
  | "lyricsBackgroundScalePercent"
  | "lowLoadPlaybackModeEnabled"
>;

const playbackSeekedEvent = "playback:seeked";
const lyricsNavigationEvent = "app:navigate:lyrics";
const lyricsViewModeMemoryKey = "echo:lyrics:view-mode";
const lyricsCandidateSourceMemoryKey = "echo:lyrics:candidate-source";
const maxInterpolatedStatusGapSeconds = 1.6;
const maxStaleStatusRegressionSeconds = 2.5;
const seekAnchorMaxAgeSeconds = 3;
const seekAnchorStalledBridgeMaxAgeSeconds = 30;
const seekAnchorSourceAdvanceReleaseSeconds = 0.75;
const playbackRateChangeDiscontinuitySeconds = 0.35;
const albumNavigationTransitionMs = 180;
const lyricSeekPreviewMaxMs = 1200;
const lyricsDrawerToolsChangedEvent = "app:lyrics-drawer-tools-changed";

const fallbackLyricsDisplaySettings: LyricsDisplaySettings = {
  lyricsEnabled: true,
  lyricsNetworkEnabled: true,
  lyricsEnabledProviders: ["local", "lrclib", "netease", "qqmusic", "kugou", "kuwo"],
  lyricsProviderOrder: ["local", "lrclib", "netease", "qqmusic", "kugou", "kuwo"],
  lyricsHeaderHidden: false,
  lyricsMvAutoShowTrackInfoDisabled: true,
  lyricsCandidatePanelAutoOpenEnabled: false,
  lyricsEmptyStateHidden: true,
  lyricsFontSizePx: 40,
  lyricsFontFamily: "Microsoft YaHei",
  lyricsFontFilePath: null,
  lyricsTextDirection: "horizontal",
  lyricsColor: "#314054",
  lyricsBackgroundMode: "theme",
  lyricsCustomWallpaperPath: null,
  lyricsRomanizationEnabled: true,
  lyricsUtatenKanaEnabled: false,
  lyricsTranslationEnabled: true,
  lyricsWordHighlightEnabled: true,
  lyricsWordHighlightClarityPercent: 70,
  lyricsAutoSearch: true,
  lyricsAutoAcceptScore: 0.5,
  lyricsRestartOnApplyEnabled: false,
  lyricsGlobalSyncOffsetMs: 0,
  lyricsTimelineCorrectionEnabled: true,
  lyricsOffsetControlsEnabled: true,
  lyricsSmartAlignmentEnabled: true,
  lyricsSecondaryFontSizePx: 22,
  lyricsLineSpacingPercent: 110,
  lyricsLineMaxChars: 0,
  lyricsContextOpacityPercent: 49,
  lyricsCoverOpacityPercent: 100,
  lyricsSmartReadableColorsEnabled: false,
  lyricsHighResolutionNetworkCoverEnabled: false,
  lyricsCoverBlurPx: 10,
  lyricsCoverBrightnessPercent: 100,
  lyricsBackgroundScalePercent: 100,
  lowLoadPlaybackModeEnabled: false,
};

const emptyLyrics = (offsetMs = 0): LyricsState => ({
  kind: "empty",
  source: "none",
  lines: [],
  offsetMs,
});

const syncedLyrics = (lines: LyricLine[], offsetMs: number): LyricsState => ({
  kind: "synced",
  source: "placeholder",
  lines,
  offsetMs,
});

const lyricsPageSessionMemoryPrefix = "echo-next.lyrics-page.state.v1:";
const isRememberableLyricsState = (lyrics: LyricsState): boolean =>
  lyrics.kind === "instrumental" || lyrics.lines.length > 0;

const readRememberedLyricsState = (key: string | null): LyricsState | null => {
  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${lyricsPageSessionMemoryPrefix}${key}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LyricsState> | null;
    if (
      !parsed ||
      !Array.isArray(parsed.lines) ||
      (parsed.kind !== "plain" && parsed.kind !== "synced" && parsed.kind !== "instrumental") ||
      typeof parsed.offsetMs !== "number"
    ) {
      return null;
    }

    return {
      kind: parsed.kind,
      source: parsed.source ?? "none",
      lines: parsed.lines,
      offsetMs: parsed.offsetMs,
    } as LyricsState;
  } catch {
    return null;
  }
};

const rememberLyricsState = (key: string | null, lyrics: LyricsState): void => {
  if (!key || !isRememberableLyricsState(lyrics) || typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(`${lyricsPageSessionMemoryPrefix}${key}`, JSON.stringify(lyrics));
  } catch {
    // Session memory is only a visual continuity hint.
  }
};

const trackLyricsToState = (
  lyrics: TrackLyrics | null,
  fallbackOffsetMs = 0,
): LyricsState => {
  if (!lyrics) {
    return emptyLyrics(fallbackOffsetMs);
  }

  return {
    kind: lyrics.kind,
    source:
      lyrics.provider === "local"
        ? "local"
        : lyrics.provider === "lrclib"
          ? "online"
          : lyrics.provider,
    lines: lyrics.lines,
    offsetMs: lyrics.offsetMs,
  };
};

const isStreamingProviderName = (value: string | null | undefined): value is StreamingProviderName =>
  streamingProviderNames.includes(value as StreamingProviderName);

const isStreamingTrack = (
  track: LibraryTrack | null,
): track is LibraryTrack & { provider: StreamingProviderName; providerTrackId: string } =>
  track?.mediaType === "streaming" &&
  isStreamingProviderName(track.provider) &&
  typeof track.providerTrackId === "string" &&
  track.providerTrackId.trim().length > 0;

type StreamingLyricsTarget = {
  provider: StreamingProviderName;
  providerTrackId: string;
};

const streamingTargetKey = (target: StreamingLyricsTarget | null): string | null =>
  target ? `${target.provider}:${target.providerTrackId}` : null;

const isNeteaseDjRadioTrack = (track: LibraryTrack | null): boolean =>
  track?.mediaType === "streaming" &&
  track.provider === "netease" &&
  (
    track.fieldSources?.streamingSourcePlaylistId?.startsWith(neteaseDjRadioPlaylistPrefix) ||
    track.fieldSources?.streamingAlbumId?.startsWith(neteaseDjRadioPlaylistPrefix)
  );

const isSnapshotTrackId = (trackId: string | null | undefined): boolean =>
  Boolean(trackId?.startsWith("dlna-receiver:") || trackId?.startsWith("airplay-receiver:"));

const snapshotProtocol = (trackId: string | null | undefined): "dlna" | "airplay" | null => {
  if (trackId?.startsWith("dlna-receiver:")) {
    return "dlna";
  }
  if (trackId?.startsWith("airplay-receiver:")) {
    return "airplay";
  }
  return null;
};

const isSnapshotLyricsTrack = (track: LibraryTrack | null, trackId: string | null): track is LibraryTrack =>
  Boolean(track?.isTemporary || isSnapshotTrackId(trackId) || isSnapshotTrackId(track?.id));

const airPlaySingleLineLyrics = (line: string | null): LyricsState | null => {
  const text = line?.trim();
  if (!text) {
    return null;
  }

  return {
    kind: "plain",
    source: "placeholder",
    lines: [{ timeMs: -1, text }],
    offsetMs: 0,
  };
};

const airPlayReceiverSourceId = (status: AirPlayReceiverStatus | null): string | null => {
  const sourceId = status?.currentSourceId?.trim();
  return sourceId && status?.enabled ? sourceId : null;
};

const airPlayReceiverPlaybackState = (status: AirPlayReceiverStatus | null): "playing" | "paused" | "idle" | null => {
  if (!airPlayReceiverSourceId(status)) {
    return null;
  }

  return status?.state === "playing" || status?.state === "paused" ? status.state : "idle";
};

const airPlayReceiverDurationSeconds = (status: AirPlayReceiverStatus | null): number | null => {
  const duration = Number(status?.durationSeconds ?? status?.metadata?.durationSeconds);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
};

const airPlayReceiverPositionSeconds = (status: AirPlayReceiverStatus | null): number => {
  const position = Number(status?.positionSeconds);
  return Number.isFinite(position) && position > 0 ? position : 0;
};

const streamingLyricsToState = (
  result: StreamingLyricsResult,
  fallbackOffsetMs = 0,
): LyricsState => {
  const directLines = result.lines
    .map((line) => ({
      timeMs: line.timeMs ?? -1,
      text: line.text.trim(),
      ...(line.translation ? { translation: line.translation } : {}),
      ...(line.romanization ? { romanization: line.romanization } : {}),
    }))
    .filter((line) => line.text.length > 0);
  const fallbackText = result.plainLyrics ?? result.syncedLyrics ?? "";
  const fallbackLines = fallbackText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ timeMs: -1, text }));
  const lines = directLines.length > 0 ? directLines : fallbackLines;
  const hasTimedLines = lines.some((line) => line.timeMs >= 0);

  if (result.instrumental === true) {
    return {
      kind: "instrumental",
      source: result.provider === "netease" || result.provider === "qqmusic" ? result.provider : "online",
      lines: [],
      offsetMs: fallbackOffsetMs,
    };
  }

  if (result.status === "missing" || lines.length === 0) {
    return emptyLyrics(fallbackOffsetMs);
  }

  return {
    kind: hasTimedLines || Boolean(result.syncedLyrics) ? "synced" : "plain",
    source: result.provider === "netease" || result.provider === "qqmusic" ? result.provider : "online",
    lines,
    offsetMs: fallbackOffsetMs,
  };
};

const dispatchCurrentLyricsProviderChanged = (lyrics: TrackLyrics | null): void => {
  window.dispatchEvent(new CustomEvent("lyrics:current-provider-changed", {
    detail: {
      provider: lyrics?.provider ?? null,
      title: lyrics?.title ?? null,
    },
  }));
};

const dispatchPlaybackSeeked = (positionSeconds: number, trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(playbackSeekedEvent, { detail: { positionSeconds, trackId } }));
};

const restartCurrentPlaybackForLyrics = async (trackId: string | null): Promise<void> => {
  const playback = window.echo?.playback;
  if (!playback) {
    return;
  }

  await playback.seek(0);
  await playback.play();
  dispatchPlaybackSeeked(0, trackId);
  await refreshPlaybackStatus();
};

type PlaybackSeekedDetail = {
  positionSeconds?: number;
  trackId?: string | null;
};

type LyricsViewMode = "lyrics" | "mv";

type LyricsNavigationDetail = {
  mode?: LyricsViewMode;
};

const isLyricsViewMode = (value: unknown): value is LyricsViewMode =>
  value === "lyrics" || value === "mv";

const readRememberedLyricsViewMode = (): LyricsViewMode => {
  try {
    const value = window.sessionStorage.getItem(lyricsViewModeMemoryKey);
    return isLyricsViewMode(value) ? value : "lyrics";
  } catch {
    return "lyrics";
  }
};

const rememberLyricsViewMode = (mode: LyricsViewMode): void => {
  try {
    window.sessionStorage.setItem(lyricsViewModeMemoryKey, mode);
  } catch {
    // Best-effort page mode only.
  }
};

const isWindowApproximatelyMaximized = (): boolean => {
  const widthDelta = Math.abs(window.outerWidth - window.screen.availWidth);
  const heightDelta = Math.abs(window.outerHeight - window.screen.availHeight);
  return widthDelta <= 24 && heightDelta <= 24;
};

const formatDuration = (durationSeconds: number | null): string => {
  if (!durationSeconds) {
    return "--:--";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const lyricsMatchAutoCloseMs = 10000;
const formatScore = (score: number): string => `${Math.round(score * 100)}%`;
const formatOffset = (offsetMs: number): string => {
  if (offsetMs === 0) {
    return "0ms";
  }

  return `${offsetMs > 0 ? "+" : ""}${offsetMs}ms`;
};

const riskLabel = (risk: LyricsSearchCandidate["risk"]): string => {
  if (risk === "low") return "精准匹配";
  if (risk === "medium") return "可能匹配";
  return "需确认";
};

type LyricsCandidateDisplayKind = "instrumental" | "synced" | "plain" | "lyrics";

const lyricsCandidateDisplayKind = (candidate: LyricsSearchCandidate): LyricsCandidateDisplayKind => {
  if (candidate.instrumental) return "instrumental";
  if (candidate.hasSynced) return "synced";
  if (candidate.hasPlain) return "plain";
  return "lyrics";
};

const lyricsCandidateDisplayLabel = (kind: LyricsCandidateDisplayKind): string => {
  if (kind === "instrumental") return "Instrumental";
  if (kind === "synced") return "Synced";
  if (kind === "plain") return "Plain";
  return "Lyrics";
};

const reasonLabels: Record<string, string> = {
  title_exact: "标题一致",
  title_similar: "标题接近",
  artist_exact: "艺人一致",
  album_match: "专辑匹配",
  duration_exact: "时长精准",
  duration_close: "时长接近",
  duration_mismatch: "时长不同",
  artist_mismatch: "艺人不同",
  cover_intent: "可能翻唱",
  candidate_only_cover: "翻唱需确认",
  candidate_only_duration: "时长需确认",
  version_match: "版本匹配",
  version_conflict: "Version mismatch",
  synced_duration_safe: "同步歌词",
  embedded_tag_priority: "嵌入歌词",
  local_sidecar_priority: "本地歌词",
  auto_accept: "自动采用",
  rejected_by_user: "已拒绝",
  amll_ttml_provider: "AMLL TTML",
  netease_id: "NetEase ID",
  netease_provider: "NetEase",
  qqmusic_provider: "QQ 音乐",
  kugou_provider: "酷狗",
  kuwo_provider: "酷我",
};

const visibleReasons = (candidate: LyricsSearchCandidate): string[] =>
  (candidate.reasons ?? [])
    .map((reason) => reasonLabels[reason])
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, 3);

const sourceFilterKey = (candidate: LyricsSearchCandidate): LyricsProviderId =>
  candidate.provider;

const searchableLyricsProviderIds: LyricsProviderId[] = ["local", "lrclib", "amll-ttml", "netease", "qqmusic", "kugou", "kuwo"];
const searchableLyricsProviderSet = new Set<string>(searchableLyricsProviderIds);
const isCandidateSourceFilter = (value: string | null): value is CandidateSourceFilter =>
  value === "all" || searchableLyricsProviderSet.has(value ?? "");
const lyricsProviderLabels: Partial<Record<LyricsProviderId, string>> = {
  local: "本地",
  lrclib: "LRCLIB",
  "amll-ttml": "AMLL TTML",
  netease: "NetEase",
  qqmusic: "QQ 音乐",
  kugou: "酷狗",
  kuwo: "酷我",
  musixmatch: "Musixmatch",
  genius: "Genius",
};
const lyricsProviderSortOrder = new Map<LyricsProviderId, number>([
  ["local", 0],
  ["lrclib", 1],
  ["amll-ttml", 2],
  ["netease", 3],
  ["qqmusic", 4],
  ["kugou", 5],
  ["kuwo", 6],
  ["musixmatch", 7],
  ["genius", 8],
  ["manual", 9],
]);

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

const isAudioStatusForPlayback = (
  audioStatus: AudioStatus,
  playbackStatus: PlaybackStatus | null,
): boolean => {
  if (!playbackStatus?.currentTrackId && !playbackStatus?.filePath) {
    return true;
  }

  return (
    Boolean(playbackStatus.currentTrackId && audioStatus.currentTrackId === playbackStatus.currentTrackId) ||
    Boolean(playbackStatus.filePath && audioStatus.currentFilePath === playbackStatus.filePath)
  );
};

const shouldUseAudioStatusForCurrentPlayback = (
  audioStatus: AudioStatus | null,
  playbackStatus: PlaybackStatus | null,
): audioStatus is AudioStatus => {
  if (!audioStatus) {
    return false;
  }

  if (isAudioStatusForPlayback(audioStatus, playbackStatus)) {
    return true;
  }

  const playbackSnapshotProtocol = snapshotProtocol(playbackStatus?.currentTrackId ?? playbackStatus?.filePath);
  if (playbackSnapshotProtocol) {
    const audioSnapshotProtocol = snapshotProtocol(audioStatus.currentTrackId ?? audioStatus.currentFilePath);
    return audioSnapshotProtocol === playbackSnapshotProtocol;
  }

  if (isSnapshotTrackId(playbackStatus?.currentTrackId)) {
    return false;
  }

  if (!audioStatus.currentTrackId && !audioStatus.currentFilePath) {
    return false;
  }

  return (
    audioStatus.state === "loading" ||
    audioStatus.state === "playing" ||
    audioStatus.state === "paused"
  );
};

const smartAlignmentOutputModes = new Set(["shared", "exclusive", "asio", "system"]);
const lyricsClockStaleTelemetryThresholdMs = 750;
const lyricsClockUnderrunBufferThresholdMs = 40;
const lyricsClockStallDetectionMs = 900;
const lyricsClockStallProgressRatio = 0.25;
const smartAlignmentBackgroundCandidateLimit = 3;

const isSmartAlignmentOutputMode = (
  outputMode: AudioStatus["outputMode"] | null | undefined,
): outputMode is LyricsSmartAlignmentOutputMode =>
  Boolean(outputMode && smartAlignmentOutputModes.has(outputMode));

const smartAlignmentModeLabel = (outputMode: LyricsSmartAlignmentOutputMode): string => {
  if (outputMode === "asio") {
    return "ASIO";
  }
  if (outputMode === "exclusive") {
    return "WASAPI 独占";
  }
  if (outputMode === "system") {
    return "System";
  }
  return "WASAPI 共享";
};

const smartAlignmentConfidenceLabel = (confidence: "low" | "medium" | "high"): string => {
  if (confidence === "high") {
    return "高置信";
  }
  if (confidence === "medium") {
    return "中置信";
  }
  return "低置信";
};

const smartAlignmentReasonText = (evaluation: LyricsSmartAlignmentEvaluation | null): string => {
  if (!evaluation) {
    return "等待同步歌词、播放时钟或候选歌词。";
  }

  switch (evaluation.reason) {
    case "stable_anchors":
      return `已用 ${evaluation.anchorCount} 个锚点确认延迟。`;
    case "stable_candidates":
      return `已用 ${evaluation.matchedLineCount} 行候选歌词确认延迟。`;
    case "mixed_evidence":
      return "已结合锚点和候选歌词确认延迟。";
    case "single_anchor":
      return "已记录 1 个锚点，再标记一句会自动保存。";
    case "not_enough_evidence":
      return "证据还不够，继续播放或标记当前句后再校准。";
    case "no_candidate_match":
      return "候选歌词文本匹配不足，建议换一个歌词源。";
    case "outlier_rejected":
      return `发现 ${evaluation.rejectedEvidenceCount} 个离群点，暂不自动保存。`;
    case "possible_drift":
      return `歌词前后可能漂移 ${formatOffset(evaluation.driftMs)}，建议重新匹配歌词源。`;
    case "unstable_evidence":
      return `校准证据分散 ${evaluation.spreadMs}ms，暂不自动保存。`;
    case "offset_too_small":
      return "当前延迟已经接近准确，无需自动保存。";
    case "offset_too_large":
      return "计算出的延迟过大，建议换源或手动确认。";
    default:
      return "智能校准暂未找到足够稳定的结果。";
  }
};

const customLyricsExtensions = [".lrc", ".ttml"] as const;

const isCustomLyricsFile = (fileName: string): boolean => {
  const normalizedName = fileName.toLowerCase();
  return customLyricsExtensions.some((extension) => normalizedName.endsWith(extension));
};

const firstCustomLyricsFile = (fileList: FileList | null): File | null => {
  if (!fileList) {
    return null;
  }

  return Array.from(fileList).find((file) => isCustomLyricsFile(file.name)) ?? null;
};

const hasFileDrag = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes("Files");

const selectAutoApplyCandidate = (
  candidates: LyricsSearchCandidate[],
  settings: Pick<LyricsDisplaySettings, "lyricsAutoAcceptScore" | "lyricsAutoSearch">,
): LyricsSearchCandidate | null => {
  if (!settings.lyricsAutoSearch) {
    return null;
  }

  const threshold = Number.isFinite(settings.lyricsAutoAcceptScore)
    ? Math.max(0.3, Math.min(1, settings.lyricsAutoAcceptScore))
    : fallbackLyricsDisplaySettings.lyricsAutoAcceptScore;

  return candidates.find(
    (candidate) =>
      candidate.score >= threshold &&
      isAutoApplyRiskAllowed(candidate) &&
      (candidate.hasSynced || candidate.hasPlain || candidate.instrumental),
  ) ?? null;
};

const isAutoApplyRiskAllowed = (candidate: LyricsSearchCandidate): boolean => {
  const risk = candidate.risk ?? "low";
  if (risk === "low") {
    return true;
  }

  const reasons = new Set(candidate.reasons ?? []);
  const titleScore = candidate.titleScore ?? (reasons.has("title_exact") ? 1 : 0);
  const artistScore = candidate.artistScore ?? (reasons.has("artist_exact") ? 1 : 0);
  const hasOnlyDurationMismatch =
    reasons.has("duration_mismatch") &&
    !reasons.has("artist_mismatch") &&
    !reasons.has("version_conflict") &&
    !reasons.has("rejected_by_user") &&
    !reasons.has("candidate_only_cover") &&
    !reasons.has("cover_intent");

  return hasOnlyDurationMismatch && titleScore >= 0.98 && artistScore >= 0.98;
};

const safeCoverUrl = (track: LibraryTrack | null): string | null => {
  const coverLarge = (track as TrackWithLargeCover | null)?.coverLarge ?? null;
  const coverUrl =
    coverLarge ??
    (track?.coverId
      ? `echo-cover://large/${encodeURIComponent(track.coverId)}`
      : (track?.coverThumb ?? null));
  const allowInlineCover = isSnapshotLyricsTrack(track, track?.id ?? null);

  return coverUrl && (allowInlineCover || !coverUrl.startsWith("data:")) ? coverUrl : null;
};

const originalCoverUrlFromCachedVariant = (coverUrl: string | null | undefined): string | null => {
  const originalUrl = coverUrl?.replace(
    /^echo-cover:\/\/(?:thumb|album|large)\//u,
    "echo-cover://original/",
  ) ?? null;

  return originalUrl?.startsWith("echo-cover://original/") ? originalUrl : null;
};

type CoverColorSampleVariant = "original" | "large" | "album" | "thumb";

const coverColorSampleVariants: CoverColorSampleVariant[] = ["original", "large", "album", "thumb"];
const emptyLyricsImageUrls: readonly string[] = [];

const coverVariantUrlFromCachedVariant = (
  coverUrl: string | null | undefined,
  variant: CoverColorSampleVariant,
): string | null => {
  const variantUrl = coverUrl?.replace(
    /^echo-cover:\/\/(?:thumb|album|large|original)\//u,
    `echo-cover://${variant}/`,
  ) ?? null;

  return variantUrl?.startsWith(`echo-cover://${variant}/`) ? variantUrl : null;
};

const appendCoverColorSampleUrl = (
  candidates: string[],
  coverUrl: string | null | undefined,
  options: { allowInlineCover?: boolean } = {},
): void => {
  const normalizedCoverUrl = coverUrl?.trim();
  if (!normalizedCoverUrl) {
    return;
  }

  if (!options.allowInlineCover && normalizedCoverUrl.startsWith("data:")) {
    return;
  }

  if (!candidates.includes(normalizedCoverUrl)) {
    candidates.push(normalizedCoverUrl);
  }
};

const highResolutionRemoteArtworkUrl = (coverUrl: string | null | undefined): string | null => {
  if (!coverUrl?.trim()) {
    return null;
  }

  const upgradeTarget = (rawUrl: string): string | null => {
    try {
      const url = new URL(rawUrl);
      let changed = false;

      if (url.hostname.endsWith("music.126.net") && url.searchParams.has("param")) {
        url.searchParams.delete("param");
        changed = true;
      }

      if (url.hostname.endsWith("gtimg.cn") && /T002R\d+x\d+M000/u.test(url.href)) {
        return url.href.replace(/T002R\d+x\d+M000/u, "T002R500x500M000");
      }

      if (url.hostname.endsWith("coverartarchive.org") && /\/front-\d+(?=$|[?#])/u.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/front-\d+$/u, "/front");
        changed = true;
      }

      return changed ? url.toString() : null;
    } catch {
      return null;
    }
  };

  try {
    const proxiedUrl = new URL(coverUrl);
    if (proxiedUrl.protocol === "echo-image:" && proxiedUrl.hostname === "remote") {
      const targetUrl = decodeURIComponent(proxiedUrl.pathname.replace(/^\/+/u, ""));
      const upgradedTargetUrl = upgradeTarget(targetUrl);
      if (!upgradedTargetUrl) {
        return null;
      }

      const referer = proxiedUrl.searchParams.get("referer");
      return `echo-image://remote/${encodeURIComponent(upgradedTargetUrl)}${
        referer ? `?referer=${encodeURIComponent(referer)}` : ""
      }`;
    }
  } catch {
    return null;
  }

  return upgradeTarget(coverUrl);
};

const isRemoteArtworkUrl = (coverUrl: string | null | undefined): coverUrl is string =>
  Boolean(coverUrl && !coverUrl.startsWith("data:") && !coverUrl.startsWith("echo-cover://"));

const isStreamBackedTrack = (track: LibraryTrack | null): boolean =>
  track?.mediaType === "streaming" || track?.mediaType === "remote";

const collectCoverColorSampleUrls = (
  track: LibraryTrack | null,
  airPlayArtworkUrl: string | null,
): string[] => {
  const candidates: string[] = [];
  const allowInlineCover = isSnapshotLyricsTrack(track, track?.id ?? null);
  const coverLarge = (track as TrackWithLargeCover | null)?.coverLarge ?? null;
  const coverThumb = track?.coverThumb ?? null;

  if (track?.coverId) {
    for (const variant of coverColorSampleVariants) {
      appendCoverColorSampleUrl(
        candidates,
        `echo-cover://${variant}/${encodeURIComponent(track.coverId)}`,
      );
    }
  }

  for (const cachedCoverUrl of [coverLarge, coverThumb]) {
    for (const variant of coverColorSampleVariants) {
      appendCoverColorSampleUrl(
        candidates,
        coverVariantUrlFromCachedVariant(cachedCoverUrl, variant),
        { allowInlineCover },
      );
    }
  }

  if (isStreamBackedTrack(track)) {
    appendCoverColorSampleUrl(candidates, highResolutionRemoteArtworkUrl(coverLarge));
    appendCoverColorSampleUrl(candidates, highResolutionRemoteArtworkUrl(coverThumb));
  }

  appendCoverColorSampleUrl(candidates, coverLarge, { allowInlineCover });
  appendCoverColorSampleUrl(candidates, coverThumb, { allowInlineCover });
  appendCoverColorSampleUrl(candidates, airPlayArtworkUrl, { allowInlineCover: true });

  return candidates;
};

const sampleFirstImageUrl = async (urls: readonly string[]): Promise<ReadableColorSample | null> => {
  for (const url of urls) {
    const sample = await sampleImageUrl(url);
    if (sample) {
      return sample;
    }
  }

  return null;
};

const safeOriginalCoverUrl = (track: LibraryTrack | null): string | null => {
  const allowInlineCover = isSnapshotLyricsTrack(track, track?.id ?? null);
  const coverLarge = (track as TrackWithLargeCover | null)?.coverLarge ?? null;
  const coverThumb = track?.coverThumb ?? null;
  const inlineCover = allowInlineCover
    ? (coverLarge ?? coverThumb)
    : null;
  const streamCover = isStreamBackedTrack(track) && isRemoteArtworkUrl(coverLarge)
    ? highResolutionRemoteArtworkUrl(coverLarge) ?? coverLarge
    : isStreamBackedTrack(track) && isRemoteArtworkUrl(coverThumb)
      ? highResolutionRemoteArtworkUrl(coverThumb) ?? coverThumb
      : null;
  const coverUrl = track?.coverId
    ? `echo-cover://original/${encodeURIComponent(track.coverId)}`
    : originalCoverUrlFromCachedVariant(coverLarge)
      ?? originalCoverUrlFromCachedVariant(coverThumb)
      ?? streamCover
      ?? inlineCover;

  return coverUrl && (allowInlineCover || !coverUrl.startsWith("data:")) ? coverUrl : null;
};

const normalizeClipboardLine = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const formatTrackInfoForClipboard = (title: string, album: string | null, artist: string): string =>
  [title, album, artist]
    .map(normalizeClipboardLine)
    .filter((line): line is string => Boolean(line))
    .join("\n");

const lyricIndexFromContextTarget = (target: EventTarget | null): number | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const lineElement = target.closest<HTMLElement>(".lyrics-line[data-lyric-index]");
  const rawIndex = lineElement?.dataset.lyricIndex;
  if (!rawIndex) {
    return null;
  }

  const index = Number.parseInt(rawIndex, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const readRememberedCandidateSource = (): CandidateSourceFilter => {
  try {
    const value = window.localStorage.getItem(lyricsCandidateSourceMemoryKey);
    return isCandidateSourceFilter(value) ? value : "all";
  } catch {
    return "all";
  }
};

const rememberCandidateSource = (source: CandidateSourceFilter): void => {
  try {
    window.localStorage.setItem(lyricsCandidateSourceMemoryKey, source);
  } catch {
    // Best-effort UI preference only.
  }
};

const selectLyricsDisplaySettings = (
  settings: AppSettings,
): LyricsDisplaySettings => ({
  lyricsEnabled: settings.lyricsEnabled,
  lyricsNetworkEnabled: settings.lyricsNetworkEnabled !== false,
  lyricsEnabledProviders: settings.lyricsEnabledProviders?.length
    ? settings.lyricsEnabledProviders
    : fallbackLyricsDisplaySettings.lyricsEnabledProviders,
  lyricsProviderOrder: settings.lyricsProviderOrder?.length
    ? settings.lyricsProviderOrder
    : fallbackLyricsDisplaySettings.lyricsProviderOrder,
  lyricsHeaderHidden: settings.lyricsHeaderHidden,
  lyricsMvAutoShowTrackInfoDisabled: settings.lyricsMvAutoShowTrackInfoDisabled !== false,
  lyricsCandidatePanelAutoOpenEnabled: settings.lyricsCandidatePanelAutoOpenEnabled === true,
  lyricsEmptyStateHidden: settings.lyricsEmptyStateHidden,
  lyricsFontSizePx: settings.lyricsFontSizePx,
  lyricsFontFamily: settings.lyricsFontFamily ?? fallbackLyricsDisplaySettings.lyricsFontFamily,
  lyricsFontFilePath: settings.lyricsFontFilePath ?? fallbackLyricsDisplaySettings.lyricsFontFilePath,
  lyricsTextDirection: settings.lyricsTextDirection ?? fallbackLyricsDisplaySettings.lyricsTextDirection,
  lyricsColor: settings.lyricsColor,
  lyricsBackgroundMode: settings.lyricsBackgroundMode,
  lyricsCustomWallpaperPath: settings.lyricsCustomWallpaperPath,
  lyricsRomanizationEnabled: settings.lyricsRomanizationEnabled,
  lyricsUtatenKanaEnabled: settings.lyricsUtatenKanaEnabled === true,
  lyricsTranslationEnabled: settings.lyricsTranslationEnabled,
  lyricsWordHighlightEnabled: settings.lyricsWordHighlightEnabled !== false,
  lyricsWordHighlightClarityPercent:
    settings.lyricsWordHighlightClarityPercent ?? fallbackLyricsDisplaySettings.lyricsWordHighlightClarityPercent,
  lowLoadPlaybackModeEnabled: settings.lowLoadPlaybackModeEnabled === true,
  lyricsAutoSearch: settings.lowLoadPlaybackModeEnabled === true ? false : settings.lyricsAutoSearch,
  lyricsAutoAcceptScore: settings.lyricsAutoAcceptScore,
  lyricsRestartOnApplyEnabled: settings.lyricsRestartOnApplyEnabled === true,
  lyricsGlobalSyncOffsetMs: settings.lyricsGlobalSyncOffsetMs,
  lyricsTimelineCorrectionEnabled: settings.lyricsTimelineCorrectionEnabled !== false,
  lyricsOffsetControlsEnabled: settings.lyricsOffsetControlsEnabled !== false,
  lyricsSmartAlignmentEnabled: settings.lyricsSmartAlignmentEnabled !== false,
  lyricsSecondaryFontSizePx: settings.lyricsSecondaryFontSizePx ?? fallbackLyricsDisplaySettings.lyricsSecondaryFontSizePx,
  lyricsLineSpacingPercent: settings.lyricsLineSpacingPercent ?? fallbackLyricsDisplaySettings.lyricsLineSpacingPercent,
  lyricsLineMaxChars: settings.lyricsLineMaxChars ?? fallbackLyricsDisplaySettings.lyricsLineMaxChars,
  lyricsContextOpacityPercent: settings.lyricsContextOpacityPercent ?? fallbackLyricsDisplaySettings.lyricsContextOpacityPercent,
  lyricsCoverOpacityPercent: settings.lyricsCoverOpacityPercent,
  lyricsSmartReadableColorsEnabled: settings.lyricsSmartReadableColorsEnabled === true,
  lyricsHighResolutionNetworkCoverEnabled: settings.lyricsHighResolutionNetworkCoverEnabled === true,
  lyricsCoverBlurPx: settings.lyricsCoverBlurPx,
  lyricsCoverBrightnessPercent: settings.lyricsCoverBrightnessPercent,
  lyricsBackgroundScalePercent: settings.lyricsBackgroundScalePercent,
});

const cssUrl = (value: string): string =>
  `url("${value.replace(/["\\]/g, "\\$&")}")`;

type CoverColorCssVarName =
  | "--lyrics-cover-color-rgb"
  | "--lyrics-cover-color-soft-rgb"
  | "--lyrics-cover-color-deep-rgb"
  | "--lyrics-cover-color-glow-rgb";

type CoverColorCssVars = Partial<Record<CoverColorCssVarName, string>>;

const clampColorChannel = (value: number): number => Math.round(Math.max(0, Math.min(255, value)));

const mixCoverRgb = (
  from: ReadableColorSample["averageRgb"],
  to: ReadableColorSample["averageRgb"],
  amount: number,
): ReadableColorSample["averageRgb"] => {
  const weight = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * weight,
    g: from.g + (to.g - from.g) * weight,
    b: from.b + (to.b - from.b) * weight,
  };
};

const rgbToCssChannels = (rgb: ReadableColorSample["averageRgb"]): string =>
  `${clampColorChannel(rgb.r)} ${clampColorChannel(rgb.g)} ${clampColorChannel(rgb.b)}`;

const createCoverColorCssVars = (
  sample: ReadableColorSample | null,
  themeMode: "light" | "dark",
): CoverColorCssVars | null => {
  if (!sample) {
    return null;
  }

  const primary = sample.dominantRgb ?? sample.averageRgb;
  const lightAnchor = themeMode === "dark" ? { r: 42, g: 49, b: 64 } : { r: 246, g: 248, b: 251 };
  const darkAnchor = themeMode === "dark" ? { r: 8, g: 12, b: 18 } : { r: 52, g: 58, b: 68 };
  const averageMix = mixCoverRgb(primary, sample.averageRgb, 0.28);

  return {
    "--lyrics-cover-color-rgb": rgbToCssChannels(primary),
    "--lyrics-cover-color-soft-rgb": rgbToCssChannels(mixCoverRgb(averageMix, lightAnchor, themeMode === "dark" ? 0.24 : 0.42)),
    "--lyrics-cover-color-deep-rgb": rgbToCssChannels(mixCoverRgb(primary, darkAnchor, themeMode === "dark" ? 0.56 : 0.24)),
    "--lyrics-cover-color-glow-rgb": rgbToCssChannels(mixCoverRgb(primary, lightAnchor, themeMode === "dark" ? 0.12 : 0.1)),
  };
};

const lyricsSmartReadableVideoSampleEvent = "lyrics:smart-readable-video-sample";

type LyricsSmartReadableVideoSampleDetail = {
  trackId?: string | null;
  sample?: ReadableColorSample | null;
};

const pickLyricsReadabilityEnhanced = (value: unknown): boolean | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const patch = value as Partial<MvSettings>;
  return typeof patch.lyricsReadabilityEnhanced === "boolean"
    ? patch.lyricsReadabilityEnhanced
    : null;
};

const pickMvHideLyrics = (value: unknown): boolean | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const patch = value as Partial<MvSettings>;
  return typeof patch.hideLyrics === "boolean" ? patch.hideLyrics : null;
};

const getCurrentDocumentThemeMode = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";

const lyricsDisplaySettingsKeys = [
  "lyricsEnabled",
  "lyricsNetworkEnabled",
  "lyricsEnabledProviders",
  "lyricsProviderOrder",
  "lyricsHeaderHidden",
  "lyricsMvAutoShowTrackInfoDisabled",
  "lyricsCandidatePanelAutoOpenEnabled",
  "lyricsEmptyStateHidden",
  "lyricsFontSizePx",
  "lyricsFontFamily",
  "lyricsFontFilePath",
  "lyricsTextDirection",
  "lyricsColor",
  "lyricsBackgroundMode",
  "lyricsCustomWallpaperPath",
  "lyricsRomanizationEnabled",
  "lyricsUtatenKanaEnabled",
  "lyricsTranslationEnabled",
  "lyricsWordHighlightEnabled",
  "lyricsWordHighlightClarityPercent",
  "lyricsAutoSearch",
  "lyricsAutoAcceptScore",
  "lyricsGlobalSyncOffsetMs",
  "lyricsTimelineCorrectionEnabled",
  "lyricsOffsetControlsEnabled",
  "lyricsSmartAlignmentEnabled",
  "lyricsSecondaryFontSizePx",
  "lyricsLineSpacingPercent",
  "lyricsLineMaxChars",
  "lyricsContextOpacityPercent",
  "lyricsCoverOpacityPercent",
  "lyricsSmartReadableColorsEnabled",
  "lyricsHighResolutionNetworkCoverEnabled",
  "lyricsCoverBlurPx",
  "lyricsCoverBrightnessPercent",
  "lyricsBackgroundScalePercent",
] as const;

const pickLyricsDisplaySettingsPatch = (
  value: unknown,
): Partial<LyricsDisplaySettings> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Partial<AppSettings>;
  const patch: Partial<LyricsDisplaySettings> = {};
  for (const key of lyricsDisplaySettingsKeys) {
    if (input[key] !== undefined) {
      patch[key] = input[key] as never;
    }
  }

  return patch;
};

const getSettingsEventDetailObject = (event: Event): Record<string, unknown> | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : null;
};

const isExplicitObjectSettingsPatch = (event: Event): boolean =>
  getSettingsEventDetailObject(event) !== null;

const clampPlaybackPosition = (
  positionSeconds: number,
  durationSeconds: number | null,
): number => {
  const safePositionSeconds = Number.isFinite(positionSeconds)
    ? Math.max(0, positionSeconds)
    : 0;

  return durationSeconds && durationSeconds > 0
    ? Math.min(safePositionSeconds, durationSeconds)
    : safePositionSeconds;
};

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const useLyricsDisplayPosition = (
  audioStatus: AudioStatus | null,
  playbackStatus: PlaybackStatus | null,
): { audioClock: MvAudioClock } => {
  const sourcePositionSeconds =
    shouldUseAudioStatusForCurrentPlayback(audioStatus, playbackStatus)
      ? audioStatus.positionSeconds
      : (playbackStatus?.positionMs ?? 0) / 1000;
  const sourceDurationSeconds =
    shouldUseAudioStatusForCurrentPlayback(audioStatus, playbackStatus)
      ? audioStatus.durationSeconds
      : (playbackStatus?.durationMs ?? 0) / 1000;
  const activeAudioStatus = shouldUseAudioStatusForCurrentPlayback(
    audioStatus,
    playbackStatus,
  )
    ? audioStatus
    : null;
  const state = activeAudioStatus?.state ?? playbackStatus?.state ?? "idle";
  const playbackRate = activeAudioStatus?.playbackRate ?? 1;
  const currentTrackId =
    activeAudioStatus?.currentTrackId ?? playbackStatus?.currentTrackId ?? null;
  const currentFilePath =
    activeAudioStatus?.currentFilePath ?? playbackStatus?.filePath ?? null;
  const nativePositionStalenessMs = finiteNonNegative(activeAudioStatus?.nativePositionStalenessMs);
  const nativeBufferedMs = finiteNonNegative(activeAudioStatus?.nativeBufferedMs);
  const nativeUnderrunCallbacks = finiteNonNegative(activeAudioStatus?.nativeUnderrunCallbacks) ?? 0;
  const [audioClock, setAudioClock] = useState<MvAudioClock>(() => ({
    durationSeconds: sourceDurationSeconds,
    playbackRate,
    positionSeconds: clampPlaybackPosition(
      sourcePositionSeconds,
      sourceDurationSeconds,
    ),
    state,
    updatedAtMs: performance.now(),
  }));
  const clockRef = useRef({
    currentFilePath,
    currentTrackId,
    durationSeconds: sourceDurationSeconds,
    playbackRate,
    positionSeconds: clampPlaybackPosition(
      sourcePositionSeconds,
      sourceDurationSeconds,
    ),
    sourcePositionSeconds: clampPlaybackPosition(
      sourcePositionSeconds,
      sourceDurationSeconds,
    ),
    nativePositionStalenessMs,
    nativeBufferedMs,
    nativeUnderrunCallbacks,
    state,
    updatedAtMs: performance.now(),
  });
  const seekAnchorRef = useRef<{ positionSeconds: number; trackId: string | null; updatedAtMs: number } | null>(null);

  useEffect(() => {
    const now = performance.now();
    const previous = clockRef.current;
    const samePlayback =
      previous.currentTrackId === currentTrackId &&
      previous.currentFilePath === currentFilePath;
    const stateChanged = previous.state !== state;
    const durationLimit =
      sourceDurationSeconds && sourceDurationSeconds > 0
        ? sourceDurationSeconds
        : Number.POSITIVE_INFINITY;
    const boundedSourcePosition = Math.min(
      Math.max(0, sourcePositionSeconds),
      durationLimit,
    );
    let nextPositionSeconds = clampPlaybackPosition(
      sourcePositionSeconds,
      sourceDurationSeconds,
    );
    const updatedAtMs = now;
    const wallElapsedSeconds = Math.max(0, (now - previous.updatedAtMs) / 1000);
    const expectedMediaElapsedSeconds = wallElapsedSeconds * previous.playbackRate;
    const sourceAdvancedSeconds = boundedSourcePosition - previous.sourcePositionSeconds;
    const nativeUnderrunAdvanced = nativeUnderrunCallbacks > previous.nativeUnderrunCallbacks;
    const sourceClockLooksStalled =
      state === "playing" &&
      samePlayback &&
      !stateChanged &&
      wallElapsedSeconds * 1000 >= lyricsClockStallDetectionMs &&
      expectedMediaElapsedSeconds > 0 &&
      sourceAdvancedSeconds >= -0.05 &&
      sourceAdvancedSeconds < expectedMediaElapsedSeconds * lyricsClockStallProgressRatio;
    const nativeClockLooksStale =
      state === "playing" &&
      samePlayback &&
      (
        (nativePositionStalenessMs !== null && nativePositionStalenessMs >= lyricsClockStaleTelemetryThresholdMs) ||
        (
          nativeUnderrunAdvanced &&
          nativeBufferedMs !== null &&
          nativeBufferedMs <= lyricsClockUnderrunBufferThresholdMs
        )
      );
    const seekAnchor = seekAnchorRef.current;
    if (seekAnchor) {
      if (seekAnchor.trackId && currentTrackId && seekAnchor.trackId !== currentTrackId) {
        seekAnchorRef.current = null;
      } else {
        const elapsedSeconds = Math.max(0, (updatedAtMs - seekAnchor.updatedAtMs) / 1000);
        const expectedSeekPosition = clampPlaybackPosition(
          seekAnchor.positionSeconds + (state === "playing" ? elapsedSeconds * playbackRate : 0),
          sourceDurationSeconds,
        );
        const isStaleStatusAfterSeek =
          elapsedSeconds < seekAnchorMaxAgeSeconds &&
          Math.abs(nextPositionSeconds - expectedSeekPosition) > 2;
        const sourceStillParkedNearSeekTarget =
          state === "playing" &&
          elapsedSeconds < seekAnchorStalledBridgeMaxAgeSeconds &&
          boundedSourcePosition <= seekAnchor.positionSeconds + seekAnchorSourceAdvanceReleaseSeconds;
        const shouldBridgeSeekAnchor = isStaleStatusAfterSeek || sourceStillParkedNearSeekTarget;

        if (shouldBridgeSeekAnchor) {
          nextPositionSeconds = expectedSeekPosition;
        } else {
          seekAnchorRef.current = null;
        }
      }
    }

    if (!seekAnchorRef.current && samePlayback && !stateChanged && state === "playing") {
      const mediaElapsedSeconds = wallElapsedSeconds * previous.playbackRate;
      const estimatedPositionSeconds = Math.min(previous.positionSeconds + mediaElapsedSeconds, durationLimit);
      const sourceJumpedBackward = boundedSourcePosition + 1 < previous.sourcePositionSeconds;
      const sourceCaughtUp = boundedSourcePosition + 0.35 >= estimatedPositionSeconds;
      const sourceJumpedForward = boundedSourcePosition > estimatedPositionSeconds + 0.35;
      const canBridgeSourceLag = wallElapsedSeconds <= maxInterpolatedStatusGapSeconds;
      const playbackRateChanged = Math.abs(previous.playbackRate - playbackRate) > 0.001;
      const rateChangeSourceDiscontinuity =
        playbackRateChanged && Math.abs(boundedSourcePosition - estimatedPositionSeconds) > playbackRateChangeDiscontinuitySeconds;
      const staleRegressionSeconds = previous.positionSeconds - boundedSourcePosition;
      const canIgnoreStaleRegression =
        canBridgeSourceLag && staleRegressionSeconds > 0.35 && staleRegressionSeconds <= maxStaleStatusRegressionSeconds;
      const canIgnoreStaleForwardJump = canBridgeSourceLag && sourceJumpedForward && Math.abs(previous.playbackRate - 1) > 0.001;
      const sourceClockNeedsBridge =
        nativeClockLooksStale || (sourceClockLooksStalled && canBridgeSourceLag);

      if (rateChangeSourceDiscontinuity) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (sourceClockNeedsBridge && !sourceJumpedForward) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canIgnoreStaleRegression) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canIgnoreStaleForwardJump) {
        nextPositionSeconds = estimatedPositionSeconds;
      } else if (canBridgeSourceLag && !sourceJumpedBackward && !sourceCaughtUp && !sourceJumpedForward && estimatedPositionSeconds > boundedSourcePosition) {
        nextPositionSeconds = estimatedPositionSeconds;
      }
    }

    clockRef.current = {
      currentFilePath,
      currentTrackId,
      durationSeconds: sourceDurationSeconds,
      playbackRate,
      positionSeconds: nextPositionSeconds,
      sourcePositionSeconds: boundedSourcePosition,
      nativePositionStalenessMs,
      nativeBufferedMs,
      nativeUnderrunCallbacks,
      state,
      updatedAtMs,
    };
    setAudioClock({
      durationSeconds: sourceDurationSeconds,
      playbackRate,
      positionSeconds: nextPositionSeconds,
      state,
      updatedAtMs,
    });
  }, [
    currentFilePath,
    currentTrackId,
    nativeBufferedMs,
    nativePositionStalenessMs,
    nativeUnderrunCallbacks,
    playbackRate,
    sourceDurationSeconds,
    sourcePositionSeconds,
    state,
  ]);

  useEffect(() => {
    const handlePlaybackSeeked = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as PlaybackSeekedDetail | null) : null;
      const eventTrackId = typeof detail?.trackId === "string" && detail.trackId.trim() ? detail.trackId : null;
      if (eventTrackId && eventTrackId !== currentTrackId) {
        return;
      }

      const positionSeconds = Number(detail?.positionSeconds);
      if (!Number.isFinite(positionSeconds)) {
        return;
      }

      const nextPositionSeconds = clampPlaybackPosition(positionSeconds, sourceDurationSeconds);
      const updatedAtMs = performance.now();
      const nextClock = {
        currentFilePath,
        currentTrackId,
        durationSeconds: sourceDurationSeconds,
        playbackRate,
        positionSeconds: nextPositionSeconds,
        sourcePositionSeconds: nextPositionSeconds,
        nativePositionStalenessMs,
        nativeBufferedMs,
        nativeUnderrunCallbacks,
        state,
        updatedAtMs,
      };
      clockRef.current = nextClock;
      seekAnchorRef.current = {
        positionSeconds: nextPositionSeconds,
        trackId: eventTrackId ?? currentTrackId,
        updatedAtMs,
      };
      setAudioClock({
        durationSeconds: nextClock.durationSeconds,
        playbackRate: nextClock.playbackRate,
        positionSeconds: nextClock.positionSeconds,
        state: nextClock.state,
        updatedAtMs: nextClock.updatedAtMs,
      });
    };

    window.addEventListener(playbackSeekedEvent, handlePlaybackSeeked);
    return () => window.removeEventListener(playbackSeekedEvent, handlePlaybackSeeked);
  }, [
    currentFilePath,
    currentTrackId,
    nativeBufferedMs,
    nativePositionStalenessMs,
    nativeUnderrunCallbacks,
    playbackRate,
    sourceDurationSeconds,
    state,
  ]);

  return { audioClock };
};

export const LyricsPage = ({ initialLyrics, usePlayerDrawerHeader = false }: LyricsPageProps): JSX.Element => {
  const queue = usePlaybackQueue();
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(
    null,
  );
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricsState>(() =>
    initialLyrics && initialLyrics.length > 0
      ? syncedLyrics(initialLyrics, 0)
      : emptyLyrics(0),
  );
  const [airPlayReceiverStatus, setAirPlayReceiverStatus] =
    useState<AirPlayReceiverStatus | null>(null);
  const [lyricsDisplaySettings, setLyricsDisplaySettings] =
    useState<LyricsDisplaySettings>(fallbackLyricsDisplaySettings);
  const [isLyricsDisplaySettingsReady, setIsLyricsDisplaySettingsReady] =
    useState(false);
  const [lyricsViewMode, setLyricsViewModeState] =
    useState<LyricsViewMode>(() => readRememberedLyricsViewMode());
  const [lyricsReadabilityEnhanced, setLyricsReadabilityEnhanced] = useState(false);
  const [mvHideLyrics, setMvHideLyrics] = useState(false);
  const [imageReadableSample, setImageReadableSample] = useState<ReadableColorSample | null>(null);
  const [mvReadableSample, setMvReadableSample] = useState<ReadableColorSample | null>(null);
  const [documentThemeMode, setDocumentThemeMode] = useState<"light" | "dark">(getCurrentDocumentThemeMode);
  const [networkBackgroundCoverUrl, setNetworkBackgroundCoverUrl] = useState<string | null>(null);
  const lyricsAutoAcceptScoreRef = useRef(fallbackLyricsDisplaySettings.lyricsAutoAcceptScore);
  const lyricsDisplaySettingsLoadVersionRef = useRef(0);
  const [isWindowMaximized, setIsWindowMaximized] = useState(isWindowApproximatelyMaximized);
  const [lyricsStatus, setLyricsStatus] = useState<string | null>(null);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [candidates, setCandidates] = useState<LyricsSearchCandidate[]>([]);
  const [sourceQualityMemoryVersion, setSourceQualityMemoryVersion] = useState(0);
  const [activeCandidateSource, setActiveCandidateSource] =
    useState<CandidateSourceFilter>(() => readRememberedCandidateSource());
  const [isLyricsMatchPanelClosed, setIsLyricsMatchPanelClosed] = useState(false);
  const [isLyricsMatchPanelRevealed, setIsLyricsMatchPanelRevealed] = useState(false);
  const [lyricsMatchPanelActivityToken, setLyricsMatchPanelActivityToken] = useState(0);
  const [isCandidateLoading, setIsCandidateLoading] = useState(false);
  const [isAlbumNavigating, setIsAlbumNavigating] = useState(false);
  const [applyingCandidateId, setApplyingCandidateId] = useState<string | null>(
    null,
  );
  const [isLyricsOffsetSaving, setIsLyricsOffsetSaving] = useState(false);
  const [isSmartAlignmentSessionActive, setIsSmartAlignmentSessionActive] = useState(false);
  const [smartAlignmentAnchors, setSmartAlignmentAnchors] = useState<LyricsSmartAlignmentAnchor[]>([]);
  const [smartAlignmentCandidatePreviews, setSmartAlignmentCandidatePreviews] = useState<LyricsSmartAlignmentCandidate[]>([]);
  const [smartAlignmentAutoState, setSmartAlignmentAutoState] = useState<LyricsSmartAlignmentAutoState | null>(null);
  const [, setIsCustomLyricsApplying] = useState(false);
  const [isCustomLyricsDragging, setIsCustomLyricsDragging] = useState(false);
  const lyricsRequestRef = useRef(0);
  const smartAlignmentCandidateRequestRef = useRef(0);
  const smartAlignmentBackgroundSearchKeyRef = useRef<string | null>(null);
  const smartAlignmentAutoRematchKeyRef = useRef<string | null>(null);
  const smartAlignmentAutoAppliedKeyRef = useRef<string | null>(null);
  const smtcLyricsProgressKeyRef = useRef<string | null>(null);
  const albumNavigationTimeoutRef = useRef<number | null>(null);
  const copyNoticeTimerRef = useRef<number | null>(null);
  const seekPreviewTimerRef = useRef<number | null>(null);
  const noteSourceQualityMemoryChanged = useCallback((): void => {
    setSourceQualityMemoryVersion((version) => (version + 1) % 1000000);
  }, []);
  const setLyricsViewMode = useCallback((mode: LyricsViewMode): void => {
    rememberLyricsViewMode(mode);
    setLyricsViewModeState(mode);
  }, []);
  const clearCopyNotice = useCallback((): void => {
    if (copyNoticeTimerRef.current !== null) {
      window.clearTimeout(copyNoticeTimerRef.current);
      copyNoticeTimerRef.current = null;
    }

    setCopyNotice(null);
  }, []);
  const showCopyNotice = useCallback((message: string): void => {
    if (copyNoticeTimerRef.current !== null) {
      window.clearTimeout(copyNoticeTimerRef.current);
    }

    setError(null);
    setCopyNotice(message);
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setCopyNotice(null);
      copyNoticeTimerRef.current = null;
    }, 1600);
  }, []);
  const showCopyError = useCallback(
    (message: string): void => {
      clearCopyNotice();
      setError(message);
    },
    [clearCopyNotice],
  );
  const clearSeekPreview = useCallback((): void => {
    if (seekPreviewTimerRef.current !== null) {
      window.clearTimeout(seekPreviewTimerRef.current);
      seekPreviewTimerRef.current = null;
    }

    setSeekPreviewSeconds(null);
  }, []);
  const showSeekPreview = useCallback((positionSeconds: number): void => {
    if (seekPreviewTimerRef.current !== null) {
      window.clearTimeout(seekPreviewTimerRef.current);
    }

    setSeekPreviewSeconds(positionSeconds);
    seekPreviewTimerRef.current = window.setTimeout(() => {
      seekPreviewTimerRef.current = null;
      setSeekPreviewSeconds(null);
    }, lyricSeekPreviewMaxMs);
  }, []);
  const writeClipboardText = useCallback(
    async (text: string, successMessage: string): Promise<void> => {
      if (!navigator.clipboard?.writeText) {
        showCopyError("当前环境不支持写入剪贴板。");
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showCopyNotice(successMessage);
      } catch (copyError) {
        showCopyError(copyError instanceof Error ? copyError.message : "复制失败。");
      }
    },
    [showCopyError, showCopyNotice],
  );
  useEffect(
    () => () => {
      if (copyNoticeTimerRef.current !== null) {
        window.clearTimeout(copyNoticeTimerRef.current);
      }
      if (seekPreviewTimerRef.current !== null) {
        window.clearTimeout(seekPreviewTimerRef.current);
      }
    },
    [],
  );
  const resolvedPlaybackStatus = playbackStatus ?? sharedPlaybackStatus.playbackStatus;
  const sharedSnapshotAudioStatus = sharedPlaybackStatus.audioStatus;
  const sharedAudioStatus =
    sharedSnapshotAudioStatus &&
    (
      isAudioStatusForPlayback(sharedSnapshotAudioStatus, resolvedPlaybackStatus) ||
      (
        !resolvedPlaybackStatus &&
        Boolean(sharedSnapshotAudioStatus.currentTrackId || sharedSnapshotAudioStatus.currentFilePath)
      )
    )
      ? sharedSnapshotAudioStatus
      : null;
  const resolvedAudioStatus = shouldUseAudioStatusForCurrentPlayback(audioStatus, resolvedPlaybackStatus)
    ? audioStatus
    : sharedAudioStatus;
  const activeAudioStatus = shouldUseAudioStatusForCurrentPlayback(
    resolvedAudioStatus,
    resolvedPlaybackStatus,
  )
    ? resolvedAudioStatus
    : null;
  const airPlaySourceId = airPlayReceiverSourceId(airPlayReceiverStatus);
  const airPlayPlaybackState = airPlayReceiverPlaybackState(airPlayReceiverStatus);
  const state = airPlayPlaybackState ?? activeAudioStatus?.state ?? resolvedPlaybackStatus?.state ?? "idle";
  const statusTrackId =
    activeAudioStatus?.currentTrackId ?? resolvedPlaybackStatus?.currentTrackId ?? null;
  const shouldPreferAudioTrackId =
    Boolean(activeAudioStatus?.currentTrackId) &&
    (!queue.currentTrackId ||
      queue.currentTrackId === resolvedPlaybackStatus?.currentTrackId ||
      queue.currentTrackId === activeAudioStatus?.currentTrackId);
  const trackId =
    shouldPreferAudioTrackId
      ? statusTrackId
      : queue.currentTrackId ?? statusTrackId ?? airPlaySourceId;
  const queuedCurrentTrack =
    !trackId || queue.currentTrack?.id === trackId ? queue.currentTrack : null;
  const currentTrack =
    queuedCurrentTrack ??
    (trackId
      ? (queue.tracks.find((track) => track.id === trackId) ?? null)
      : null) ??
    (queue.lastPlayedTrack?.id === trackId
      ? queue.lastPlayedTrack
      : null);
  const streamingTarget = useMemo(
    () =>
      isStreamingTrack(currentTrack)
        ? {
            provider: currentTrack.provider,
            providerTrackId: currentTrack.providerTrackId,
          }
        : null,
    [currentTrack],
  );
  const currentStreamingTargetKey = useMemo(() => streamingTargetKey(streamingTarget), [streamingTarget]);
  const hasCurrentNeteaseDjRadioMarker = isNeteaseDjRadioTrack(currentTrack);
  const [neteaseDjRadioLookup, setNeteaseDjRadioLookup] = useState<{ key: string; isDjRadio: boolean } | null>(null);
  useEffect(() => {
    if (!streamingTarget || streamingTarget.provider !== "netease" || hasCurrentNeteaseDjRadioMarker || !currentStreamingTargetKey) {
      setNeteaseDjRadioLookup(null);
      return undefined;
    }

    const streamingApi = window.echo?.streaming;
    if (!streamingApi?.getTrackSourceInfo) {
      setNeteaseDjRadioLookup({ key: currentStreamingTargetKey, isDjRadio: false });
      return undefined;
    }

    let cancelled = false;
    void streamingApi
      .getTrackSourceInfo(streamingTarget)
      .then((sourceInfo) => {
        if (!cancelled) {
          setNeteaseDjRadioLookup({
            key: currentStreamingTargetKey,
            isDjRadio: sourceInfo.isNeteaseDjRadio === true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNeteaseDjRadioLookup({ key: currentStreamingTargetKey, isDjRadio: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentStreamingTargetKey, hasCurrentNeteaseDjRadioMarker, streamingTarget]);
  const isCurrentNeteaseDjRadioTrack =
    hasCurrentNeteaseDjRadioMarker
      ? true
      : streamingTarget?.provider === "netease"
        ? neteaseDjRadioLookup?.key === currentStreamingTargetKey
          ? neteaseDjRadioLookup.isDjRadio
          : null
        : false;
  const resolveCurrentNeteaseDjRadioTrack = useCallback(async (): Promise<boolean> => {
    if (hasCurrentNeteaseDjRadioMarker) {
      return true;
    }
    if (!streamingTarget || streamingTarget.provider !== "netease" || !currentStreamingTargetKey) {
      return false;
    }
    if (neteaseDjRadioLookup?.key === currentStreamingTargetKey) {
      return neteaseDjRadioLookup.isDjRadio;
    }

    const streamingApi = window.echo?.streaming;
    if (!streamingApi?.getTrackSourceInfo) {
      return false;
    }

    try {
      const sourceInfo = await streamingApi.getTrackSourceInfo(streamingTarget);
      const isDjRadio = sourceInfo.isNeteaseDjRadio === true;
      setNeteaseDjRadioLookup({ key: currentStreamingTargetKey, isDjRadio });
      return isDjRadio;
    } catch {
      setNeteaseDjRadioLookup({ key: currentStreamingTargetKey, isDjRadio: false });
      return false;
    }
  }, [currentStreamingTargetKey, hasCurrentNeteaseDjRadioMarker, neteaseDjRadioLookup, streamingTarget]);
  const filePath =
    currentTrack?.path ??
    activeAudioStatus?.currentFilePath ??
    resolvedPlaybackStatus?.filePath ??
    airPlaySourceId ??
    null;
  const airPlayMetadata = airPlayReceiverStatus?.metadata ?? null;
  const airPlayDurationSeconds = airPlayReceiverDurationSeconds(airPlayReceiverStatus);
  const airPlayArtworkUrl =
    airPlayReceiverStatus?.artworkUrl ||
    airPlayMetadata?.coverHttpUrl ||
    null;
  const title =
    currentTrack?.title ??
    airPlayMetadata?.title?.trim() ??
    titleFromPath(filePath);
  const artist =
    currentTrack?.artist ||
    currentTrack?.albumArtist ||
    airPlayMetadata?.artist?.trim() ||
    airPlayMetadata?.albumArtist?.trim() ||
    (filePath ? "Local file" : "Ready");
  const album = currentTrack?.album?.trim() || airPlayMetadata?.album?.trim() || null;
  const coverUrl = safeCoverUrl(currentTrack) ?? airPlayArtworkUrl;
  const headerCoverUrl = safeOriginalCoverUrl(currentTrack) ?? airPlayArtworkUrl;
  const backgroundCoverUrl = safeOriginalCoverUrl(currentTrack) ?? airPlayArtworkUrl;
  const coverColorSampleUrls = useMemo(
    () => collectCoverColorSampleUrls(currentTrack, airPlayArtworkUrl),
    [airPlayArtworkUrl, currentTrack],
  );
  const trackCoverCopyTrackId = currentTrack?.id ?? null;
  const canCopyTrackOriginalCover =
    Boolean(trackCoverCopyTrackId) &&
    currentTrack?.isTemporary !== true &&
    !isSnapshotTrackId(trackCoverCopyTrackId);
  const lyricsSnapshotRequest = useMemo<LyricsTrackSnapshotRequest | null>(() => {
    const shouldUseSnapshot =
      Boolean(currentTrack?.mediaType === "streaming") ||
      isSnapshotLyricsTrack(currentTrack, trackId);
    if (!trackId || !shouldUseSnapshot) {
      return null;
    }

    const snapshotTrackId = currentTrack?.id ?? trackId;
    return {
      trackId: snapshotTrackId,
      title: currentTrack?.title?.trim() || title || "AirPlay stream",
      artist: currentTrack?.artist?.trim() || currentTrack?.albumArtist?.trim() || artist || "Unknown Artist",
      album: currentTrack?.album?.trim() || album,
      albumArtist: currentTrack?.albumArtist?.trim() || airPlayMetadata?.albumArtist?.trim() || null,
      durationSeconds: currentTrack?.duration && currentTrack.duration > 0 ? currentTrack.duration : airPlayDurationSeconds,
      mediaType: currentTrack?.mediaType ?? "remote",
      sourceId: currentTrack?.sourceId ?? (isStreamingTrack(currentTrack) ? currentTrack.providerTrackId : airPlaySourceId),
      stableKey: currentTrack?.stableKey ?? snapshotTrackId,
    };
  }, [
    airPlayDurationSeconds,
    airPlayMetadata?.albumArtist,
    airPlaySourceId,
    album,
    artist,
    currentTrack,
    title,
    trackId,
  ]);
  const lyricsMemoryKey = useMemo(
    () =>
      trackId
        ? [
            trackId,
            currentTrack?.stableKey ?? "",
            isStreamingTrack(currentTrack) ? currentTrack.providerTrackId : "",
          ].join("|")
        : null,
    [currentTrack, trackId],
  );
  const isCurrentAirPlayReceiverTrack =
    Boolean(airPlaySourceId) ||
    snapshotProtocol(trackId) === "airplay" ||
    snapshotProtocol(currentTrack?.id) === "airplay" ||
    snapshotProtocol(currentTrack?.path) === "airplay" ||
    snapshotProtocol(playbackStatus?.filePath) === "airplay";
  const liveAirPlayLyrics = useMemo(
    () => (isCurrentAirPlayReceiverTrack ? airPlaySingleLineLyrics(airPlayReceiverStatus?.currentLyricLine ?? null) : null),
    [airPlayReceiverStatus?.currentLyricLine, isCurrentAirPlayReceiverTrack],
  );
  const hasMatchedLyricsForAirPlay = isCurrentAirPlayReceiverTrack && isRememberableLyricsState(lyrics);
  const displayedLyrics = hasMatchedLyricsForAirPlay ? lyrics : liveAirPlayLyrics ?? lyrics;
  const shouldRevealAutomaticLyricsCandidates =
    isCurrentAirPlayReceiverTrack ||
    lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled === true;
  useEffect(() => {
    rememberLyricsState(lyricsMemoryKey, lyrics);
  }, [lyrics, lyricsMemoryKey]);
  useEffect(() => {
    setIsSmartAlignmentSessionActive(false);
    setSmartAlignmentAnchors([]);
    setSmartAlignmentCandidatePreviews([]);
    setSmartAlignmentAutoState(null);
    smartAlignmentAutoRematchKeyRef.current = null;
    smartAlignmentAutoAppliedKeyRef.current = null;
  }, [lyrics.source, trackId]);
  const effectiveDisplayedLyrics = useMemo(
    () =>
      lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false
        ? displayedLyrics
        : { ...displayedLyrics, offsetMs: 0 },
    [displayedLyrics, lyricsDisplaySettings.lyricsTimelineCorrectionEnabled],
  );
  const handleTrackInfoContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const text = formatTrackInfoForClipboard(title, album, artist);
      if (!text) {
        showCopyError("没有可复制的歌曲信息。");
        return;
      }

      void writeClipboardText(text, "已复制歌曲信息");
    },
    [album, artist, showCopyError, title, writeClipboardText],
  );
  const handleTrackTitleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const text = normalizeClipboardLine(title);
      if (!text) {
        showCopyError("没有可复制的歌名。");
        return;
      }

      void writeClipboardText(text, "已复制歌名");
    },
    [showCopyError, title, writeClipboardText],
  );
  const handleTrackAlbumContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const text = normalizeClipboardLine(album);
      if (!text) {
        showCopyError("没有可复制的专辑名。");
        return;
      }

      void writeClipboardText(text, "已复制专辑名");
    },
    [album, showCopyError, writeClipboardText],
  );
  const handleTrackArtistContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const text = normalizeClipboardLine(artist);
      if (!text) {
        showCopyError("没有可复制的艺人名。");
        return;
      }

      void writeClipboardText(text, "已复制艺人名");
    },
    [artist, showCopyError, writeClipboardText],
  );
  const handleTrackCoverContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      if (!trackCoverCopyTrackId || !canCopyTrackOriginalCover) {
        showCopyError("这首歌没有可复制的封面原图。");
        return;
      }

      void (async () => {
        try {
          const copied = await window.echo.library.copyTrackOriginalCover(trackCoverCopyTrackId);
          if (!copied) {
            showCopyError("这首歌没有可复制的封面原图。");
            return;
          }

          showCopyNotice("已复制封面原图");
        } catch (copyError) {
          showCopyError(copyError instanceof Error ? copyError.message : "复制封面失败。");
        }
      })();
    },
    [canCopyTrackOriginalCover, showCopyError, showCopyNotice, trackCoverCopyTrackId],
  );
  const handleLyricsContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const index = lyricIndexFromContextTarget(event.target);
      const text = index === null ? "" : normalizeClipboardLine(effectiveDisplayedLyrics.lines[index]?.text);
      if (!text) {
        showCopyError("没有可复制的当句歌词。");
        return;
      }

      void writeClipboardText(text, "已复制当句歌词");
    },
    [
      effectiveDisplayedLyrics,
      showCopyError,
      writeClipboardText,
    ],
  );
  const shouldRequestNetworkBackgroundCover =
    lyricsDisplaySettings.lowLoadPlaybackModeEnabled !== true &&
    lyricsDisplaySettings.lyricsHighResolutionNetworkCoverEnabled === true &&
    lyricsDisplaySettings.lyricsBackgroundMode === "cover" &&
    Boolean(currentTrack?.id) &&
    currentTrack?.isTemporary !== true &&
    !isSnapshotTrackId(trackId) &&
    !isSnapshotTrackId(currentTrack?.id);
  const effectiveLyricsBackgroundMode =
    lyricsDisplaySettings.lyricsBackgroundMode === "customWallpaper" &&
    !lyricsDisplaySettings.lyricsCustomWallpaperPath
      ? "theme"
      : lyricsDisplaySettings.lyricsBackgroundMode === "cover" && !backgroundCoverUrl && !shouldRequestNetworkBackgroundCover
        ? "theme"
        : lyricsDisplaySettings.lyricsBackgroundMode === "coverColor" && coverColorSampleUrls.length === 0
          ? "theme"
          : lyricsDisplaySettings.lyricsBackgroundMode;
  const effectiveLyricsBackgroundScalePercent =
    effectiveLyricsBackgroundMode === "cover"
      ? Math.max(100, lyricsDisplaySettings.lyricsBackgroundScalePercent)
      : lyricsDisplaySettings.lyricsBackgroundScalePercent;
  const lyricsWallpaperUrl = lyricsDisplaySettings.lyricsCustomWallpaperPath
    ? `echo-wallpaper://lyrics/custom?path=${encodeURIComponent(lyricsDisplaySettings.lyricsCustomWallpaperPath)}`
    : null;
  const lyricsBackgroundCoverUrl = networkBackgroundCoverUrl ?? backgroundCoverUrl;
  const lyricsSmartReadableEnabled = lyricsDisplaySettings.lyricsSmartReadableColorsEnabled === true;
  const lyricsUsesManualColor =
    lyricsDisplaySettings.lyricsColor.toUpperCase() !== fallbackLyricsDisplaySettings.lyricsColor.toUpperCase();
  const shouldEnhanceLyricsReadability = lyricsReadabilityEnhanced || lyricsSmartReadableEnabled;
  const lyricsSmartReadableImageUrls = useMemo<readonly string[]>(
    () => {
      if (!lyricsSmartReadableEnabled) {
        return emptyLyricsImageUrls;
      }

      if (effectiveLyricsBackgroundMode === "cover") {
        return lyricsBackgroundCoverUrl ? [lyricsBackgroundCoverUrl] : emptyLyricsImageUrls;
      }

      if (effectiveLyricsBackgroundMode === "coverColor") {
        return coverColorSampleUrls;
      }

      if (effectiveLyricsBackgroundMode === "customWallpaper") {
        return lyricsWallpaperUrl ? [lyricsWallpaperUrl] : emptyLyricsImageUrls;
      }

      return emptyLyricsImageUrls;
    },
    [
      coverColorSampleUrls,
      effectiveLyricsBackgroundMode,
      lyricsBackgroundCoverUrl,
      lyricsSmartReadableEnabled,
      lyricsWallpaperUrl,
    ],
  );
  const lyricsCoverColorImageUrls = effectiveLyricsBackgroundMode === "coverColor" ? coverColorSampleUrls : emptyLyricsImageUrls;
  const lyricsSampleImageUrls = lyricsSmartReadableImageUrls.length > 0
    ? lyricsSmartReadableImageUrls
    : lyricsCoverColorImageUrls;
  const coverColorCssVars = useMemo<CoverColorCssVars | null>(
    () =>
      effectiveLyricsBackgroundMode === "coverColor"
        ? createCoverColorCssVars(imageReadableSample, documentThemeMode)
        : null,
    [documentThemeMode, effectiveLyricsBackgroundMode, imageReadableSample],
  );
  const smartReadableColors = useMemo<ReadableLyricsCssVars | null>(
    () => {
      if (!lyricsSmartReadableEnabled) {
        return null;
      }

      if (lyricsSmartReadableImageUrls.length > 0 && !mvReadableSample && !imageReadableSample) {
        return null;
      }

      return createReadableLyricsColorVars({
        sample: mvReadableSample ?? imageReadableSample,
        userColor: lyricsDisplaySettings.lyricsColor,
        themeMode: documentThemeMode,
      });
    },
    [
      documentThemeMode,
      imageReadableSample,
      lyricsDisplaySettings.lyricsColor,
      lyricsSmartReadableEnabled,
      lyricsSmartReadableImageUrls.length,
      mvReadableSample,
    ],
  );
  const lyricsPageStyle = useMemo(
    () =>
      ({
        "--lyrics-cover": effectiveLyricsBackgroundMode === "cover" && lyricsBackgroundCoverUrl
          ? cssUrl(lyricsBackgroundCoverUrl)
          : "none",
        "--lyrics-wallpaper": lyricsWallpaperUrl
          ? cssUrl(lyricsWallpaperUrl)
          : "none",
        "--lyrics-font-family": [
          serializeFontList(lyricsDisplaySettings.lyricsFontFamily ?? fallbackLyricsDisplaySettings.lyricsFontFamily ?? "Microsoft YaHei"),
          "var(--echo-font-family)",
        ].join(", "),
        "--lyrics-font-size": `${lyricsDisplaySettings.lyricsFontSizePx}px`,
        "--lyrics-secondary-font-size": `${lyricsDisplaySettings.lyricsSecondaryFontSizePx}px`,
        "--lyrics-line-max-width": lyricsDisplaySettings.lyricsLineMaxChars && lyricsDisplaySettings.lyricsLineMaxChars > 0
          ? `${lyricsDisplaySettings.lyricsLineMaxChars}em`
          : "100%",
        "--lyrics-line-spacing": (
          (lyricsDisplaySettings.lyricsLineSpacingPercent ?? fallbackLyricsDisplaySettings.lyricsLineSpacingPercent ?? 110) / 100
        ).toFixed(2),
        "--lyrics-context-opacity": (
          (lyricsDisplaySettings.lyricsContextOpacityPercent ?? fallbackLyricsDisplaySettings.lyricsContextOpacityPercent ?? 49) / 100
        ).toFixed(2),
        "--lyrics-current-word-clarity": `${lyricsDisplaySettings.lyricsWordHighlightClarityPercent ?? fallbackLyricsDisplaySettings.lyricsWordHighlightClarityPercent ?? 70}%`,
        "--lyrics-color": lyricsDisplaySettings.lyricsColor,
        "--lyrics-cover-opacity": (
          lyricsDisplaySettings.lyricsCoverOpacityPercent / 100
        ).toFixed(2),
        "--lyrics-background-surface-alpha": (
          lyricsDisplaySettings.lyricsCoverOpacityPercent / 100
        ).toFixed(2),
        "--lyrics-cover-blur": `${lyricsDisplaySettings.lyricsCoverBlurPx}px`,
        "--lyrics-cover-brightness": `${lyricsDisplaySettings.lyricsCoverBrightnessPercent}%`,
        "--lyrics-background-scale": (effectiveLyricsBackgroundScalePercent / 100).toFixed(2),
        "--lyrics-background-bleed": `-${lyricsDisplaySettings.lyricsCoverBlurPx * 2}px`,
        ...(coverColorCssVars ?? {}),
        ...(smartReadableColors ?? {}),
      }) as CSSProperties,
    [
      coverColorCssVars,
      effectiveLyricsBackgroundMode,
      lyricsBackgroundCoverUrl,
      effectiveLyricsBackgroundScalePercent,
      lyricsDisplaySettings.lyricsColor,
      lyricsDisplaySettings.lyricsCoverBlurPx,
      lyricsDisplaySettings.lyricsCoverBrightnessPercent,
      lyricsDisplaySettings.lyricsCoverOpacityPercent,
      lyricsDisplaySettings.lyricsFontFamily,
      lyricsDisplaySettings.lyricsFontSizePx,
      lyricsDisplaySettings.lyricsLineMaxChars,
      lyricsDisplaySettings.lyricsSecondaryFontSizePx,
      lyricsDisplaySettings.lyricsLineSpacingPercent,
      lyricsDisplaySettings.lyricsContextOpacityPercent,
      lyricsDisplaySettings.lyricsWordHighlightClarityPercent,
      lyricsWallpaperUrl,
      smartReadableColors,
    ],
  );

  useEffect(() => {
    const handleLyricsNavigation = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as LyricsNavigationDetail | null) : null;
      if (isLyricsViewMode(detail?.mode)) {
        setLyricsViewMode(detail.mode);
      }
    };

    window.addEventListener(lyricsNavigationEvent, handleLyricsNavigation);
    return () => window.removeEventListener(lyricsNavigationEvent, handleLyricsNavigation);
  }, [setLyricsViewMode]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const syncThemeMode = (): void => setDocumentThemeMode(getCurrentDocumentThemeMode());
    const observer = new MutationObserver(syncThemeMode);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    syncThemeMode();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      !shouldRequestNetworkBackgroundCover ||
      effectiveLyricsBackgroundMode !== "cover" ||
      !currentTrack?.id
    ) {
      setNetworkBackgroundCoverUrl(null);
      return undefined;
    }

    const library = window.echo?.library;
    if (!library?.resolveLyricsBackgroundCover) {
      setNetworkBackgroundCoverUrl(null);
      return undefined;
    }

    let disposed = false;
    setNetworkBackgroundCoverUrl(null);
    void library
      .resolveLyricsBackgroundCover(currentTrack.id)
      .then((result) => {
        if (!disposed) {
          setNetworkBackgroundCoverUrl(result?.coverUrl ?? null);
        }
      })
      .catch(() => {
        if (!disposed) {
          setNetworkBackgroundCoverUrl(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    backgroundCoverUrl,
    currentTrack?.id,
    effectiveLyricsBackgroundMode,
    shouldRequestNetworkBackgroundCover,
  ]);

  useEffect(() => {
    if (lyricsSampleImageUrls.length === 0) {
      setImageReadableSample(null);
      return undefined;
    }

    let disposed = false;
    setImageReadableSample(null);
    void sampleFirstImageUrl(lyricsSampleImageUrls).then((sample) => {
      if (!disposed) {
        setImageReadableSample(sample);
      }
    });

    return () => {
      disposed = true;
    };
  }, [lyricsSampleImageUrls]);

  useEffect(() => {
    setMvReadableSample(null);
  }, [lyricsSmartReadableEnabled, trackId]);

  useEffect(() => {
    const handleVideoSample = (event: Event): void => {
      if (!lyricsSmartReadableEnabled || !(event instanceof CustomEvent)) {
        return;
      }

      const detail = event.detail as LyricsSmartReadableVideoSampleDetail | null;
      if (detail?.trackId && trackId && detail.trackId !== trackId) {
        return;
      }

      setMvReadableSample(detail?.sample ?? null);
    };

    window.addEventListener(lyricsSmartReadableVideoSampleEvent, handleVideoSample);
    return () => window.removeEventListener(lyricsSmartReadableVideoSampleEvent, handleVideoSample);
  }, [lyricsSmartReadableEnabled, trackId]);

  const handleOpenAlbumDetail = useCallback((): void => {
    if (!currentTrack || isAlbumNavigating) {
      return;
    }

    setIsAlbumNavigating(true);
    setError(null);

    if (albumNavigationTimeoutRef.current !== null) {
      window.clearTimeout(albumNavigationTimeoutRef.current);
    }

    albumNavigationTimeoutRef.current = window.setTimeout(() => {
      albumNavigationTimeoutRef.current = null;
      void openAlbumDetailForTrack(currentTrack)
        .then((locatedAlbum) => {
          if (!locatedAlbum) {
            setIsAlbumNavigating(false);
            setError("No album page found for this track.");
          }
        })
        .catch((albumError) => {
          setIsAlbumNavigating(false);
          setError(albumError instanceof Error ? albumError.message : String(albumError));
        });
    }, albumNavigationTransitionMs);
  }, [currentTrack, isAlbumNavigating]);

  useEffect(
    () => () => {
      if (albumNavigationTimeoutRef.current !== null) {
        window.clearTimeout(albumNavigationTimeoutRef.current);
      }
    },
    [],
  );

  const { audioClock: baseMvAudioClock } = useLyricsDisplayPosition(
    activeAudioStatus,
    resolvedPlaybackStatus,
  );
  const displayDurationSeconds =
    airPlayDurationSeconds ??
    activeAudioStatus?.durationSeconds ??
    currentTrack?.duration ??
    0;
  const mvAudioClock = useMemo<MvAudioClock>(() => {
    if (!airPlaySourceId) {
      return baseMvAudioClock;
    }

    return {
      durationSeconds: airPlayDurationSeconds,
      playbackRate: 1,
      positionSeconds: airPlayReceiverPositionSeconds(airPlayReceiverStatus),
      state: airPlayPlaybackState ?? "idle",
      updatedAtMs: performance.now(),
    };
  }, [
    airPlayDurationSeconds,
    airPlayPlaybackState,
    airPlayReceiverStatus,
    airPlaySourceId,
    baseMvAudioClock,
  ]);
  const lyricsPositionSeconds = seekPreviewSeconds ?? mvAudioClock.positionSeconds;
  const smtcLyricsProgress = useMemo(() => {
    if (!lyricsDisplaySettings.lyricsEnabled || effectiveDisplayedLyrics.lines.length === 0) {
      return null;
    }

    const positionMs =
      lyricsPositionSeconds * 1000 +
      (lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false ? lyricsDisplaySettings.lyricsGlobalSyncOffsetMs : 0);
    const lineIndex =
      effectiveDisplayedLyrics.kind === "synced"
        ? getActiveLyricIndex(effectiveDisplayedLyrics.lines, positionMs, effectiveDisplayedLyrics.offsetMs)
        : effectiveDisplayedLyrics.kind === "plain"
          ? getEstimatedPlainLyricIndex(effectiveDisplayedLyrics.lines, positionMs, displayDurationSeconds * 1000)
          : -1;
    const line = lineIndex >= 0 ? effectiveDisplayedLyrics.lines[lineIndex] : null;
    const lineText = line?.text?.replace(/\s+/gu, " ").trim() ?? "";
    if (!lineText) {
      return null;
    }

    return {
      trackId: trackId ?? null,
      lineText,
      lineIndex,
      lineCount: effectiveDisplayedLyrics.lines.length,
      lineStartMs: line?.timeMs ?? null,
      positionSeconds: lyricsPositionSeconds,
      durationSeconds: displayDurationSeconds,
    };
  }, [
    displayDurationSeconds,
    effectiveDisplayedLyrics,
    lyricsDisplaySettings.lyricsEnabled,
    lyricsDisplaySettings.lyricsGlobalSyncOffsetMs,
    lyricsDisplaySettings.lyricsTimelineCorrectionEnabled,
    lyricsPositionSeconds,
    trackId,
  ]);

  useEffect(() => {
    const nextKey = smtcLyricsProgress
      ? `${smtcLyricsProgress.trackId ?? ""}|${smtcLyricsProgress.lineIndex ?? ""}|${smtcLyricsProgress.lineStartMs ?? ""}|${smtcLyricsProgress.lineText}`
      : null;
    if (nextKey === smtcLyricsProgressKeyRef.current) {
      return;
    }

    smtcLyricsProgressKeyRef.current = nextKey;
    void window.echo?.smtc?.setLyricsProgress?.(smtcLyricsProgress ?? null).catch(() => undefined);
  }, [smtcLyricsProgress]);

  useEffect(
    () => () => {
      smtcLyricsProgressKeyRef.current = null;
      void window.echo?.smtc?.setLyricsProgress?.(null).catch(() => undefined);
    },
    [],
  );

  const activeSearchProviders = useMemo<LyricsProviderId[]>(() => {
    const enabled = (lyricsDisplaySettings.lyricsEnabledProviders?.length
      ? lyricsDisplaySettings.lyricsEnabledProviders
      : fallbackLyricsDisplaySettings.lyricsEnabledProviders) ?? searchableLyricsProviderIds;
    const order = (lyricsDisplaySettings.lyricsProviderOrder?.length
      ? lyricsDisplaySettings.lyricsProviderOrder
      : fallbackLyricsDisplaySettings.lyricsProviderOrder) ?? searchableLyricsProviderIds;
    const ordered = [
      ...order.filter((provider) => enabled.includes(provider)),
      ...enabled.filter((provider) => !order.includes(provider)),
    ];

    const filtered = ordered.filter(
      (provider): provider is LyricsProviderId =>
        searchableLyricsProviderSet.has(provider) &&
        (provider === "local" || lyricsDisplaySettings.lyricsNetworkEnabled),
    );
    const streamingProvider = streamingTarget?.provider;
    const preferredStreamingProvider =
      streamingProvider && searchableLyricsProviderSet.has(streamingProvider)
        ? (streamingProvider as LyricsProviderId)
        : null;

    return preferredStreamingProvider && filtered.includes(preferredStreamingProvider)
      ? [preferredStreamingProvider, ...filtered.filter((provider) => provider !== preferredStreamingProvider)]
      : filtered;
  }, [
    lyricsDisplaySettings.lyricsEnabledProviders,
    lyricsDisplaySettings.lyricsNetworkEnabled,
    lyricsDisplaySettings.lyricsProviderOrder,
    streamingTarget?.provider,
  ]);
  const candidateSourceOptions = useMemo<Array<{ key: CandidateSourceFilter; label: string; count: number; order: number }>>(() => {
    const sourceMap = new Map<
      CandidateSourceFilter,
      { key: CandidateSourceFilter; label: string; count: number; order: number }
    >();

    activeSearchProviders.forEach((provider, index) => {
      sourceMap.set(provider, {
        key: provider,
        label: lyricsProviderLabels[provider] ?? provider,
        count: 0,
        order: index,
      });
    });

    for (const candidate of candidates) {
      const key = sourceFilterKey(candidate);
      const existing = sourceMap.get(key);
      if (existing) {
        existing.count += 1;
        if (!lyricsProviderLabels[candidate.provider] && candidate.sourceLabel) {
          existing.label = candidate.sourceLabel;
        }
      } else {
        sourceMap.set(key, {
          key,
          label: lyricsProviderLabels[candidate.provider] ?? candidate.sourceLabel,
          count: 1,
          order: lyricsProviderSortOrder.get(candidate.provider) ?? 99,
        });
      }
    }

    return [
      { key: "all", label: "全部来源", count: candidates.length, order: -1 },
      ...Array.from(sourceMap.values()).sort(
        (left, right) =>
          left.order - right.order || left.label.localeCompare(right.label),
      ),
    ];
  }, [activeSearchProviders, candidates]);
  const visibleCandidates = useMemo(
    () =>
      activeCandidateSource === "all"
        ? candidates
        : candidates.filter(
            (candidate) => sourceFilterKey(candidate) === activeCandidateSource,
          ),
    [activeCandidateSource, candidates],
  );
  const rememberedSourceQualityByProvider = useMemo(() => {
    const summaries = readLyricsSourceQualitySummaries();
    return new Map<LyricsProviderId, LyricsSourceQualityProviderSummary>(
      summaries.map((summary) => [summary.provider, summary]),
    );
  }, [sourceQualityMemoryVersion]);
  const candidateSourceQualitySummaries = useMemo<CandidateSourceQualitySummary[]>(() => {
    const sourceMap = new Map<LyricsProviderId, CandidateSourceQualitySummary & { scoreTotal: number }>();

    for (const candidate of candidates) {
      const existing =
        sourceMap.get(candidate.provider) ??
        {
          key: candidate.provider,
          label: lyricsProviderLabels[candidate.provider] ?? candidate.sourceLabel,
          count: 0,
          bestScore: 0,
          averageScore: 0,
          lowRiskCount: 0,
          syncedCount: 0,
          recentCandidateCount: 0,
          recentAppliedCount: 0,
          recentAverageScore: 0,
          order: lyricsProviderSortOrder.get(candidate.provider) ?? 99,
          scoreTotal: 0,
        };

      existing.count += 1;
      existing.scoreTotal += candidate.score;
      existing.bestScore = Math.max(existing.bestScore, candidate.score);
      if ((candidate.risk ?? "high") === "low") {
        existing.lowRiskCount += 1;
      }
      if (candidate.hasSynced) {
        existing.syncedCount += 1;
      }
      sourceMap.set(candidate.provider, existing);
    }

    return Array.from(sourceMap.values())
      .map(({ scoreTotal, ...summary }) => {
        const remembered = rememberedSourceQualityByProvider.get(summary.key);
        return {
          ...summary,
          averageScore: summary.count > 0 ? scoreTotal / summary.count : 0,
          recentCandidateCount: remembered?.candidateCount ?? 0,
          recentAppliedCount: remembered?.appliedCount ?? 0,
          recentAverageScore: remembered?.averageScore ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.bestScore - left.bestScore ||
          right.lowRiskCount - left.lowRiskCount ||
          right.recentAppliedCount - left.recentAppliedCount ||
          right.syncedCount - left.syncedCount ||
          left.order - right.order ||
          left.label.localeCompare(right.label),
      );
  }, [candidates, rememberedSourceQualityByProvider]);
  const selectCandidateSource = useCallback((source: CandidateSourceFilter): void => {
    setActiveCandidateSource(source);
    rememberCandidateSource(source);
  }, []);

  useEffect(() => {
    if (activeCandidateSource === "all") {
      return;
    }

    if (!candidateSourceOptions.some((option) => option.key === activeCandidateSource)) {
      selectCandidateSource("all");
    }
  }, [activeCandidateSource, candidateSourceOptions, selectCandidateSource]);

  const applySharedPlaybackStatus = useCallback(
    (snapshot: { playbackStatus: PlaybackStatus | null; audioStatus: AudioStatus | null; error: string | null }): void => {
      if (snapshot.playbackStatus) {
        setPlaybackStatus(snapshot.playbackStatus);
      }

      const snapshotAudioStatus = snapshot.audioStatus;
      const shouldApplyAudioStatus = snapshotAudioStatus
        ? isAudioStatusForPlayback(snapshotAudioStatus, snapshot.playbackStatus) ||
          Boolean(snapshotAudioStatus.currentTrackId || snapshotAudioStatus.currentFilePath)
        : false;
      if (snapshotAudioStatus && shouldApplyAudioStatus) {
        setAudioStatus(snapshotAudioStatus);
      } else if (snapshotAudioStatus || snapshot.playbackStatus || snapshot.error) {
        setAudioStatus(null);
      }

      const nextTrackId =
        (snapshotAudioStatus && shouldApplyAudioStatus ? snapshotAudioStatus.currentTrackId : null) ??
        snapshot.playbackStatus?.currentTrackId ??
        null;
      if (nextTrackId) {
        queue.setCurrentTrackId(nextTrackId);
      }
      setError(snapshot.error ?? snapshotAudioStatus?.error ?? null);
    },
    [queue],
  );

  const refreshStatus = useCallback(async (): Promise<void> => {
    applySharedPlaybackStatus(await refreshPlaybackStatus());
  }, [applySharedPlaybackStatus]);

  useEffect(() => {
    let disposed = false;
    const connect = window.echo?.connect;
    void connect?.getAirPlayReceiverStatus?.()
      .then((status) => {
        if (!disposed) {
          setAirPlayReceiverStatus(status);
        }
      })
      .catch(() => undefined);

    const unsubscribe = connect?.onAirPlayReceiverStatus?.((status) => {
      setAirPlayReceiverStatus(status);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const loadLyricsDisplaySettings = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const loadVersion = lyricsDisplaySettingsLoadVersionRef.current;

    if (!app?.getSettings) {
      if (loadVersion !== lyricsDisplaySettingsLoadVersionRef.current) {
        return;
      }
      setLyricsDisplaySettings(fallbackLyricsDisplaySettings);
      setIsLyricsDisplaySettingsReady(true);
      return;
    }

    try {
      const nextSettings = await app.getSettings();
      if (loadVersion !== lyricsDisplaySettingsLoadVersionRef.current) {
        return;
      }
      setLyricsDisplaySettings(selectLyricsDisplaySettings(nextSettings));
    } catch {
      if (loadVersion !== lyricsDisplaySettingsLoadVersionRef.current) {
        return;
      }
      setLyricsDisplaySettings(fallbackLyricsDisplaySettings);
    } finally {
      if (loadVersion === lyricsDisplaySettingsLoadVersionRef.current) {
        setIsLyricsDisplaySettingsReady(true);
      }
    }
  }, []);

  useEffect(() => {
    applySharedPlaybackStatus(sharedPlaybackStatus);
  }, [applySharedPlaybackStatus, sharedPlaybackStatus]);

  useEffect(() => {
    lyricsAutoAcceptScoreRef.current = lyricsDisplaySettings.lyricsAutoAcceptScore;
  }, [lyricsDisplaySettings.lyricsAutoAcceptScore]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event): void => {
      const patch = pickLyricsDisplaySettingsPatch(getSettingsEventDetailObject(event));
      if (Object.keys(patch).length > 0) {
        lyricsDisplaySettingsLoadVersionRef.current += 1;
        setLyricsDisplaySettings((current) => ({ ...current, ...patch }));
        if (patch.lyricsCandidatePanelAutoOpenEnabled === false) {
          setIsLyricsMatchPanelClosed(true);
          setIsLyricsMatchPanelRevealed(false);
        }
        setIsLyricsDisplaySettingsReady(true);
        return;
      }

      if (isExplicitObjectSettingsPatch(event)) {
        return;
      }

      lyricsDisplaySettingsLoadVersionRef.current += 1;
      void loadLyricsDisplaySettings();
    };

    void loadLyricsDisplaySettings();
    window.addEventListener("settings:changed", handleSettingsChanged);
    window.addEventListener("lyrics:display-settings-changed", handleSettingsChanged);
    return () =>
      {
        window.removeEventListener("settings:changed", handleSettingsChanged);
        window.removeEventListener("lyrics:display-settings-changed", handleSettingsChanged);
      };
  }, [loadLyricsDisplaySettings]);

  useEffect(() => {
    let isCancelled = false;

    const loadMvDisplaySettings = async (): Promise<void> => {
      try {
        const nextSettings = await window.echo?.mv?.getSettings?.();
        if (!isCancelled && nextSettings) {
          setLyricsReadabilityEnhanced(nextSettings.lyricsReadabilityEnhanced === true);
          setMvHideLyrics(nextSettings.hideLyrics === true);
        }
      } catch {
        // Keep the last known value when the MV bridge is unavailable.
      }
    };

    const handleSettingsChanged = (event: Event): void => {
      const detail = getSettingsEventDetailObject(event);
      const nextReadabilityValue = pickLyricsReadabilityEnhanced(detail);
      const nextHideLyricsValue = pickMvHideLyrics(detail);
      if (nextReadabilityValue !== null || nextHideLyricsValue !== null) {
        if (nextReadabilityValue !== null) {
          setLyricsReadabilityEnhanced(nextReadabilityValue);
        }
        if (nextHideLyricsValue !== null) {
          setMvHideLyrics(nextHideLyricsValue);
        }
        return;
      }

      if (!isExplicitObjectSettingsPatch(event)) {
        void loadMvDisplaySettings();
      }
    };

    void loadMvDisplaySettings();
    window.addEventListener("settings:changed", handleSettingsChanged);
    return () => {
      isCancelled = true;
      window.removeEventListener("settings:changed", handleSettingsChanged);
    };
  }, []);

  const setLyricsCandidatePanelAutoOpenEnabled = useCallback(
    (enabled: boolean): void => {
      const patch: Partial<AppSettings> = {
        lyricsCandidatePanelAutoOpenEnabled: enabled,
      };
      const app = window.echo?.app;

      setLyricsDisplaySettings((current) => ({
        ...current,
        lyricsCandidatePanelAutoOpenEnabled: enabled,
      }));
      if (!enabled) {
        setIsLyricsMatchPanelClosed(true);
        setIsLyricsMatchPanelRevealed(false);
      }
      window.dispatchEvent(new CustomEvent("lyrics:display-settings-changed", { detail: patch }));

      if (!app?.setSettings) {
        setError("Desktop bridge unavailable");
        return;
      }

      void app
        .setSettings(patch)
        .then((nextSettings) => {
          const savedValue = selectLyricsDisplaySettings(nextSettings)
            .lyricsCandidatePanelAutoOpenEnabled === true;
          const savedPatch: Partial<AppSettings> = {
            lyricsCandidatePanelAutoOpenEnabled: savedValue,
          };
          setLyricsDisplaySettings((current) => ({
            ...current,
            lyricsCandidatePanelAutoOpenEnabled: savedValue,
          }));
          window.dispatchEvent(new CustomEvent("settings:changed", { detail: savedPatch }));
          window.dispatchEvent(new CustomEvent("lyrics:display-settings-changed", { detail: savedPatch }));
          setError(null);
        })
        .catch((settingsError) => {
          setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
          void loadLyricsDisplaySettings();
        });
    },
    [loadLyricsDisplaySettings],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.dispatchEvent(new Event("app:navigate:lyrics-back"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const updateWindowState = (): void => setIsWindowMaximized(isWindowApproximatelyMaximized());

    updateWindowState();
    window.addEventListener("resize", updateWindowState);
    return () => window.removeEventListener("resize", updateWindowState);
  }, []);

  useEffect(() => {
    setIsLyricsMatchPanelClosed(false);
    setIsLyricsMatchPanelRevealed(false);
    setLyricsMatchPanelActivityToken(0);
  }, [trackId]);

  const noteLyricsMatchPanelActivity = useCallback((): void => {
    setLyricsMatchPanelActivityToken((token) => (token + 1) % 1000000);
  }, []);

  const getLyricsForActiveTrack = useCallback(async (): Promise<TrackLyrics | null> => {
    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi || !trackId) {
      return null;
    }

    if (lyricsSnapshotRequest && lyricsApi.getForSnapshot) {
      return lyricsApi.getForSnapshot(lyricsSnapshotRequest);
    }

    return lyricsApi.getForTrack(trackId);
  }, [lyricsSnapshotRequest, trackId]);

  const searchLyricsCandidatesForProvider = useCallback(
    async (provider: LyricsProviderId, searchText?: string | null): Promise<LyricsSearchCandidate[]> => {
      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi || !trackId) {
        return [];
      }

      const providerCandidates = lyricsSnapshotRequest && lyricsApi.searchCandidatesForSnapshot
        ? await lyricsApi.searchCandidatesForSnapshot(lyricsSnapshotRequest, searchText ?? undefined, provider)
        : searchText
          ? await lyricsApi.searchCandidates(trackId, searchText, provider)
          : await lyricsApi.searchCandidates(trackId, undefined, provider);

      if (recordLyricsSourceQualityCandidates(providerCandidates)) {
        noteSourceQualityMemoryChanged();
      }

      return providerCandidates;
    },
    [lyricsSnapshotRequest, noteSourceQualityMemoryChanged, trackId],
  );

  const applyLyricsCandidateForActiveTrack = useCallback(
    async (candidateId: string): Promise<TrackLyrics> => {
      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi || !trackId) {
        throw new Error("Desktop bridge unavailable");
      }

      if (lyricsSnapshotRequest && lyricsApi.applyCandidateForSnapshot) {
        return lyricsApi.applyCandidateForSnapshot(lyricsSnapshotRequest, candidateId);
      }

      return lyricsApi.applyCandidate(trackId, candidateId);
    },
    [lyricsSnapshotRequest, trackId],
  );

  useEffect(() => {
    if (
      isLyricsMatchPanelClosed ||
      !isLyricsMatchPanelRevealed ||
      candidates.length === 0 ||
      applyingCandidateId
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setIsLyricsMatchPanelClosed(true);
    }, lyricsMatchAutoCloseMs);

    return () => window.clearTimeout(timer);
  }, [
    applyingCandidateId,
    candidates.length,
    isLyricsMatchPanelClosed,
    isLyricsMatchPanelRevealed,
    lyricsMatchPanelActivityToken,
  ]);

  const tryAutoApplyCandidate = useCallback(
    async (
      nextCandidates: LyricsSearchCandidate[],
      shouldApplyResult?: () => boolean,
    ): Promise<boolean> => {
      const autoCandidate = selectAutoApplyCandidate(
        nextCandidates,
        {
          lyricsAutoAcceptScore: lyricsAutoAcceptScoreRef.current,
          lyricsAutoSearch: lyricsDisplaySettings.lyricsAutoSearch,
        },
      );
      const lyricsApi = window.echo?.lyrics;
      if (!autoCandidate || !trackId || !lyricsApi) {
        return false;
      }

      if (shouldApplyResult && !shouldApplyResult()) {
        return false;
      }

      setApplyingCandidateId(autoCandidate.id);
      try {
        const trackLyrics = await applyLyricsCandidateForActiveTrack(autoCandidate.id);
        if (shouldApplyResult && !shouldApplyResult()) {
          return true;
        }

        if (recordLyricsSourceQualityOutcome(autoCandidate, 'applied')) {
          noteSourceQualityMemoryChanged();
        }
        setLyrics(trackLyricsToState(trackLyrics));
        dispatchCurrentLyricsProviderChanged(trackLyrics);
        setCandidates([]);
        setActiveCandidateSource(readRememberedCandidateSource());
        setLyricsStatus(null);
        setError(null);
        if (lyricsDisplaySettings.lyricsRestartOnApplyEnabled === true) {
          await restartCurrentPlaybackForLyrics(trackId);
        }
        return true;
      } catch (applyError) {
        setError(
          applyError instanceof Error ? applyError.message : String(applyError),
        );
        return false;
      } finally {
        if (!shouldApplyResult || shouldApplyResult()) {
          setApplyingCandidateId(null);
        }
      }
    },
    [
      applyLyricsCandidateForActiveTrack,
      lyricsDisplaySettings.lyricsAutoSearch,
      lyricsDisplaySettings.lyricsRestartOnApplyEnabled,
      noteSourceQualityMemoryChanged,
      trackId,
    ],
  );

  useEffect(() => {
    if (!isLyricsDisplaySettingsReady) {
      return;
    }

    const rememberedLyrics = readRememberedLyricsState(lyricsMemoryKey);
    const setPendingLyrics = (fallbackOffsetMs = 0): boolean => {
      if (rememberedLyrics) {
        setLyrics(rememberedLyrics);
        return true;
      }

      setLyrics(emptyLyrics(fallbackOffsetMs));
      return false;
    };

    if (!lyricsDisplaySettings.lyricsEnabled) {
      lyricsRequestRef.current += 1;
      setLyrics(emptyLyrics(0));
      dispatchCurrentLyricsProviderChanged(null);
      setLyricsStatus(null);
      setCandidates([]);
      setActiveCandidateSource(readRememberedCandidateSource());
      setIsLyricsMatchPanelRevealed(false);
      setIsLyricsLoading(false);
      setIsCandidateLoading(false);
      return;
    }

    if (!trackId) {
      lyricsRequestRef.current += 1;
      setLyrics(
        initialLyrics && initialLyrics.length > 0
          ? syncedLyrics(initialLyrics, 0)
          : emptyLyrics(0),
      );
      dispatchCurrentLyricsProviderChanged(null);
      setLyricsStatus(null);
      setCandidates([]);
      setActiveCandidateSource(readRememberedCandidateSource());
      setIsLyricsMatchPanelRevealed(false);
      return;
    }

    if (streamingTarget && isCurrentNeteaseDjRadioTrack === null) {
      lyricsRequestRef.current += 1;
      setIsLyricsLoading(true);
      setIsCandidateLoading(false);
      const hasRememberedLyrics = setPendingLyrics();
      dispatchCurrentLyricsProviderChanged(null);
      setLyricsStatus(hasRememberedLyrics ? null : "Loading lyrics...");
      setCandidates([]);
      setActiveCandidateSource(readRememberedCandidateSource());
      setIsLyricsMatchPanelRevealed(false);
      return;
    }

    if (streamingTarget && isCurrentNeteaseDjRadioTrack === false) {
      const streamingApi = window.echo?.streaming;
      if (!streamingApi?.getLyrics) {
        lyricsRequestRef.current += 1;
        setLyrics(emptyLyrics(0));
        dispatchCurrentLyricsProviderChanged(null);
        setLyricsStatus("流媒体歌词服务不可用");
        return;
      }

      const requestId = lyricsRequestRef.current + 1;
      lyricsRequestRef.current = requestId;
      setIsLyricsLoading(true);
      setIsCandidateLoading(false);
      const hasRememberedLyrics = setPendingLyrics();
      dispatchCurrentLyricsProviderChanged(null);
      setLyricsStatus(hasRememberedLyrics ? null : "Loading streaming lyrics...");
      setCandidates([]);
      setActiveCandidateSource(readRememberedCandidateSource());
      setIsLyricsMatchPanelRevealed(false);

      // Prefer the streaming provider's exact lookup, then fall back to the regular lyrics matcher.
      void streamingApi
        .getLyrics(streamingTarget)
        .then(async (streamingLyrics) => {
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          const nextLyrics = streamingLyricsToState(streamingLyrics);
          setLyrics(nextLyrics);
          dispatchCurrentLyricsProviderChanged(null);
          setError(null);

          if (nextLyrics.kind !== "empty" || !lyricsDisplaySettings.lyricsAutoSearch) {
            setLyricsStatus(nextLyrics.lines.length > 0 ? null : "No lyrics found");
            return;
          }

          setIsCandidateLoading(true);
          setLyricsStatus("Searching lyrics candidates...");
          let nextCandidates: LyricsSearchCandidate[] = [];
          const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ["local"];
          await Promise.allSettled(
            providers.map(async (provider) => {
              const providerCandidates = await searchLyricsCandidatesForProvider(provider);
              if (lyricsRequestRef.current !== requestId) {
                return;
              }

              nextCandidates = mergeLyricsCandidates(nextCandidates, providerCandidates);
              setCandidates(nextCandidates);
              setActiveCandidateSource(readRememberedCandidateSource());
            }),
          );
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          const autoApplied = await tryAutoApplyCandidate(
            nextCandidates,
            () => lyricsRequestRef.current === requestId,
          );
          if (lyricsRequestRef.current !== requestId || autoApplied) {
            return;
          }

          setCandidates(nextCandidates);
          setActiveCandidateSource(readRememberedCandidateSource());
          setIsLyricsMatchPanelRevealed(
            nextCandidates.length > 0 &&
              shouldRevealAutomaticLyricsCandidates,
          );
          setLyricsStatus(nextCandidates.length ? null : "No lyrics found");
        })
        .catch((lyricsError) => {
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          if (!rememberedLyrics) {
            setLyrics(emptyLyrics(0));
          }
          dispatchCurrentLyricsProviderChanged(null);
          setLyricsStatus(rememberedLyrics ? null : "No lyrics found");
          setError(rememberedLyrics
            ? null
            : lyricsError instanceof Error
              ? lyricsError.message
              : String(lyricsError));
        })
        .finally(() => {
          if (lyricsRequestRef.current === requestId) {
            setIsLyricsLoading(false);
            setIsCandidateLoading(false);
          }
        });
      return;
    }

    const lyricsApi = window.echo?.lyrics;
    if (!lyricsApi) {
      lyricsRequestRef.current += 1;
      setLyrics(
        rememberedLyrics ??
        (initialLyrics && initialLyrics.length > 0
          ? syncedLyrics(initialLyrics, 0)
          : emptyLyrics(0)),
      );
      dispatchCurrentLyricsProviderChanged(null);
      return;
    }

    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;
    setIsLyricsLoading(true);
    const hasRememberedLyrics = setPendingLyrics();
    dispatchCurrentLyricsProviderChanged(null);
    setLyricsStatus("正在匹配歌词...");
    setCandidates([]);
    setActiveCandidateSource(readRememberedCandidateSource());
    setIsLyricsMatchPanelRevealed(false);

    void getLyricsForActiveTrack()
      .then(async (trackLyrics) => {
        if (lyricsRequestRef.current !== requestId) {
          return;
        }

        if (!trackLyrics && lyricsDisplaySettings.lyricsAutoSearch) {
          setIsCandidateLoading(true);
          let nextCandidates: LyricsSearchCandidate[] = [];
          const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ["local"];
          await Promise.allSettled(
            providers.map(async (provider) => {
              const providerCandidates = await searchLyricsCandidatesForProvider(provider);
              if (lyricsRequestRef.current !== requestId) {
                return;
              }

              nextCandidates = mergeLyricsCandidates(nextCandidates, providerCandidates);
              setCandidates(nextCandidates);
              setActiveCandidateSource(readRememberedCandidateSource());
            }),
          );
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          const autoApplied = await tryAutoApplyCandidate(
            nextCandidates,
            () => lyricsRequestRef.current === requestId,
          );
          if (lyricsRequestRef.current !== requestId || autoApplied) {
            return;
          }

          setCandidates(nextCandidates);
          setActiveCandidateSource(readRememberedCandidateSource());
          setIsLyricsMatchPanelRevealed(
            nextCandidates.length > 0 &&
              shouldRevealAutomaticLyricsCandidates,
          );
          setLyricsStatus(nextCandidates.length ? null : "No lyrics found");
          return;
        }

        setLyrics(trackLyricsToState(trackLyrics));
        dispatchCurrentLyricsProviderChanged(trackLyrics);
        setLyricsStatus(trackLyrics ? null : "No lyrics found");
      })
      .catch((lyricsError) => {
        if (lyricsRequestRef.current !== requestId) {
          return;
        }

        if (!rememberedLyrics) {
          setLyrics(emptyLyrics(0));
        }
        dispatchCurrentLyricsProviderChanged(null);
        setLyricsStatus(rememberedLyrics ? null : "No lyrics found");
        setError(rememberedLyrics
          ? null
          : lyricsError instanceof Error
            ? lyricsError.message
            : String(lyricsError));
      })
      .finally(() => {
        if (lyricsRequestRef.current === requestId) {
          setIsLyricsLoading(false);
          setIsCandidateLoading(false);
        }
      });
  }, [
    activeSearchProviders,
    getLyricsForActiveTrack,
    initialLyrics,
    isLyricsDisplaySettingsReady,
    isCurrentNeteaseDjRadioTrack,
    lyricsDisplaySettings.lyricsAutoSearch,
    lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled,
    lyricsDisplaySettings.lyricsEnabled,
    lyricsDisplaySettings.lyricsRomanizationEnabled,
    lyricsDisplaySettings.lyricsUtatenKanaEnabled,
    lyricsMemoryKey,
    searchLyricsCandidatesForProvider,
    shouldRevealAutomaticLyricsCandidates,
    streamingTarget,
    trackId,
    tryAutoApplyCandidate,
  ]);

  const handleSearchLyrics = useCallback(async (searchText?: string): Promise<void> => {
    if (!lyricsDisplaySettings.lyricsEnabled) {
      setLyricsStatus(null);
      return;
    }

    setIsLyricsMatchPanelClosed(false);
    setIsLyricsMatchPanelRevealed(true);

    const isNeteaseDjRadioForSearch = await resolveCurrentNeteaseDjRadioTrack();
    if (streamingTarget && !isNeteaseDjRadioForSearch && !searchText?.trim()) {
      const streamingApi = window.echo?.streaming;
      if (streamingApi?.getLyrics) {
        setIsCandidateLoading(false);
        setIsLyricsLoading(true);
        setLyricsStatus("Loading streaming lyrics...");
        try {
          const streamingLyrics = await streamingApi.getLyrics(streamingTarget);
          const nextLyrics = streamingLyricsToState(streamingLyrics, lyrics.offsetMs);
          setLyrics(nextLyrics);
          dispatchCurrentLyricsProviderChanged(null);
          setCandidates([]);
          setActiveCandidateSource(readRememberedCandidateSource());
          setLyricsStatus(nextLyrics.lines.length > 0 ? null : "No lyrics found");
          setError(null);

          if (nextLyrics.kind === "instrumental" || nextLyrics.lines.length > 0) {
            return;
          }
        } catch {
          setLyrics(emptyLyrics(lyrics.offsetMs));
          dispatchCurrentLyricsProviderChanged(null);
          setLyricsStatus("No lyrics found");
        } finally {
          setIsLyricsLoading(false);
        }
      }
    }

    if (!trackId || !window.echo?.lyrics) {
      setError("Desktop bridge unavailable");
      return;
    }

    const requestId = lyricsRequestRef.current + 1;
    lyricsRequestRef.current = requestId;
    let collectedCandidates: LyricsSearchCandidate[] = [];
    const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ["local"];
    setIsCandidateLoading(true);
    setCandidates([]);
    setActiveCandidateSource(readRememberedCandidateSource());
    setLyricsStatus("Searching lyrics candidates...");
    try {
      await Promise.allSettled(
        providers.map(async (provider) => {
          const providerCandidates = await searchLyricsCandidatesForProvider(provider, searchText);
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          collectedCandidates = mergeLyricsCandidates(collectedCandidates, providerCandidates);
          setCandidates(collectedCandidates);
          setActiveCandidateSource(readRememberedCandidateSource());
          if (collectedCandidates.length > 0) {
            setLyricsStatus(null);
          }
        }),
      );

      if (lyricsRequestRef.current !== requestId) {
        return;
      }

      const shouldAutoApplySearchResult = lyrics.kind === "empty" || lyrics.lines.length === 0;
      if (shouldAutoApplySearchResult) {
        const autoApplied = await tryAutoApplyCandidate(
          collectedCandidates,
          () => lyricsRequestRef.current === requestId,
        );
        if (autoApplied) {
          return;
        }
      }
      setCandidates(collectedCandidates);
      setActiveCandidateSource(readRememberedCandidateSource());
      setLyricsStatus(collectedCandidates.length ? null : "No lyrics found");
      setError(null);
    } catch (candidateError) {
      setLyricsStatus("No lyrics found");
      setError(
        candidateError instanceof Error
          ? candidateError.message
          : String(candidateError),
      );
    } finally {
      if (lyricsRequestRef.current === requestId) {
        setIsCandidateLoading(false);
      }
    }
  }, [
    activeSearchProviders,
    lyrics.kind,
    lyrics.lines.length,
    lyricsDisplaySettings.lyricsEnabled,
    lyrics.offsetMs,
    resolveCurrentNeteaseDjRadioTrack,
    searchLyricsCandidatesForProvider,
    streamingTarget,
    trackId,
    tryAutoApplyCandidate,
  ]);

  const handleRematchLyrics = useCallback(async (): Promise<void> => {
    if (!lyricsDisplaySettings.lyricsEnabled) {
      setLyricsStatus(null);
      return;
    }

    setIsLyricsMatchPanelClosed(false);
    setIsLyricsMatchPanelRevealed(true);

    const isNeteaseDjRadioForRematch = await resolveCurrentNeteaseDjRadioTrack();
    if (streamingTarget && !isNeteaseDjRadioForRematch) {
      await handleSearchLyrics();
      return;
    }

    if (!trackId || !window.echo?.lyrics) {
      setError("Desktop bridge unavailable");
      return;
    }

    const lyricsApi = window.echo.lyrics;
    smartAlignmentAutoAppliedKeyRef.current = null;
    setSmartAlignmentAutoState(null);
    setSmartAlignmentAnchors([]);
    setLyrics(emptyLyrics(lyrics.offsetMs));
    setCandidates([]);
    setActiveCandidateSource(readRememberedCandidateSource());
    setIsCandidateLoading(true);
    setLyricsStatus("正在重新匹配歌词...");
    try {
      const requestId = lyricsRequestRef.current + 1;
      lyricsRequestRef.current = requestId;
      let collectedCandidates: LyricsSearchCandidate[] = [];
      const providers: LyricsProviderId[] = activeSearchProviders.length ? activeSearchProviders : ["local"];

      await lyricsApi.clearCache(trackId);
      await Promise.allSettled(
        providers.map(async (provider) => {
          const providerCandidates = await searchLyricsCandidatesForProvider(provider);
          if (lyricsRequestRef.current !== requestId) {
            return;
          }

          collectedCandidates = mergeLyricsCandidates(collectedCandidates, providerCandidates);
          setCandidates(collectedCandidates);
          setActiveCandidateSource(readRememberedCandidateSource());
          if (collectedCandidates.length > 0) {
            setLyricsStatus(null);
          }
        }),
      );

      if (lyricsRequestRef.current !== requestId) {
        return;
      }

      const autoApplied = await tryAutoApplyCandidate(
        collectedCandidates,
        () => lyricsRequestRef.current === requestId,
      );
      if (autoApplied) {
        return;
      }
      setCandidates(collectedCandidates);
      setActiveCandidateSource(readRememberedCandidateSource());
      setLyricsStatus(collectedCandidates.length ? null : "No lyrics found");
      setError(null);
    } catch (rematchError) {
      setLyricsStatus("No lyrics found");
      setError(
        rematchError instanceof Error
          ? rematchError.message
          : String(rematchError),
      );
    } finally {
      setIsCandidateLoading(false);
    }
  }, [
    activeSearchProviders,
    handleSearchLyrics,
    lyrics.offsetMs,
    lyricsDisplaySettings.lyricsEnabled,
    resolveCurrentNeteaseDjRadioTrack,
    searchLyricsCandidatesForProvider,
    streamingTarget,
    trackId,
    tryAutoApplyCandidate,
  ]);

  useEffect(() => {
    const handleSearchRequested = (event: Event): void => {
      const query = event instanceof CustomEvent && typeof event.detail?.query === "string" ? event.detail.query : undefined;
      void handleSearchLyrics(query);
    };
    const handleRematchRequested = (event: Event): void => {
      const requestedTrackId = event instanceof CustomEvent && typeof event.detail?.trackId === "string" ? event.detail.trackId : null;
      if (requestedTrackId && requestedTrackId !== trackId) {
        return;
      }

      void handleRematchLyrics();
    };
    const handleCandidateApplied = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail as { trackId?: string | null; lyrics?: TrackLyrics | null } : null;
      if (!detail?.lyrics || !detail.trackId || detail.trackId !== trackId) {
        return;
      }

      setLyrics(trackLyricsToState(detail.lyrics));
      dispatchCurrentLyricsProviderChanged(detail.lyrics);
      smartAlignmentAutoAppliedKeyRef.current = null;
      setSmartAlignmentAutoState(null);
      setSmartAlignmentAnchors([]);
      setCandidates([]);
      setActiveCandidateSource(readRememberedCandidateSource());
      setLyricsStatus(null);
      setError(null);
    };

    window.addEventListener("lyrics:search-requested", handleSearchRequested);
    window.addEventListener("lyrics:rematch-requested", handleRematchRequested);
    window.addEventListener("lyrics:candidate-applied", handleCandidateApplied);
    return () => {
      window.removeEventListener("lyrics:search-requested", handleSearchRequested);
      window.removeEventListener("lyrics:rematch-requested", handleRematchRequested);
      window.removeEventListener("lyrics:candidate-applied", handleCandidateApplied);
    };
  }, [handleRematchLyrics, handleSearchLyrics, trackId]);

  const handleApplyCandidate = useCallback(
    async (candidateId: string): Promise<void> => {
      if (!lyricsDisplaySettings.lyricsEnabled) {
        setLyricsStatus(null);
        return;
      }

      if (!trackId || !window.echo?.lyrics) {
        setError("Desktop bridge unavailable");
        return;
      }

      setApplyingCandidateId(candidateId);
      try {
        const trackLyrics = await applyLyricsCandidateForActiveTrack(candidateId);
        const appliedCandidate = candidates.find((candidate) => candidate.id === candidateId);
        if (recordLyricsSourceQualityOutcome(appliedCandidate, 'applied')) {
          noteSourceQualityMemoryChanged();
        }
        setLyrics(trackLyricsToState(trackLyrics));
        dispatchCurrentLyricsProviderChanged(trackLyrics);
        smartAlignmentAutoAppliedKeyRef.current = null;
        setSmartAlignmentAutoState(null);
        setSmartAlignmentAnchors([]);
        setCandidates([]);
        setActiveCandidateSource(readRememberedCandidateSource());
        setLyricsStatus(null);
        setError(null);
        if (lyricsDisplaySettings.lyricsRestartOnApplyEnabled === true) {
          await restartCurrentPlaybackForLyrics(trackId);
        }
      } catch (applyError) {
        setError(
          applyError instanceof Error ? applyError.message : String(applyError),
        );
      } finally {
        setApplyingCandidateId(null);
      }
    },
    [
      applyLyricsCandidateForActiveTrack,
      candidates,
      lyricsDisplaySettings.lyricsEnabled,
      lyricsDisplaySettings.lyricsRestartOnApplyEnabled,
      noteSourceQualityMemoryChanged,
      trackId,
    ],
  );

  const applyCustomLyricsFile = useCallback(
    async (file: File): Promise<void> => {
      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi?.applyCustomLrc || !trackId) {
        setError("Desktop bridge unavailable");
        return;
      }

      if (!isCustomLyricsFile(file.name)) {
        setError("Please choose an .lrc or .ttml lyrics file");
        return;
      }

      setIsCustomLyricsApplying(true);
      setLyricsStatus("Applying custom lyrics...");
      try {
        const lrcText = decodeTextFileBytes(new Uint8Array(await file.arrayBuffer()));
        const trackLyrics = await lyricsApi.applyCustomLrc(trackId, lrcText, file.name);
        lyricsRequestRef.current += 1;
        setLyrics(trackLyricsToState(trackLyrics));
        dispatchCurrentLyricsProviderChanged(trackLyrics);
        smartAlignmentAutoAppliedKeyRef.current = null;
        setSmartAlignmentAutoState(null);
        setSmartAlignmentAnchors([]);
        setCandidates([]);
        setActiveCandidateSource(readRememberedCandidateSource());
        setLyricsStatus(null);
        setError(null);
        if (lyricsDisplaySettings.lyricsRestartOnApplyEnabled === true) {
          await restartCurrentPlaybackForLyrics(trackId);
        }
      } catch (customLyricsError) {
        setLyricsStatus(null);
        setError(
          customLyricsError instanceof Error
            ? customLyricsError.message
            : String(customLyricsError),
        );
      } finally {
        setIsCustomLyricsApplying(false);
      }
    },
    [lyricsDisplaySettings.lyricsRestartOnApplyEnabled, trackId],
  );

  const handleLyricsDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!firstCustomLyricsFile(event.dataTransfer.files) && !hasFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsCustomLyricsDragging(true);
  }, []);

  const handleLyricsDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsCustomLyricsDragging(false);
  }, []);

  const handleLyricsDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      const file = firstCustomLyricsFile(event.dataTransfer.files);
      if (!file) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsCustomLyricsDragging(false);
      void applyCustomLyricsFile(file);
    },
    [applyCustomLyricsFile],
  );

  const handleLyricSeek = useCallback(
    async (timeMs: number): Promise<void> => {
      const playback = window.echo?.playback;

      if (!playback) {
        setError("Desktop bridge unavailable");
        return;
      }

      const nextSeconds = Math.max(0, timeMs / 1000);
      logLyricsConsole("page.seek-request", {
        trackId,
        targetPositionMs: Math.round(nextSeconds * 1000),
        currentPlaybackMs: Math.round(Math.max(0, lyricsPositionSeconds * 1000)),
        source: "lyrics-line",
      });
      try {
        showSeekPreview(nextSeconds);
        const status = await playback.seek(nextSeconds);
        const nextStatus = {
          ...status,
          positionMs: Math.round(nextSeconds * 1000),
        };
        setPlaybackStatus(nextStatus);
        setAudioStatus((current) =>
          current
            ? {
                ...current,
                state: status.state,
                currentTrackId: status.currentTrackId,
                currentFilePath: status.filePath,
                positionSeconds: nextSeconds,
                durationSeconds: status.durationMs / 1000,
              }
            : current,
        );
        beginPlaybackSeekSnapshot(nextStatus);
        dispatchPlaybackSeeked(nextSeconds, status.currentTrackId ?? trackId ?? null);
        clearSeekPreview();
        logLyricsConsole("page.seek-committed", {
          trackId: status.currentTrackId ?? trackId ?? null,
          state: status.state,
          targetPositionMs: Math.round(nextSeconds * 1000),
          statusPositionMs: nextStatus.positionMs,
          durationMs: nextStatus.durationMs,
        });
        void refreshStatus();
      } catch (seekError) {
        clearSeekPreview();
        logLyricsConsole("page.seek-failed", {
          trackId,
          targetPositionMs: Math.round(nextSeconds * 1000),
          error: seekError instanceof Error ? seekError.message : String(seekError),
        }, { level: "warn", dedupeKey: `lyrics-page-seek-failed:${trackId ?? "unknown"}`, dedupeMs: 1000 });
        setError(
          seekError instanceof Error ? seekError.message : String(seekError),
        );
      }
    },
    [clearSeekPreview, lyricsPositionSeconds, refreshStatus, showSeekPreview, trackId],
  );

  const handleLyricsOffsetChange = useCallback(
    async (
      nextOffsetMs: number,
      options: { source?: "manual" | "smart-auto" | "smart-undo"; previousOffsetMs?: number } = {},
    ): Promise<void> => {
      const lyricsApi = window.echo?.lyrics;
      if (!lyricsApi || !trackId) {
        setError("Desktop bridge unavailable");
        return;
      }

      const source = options.source ?? "manual";
      if (source === "manual") {
        smartAlignmentAutoAppliedKeyRef.current = null;
        setSmartAlignmentAutoState(null);
        setSmartAlignmentAnchors([]);
      }

      try {
        setIsLyricsOffsetSaving(true);
        const nextLyrics = await lyricsApi.setOffset(trackId, nextOffsetMs);
        if (!nextLyrics) {
          setError("Current lyrics cannot be adjusted until a matched lyric is cached");
          return;
        }

        setLyrics(trackLyricsToState(nextLyrics, lyrics.offsetMs));
        dispatchCurrentLyricsProviderChanged(nextLyrics);
        if (source === "smart-auto") {
          setSmartAlignmentAutoState({
            trackId,
            previousOffsetMs: options.previousOffsetMs ?? lyrics.offsetMs,
            offsetMs: nextLyrics.offsetMs,
          });
        } else if (source === "smart-undo") {
          setSmartAlignmentAutoState(null);
        }
        setError(null);
      } catch (offsetError) {
        setError(
          offsetError instanceof Error ? offsetError.message : String(offsetError),
        );
      } finally {
        setIsLyricsOffsetSaving(false);
      }
    },
    [lyrics.offsetMs, trackId],
  );

  const smartAlignmentPreviewCandidates = useMemo(
    () =>
      [...candidates]
        .filter((candidate) => candidate.hasSynced && !candidate.instrumental)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3),
    [candidates],
  );
  const smartAlignmentPreviewCandidateKey = useMemo(
    () => smartAlignmentPreviewCandidates.map((candidate) => candidate.id).join("|"),
    [smartAlignmentPreviewCandidates],
  );

  useEffect(() => {
    const canSearchBackgroundCandidates =
      lyricsDisplaySettings.lyricsSmartAlignmentEnabled === true &&
      lyricsDisplaySettings.lyricsAutoSearch !== false &&
      lyrics.kind === "synced" &&
      lyrics.source !== "placeholder" &&
      lyrics.lines.length > 0 &&
      Boolean(trackId) &&
      audioStatus?.currentTrackId === trackId &&
      candidates.length === 0 &&
      !isCandidateLoading &&
      !isLyricsLoading &&
      activeSearchProviders.length > 0 &&
      Boolean(window.echo?.lyrics?.searchCandidates);

    if (!canSearchBackgroundCandidates || !trackId) {
      return;
    }

    const searchKey = `${trackId}|${lyrics.source}|${lyrics.lines.length}|${lyrics.offsetMs}|${activeSearchProviders.join(",")}`;
    if (smartAlignmentBackgroundSearchKeyRef.current === searchKey) {
      return;
    }
    smartAlignmentBackgroundSearchKeyRef.current = searchKey;

    let isCancelled = false;
    const providers = activeSearchProviders.slice(0, smartAlignmentBackgroundCandidateLimit);
    void Promise.allSettled(
      providers.map(async (provider) => searchLyricsCandidatesForProvider(provider)),
    ).then((results) => {
      if (isCancelled) {
        return;
      }

      const nextCandidates = results.reduce<LyricsSearchCandidate[]>((merged, result) => {
        if (result.status !== "fulfilled") {
          return merged;
        }
        return mergeLyricsCandidates(merged, result.value);
      }, []);

      if (nextCandidates.length === 0) {
        return;
      }

      setCandidates(nextCandidates);
      setActiveCandidateSource(readRememberedCandidateSource());
    });

    return () => {
      isCancelled = true;
    };
  }, [
    activeSearchProviders,
    audioStatus?.currentTrackId,
    candidates.length,
    isCandidateLoading,
    isLyricsLoading,
    lyrics.kind,
    lyrics.lines.length,
    lyrics.offsetMs,
    lyrics.source,
    lyricsDisplaySettings.lyricsAutoSearch,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    searchLyricsCandidatesForProvider,
    trackId,
  ]);

  useEffect(() => {
    const lyricsApi = window.echo?.lyrics;
    const canPreviewCandidates =
      lyricsDisplaySettings.lyricsSmartAlignmentEnabled === true &&
      lyrics.kind === "synced" &&
      Boolean(trackId) &&
      audioStatus?.currentTrackId === trackId &&
      Boolean(lyricsApi?.previewCandidate) &&
      smartAlignmentPreviewCandidates.length > 0;

    if (!canPreviewCandidates || !trackId || !lyricsApi?.previewCandidate) {
      setSmartAlignmentCandidatePreviews([]);
      return;
    }

    const requestId = smartAlignmentCandidateRequestRef.current + 1;
    smartAlignmentCandidateRequestRef.current = requestId;
    void Promise.all(
      smartAlignmentPreviewCandidates.map(async (candidate): Promise<LyricsSmartAlignmentCandidate | null> => {
        try {
          const preview = await lyricsApi.previewCandidate!(trackId, candidate.id);
          if (preview.kind !== "synced" || preview.lines.length === 0) {
            return null;
          }
          return {
            id: candidate.id,
            sourceLabel: candidate.sourceLabel,
            score: candidate.score,
            lines: preview.lines,
          };
        } catch {
          return null;
        }
      }),
    ).then((previews) => {
      if (smartAlignmentCandidateRequestRef.current !== requestId) {
        return;
      }
      setSmartAlignmentCandidatePreviews(previews.filter((preview): preview is LyricsSmartAlignmentCandidate => Boolean(preview)));
    });
  }, [
    lyrics.kind,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    audioStatus?.currentTrackId,
    smartAlignmentPreviewCandidateKey,
    smartAlignmentPreviewCandidates,
    trackId,
  ]);

  const smartAlignmentEvaluation = useMemo(() => {
    if (
      lyricsDisplaySettings.lyricsSmartAlignmentEnabled !== true ||
      lyrics.kind !== "synced" ||
      lyrics.source === "placeholder" ||
      lyrics.lines.length === 0
    ) {
      return null;
    }

    return evaluateLyricsSmartAlignment({
      anchors: smartAlignmentAnchors,
      currentLines: lyrics.lines,
      candidates: smartAlignmentCandidatePreviews,
      currentOffsetMs: lyrics.offsetMs,
    });
  }, [
    lyrics.kind,
    lyrics.lines,
    lyrics.offsetMs,
    lyrics.source,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    smartAlignmentAnchors,
    smartAlignmentCandidatePreviews,
  ]);

  useEffect(() => {
    const outputMode = isSmartAlignmentOutputMode(audioStatus?.outputMode)
      ? audioStatus.outputMode
      : null;
    const hasCurrentAudioClock = Boolean(
      audioStatus &&
        trackId &&
        audioStatus.currentTrackId === trackId &&
        Number.isFinite(audioStatus.positionSeconds),
    );
    const canAutoApplySmartAlignment =
      Boolean(trackId) &&
      lyrics.kind === "synced" &&
      lyrics.source !== "placeholder" &&
      lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false &&
      hasCurrentAudioClock &&
      Boolean(outputMode) &&
      Boolean(window.echo?.lyrics?.setOffset) &&
      !isLyricsOffsetSaving;

    if (!canAutoApplySmartAlignment || !trackId || !smartAlignmentEvaluation?.canAutoApply) {
      return;
    }
    if (smartAlignmentAutoState?.trackId === trackId) {
      return;
    }

    const autoApplyKey = `${trackId}|${lyrics.source}|${lyrics.lines.length}|${lyrics.offsetMs}|${smartAlignmentEvaluation.offsetMs}`;
    if (smartAlignmentAutoAppliedKeyRef.current === autoApplyKey) {
      return;
    }

    smartAlignmentAutoAppliedKeyRef.current = autoApplyKey;
    void handleLyricsOffsetChange(smartAlignmentEvaluation.offsetMs, {
      source: "smart-auto",
      previousOffsetMs: lyrics.offsetMs,
    });
  }, [
    audioStatus,
    handleLyricsOffsetChange,
    isLyricsOffsetSaving,
    lyrics.kind,
    lyrics.lines.length,
    lyrics.offsetMs,
    lyrics.source,
    lyricsDisplaySettings.lyricsTimelineCorrectionEnabled,
    smartAlignmentAutoState,
    smartAlignmentEvaluation,
    trackId,
  ]);

  useEffect(() => {
    if (
      lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled !== true ||
      lyricsDisplaySettings.lyricsSmartAlignmentEnabled !== true ||
      !smartAlignmentEvaluation ||
      smartAlignmentEvaluation.evidenceCount === 0 ||
      smartAlignmentEvaluation.canAutoApply ||
      (smartAlignmentEvaluation.confidence !== "low" && smartAlignmentEvaluation.action !== "needs_rematch")
    ) {
      return;
    }

    setIsLyricsMatchPanelClosed(false);
    setIsLyricsMatchPanelRevealed(true);
  }, [
    lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    smartAlignmentEvaluation,
  ]);

  useEffect(() => {
    const canAutoRematchDrift =
      Boolean(trackId) &&
      lyricsDisplaySettings.lyricsSmartAlignmentEnabled === true &&
      lyricsDisplaySettings.lyricsAutoSearch !== false &&
      lyrics.kind === "synced" &&
      lyrics.source !== "placeholder" &&
      smartAlignmentEvaluation?.reason === "possible_drift" &&
      smartAlignmentEvaluation.matchedLineCount >= 3 &&
      smartAlignmentPreviewCandidates.length > 0 &&
      !applyingCandidateId &&
      !isLyricsOffsetSaving;

    if (!canAutoRematchDrift || !trackId || !smartAlignmentEvaluation) {
      return;
    }

    const rematchKey = `${trackId}|${lyrics.source}|${lyrics.lines.length}|${lyrics.offsetMs}|${smartAlignmentEvaluation.driftMs}|${smartAlignmentPreviewCandidateKey}`;
    if (smartAlignmentAutoRematchKeyRef.current === rematchKey) {
      return;
    }
    smartAlignmentAutoRematchKeyRef.current = rematchKey;

    void tryAutoApplyCandidate(
      smartAlignmentPreviewCandidates,
      () => smartAlignmentAutoRematchKeyRef.current === rematchKey,
    );
  }, [
    applyingCandidateId,
    isLyricsOffsetSaving,
    lyrics.kind,
    lyrics.lines.length,
    lyrics.offsetMs,
    lyrics.source,
    lyricsDisplaySettings.lyricsAutoSearch,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    smartAlignmentEvaluation,
    smartAlignmentPreviewCandidateKey,
    smartAlignmentPreviewCandidates,
    trackId,
    tryAutoApplyCandidate,
  ]);

  const lyricsOffsetControls = useMemo(() => {
    if (!trackId || lyrics.kind !== "synced" || !lyricsDisplaySettings.lyricsOffsetControlsEnabled) {
      return null;
    }

    const currentOffsetMs = lyrics.offsetMs;
    const offsetSteps = [-500, -100, 100, 500];
    const clampNextOffset = (value: number): number =>
      Math.max(-10000, Math.min(10000, Math.round(value)));
    const correctionEnabled = lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false;
    const currentPlaybackMs = Math.max(0, lyricsPositionSeconds * 1000);
    const displayPositionMs = currentPlaybackMs + (correctionEnabled ? lyricsDisplaySettings.lyricsGlobalSyncOffsetMs : 0);
    const activeLineIndex = getActiveLyricIndex(
      displayedLyrics.lines,
      displayPositionMs,
      correctionEnabled ? lyrics.offsetMs : 0,
    );
    const activeLine = activeLineIndex >= 0 ? displayedLyrics.lines[activeLineIndex] : null;
    const alignedOffsetMs = activeLine
      ? clampNextOffset(activeLine.timeMs - (currentPlaybackMs + lyricsDisplaySettings.lyricsGlobalSyncOffsetMs))
      : currentOffsetMs;

    return (
      <section className="lyrics-offset-controls" aria-label="歌词延迟">
        <span className="lyrics-offset-label">本歌曲延迟</span>
        <span className="lyrics-offset-value">{formatOffset(currentOffsetMs)}</span>
        <div className="lyrics-offset-buttons">
          <button
            type="button"
            disabled={isLyricsOffsetSaving || !activeLine || alignedOffsetMs === currentOffsetMs}
            title={activeLine ? "对齐当前句到当前播放位置" : "当前没有可对齐的同步歌词行"}
            onClick={() => void handleLyricsOffsetChange(alignedOffsetMs)}
          >
            <TimerReset size={14} />
            <span>对齐当前句</span>
          </button>
          {offsetSteps.map((step) => {
            const nextOffsetMs = clampNextOffset(currentOffsetMs + step);
            const isForward = step > 0;
            return (
              <button
                type="button"
                key={step}
                disabled={isLyricsOffsetSaving || nextOffsetMs === currentOffsetMs}
                title={step > 0 ? `歌词提前 ${step}ms` : `歌词延后 ${Math.abs(step)}ms`}
                onClick={() => void handleLyricsOffsetChange(nextOffsetMs)}
              >
                {isForward ? <FastForward size={14} /> : <Rewind size={14} />}
                <span>{step > 0 ? "+" : ""}{step}ms</span>
              </button>
            );
          })}
          <button
            type="button"
            disabled={isLyricsOffsetSaving || currentOffsetMs === 0}
            title="重置本歌曲歌词延迟"
            onClick={() => void handleLyricsOffsetChange(0)}
          >
            <RotateCcw size={14} />
            <span>0ms</span>
          </button>
        </div>
        <p>只保存到当前歌曲；切到下一首会使用下一首自己的延迟。</p>
      </section>
    );
  }, [
    handleLyricsOffsetChange,
    isLyricsOffsetSaving,
    displayedLyrics.lines,
    lyrics.kind,
    lyrics.offsetMs,
    lyricsDisplaySettings.lyricsGlobalSyncOffsetMs,
    lyricsDisplaySettings.lyricsOffsetControlsEnabled,
    lyricsDisplaySettings.lyricsTimelineCorrectionEnabled,
    lyricsPositionSeconds,
    trackId,
  ]);

  const lyricsSmartAlignmentControls = useMemo(() => {
    if (!lyricsDisplaySettings.lyricsSmartAlignmentEnabled) {
      return null;
    }

    const outputMode = isSmartAlignmentOutputMode(audioStatus?.outputMode)
      ? audioStatus.outputMode
      : null;
    const hasCachedSyncedLyrics =
      lyrics.kind === "synced" &&
      lyrics.source !== "placeholder" &&
      lyrics.lines.length > 0;
    const hasCurrentAudioClock =
      Boolean(
        audioStatus &&
          trackId &&
          audioStatus.currentTrackId === trackId &&
          Number.isFinite(audioStatus.positionSeconds),
      );
    const correctionEnabled = lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false;
    const canUseSmartAlignment =
      Boolean(trackId) &&
      hasCachedSyncedLyrics &&
      correctionEnabled &&
      hasCurrentAudioClock &&
      Boolean(outputMode) &&
      Boolean(window.echo?.lyrics?.setOffset);
    const unavailableReason =
      !trackId
        ? "等待当前歌曲"
        : !hasCachedSyncedLyrics
          ? "需要已缓存的同步歌词"
          : !correctionEnabled
            ? "时间轴校准总开关已关闭"
            : !hasCurrentAudioClock
              ? "等待当前播放时钟"
              : !outputMode
                ? "当前输出模式暂不支持智能校准"
                : !window.echo?.lyrics?.setOffset
                  ? "歌词校准接口不可用"
                  : null;
    const audioPlaybackMs = audioStatus ? Math.max(0, audioStatus.positionSeconds * 1000) : 0;
    const displayPositionMs = audioPlaybackMs + lyricsDisplaySettings.lyricsGlobalSyncOffsetMs;
    const activeLineIndex = canUseSmartAlignment
      ? getActiveLyricIndex(
          lyrics.lines,
          displayPositionMs,
          lyrics.offsetMs,
        )
      : -1;
    const activeLine = activeLineIndex >= 0 ? lyrics.lines[activeLineIndex] : null;
    const evidenceLabel = smartAlignmentEvaluation
      ? smartAlignmentEvaluation.matchedLineCount > 0
        ? `候选 ${smartAlignmentEvaluation.matchedLineCount} 行`
        : `锚点 ${smartAlignmentEvaluation.anchorCount} 个`
      : null;
    const currentAutoState =
      smartAlignmentAutoState && smartAlignmentAutoState.trackId === trackId
        ? smartAlignmentAutoState
        : null;

    const handleStartSession = (): void => {
      setSmartAlignmentAnchors([]);
      setIsSmartAlignmentSessionActive(true);
      setSmartAlignmentAutoState(null);
      smartAlignmentAutoAppliedKeyRef.current = null;
    };

    const handleMarkAnchor = (): void => {
      if (!activeLine || !outputMode || !canUseSmartAlignment) {
        return;
      }

      setSmartAlignmentAnchors((current) =>
        [
          ...current,
          {
            lyricLineTimeMs: activeLine.timeMs,
            playbackMs: audioPlaybackMs,
            globalOffsetMs: lyricsDisplaySettings.lyricsGlobalSyncOffsetMs,
            outputMode,
          },
        ].slice(-5),
      );
    };

    const handleUndoSmartAlignment = (): void => {
      if (!currentAutoState || isLyricsOffsetSaving) {
        return;
      }
      void handleLyricsOffsetChange(currentAutoState.previousOffsetMs, { source: "smart-undo" });
    };
    const smartAlignmentMessage =
      unavailableReason ??
      (currentAutoState
        ? `已自动保存当前歌曲延迟，原值 ${formatOffset(currentAutoState.previousOffsetMs)}。`
        : isSmartAlignmentSessionActive && !smartAlignmentEvaluation
          ? `已标记 ${smartAlignmentAnchors.length} 个锚点，听到当前句时继续标记。`
          : smartAlignmentReasonText(smartAlignmentEvaluation));

    return (
      <section className="lyrics-smart-alignment" aria-label="Smart lyrics alignment">
        <span className="lyrics-smart-alignment-label">智能自动校准</span>
        <div className="lyrics-smart-alignment-buttons">
          <button
            type="button"
            disabled={!canUseSmartAlignment}
            onClick={handleStartSession}
          >
            <TimerReset size={14} />
            <span>重新检测</span>
          </button>
          <button
            type="button"
            disabled={!isSmartAlignmentSessionActive || !canUseSmartAlignment || !activeLine}
            title={activeLine ? `标记：${activeLine.text}` : "当前没有可标记的同步歌词行"}
            onClick={handleMarkAnchor}
          >
            <Disc3 size={14} />
            <span>标记当前句</span>
          </button>
          {currentAutoState ? (
            <button
              type="button"
              disabled={isLyricsOffsetSaving}
              onClick={handleUndoSmartAlignment}
            >
              <RotateCcw size={14} />
              <span>撤销</span>
            </button>
          ) : null}
        </div>
        {currentAutoState ? (
          <span className="lyrics-smart-alignment-suggestion">
            已自动校准 {formatOffset(currentAutoState.offsetMs)}
          </span>
        ) : smartAlignmentEvaluation && smartAlignmentEvaluation.evidenceCount > 0 ? (
          <span className="lyrics-smart-alignment-suggestion">
            {smartAlignmentEvaluation.action === "auto_apply" && isLyricsOffsetSaving ? "正在保存" : formatOffset(smartAlignmentEvaluation.offsetMs)}
            {" · "}
            {smartAlignmentConfidenceLabel(smartAlignmentEvaluation.confidence)}
            {smartAlignmentEvaluation.outputMode ? ` · ${smartAlignmentModeLabel(smartAlignmentEvaluation.outputMode)} 时钟` : ""}
            {evidenceLabel ? ` · ${evidenceLabel}` : ""}
          </span>
        ) : null}
        <p>{smartAlignmentMessage}</p>
      </section>
    );
  }, [
    audioStatus,
    handleLyricsOffsetChange,
    isLyricsOffsetSaving,
    isSmartAlignmentSessionActive,
    lyrics.kind,
    lyrics.lines,
    lyrics.offsetMs,
    lyrics.source,
    lyricsDisplaySettings.lyricsGlobalSyncOffsetMs,
    lyricsDisplaySettings.lyricsSmartAlignmentEnabled,
    lyricsDisplaySettings.lyricsTimelineCorrectionEnabled,
    smartAlignmentAutoState,
    smartAlignmentAnchors,
    smartAlignmentEvaluation,
    trackId,
  ]);

  const lyricsControls = useMemo(() => {
    if (!trackId) {
      return null;
    }

    if (!lyricsDisplaySettings.lyricsEnabled) {
      return null;
    }

    const shouldFoldStatusIntoEmptyLyrics =
      lyrics.lines.length === 0 &&
      candidates.length === 0 &&
      !isLyricsLoading &&
      !isCandidateLoading;
    const statusText = isLyricsLoading
      ? "正在匹配歌词..."
      : isCandidateLoading
        ? "Searching lyrics candidates..."
        : shouldFoldStatusIntoEmptyLyrics
          ? null
          : lyricsStatus;

    if (candidates.length === 0 && !statusText) {
      return null;
    }

    if (isLyricsMatchPanelClosed) {
      return null;
    }

    if (!isLyricsMatchPanelRevealed) {
      return null;
    }

    return (
      <section
        className="lyrics-match-panel"
        aria-label="Lyrics matching"
        onFocusCapture={noteLyricsMatchPanelActivity}
        onKeyDown={noteLyricsMatchPanelActivity}
        onPointerDown={noteLyricsMatchPanelActivity}
        onPointerEnter={noteLyricsMatchPanelActivity}
        onWheel={noteLyricsMatchPanelActivity}
      >
        <div className="lyrics-match-panel__bar">
          {statusText ? <p className="lyrics-match-status">{statusText}</p> : <span />}
          <div className="lyrics-match-panel__actions">
            <label className="lyrics-match-auto-open">
              <input
                type="checkbox"
                checked={lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled === true}
                onChange={(event) => setLyricsCandidatePanelAutoOpenEnabled(event.currentTarget.checked)}
              />
              <span>自动弹出</span>
            </label>
            <button
              className="lyrics-match-close"
              type="button"
              aria-label="Close lyrics candidates"
              title="Close lyrics candidates"
              onClick={() => setIsLyricsMatchPanelClosed(true)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {candidates.length ? (
          <>
            {candidateSourceQualitySummaries.length ? (
              <div className="lyrics-source-quality" aria-label="Lyrics source quality">
                {candidateSourceQualitySummaries.map((summary) => (
                  <div className="lyrics-source-quality__item" key={summary.key}>
                    <strong>{summary.label}</strong>
                    <span>
                      <small>{summary.count} 候选</small>
                      <small>最佳 {formatScore(summary.bestScore)}</small>
                      <small>均分 {formatScore(summary.averageScore)}</small>
                      {summary.lowRiskCount > 0 ? <small>安全 {summary.lowRiskCount}</small> : null}
                      {summary.syncedCount > 0 ? <small>同步 {summary.syncedCount}</small> : null}
                      {summary.recentCandidateCount > 0 ? <small>近期 {summary.recentCandidateCount}</small> : null}
                      {summary.recentAppliedCount > 0 ? <small>采用 {summary.recentAppliedCount}</small> : null}
                      {summary.recentAverageScore > 0 ? <small>近均 {formatScore(summary.recentAverageScore)}</small> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="lyrics-source-filters" aria-label="Lyrics source filter">
              {candidateSourceOptions.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  data-active={activeCandidateSource === option.key}
                  onClick={() => selectCandidateSource(option.key)}
                >
                  {option.label}
                  <small>{option.count}</small>
                </button>
              ))}
            </div>
            <div className="lyrics-candidate-list">
              {visibleCandidates.map((candidate) => {
                const candidateKind = lyricsCandidateDisplayKind(candidate);
                return (
                  <button
                    className={`lyrics-candidate lyrics-candidate--${candidateKind}`}
                    type="button"
                    key={candidate.id}
                    data-lyrics-kind={candidateKind}
                    disabled={Boolean(applyingCandidateId)}
                    onClick={() => void handleApplyCandidate(candidate.id)}
                  >
                    <span>
                      <strong>{candidate.title}</strong>
                      <em>
                        {candidate.artist}
                        {candidate.album ? ` / ${candidate.album}` : ""} /{" "}
                        {formatDuration(candidate.durationSeconds)}
                      </em>
                    </span>
                    <span className="lyrics-candidate-badges">
                      <small
                        className={`lyrics-risk-badge lyrics-risk-badge--${candidate.risk ?? "high"}`}
                      >
                        {riskLabel(candidate.risk)}
                      </small>
                      <small className={`lyrics-kind-badge lyrics-kind-badge--${candidateKind}`}>
                        {lyricsCandidateDisplayLabel(candidateKind)}
                      </small>
                      <small>{candidate.sourceLabel}</small>
                      <small>{formatScore(candidate.score)}</small>
                      {visibleReasons(candidate).map((reason) => (
                        <small className="lyrics-reason-badge" key={reason}>
                          {reason}
                        </small>
                      ))}
                      {applyingCandidateId === candidate.id ? (
                        <small>Applying</small>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </section>
    );
  }, [
    activeCandidateSource,
    applyingCandidateId,
    candidates,
    candidateSourceOptions,
    candidateSourceQualitySummaries,
    handleApplyCandidate,
    isLyricsMatchPanelClosed,
    isLyricsMatchPanelRevealed,
    isCandidateLoading,
    isLyricsLoading,
    lyricsDisplaySettings.lyricsCandidatePanelAutoOpenEnabled,
    lyricsDisplaySettings.lyricsEnabled,
    lyrics.lines.length,
    lyricsStatus,
    noteLyricsMatchPanelActivity,
    selectCandidateSource,
    setLyricsCandidatePanelAutoOpenEnabled,
    trackId,
    visibleCandidates,
  ]);

  const shouldHideLyricsInMv = lyricsViewMode === "mv" && mvHideLyrics;
  const lyricsDrawerCurrentTrackTools = useMemo(() => {
    if (shouldHideLyricsInMv) {
      return null;
    }

    const smartAlignmentControls = lyricsDisplaySettings.lyricsOffsetControlsEnabled ? lyricsSmartAlignmentControls : null;
    if (!lyricsOffsetControls && !smartAlignmentControls) {
      return null;
    }

    return (
      <div className="lyrics-current-track-tools">
        {lyricsOffsetControls}
        {smartAlignmentControls}
      </div>
    );
  }, [
    lyricsDisplaySettings.lyricsOffsetControlsEnabled,
    lyricsOffsetControls,
    lyricsSmartAlignmentControls,
    shouldHideLyricsInMv,
  ]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(lyricsDrawerToolsChangedEvent, {
      detail: { currentTrackTools: lyricsDrawerCurrentTrackTools },
    }));

    return () => {
      window.dispatchEvent(new CustomEvent(lyricsDrawerToolsChangedEvent, {
        detail: { currentTrackTools: null },
      }));
    };
  }, [lyricsDrawerCurrentTrackTools]);

  if (!currentTrack && !filePath && !trackId) {
    return (
      <div className="lyrics-page lyrics-page--empty">
        <button
          className="lyrics-back-button"
          type="button"
          aria-label="Back"
          title="Back"
          onClick={() =>
            window.dispatchEvent(new Event("app:navigate:lyrics-back"))
          }
        >
          <ArrowLeft size={17} />
        </button>
        <section className="lyrics-no-track">
          <Music2 size={34} />
          <h1>Nothing is playing</h1>
          <p>
            Start a song from the library, then return here for lyrics and
            immersive playback.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div
      className="lyrics-page"
      data-background={effectiveLyricsBackgroundMode}
      data-lyrics-color-mode={lyricsUsesManualColor ? "manual" : "theme"}
      data-smart-readable={smartReadableColors ? "true" : undefined}
      data-album-transition={isAlbumNavigating ? "true" : undefined}
      data-custom-lrc-dragging={isCustomLyricsDragging}
      data-lyrics-text-direction={lyricsDisplaySettings.lyricsTextDirection}
      data-view-mode={lyricsViewMode}
      data-mv-lyrics-hidden={shouldHideLyricsInMv ? "true" : undefined}
      data-airplay-receiver={isCurrentAirPlayReceiverTrack ? "true" : undefined}
      data-window-maximized={isWindowMaximized}
      style={lyricsPageStyle}
      onDragLeave={handleLyricsDragLeave}
      onDragOver={handleLyricsDragOver}
      onDrop={handleLyricsDrop}
    >
      <div className="lyrics-backdrop" aria-hidden="true" />
      {isCustomLyricsDragging ? (
        <div className="lyrics-custom-lrc-drop" aria-hidden="true">
          <Upload size={28} />
          <strong>Drop lyrics to apply</strong>
        </div>
      ) : null}
      {usePlayerDrawerHeader && !lyricsDisplaySettings.lyricsHeaderHidden ? (
        <header className="lyrics-track-header lyrics-track-header-floating">
          <div
            className="lyrics-track-cover"
            data-empty={!headerCoverUrl}
            title="Copy cover"
            onContextMenu={handleTrackCoverContextMenu}
          >
            {headerCoverUrl ? (
              <img alt="" draggable={false} src={headerCoverUrl} />
            ) : (
              <Disc3 size={26} />
            )}
          </div>
          <div
            className="lyrics-track-copy"
            title="Copy track info"
            onContextMenu={handleTrackInfoContextMenu}
          >
            <span className="lyrics-kicker">Now Playing</span>
            <h1 title="Copy title" onContextMenu={handleTrackTitleContextMenu}>
              {title}
            </h1>
            {album ? (
              <button
                className="lyrics-track-album"
                type="button"
                aria-disabled={!currentTrack || isAlbumNavigating}
                title={`Open ${album}`}
                onClick={handleOpenAlbumDetail}
                onContextMenu={handleTrackAlbumContextMenu}
              >
                {album}
              </button>
            ) : null}
            <p
              className="lyrics-track-artist"
              title="Copy artist"
              onContextMenu={handleTrackArtistContextMenu}
            >
              {artist}
            </p>
          </div>
        </header>
      ) : null}
      <section className="lyrics-left-panel">
        <button
          className="lyrics-back-button"
          type="button"
          aria-label="Back"
          title="Back"
          onClick={() =>
            window.dispatchEvent(new Event("app:navigate:lyrics-back"))
          }
        >
          <ArrowLeft size={17} />
        </button>

        {lyricsDisplaySettings.lyricsHeaderHidden ? null : (
          <header className="lyrics-track-header">
            <div
              className="lyrics-track-cover"
              data-empty={!headerCoverUrl}
              title="右键复制封面原图"
              onContextMenu={handleTrackCoverContextMenu}
            >
              {headerCoverUrl ? (
                <img alt="" draggable={false} src={headerCoverUrl} />
              ) : (
                <Disc3 size={26} />
              )}
            </div>
            <div
              className="lyrics-track-copy"
              title="右键复制歌曲信息"
              onContextMenu={handleTrackInfoContextMenu}
            >
              <span className="lyrics-kicker">Now Playing</span>
              <h1 title="右键复制歌名" onContextMenu={handleTrackTitleContextMenu}>
                {title}
              </h1>
              {album ? (
                <button
                  className="lyrics-track-album"
                  type="button"
                  aria-disabled={!currentTrack || isAlbumNavigating}
                  title={`Open ${album} / 右键复制专辑名`}
                  onClick={handleOpenAlbumDetail}
                  onContextMenu={handleTrackAlbumContextMenu}
                >
                  {album}
                </button>
              ) : null}
              <p
                className="lyrics-track-artist"
                title="右键复制艺人名"
                onContextMenu={handleTrackArtistContextMenu}
              >
                {artist}
              </p>
              <div className="lyrics-track-status">
                <PlayerStatusChips status={audioStatus} state={state} track={currentTrack} />
              </div>
            </div>
          </header>
        )}

        {shouldHideLyricsInMv ? null : lyricsControls}
        {lyricsDisplaySettings.lyricsEnabled && !shouldHideLyricsInMv ? (
          <LyricsView
            durationMs={displayDurationSeconds * 1000}
            hideEmptyState={lyricsDisplaySettings.lyricsEmptyStateHidden && !isCurrentAirPlayReceiverTrack}
            emptyLabel={isLyricsLoading || isCandidateLoading ? "正在加载歌词..." : undefined}
            lyrics={effectiveDisplayedLyrics}
            positionMs={
              lyricsPositionSeconds * 1000 +
              (lyricsDisplaySettings.lyricsTimelineCorrectionEnabled !== false ? lyricsDisplaySettings.lyricsGlobalSyncOffsetMs : 0)
            }
            playbackRate={mvAudioClock.playbackRate}
            playbackState={seekPreviewSeconds === null ? mvAudioClock.state : "paused"}
            positionUpdatedAtMs={seekPreviewSeconds === null ? mvAudioClock.updatedAtMs : performance.now()}
            wordHighlightEnabled={lyricsDisplaySettings.lyricsWordHighlightEnabled !== false && lyricsDisplaySettings.lowLoadPlaybackModeEnabled !== true}
            highFrequencyUpdatesEnabled={lyricsDisplaySettings.lowLoadPlaybackModeEnabled !== true}
            textDirection={lyricsDisplaySettings.lyricsTextDirection ?? "horizontal"}
            showRomanization={isLyricsDisplaySettingsReady && lyricsDisplaySettings.lyricsRomanizationEnabled}
            preferKanaPronunciation={lyricsDisplaySettings.lyricsUtatenKanaEnabled === true}
            showTranslation={isLyricsDisplaySettingsReady && lyricsDisplaySettings.lyricsTranslationEnabled}
            onContextMenu={handleLyricsContextMenu}
            onSeek={(timeMs) => void handleLyricSeek(timeMs)}
          />
        ) : null}
      </section>

      {lyricsViewMode === "mv" ? (
        <LyricsMvPanelBoundary resetKey={`${trackId ?? "none"}:${title}:${artist}`}>
          <MvPanel
            trackId={trackId ?? null}
            currentTrack={currentTrack}
            streamingTarget={streamingTarget}
            title={title}
            artist={artist}
            coverUrl={coverUrl}
            hideFallbackTrackInfo={
              lyricsDisplaySettings.lyricsHeaderHidden &&
              lyricsDisplaySettings.lyricsMvAutoShowTrackInfoDisabled
            }
            smartReadableColorsEnabled={lyricsSmartReadableEnabled}
            isAudioPlaying={state === "playing"}
            audioClock={mvAudioClock}
          />
        </LyricsMvPanelBoundary>
      ) : (
        <section
          className="lyrics-mv-panel"
          aria-label="MV"
          data-lyrics-readability={shouldEnhanceLyricsReadability ? "true" : undefined}
          data-mv-enabled="false"
          data-view-mode="lyrics"
        />
      )}

      {error ? (
        <div className="lyrics-error" role="status">
          {error}
        </div>
      ) : null}
      {copyNotice ? (
        <div className="lyrics-copy-notice" role="status" aria-live="polite">
          <span className="lyrics-copy-notice-mark" aria-hidden="true">
            <Check size={13} strokeWidth={2.5} />
          </span>
          <span className="lyrics-copy-notice-text">{copyNotice}</span>
        </div>
      ) : null}
    </div>
  );
};
