import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { Disc3, FastForward, Rewind, RotateCcw, TimerReset } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { LyricsState } from './lyricsTypes';
import type { LyricsSmartAlignmentAnchor, LyricsSmartAlignmentEvaluation, LyricsSmartAlignmentOutputMode } from './lyricsSmartAlignment';
import { getActiveLyricIndex } from './LyricsView';

type LyricsSmartAlignmentAutoState = {
  trackId: string;
  previousOffsetMs: number;
  offsetMs: number;
};

type TimingControlProps = {
  trackId: string | null;
  lyrics: LyricsState;
  lyricsDisplaySettings: Pick<AppSettings, 'lyricsOffsetControlsEnabled' | 'lyricsTimelineCorrectionEnabled' | 'lyricsGlobalSyncOffsetMs' | 'lyricsSmartAlignmentEnabled'>;
  isLyricsOffsetSaving: boolean;
  handleLyricsOffsetChange: (offsetMs: number, options?: { source?: 'manual' | 'smart-auto' | 'smart-undo'; previousOffsetMs?: number }) => Promise<void>;
};
type OffsetControlProps = TimingControlProps & {
  displayedLyrics: LyricsState;
  lyricsPositionSeconds: number;
};
type SmartAlignmentControlProps = TimingControlProps & {
  audioStatus: AudioStatus | null;
  smartAlignmentEvaluation: LyricsSmartAlignmentEvaluation | null;
  smartAlignmentAutoState: LyricsSmartAlignmentAutoState | null;
  isSmartAlignmentSessionActive: boolean;
  smartAlignmentAnchors: LyricsSmartAlignmentAnchor[];
  setSmartAlignmentAnchors: Dispatch<SetStateAction<LyricsSmartAlignmentAnchor[]>>;
  setIsSmartAlignmentSessionActive: Dispatch<SetStateAction<boolean>>;
  setSmartAlignmentAutoState: Dispatch<SetStateAction<LyricsSmartAlignmentAutoState | null>>;
  smartAlignmentAutoAppliedKeyRef: MutableRefObject<string | null>;
};
const isSmartAlignmentOutputMode = (mode: AudioStatus['outputMode'] | null | undefined): mode is LyricsSmartAlignmentOutputMode =>
  mode === 'shared' || mode === 'exclusive' || mode === 'system';

const formatOffset = (offsetMs: number): string => {
  if (offsetMs === 0) {
    return "0ms";
  }

  return `${offsetMs > 0 ? "+" : ""}${offsetMs}ms`;
};

const smartAlignmentModeLabel = (outputMode: LyricsSmartAlignmentOutputMode): string => {
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

// Own button closures here so cached controls cannot retain the LyricsPage render scope.
export const LyricsOffsetControls = ({
  trackId,
  lyrics,
  lyricsDisplaySettings,
  isLyricsOffsetSaving,
  handleLyricsOffsetChange,
  displayedLyrics,
  lyricsPositionSeconds
}: OffsetControlProps): JSX.Element | null => {
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
};

// Own button closures here so cached controls cannot retain the LyricsPage render scope.
export const LyricsSmartAlignmentControls = ({
  trackId,
  lyrics,
  lyricsDisplaySettings,
  isLyricsOffsetSaving,
  handleLyricsOffsetChange,
  audioStatus,
  smartAlignmentEvaluation,
  smartAlignmentAutoState,
  isSmartAlignmentSessionActive,
  smartAlignmentAnchors,
  setSmartAlignmentAnchors,
  setIsSmartAlignmentSessionActive,
  setSmartAlignmentAutoState,
  smartAlignmentAutoAppliedKeyRef
}: SmartAlignmentControlProps): JSX.Element | null => {
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
};
