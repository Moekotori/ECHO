import type { LyricLine } from '../../shared/types/lyrics';
import type { SmtcLyricsProgress } from '../../shared/types/smtc';
import type { AudioStatus } from '../../shared/types/audio';
import { getAudioSession } from '../audio/AudioSession';
import { getLyricsService } from './LyricsService';
import { getAppSettings } from '../app/appSettings';

// Minimal lyrics state tracked per track in the main process.

type TrackLyricsState = {
  kind: 'empty' | 'synced' | 'plain';
  lines: LyricLine[];
  offsetMs: number;
};

// Active line helpers; keep this aligned with LyricsView.tsx behavior.

const getActiveLyricIndex = (lines: LyricLine[], positionMs: number, offsetMs: number): number => {
  if (lines.length === 0) {
    return -1;
  }

  const adjusted = Math.max(0, positionMs + offsetMs);

  // Binary search
  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const timeMs = lines[mid].timeMs;

    if (timeMs < 0 || timeMs <= adjusted) {
      if (timeMs >= 0) {
        activeIndex = mid;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
};

const getEstimatedPlainLyricIndex = (
  lines: LyricLine[],
  positionMs: number,
  durationMs: number | null | undefined,
): number => {
  if (lines.length === 0 || !durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) {
    return lines.length > 0 ? 0 : -1;
  }

  const progress = Math.max(0, Math.min(0.999999, positionMs / durationMs));
  return Math.max(0, Math.min(lines.length - 1, Math.floor(progress * lines.length)));
};

const emptyLyrics: TrackLyricsState = { kind: 'empty', lines: [], offsetMs: 0 };

// Tracker state.

let lastTrackId: string | null = null;
let lastLyricsProgressKey: string | null = null;
let pendingLoadToken = 0;
let cachedLyrics: TrackLyricsState = emptyLyrics;
let lastComputedProgress: SmtcLyricsProgress | null = null;

/** Get the current lyrics progress computed by the tracker (main-process side). */
export const getCurrentLyricsProgress = (): SmtcLyricsProgress | null => lastComputedProgress;

const lyricsProgressKey = (progress: SmtcLyricsProgress | null): string =>
  progress !== null && progress.lineText
    ? `${progress.trackId ?? ''}|${progress.lineIndex ?? ''}|${progress.lineStartMs ?? ''}|${progress.lineText}`
    : '';

const updateLastComputedProgress = (progress: SmtcLyricsProgress | null): void => {
  lastComputedProgress = progress;
};

const computeLyricsProgress = (
  status: AudioStatus,
  lyrics: TrackLyricsState,
): SmtcLyricsProgress | null => {
  if (lyrics.kind === 'empty' || lyrics.lines.length === 0) {
    return null;
  }

  const settings = getAppSettings();
  if (!settings.lyricsEnabled) {
    return null;
  }

  const correctionEnabled = settings.lyricsTimelineCorrectionEnabled !== false;
  const globalOffsetMs = settings.lyricsGlobalSyncOffsetMs ?? 0;
  const positionMs = status.positionSeconds * 1000 + (correctionEnabled ? globalOffsetMs : 0);

  let lineIndex: number;
  if (lyrics.kind === 'synced') {
    lineIndex = getActiveLyricIndex(lyrics.lines, positionMs, lyrics.offsetMs);
  } else if (lyrics.kind === 'plain') {
    lineIndex = getEstimatedPlainLyricIndex(lyrics.lines, positionMs, status.durationSeconds * 1000);
  } else {
    return null;
  }

  const line = lineIndex >= 0 ? lyrics.lines[lineIndex] : null;
  const lineText = line?.text?.replace(/\s+/gu, ' ').trim() ?? '';
  if (!lineText) {
    return null;
  }

  return {
    trackId: status.currentTrackId ?? null,
    lineText,
    lineIndex,
    lineCount: lyrics.lines.length,
    lineStartMs: line?.timeMs ?? null,
    positionSeconds: status.positionSeconds,
    durationSeconds: status.durationSeconds,
  };
};

const loadLyricsForTrack = async (trackId: string, token: number): Promise<TrackLyricsState> => {
  try {
    const lyricsService = getLyricsService();
    const trackLyrics = await lyricsService.getLyricsForTrack(trackId);

    if (token !== pendingLoadToken) {
      return emptyLyrics; // Superseded by a newer track change
    }

    if (!trackLyrics || trackLyrics.kind === 'empty' || trackLyrics.kind === 'instrumental') {
      return emptyLyrics;
    }

    if (trackLyrics.lines.length === 0) {
      return emptyLyrics;
    }

    return {
      kind: trackLyrics.kind,
      lines: trackLyrics.lines,
      offsetMs: trackLyrics.offsetMs ?? 0,
    };
  } catch {
    return emptyLyrics;
  }
};

const handleAudioStatus = (status: AudioStatus): void => {
  const trackId = status.currentTrackId;
  const isPlaying = status.state === 'playing';

  if (!isPlaying || !trackId) {
    return;
  }

  // Track changed; reload lyrics.
  if (trackId !== lastTrackId) {
    lastTrackId = trackId;
    lastLyricsProgressKey = '';
    cachedLyrics = emptyLyrics;
    // Clear stale lyrics progress so consumers don't show previous track's lyrics
    if (lastComputedProgress) {
      updateLastComputedProgress(null);
    }
    pendingLoadToken += 1;

    const token = pendingLoadToken;
    void loadLyricsForTrack(trackId, token).then((lyrics) => {
      if (token === pendingLoadToken && trackId === lastTrackId) {
        cachedLyrics = lyrics;
        // Immediately compute and broadcast initial progress after load
        const progress = computeLyricsProgress(status, lyrics);
        if (progress) {
          lastLyricsProgressKey = lyricsProgressKey(progress);
          updateLastComputedProgress(progress);
        }
      }
    });
    return;
  }

  // Same track; compute current line from position.
  if (cachedLyrics.kind === 'empty') {
    return;
  }

  const progress = computeLyricsProgress(status, cachedLyrics);
  const nextKey = progress ? lyricsProgressKey(progress) : '';
  if (nextKey === lastLyricsProgressKey) {
    return;
  }

  lastLyricsProgressKey = nextKey;
  updateLastComputedProgress(progress);
};

let started = false;

export const startLyricsProgressTracking = (): void => {
  if (started) {
    return;
  }
  started = true;

  // Reset state when playback stops or track is cleared
  getAudioSession().on('status', handleAudioStatus);
};
