import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCopy, Crosshair, Music2, Play, RotateCw, Volume2, X } from 'lucide-react';
import { BPM_CONFIDENCE_THRESHOLD } from '../../../shared/constants/audioAnalysis';
import type { BpmAnalysisJobStatus, LibraryTrack } from '../../../shared/types/library';
import { formatOsuBookmarksLine, formatOsuTimingBlock, formatOsuTimingPoint, getBeatLengthMs, getMeasureLengthMs } from '../../utils/osuTiming';

type OsuTimingPanelProps = {
  track: LibraryTrack | null;
  isOpen: boolean;
  onClose: () => void;
  onTrackUpdated?: (track: LibraryTrack) => void;
};

const analysisPollMs = 1000;
const offsetSteps = [-10, -5, -1, 1, 5, 10];
const bpmMultipliers = [0.5, 1, 2] as const;
const meterOptions = [3, 4, 6] as const;
const beatSnapDivisors = [1, 2, 3, 4, 6, 8] as const;
const bookmarkMeasureCount = 16;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const isFinitePositive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const analysisStatusLabels: Record<NonNullable<LibraryTrack['analysisStatus']>, string> = {
  none: '未分析',
  pending: '等待中',
  analyzing: '分析中',
  complete: '已完成',
  low_confidence: '低置信度',
  error: '分析失败',
};

const formatMs = (value: number): string => `${Math.round(value)} ms`;

const formatBpm = (value: number | null | undefined): string =>
  isFinitePositive(value) ? `${Math.round(value * 100) / 100} BPM` : '未知';

const formatConfidence = (value: number | null | undefined): string =>
  isFiniteNumber(value) ? `${Math.round(value * 100)}%` : '未知';

const getStatusLabel = (status: LibraryTrack['analysisStatus'] | undefined): string =>
  status ? (analysisStatusLabels[status] ?? status) : '未分析';

const formatPreciseMs = (value: number): string => `${Number(value.toFixed(3))} ms`;

const parseNumberInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveNumberInput = (value: string): number | null => {
  const parsed = parseNumberInput(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const stopClickTimer = (timeoutRef: MutableRefObject<number | null>, intervalRef: MutableRefObject<number | null>): void => {
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  if (intervalRef.current !== null) {
    window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }
};

export const OsuTimingPanel = ({ track, isOpen, onClose, onTrackUpdated }: OsuTimingPanelProps): JSX.Element | null => {
  const [activeTrack, setActiveTrack] = useState<LibraryTrack | null>(track);
  const [offsetAdjustmentMs, setOffsetAdjustmentMs] = useState(0);
  const [bpmMultiplier, setBpmMultiplier] = useState<(typeof bpmMultipliers)[number]>(1);
  const [manualBpmText, setManualBpmText] = useState('');
  const [manualOffsetText, setManualOffsetText] = useState('');
  const [meter, setMeter] = useState<(typeof meterOptions)[number]>(4);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<BpmAnalysisJobStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'line' | 'block' | 'bookmarks' | null>(null);
  const [clickPreviewRunning, setClickPreviewRunning] = useState(false);
  const analysisRunRef = useRef(0);
  const clickTimeoutRef = useRef<number | null>(null);
  const clickIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onTrackUpdatedRef = useRef(onTrackUpdated);

  useEffect(() => {
    onTrackUpdatedRef.current = onTrackUpdated;
  }, [onTrackUpdated]);

  useEffect(() => {
    setActiveTrack(track);
    setOffsetAdjustmentMs(0);
    setBpmMultiplier(1);
    setManualBpmText('');
    setManualOffsetText('');
    setMeter(4);
    setAnalysisJob(null);
    setMessage(null);
    setError(null);
    setCopied(null);
    setClickPreviewRunning(false);
    stopClickTimer(clickTimeoutRef, clickIntervalRef);
  }, [track]);

  useEffect(() => {
    if (!isOpen || !track?.id) {
      return;
    }

    let cancelled = false;
    const library = window.echo?.library;

    if (!library?.getTrack) {
      return;
    }

    void library
      .getTrack(track.id)
      .then((freshTrack) => {
        if (!cancelled && freshTrack) {
          setActiveTrack(freshTrack);
          onTrackUpdatedRef.current?.(freshTrack);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isOpen, track?.id]);

  useEffect(() => {
    if (!isOpen) {
      stopClickTimer(clickTimeoutRef, clickIntervalRef);
      setClickPreviewRunning(false);
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      analysisRunRef.current += 1;
      stopClickTimer(clickTimeoutRef, clickIntervalRef);
      void audioContextRef.current?.close().catch(() => undefined);
    },
    [],
  );

  const rawBpm = activeTrack?.bpm ?? null;
  const manualBpm = parsePositiveNumberInput(manualBpmText);
  const hasManualBpmText = manualBpmText.trim().length > 0;
  const hasManualBpm = hasManualBpmText && manualBpm !== null;
  const invalidManualBpm = hasManualBpmText && manualBpm === null;
  const sourceBpm = invalidManualBpm ? null : hasManualBpm ? manualBpm : rawBpm;
  const bpm = isFinitePositive(sourceBpm) ? sourceBpm * bpmMultiplier : null;
  const rawBeatOffsetMs = activeTrack?.beatOffsetMs;
  const hasDetectedOffset = isFiniteNumber(rawBeatOffsetMs);
  const detectedOffsetMs = hasDetectedOffset ? rawBeatOffsetMs : 0;
  const manualOffsetMs = parseNumberInput(manualOffsetText);
  const hasManualOffsetText = manualOffsetText.trim().length > 0;
  const hasManualOffset = hasManualOffsetText && manualOffsetMs !== null;
  const invalidManualOffset = hasManualOffsetText && manualOffsetMs === null;
  const sourceOffsetMs = hasManualOffset ? manualOffsetMs : detectedOffsetMs;
  const adjustedOffsetMs = sourceOffsetMs + offsetAdjustmentMs;
  const missingBpm = !isFinitePositive(bpm);
  const missingOffset = !hasDetectedOffset && !hasManualOffset;
  const lowConfidence =
    activeTrack?.analysisStatus === 'low_confidence' ||
    (isFiniteNumber(activeTrack?.bpmConfidence) && activeTrack.bpmConfidence < BPM_CONFIDENCE_THRESHOLD);
  const bpmSourceLabel = invalidManualBpm ? '输入无效' : hasManualBpm ? '手动' : '检测';
  const offsetSourceLabel = invalidManualOffset ? '输入无效' : hasManualOffset ? '手动' : hasDetectedOffset ? '检测' : '默认 0';
  const beatLengthMs = isFinitePositive(bpm) ? getBeatLengthMs(bpm) : null;
  const measureLengthMs = isFinitePositive(bpm) ? getMeasureLengthMs(bpm, meter) : null;
  const snapRows = beatLengthMs
    ? beatSnapDivisors.map((divisor) => ({
        label: divisor === 1 ? '1/1' : `1/${divisor}`,
        valueMs: beatLengthMs / divisor,
      }))
    : [];

  const timingLine = useMemo(() => {
    if (!isFinitePositive(bpm) || invalidManualOffset) {
      return null;
    }

    try {
      return formatOsuTimingPoint({ bpm, offsetMs: adjustedOffsetMs, meter });
    } catch {
      return null;
    }
  }, [adjustedOffsetMs, bpm, invalidManualOffset, meter]);

  const timingBlock = useMemo(() => {
    if (!isFinitePositive(bpm) || invalidManualOffset) {
      return null;
    }

    try {
      return formatOsuTimingBlock({ bpm, offsetMs: adjustedOffsetMs, meter });
    } catch {
      return null;
    }
  }, [adjustedOffsetMs, bpm, invalidManualOffset, meter]);

  const bookmarksLine = useMemo(() => {
    if (!isFinitePositive(bpm) || invalidManualOffset) {
      return null;
    }

    try {
      return formatOsuBookmarksLine({ bpm, offsetMs: adjustedOffsetMs, meter, measureCount: bookmarkMeasureCount });
    } catch {
      return null;
    }
  }, [adjustedOffsetMs, bpm, invalidManualOffset, meter]);

  const stopClickPreview = (): void => {
    stopClickTimer(clickTimeoutRef, clickIntervalRef);
    setClickPreviewRunning(false);
  };

  const playClick = (): void => {
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      setError('当前环境不支持节拍器预览。');
      stopClickPreview();
      return;
    }

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 1100;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.045);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.05);
  };

  const startClickPreview = (showError = true): void => {
    if (!isFinitePositive(bpm)) {
      if (showError) {
        setError('需要先有 BPM，才能启动节拍器预览。');
      }
      return;
    }

    stopClickTimer(clickTimeoutRef, clickIntervalRef);
    setError(null);
    const beatLength = getBeatLengthMs(bpm);
    const firstDelay = ((adjustedOffsetMs % beatLength) + beatLength) % beatLength;

    clickTimeoutRef.current = window.setTimeout(() => {
      playClick();
      clickIntervalRef.current = window.setInterval(playClick, beatLength);
    }, firstDelay);
    setClickPreviewRunning(true);
  };

  useEffect(() => {
    if (clickPreviewRunning) {
      startClickPreview(false);
    }
    // Re-arm the metronome whenever the user changes the timing grid.
  }, [adjustedOffsetMs, bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayTrack = async (): Promise<void> => {
    if (!activeTrack) {
      return;
    }

    const playback = window.echo?.playback;
    if (!playback?.playLocalFile) {
      setError('桌面桥接不可用，请在 ECHO Next 桌面端播放歌曲。');
      return;
    }

    try {
      setError(null);
      await playback.playLocalFile({
        filePath: activeTrack.path,
        trackId: activeTrack.id,
        probe: {
          durationSeconds: activeTrack.duration,
          fileSampleRate: activeTrack.sampleRate,
          channels: 2,
          codec: activeTrack.codec,
          bitDepth: activeTrack.bitDepth,
          bitrate: activeTrack.bitrate,
          bpm,
          bpmConfidence: activeTrack.bpmConfidence,
          beatOffsetMs: adjustedOffsetMs,
        },
      });
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : String(playError));
    }
  };

  const handleSeekToOffset = async (): Promise<void> => {
    const playback = window.echo?.playback;
    if (!playback?.seek) {
      setError('桌面桥接不可用，不能跳到校准点。');
      return;
    }

    try {
      setError(null);
      await playback.seek(Math.max(0, adjustedOffsetMs) / 1000);
      startClickPreview();
    } catch (seekError) {
      setError(seekError instanceof Error ? seekError.message : String(seekError));
    }
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!activeTrack) {
      return;
    }

    const library = window.echo?.library;
    if (!library?.startBpmAnalysis || !library.getBpmAnalysisStatus || !library.getTrack) {
      setError('桌面桥接不可用，请在 ECHO Next 桌面端分析 BPM。');
      return;
    }

    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    setIsAnalyzing(true);
    setError(null);
    setMessage(null);
    setAnalysisJob(null);

    try {
      const job = await library.startBpmAnalysis({ trackIds: [activeTrack.id], force: true });
      setAnalysisJob(job);

      let latest = job;
      while (analysisRunRef.current === runId && latest.status !== 'completed' && latest.status !== 'failed') {
        await sleep(analysisPollMs);
        latest = await library.getBpmAnalysisStatus(job.id);
        setAnalysisJob(latest);
      }

      const updated = await library.getTrack(activeTrack.id);
      if (updated) {
        setActiveTrack(updated);
        setBpmMultiplier(1);
        onTrackUpdated?.(updated);
        setMessage(updated.bpm ? '分析结果已更新。听节拍器微调 offset 后，再复制 timing。' : '分析结束，但没有拿到可用 BPM。');
      }

      if (latest.status === 'failed') {
        setError(latest.errors[0] ?? 'BPM 分析失败。');
      }
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
    } finally {
      if (analysisRunRef.current === runId) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleCopy = async (kind: 'line' | 'block' | 'bookmarks'): Promise<void> => {
    const text = kind === 'line' ? timingLine : kind === 'block' ? timingBlock : bookmarksLine;
    if (!text) {
      setError('还没有可复制的 osu! timing。');
      return;
    }

    try {
      setError(null);
      await window.navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  };

  if (!activeTrack) {
    return null;
  }

  const panel = (
    <div className="osu-timing-root" data-open={isOpen}>
      <button className="osu-timing-scrim" type="button" aria-label="关闭 osu! Timing" onClick={onClose} />
      <aside className="osu-timing-panel" role="dialog" aria-modal="true" aria-label="osu! Timing">
        <div className="osu-timing-scroll">
          <header className="osu-timing-header">
            <div>
              <Music2 size={23} />
              <div>
                <h2>osu! Timing</h2>
                <p>{activeTrack.title}</p>
              </div>
            </div>
            <button className="osu-timing-close" type="button" aria-label="关闭 osu! Timing" onClick={onClose}>
              <X size={22} />
            </button>
          </header>

          <section className="osu-timing-track-card" aria-label="当前歌曲">
            <strong>{activeTrack.title}</strong>
            <span>{activeTrack.artist}</span>
            <em title={activeTrack.path}>{activeTrack.path}</em>
          </section>

          <section className="osu-timing-section osu-timing-guide" aria-label="使用步骤">
            <div className="osu-timing-section-heading">
              <h3>怎么用</h3>
              <span>不会写入文件</span>
            </div>
            <ol>
              <li>先播放歌曲，再启动节拍器；检测不准时可手动输入 BPM 或 offset。</li>
              <li>鼓点和节拍器不齐时，用 +/-1、5、10 ms 微调，或切换拍号生成小节网格。</li>
              <li>确认后复制 TimingPoints、Bookmarks，放到 osu! editor 里再听一遍。</li>
            </ol>
          </section>

          <section className="osu-timing-section" aria-label="Timing 分析">
            <div className="osu-timing-section-heading">
              <h3>Timing</h3>
              <span>{getStatusLabel(activeTrack.analysisStatus)}</span>
            </div>
            <div className="osu-timing-metrics">
              <span>
                <em>检测 BPM</em>
                <strong>{formatBpm(rawBpm)}</strong>
              </span>
              <span>
                <em>使用 BPM</em>
                <strong>{formatBpm(bpm)}</strong>
              </span>
              <span>
                <em>BPM 来源</em>
                <strong>{bpmSourceLabel}</strong>
              </span>
              <span>
                <em>置信度</em>
                <strong>{formatConfidence(activeTrack.bpmConfidence)}</strong>
              </span>
              <span>
                <em>最终 offset</em>
                <strong>{formatMs(adjustedOffsetMs)}</strong>
              </span>
              <span>
                <em>offset 来源</em>
                <strong>{offsetSourceLabel}</strong>
              </span>
            </div>
            <div className="osu-timing-field-grid">
              <label className="osu-timing-field">
                <span>手动 BPM</span>
                <input
                  aria-label="手动 BPM"
                  inputMode="decimal"
                  min="1"
                  placeholder={isFinitePositive(rawBpm) ? String(Math.round(rawBpm * 1000) / 1000) : '例如 180'}
                  step="0.001"
                  type="number"
                  value={manualBpmText}
                  onChange={(event) => setManualBpmText(event.currentTarget.value)}
                />
              </label>
              <label className="osu-timing-field">
                <span>手动 offset</span>
                <input
                  aria-label="手动 offset"
                  inputMode="decimal"
                  placeholder={hasDetectedOffset ? String(Math.round(detectedOffsetMs)) : '0'}
                  step="1"
                  type="number"
                  value={manualOffsetText}
                  onChange={(event) => setManualOffsetText(event.currentTarget.value)}
                />
              </label>
            </div>
            <div className="osu-timing-control-stack">
              <div>
                <span>BPM 修正</span>
                <div className="osu-timing-segmented" aria-label="BPM 修正">
                  {bpmMultipliers.map((multiplier) => (
                    <button
                      key={multiplier}
                      type="button"
                      className={bpmMultiplier === multiplier ? 'is-active' : undefined}
                      disabled={!isFinitePositive(sourceBpm)}
                      onClick={() => setBpmMultiplier(multiplier)}
                    >
                      {multiplier === 0.5 ? '半速' : multiplier === 2 ? '倍速' : '原速'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span>拍号</span>
                <div className="osu-timing-segmented" aria-label="拍号">
                  {meterOptions.map((option) => (
                    <button key={option} type="button" className={meter === option ? 'is-active' : undefined} onClick={() => setMeter(option)}>
                      {option}/4
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {hasManualBpmText || hasManualOffsetText ? (
              <div className="osu-timing-button-row osu-timing-button-row--compact">
                <button type="button" onClick={() => setManualBpmText('')}>
                  清空 BPM
                </button>
                <button type="button" onClick={() => setManualOffsetText('')}>
                  清空 offset
                </button>
              </div>
            ) : null}
            {invalidManualBpm ? <p className="osu-timing-warning">手动 BPM 需要是大于 0 的数字。</p> : null}
            {invalidManualOffset ? <p className="osu-timing-warning">手动 offset 需要是有效数字，单位是 ms。</p> : null}
            {missingBpm ? <p className="osu-timing-note">还没有 BPM。点击“重新分析此曲”后会尝试读取 BPM 和 offset。</p> : null}
            {!missingBpm && missingOffset ? <p className="osu-timing-note">已有 BPM，但没有检测到 offset。当前先按 0ms 生成 timing，请用节拍器手动校准。</p> : null}
            {lowConfidence ? <p className="osu-timing-warning">BPM 置信度偏低。可复制，但建议在 osu! editor 里再听一遍确认。</p> : null}
            {analysisJob ? (
              <p className="osu-timing-note">
                分析进度：{analysisJob.processedTracks}/{analysisJob.totalTracks}
              </p>
            ) : null}
          </section>

          <section className="osu-timing-section" aria-label="Offset 微调">
            <div className="osu-timing-section-heading">
              <h3>Offset 微调</h3>
              <span>{offsetAdjustmentMs === 0 ? '未手动调整' : formatMs(offsetAdjustmentMs)}</span>
            </div>
            <div className="osu-timing-step-row">
              {offsetSteps.map((step) => (
                <button key={step} type="button" onClick={() => setOffsetAdjustmentMs((current) => current + step)}>
                  {step > 0 ? `+${step}` : step} ms
                </button>
              ))}
              <button type="button" onClick={() => setOffsetAdjustmentMs(0)}>
                重置
              </button>
            </div>
            <p className="osu-timing-note">
              检测 offset：{hasDetectedOffset ? formatMs(detectedOffsetMs) : '未检测'}。节拍器开启时，微调会立即重排下一拍。
            </p>
          </section>

          <section className="osu-timing-section" aria-label="制谱计算">
            <div className="osu-timing-section-heading">
              <h3>制谱计算</h3>
              <span>{isFinitePositive(bpm) ? `${meter}/4 · ${bookmarkMeasureCount} 小节` : '需要 BPM'}</span>
            </div>
            <div className="osu-timing-metrics osu-timing-metrics--compact">
              <span>
                <em>一拍</em>
                <strong>{beatLengthMs ? formatPreciseMs(beatLengthMs) : '未知'}</strong>
              </span>
              <span>
                <em>一小节</em>
                <strong>{measureLengthMs ? formatPreciseMs(measureLengthMs) : '未知'}</strong>
              </span>
            </div>
            <div className="osu-timing-snap-grid" aria-label="Beat snap 长度">
              {snapRows.length > 0 ? (
                snapRows.map((row) => (
                  <span key={row.label}>
                    <em>{row.label}</em>
                    <strong>{formatPreciseMs(row.valueMs)}</strong>
                  </span>
                ))
              ) : (
                <p className="osu-timing-note">输入 BPM 后显示 beat snap 长度。</p>
              )}
            </div>
          </section>

          <section className="osu-timing-section" aria-label="预览控制">
            <div className="osu-timing-button-row">
              <button type="button" onClick={() => void handlePlayTrack()}>
                <Play size={17} />
                播放歌曲
              </button>
              <button type="button" disabled={!isFinitePositive(bpm)} onClick={clickPreviewRunning ? stopClickPreview : () => startClickPreview()}>
                <Volume2 size={17} />
                {clickPreviewRunning ? '停止节拍器' : '开始节拍器'}
              </button>
              <button type="button" disabled={!isFinitePositive(bpm)} onClick={() => void handleSeekToOffset()}>
                <Crosshair size={17} />
                试听校准点
              </button>
              <button type="button" disabled={isAnalyzing} onClick={() => void handleAnalyze()}>
                <RotateCw className={isAnalyzing ? 'spinning-icon' : undefined} size={17} />
                {isAnalyzing ? '分析中...' : '重新分析此曲'}
              </button>
            </div>
          </section>

          <section className="osu-timing-section" aria-label="osu timing point">
            <div className="osu-timing-section-heading">
              <h3>[TimingPoints]</h3>
              <span>{timingLine ? '可复制' : '需要 BPM'}</span>
            </div>
            <pre className="osu-timing-output">{timingLine ?? '点击“重新分析此曲”生成 timing。'}</pre>
            <pre className="osu-timing-output osu-timing-output--secondary">{bookmarksLine ?? '输入 BPM 后生成 osu! editor Bookmarks。'}</pre>
            <div className="osu-timing-copy-row">
              <button className="osu-timing-copy" type="button" disabled={!timingLine} onClick={() => void handleCopy('line')}>
                <ClipboardCopy size={18} />
                {copied === 'line' ? '已复制' : '复制 timing 行'}
              </button>
              <button className="osu-timing-copy osu-timing-copy--secondary" type="button" disabled={!timingBlock} onClick={() => void handleCopy('block')}>
                <ClipboardCopy size={18} />
                {copied === 'block' ? '已复制' : '复制完整块'}
              </button>
              <button className="osu-timing-copy osu-timing-copy--secondary" type="button" disabled={!bookmarksLine} onClick={() => void handleCopy('bookmarks')}>
                <ClipboardCopy size={18} />
                {copied === 'bookmarks' ? '已复制' : '复制书签行'}
              </button>
            </div>
          </section>

          {message ? <p className="osu-timing-message">{message}</p> : null}
          {error ? <p className="osu-timing-error">{error}</p> : null}
        </div>
      </aside>
    </div>
  );

  return createPortal(panel, document.body);
};
