import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';
import type { PersistedPlaybackSessionV1 } from '../../shared/types/playback';
import { PlaybackSessionStore } from './PlaybackSessionStore';

const sqliteMock = vi.hoisted(() => ({
  databases: new Map<string, { row: { version: number; payload_json: string; updated_at: string } | null }>(),
}));

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    private readonly state: { row: { version: number; payload_json: string; updated_at: string } | null };

    constructor(private readonly databasePath: string) {
      const existing = sqliteMock.databases.get(databasePath);
      this.state = existing ?? { row: null };
      sqliteMock.databases.set(databasePath, this.state);
    }

    pragma(): void {
      // No-op for the unit test fake.
    }

    exec(): void {
      // No-op for the unit test fake.
    }

    close(): void {
      // No-op for the unit test fake.
    }

    prepare(sql: string): { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown } {
      return {
        get: () => this.state.row,
        run: (...args: unknown[]) => {
          if (sql.includes('DELETE FROM playback_queue_session')) {
            this.state.row = null;
            return { changes: 1 };
          }

          if (sql.includes('UPDATE playback_queue_session SET payload_json')) {
            if (this.state.row) {
              this.state.row = {
                ...this.state.row,
                payload_json: String(args[0]),
              };
            }
            return { changes: this.state.row ? 1 : 0 };
          }

          this.state.row = {
            version: Number(args[1]),
            payload_json: String(args[2]),
            updated_at: String(args[3]),
          };
          return { changes: 1 };
        },
      };
    }
  }

  return { default: FakeDatabase };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
  },
}));

const tempRoots: string[] = [];

const makeTrack = (index: number): LibraryTrack => ({
  id: `track-${index}`,
  path: `D:\\Music\\track-${index}.flac`,
  title: `Track ${index}`,
  artist: `Artist ${index}`,
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const makeSession = (): PersistedPlaybackSessionV1 => {
  const track = makeTrack(1);
  const item = {
    queueId: 'queue-1',
    track,
    source: { type: 'manual' as const, label: 'Manual queue' },
    addedAt: '2026-05-21T00:00:00.000Z',
  };

  return {
    version: 1,
    items: [item],
    currentQueueId: item.queueId,
    currentTrackId: track.id,
    lastPlayedTrack: track,
    history: [],
    mode: {
      isShuffleEnabled: true,
      repeatMode: 'one',
      automixEnabled: true,
    },
    resume: null,
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
};

const makeStatus = (patch: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'paused',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  currentFilePath: 'D:\\Music\\track-1.flac',
  currentTrackId: 'track-1',
  positionSeconds: 42,
  durationSeconds: 120,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  channels: 2,
  codec: 'flac',
  bitDepth: 16,
  bitrate: 900000,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: 44100,
  sharedDeviceSampleRate: 44100,
  resampling: false,
  bitPerfectCandidate: true,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...patch,
});

const makeStore = (): { store: PlaybackSessionStore; databasePath: string } => {
  const root = mkdtempSync(join(tmpdir(), 'echo-playback-session-'));
  tempRoots.push(root);
  return {
    databasePath: join(root, 'session.sqlite'),
    store: new PlaybackSessionStore(join(root, 'session.sqlite'), {
      now: () => new Date('2026-05-21T01:02:03.000Z'),
    }),
  };
};

afterEach(() => {
  sqliteMock.databases.clear();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('PlaybackSessionStore', () => {
  it('saves and loads a queue session with playback mode', () => {
    const { store } = makeStore();

    store.save(makeSession());
    store.close();

    expect(store.load()).toMatchObject({
      items: [{ queueId: 'queue-1', track: { id: 'track-1' } }],
      currentQueueId: 'queue-1',
      currentTrackId: 'track-1',
      mode: {
        isShuffleEnabled: true,
        repeatMode: 'one',
        automixEnabled: true,
      },
    });
  });

  it('treats corrupt payload JSON as no active session', () => {
    const { databasePath, store } = makeStore();
    store.save(makeSession());
    store.close();

    const database = new Database(databasePath);
    database
      .prepare('UPDATE playback_queue_session SET payload_json = ? WHERE id = ?')
      .run('{bad json', 'active');
    database.close();

    expect(store.load()).toBeNull();
  });

  it('merges audio resume status without replacing queue contents', () => {
    const { store } = makeStore();
    store.save(makeSession());

    const saved = store.saveResumeFromAudioStatus(makeStatus());

    expect(saved).toMatchObject({
      items: [{ queueId: 'queue-1' }],
      resume: {
        queueId: 'queue-1',
        trackId: 'track-1',
        positionMs: 42000,
        durationMs: 120000,
        state: 'paused',
      },
    });
  });

  it('clears resume on stopped playback but keeps the queue', () => {
    const { store } = makeStore();
    store.saveResumeFromAudioStatus(makeStatus());
    store.save(makeSession());
    store.saveResumeFromAudioStatus(makeStatus());

    const saved = store.saveResumeFromAudioStatus(makeStatus({
      state: 'stopped',
      currentFilePath: null,
      currentTrackId: null,
      positionSeconds: 0,
    }));

    expect(saved?.items).toHaveLength(1);
    expect(saved?.resume).toBeNull();
  });
});
