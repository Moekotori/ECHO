import { useEffect, useMemo, useState } from 'react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { LibraryTrack } from '../../../shared/types/library';
import type { LyricLine, LyricsTrackSnapshotRequest, TrackLyrics } from '../../../shared/types/lyrics';
import { isInstrumentalPlaceholderLine } from '../../../shared/utils/instrumentalLyrics';
import { useThrottledSharedPlaybackStatus } from '../../stores/playbackStatusStore';

const positiveNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const formatSampleRate = (value: number | null | undefined): string | null => {
  const sampleRate = positiveNumber(value);
  if (!sampleRate) return null;
  if (sampleRate >= 1_000_000) {
    const mhz = sampleRate / 1_000_000;
    return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(2)} MHz`;
  }
  if (sampleRate >= 1_000) {
    const khz = sampleRate / 1_000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }
  return `${Math.round(sampleRate)} Hz`;
};

const formatBitrate = (value: number | null | undefined): string | null => {
  const bitrate = positiveNumber(value);
  if (!bitrate) return null;
  return bitrate >= 1_000_000 ? `${(bitrate / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bitrate / 1_000)} kbps`;
};

const statusMatchesTrack = (
  status: Pick<AudioStatus, 'currentFilePath' | 'currentTrackId'> | null | undefined,
  track: LibraryTrack,
): boolean => Boolean(
  (status?.currentTrackId && status.currentTrackId === track.id) ||
  (status?.currentFilePath && status.currentFilePath === track.path),
);

export const buildHomeNowAudioFacts = (track: LibraryTrack, audioStatus: AudioStatus | null): string[] => {
  const matchedStatus = statusMatchesTrack(audioStatus, track) ? audioStatus : null;
  const bitDepth = positiveNumber(matchedStatus?.bitDepth) ?? positiveNumber(track.bitDepth);
  const channels = positiveNumber(matchedStatus?.channels);
  return [
    matchedStatus?.codec?.trim().toUpperCase() || track.codec?.trim().toUpperCase() || null,
    bitDepth ? `${bitDepth} bit` : null,
    formatSampleRate(matchedStatus?.fileSampleRate ?? track.sampleRate),
    formatBitrate(matchedStatus?.bitrate ?? track.bitrate),
    channels ? `${channels} ch` : null,
  ].filter((value): value is string => Boolean(value));
};

const meaningfulLines = (lines: LyricLine[]): LyricLine[] => lines.filter((line) => line.text.trim().length > 0);

export type HomeNowLyricContext = {
  activeIndex: number;
  previous: string | null;
  current: string | null;
  next: string | null;
};

const lineTextAt = (lines: LyricLine[], index: number): string | null =>
  index >= 0 && index < lines.length ? lines[index]?.text.trim() ?? null : null;

export const resolveHomeNowLyricContext = (
  lyrics: TrackLyrics | null,
  positionMs: number,
  durationMs: number,
): HomeNowLyricContext | null => {
  if (!lyrics || lyrics.kind === 'empty' || lyrics.kind === 'instrumental') return null;
  if (lyrics.lines.some((line) => isInstrumentalPlaceholderLine(line.text))) return null;
  const lines = meaningfulLines(lyrics.lines);
  if (lines.length === 0) return null;

  let activeIndex: number;
  if (lyrics.kind === 'plain') {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      activeIndex = 0;
    } else {
      const progress = Math.max(0, Math.min(0.999999, positionMs / durationMs));
      activeIndex = Math.min(lines.length - 1, Math.floor(progress * lines.length));
    }
  } else {
    const adjustedPositionMs = Math.max(0, positionMs + lyrics.offsetMs);
    activeIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const timeMs = lines[index]?.timeMs;
      if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > adjustedPositionMs) continue;
      if (activeIndex < 0 || timeMs >= (lines[activeIndex]?.timeMs ?? 0)) activeIndex = index;
    }
  }

  return {
    activeIndex,
    previous: lineTextAt(lines, activeIndex - 1),
    current: lineTextAt(lines, activeIndex),
    next: lineTextAt(lines, activeIndex + 1),
  };
};

export const resolveHomeNowLyricLine = (
  lyrics: TrackLyrics | null,
  positionMs: number,
  durationMs: number,
): string | null => resolveHomeNowLyricContext(lyrics, positionMs, durationMs)?.current ?? null;

type HomeNowDetailsProps = {
  isCurrentTrack: boolean;
  track: LibraryTrack | null;
};

export const HomeNowDetails = ({ isCurrentTrack, track }: HomeNowDetailsProps): JSX.Element | null => {
  const playbackSnapshot = useThrottledSharedPlaybackStatus(250);
  const [lyrics, setLyrics] = useState<TrackLyrics | null>(null);

  const trackId = track?.id ?? null;
  const shouldUseSnapshot = track?.mediaType === 'streaming' || track?.isTemporary === true;
  const snapshotRequest = useMemo<LyricsTrackSnapshotRequest | null>(() => {
    if (!track || !shouldUseSnapshot) return null;
    return {
      trackId: track.id,
      title: track.title,
      artist: track.artist || track.albumArtist,
      album: track.album,
      albumArtist: track.albumArtist,
      durationSeconds: positiveNumber(track.duration),
      mediaType: track.mediaType,
      sourceId: track.sourceId,
      stableKey: track.stableKey ?? track.id,
    };
  }, [shouldUseSnapshot, track]);

  useEffect(() => {
    let cancelled = false;
    const lyricsApi = window.echo?.lyrics;
    setLyrics(null);
    if (!isCurrentTrack || !trackId || !lyricsApi) return undefined;

    const loadLyrics = async (): Promise<void> => {
      try {
        const nextLyrics = snapshotRequest && lyricsApi.getForSnapshot
          ? await lyricsApi.getForSnapshot(snapshotRequest)
          : await lyricsApi.getForTrack(trackId);
        if (!cancelled) setLyrics(nextLyrics);
      } catch {
        if (!cancelled) setLyrics(null);
      }
    };

    void loadLyrics();
    const unsubscribe = lyricsApi.onChanged?.((changedTrackId) => {
      if (changedTrackId === trackId) void loadLyrics();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isCurrentTrack, snapshotRequest, trackId]);

  if (!track) return null;

  const audioStatus = statusMatchesTrack(playbackSnapshot.audioStatus, track) ? playbackSnapshot.audioStatus : null;
  const playbackStatusMatches = Boolean(
    (playbackSnapshot.playbackStatus?.currentTrackId && playbackSnapshot.playbackStatus.currentTrackId === track.id) ||
    (playbackSnapshot.playbackStatus?.filePath && playbackSnapshot.playbackStatus.filePath === track.path),
  );
  const positionMs = audioStatus
    ? Math.max(0, audioStatus.positionSeconds) * 1_000
    : playbackStatusMatches
      ? Math.max(0, playbackSnapshot.playbackStatus?.positionMs ?? 0)
      : 0;
  const durationMs = positiveNumber(audioStatus?.durationSeconds)
    ? (audioStatus?.durationSeconds ?? 0) * 1_000
    : positiveNumber(track.duration)
      ? track.duration * 1_000
      : 0;
  const audioFacts = buildHomeNowAudioFacts(track, audioStatus);
  const lyricContext = isCurrentTrack ? resolveHomeNowLyricContext(lyrics, positionMs, durationMs) : null;

  return (
    <div className="home-now-details">
      {audioFacts.length > 0 ? (
        <div className="home-now-audio-facts">
          {audioFacts.map((fact) => <span key={fact}>{fact}</span>)}
        </div>
      ) : null}
      {lyricContext ? (
        <div className="home-now-lyric" aria-live="polite">
          <svg className="home-now-lyric-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path className="home-now-lyric-icon-context" d="M2 3.5h7M2 12.5h5" />
            <path className="home-now-lyric-icon-current" d="M2 8h12" />
          </svg>
          <div className="home-now-lyric-lines" key={`${lyrics?.id ?? 'lyrics'}:${lyricContext.activeIndex}`}>
            <span className="home-now-lyric-line" data-role="previous" aria-hidden="true">
              {lyricContext.previous ?? ''}
            </span>
            <span className="home-now-lyric-line" data-role="current">
              {lyricContext.current ?? '♪'}
            </span>
            <span className="home-now-lyric-line" data-role="next" aria-hidden="true">
              {lyricContext.next ?? ''}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
