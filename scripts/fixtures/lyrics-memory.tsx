import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LyricsPage } from '../../src/renderer/pages/LyricsPage';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../src/renderer/stores/PlaybackQueueProvider';

// Synthetic data only: no user library, network, audio device or Electron profile.
const track = {
  id: 'memory-track', path: 'memory.flac', title: 'Memory probe', artist: 'ECHO',
  album: 'Probe', albumArtist: 'ECHO', duration: 180, codec: 'flac',
  sampleRate: 48000, bitDepth: 24, bitrate: 1440000, coverThumb: null,
  coverId: null, fieldSources: {},
};
const lines = Array.from({ length: 74 }, (_, index) => ({
  timeMs: index * 2400, text: `Memory probe line ${index}`,
  words: [
    { text: 'Memory ', startMs: index * 2400, endMs: index * 2400 + 600 },
    { text: 'probe ', startMs: index * 2400 + 600, endMs: index * 2400 + 1200 },
    { text: `line ${index}`, startMs: index * 2400 + 1200, endMs: index * 2400 + 2300 },
  ],
}));
const lyrics = {
  id: 'memory-lyrics', trackId: track.id, provider: 'local', kind: 'synced',
  title: track.title, lines, offsetMs: 0, score: 1,
};
const audioStatus = (positionSeconds = 0) => ({
  host: 'ready', state: 'playing', currentTrackId: track.id, currentFilePath: track.path,
  durationSeconds: 180, positionSeconds, playbackRate: 1, outputMode: 'shared',
  outputBackend: 'wasapi-shared', volume: 1, channels: 2, warnings: [], error: null,
});
const handlers = new Set<(status: ReturnType<typeof audioStatus>) => void>();
const counters = { subscriptions: 0, lyricSubscriptions: 0, lyricReads: 0 };
const readLyrics = async () => { counters.lyricReads += 1; return lyrics; };
window.echo = {
  app: { getSettings: async () => ({
    lyricsEnabled: true, lyricsNetworkEnabled: false, lyricsAutoSearch: false,
    lyricsSmartAlignmentEnabled: true, lyricsOffsetControlsEnabled: true,
    lyricsTimelineCorrectionEnabled: true, lyricsGlobalSyncOffsetMs: 0,
    lyricsBackgroundMode: 'theme', lyricsSmartReadableColorsEnabled: false,
    lyricsColor: '#314054', lyricsCoverOpacityPercent: 100,
    lyricsCoverBlurPx: 10, lyricsCoverBrightnessPercent: 100,
    lyricsFontSizePx: 40, lyricsSecondaryFontSizePx: 22,
  }) },
  playback: { getStatus: async () => ({
    state: 'playing', currentTrackId: track.id, filePath: track.path, positionMs: 0, durationMs: 180000,
  }) },
  audio: {
    getStatus: async () => audioStatus(),
    onStatus: (handler) => {
      counters.subscriptions += 1;
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
  },
  library: { resolveLyricsBackgroundCover: async () => null },
  lyrics: {
    getForTrack: readLyrics, getForSnapshot: readLyrics, getStoredCandidates: async () => [],
    onChanged: () => { counters.lyricSubscriptions += 1; return () => {}; },
    setOffset: async () => null,
  },
} as unknown as Window['echo'];

function Seed() {
  const { replaceQueue, setCurrentTrackId } = usePlaybackQueue();
  useEffect(() => {
    replaceQueue([track as Parameters<typeof replaceQueue>[0][number]]);
    setCurrentTrackId(track.id);
  }, [replaceQueue, setCurrentTrackId]);
  return <LyricsPage />;
}
const root = createRoot(document.getElementById('root')!);
root.render(<PlaybackQueueProvider><Seed /></PlaybackQueueProvider>);
Object.assign(window, {
  tick: (index: number) => flushSync(() => {
    handlers.forEach((handler) => handler(audioStatus((index % 720) / 4)));
  }),
  probeStats: () => ({ ...counters, activeSubscriptions: handlers.size }),
  unmountProbe: () => flushSync(() => root.unmount()),
});
