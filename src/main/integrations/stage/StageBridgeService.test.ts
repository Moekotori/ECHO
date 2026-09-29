import { get } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { IntegrationEventEnvelopeV1, IntegrationPlaybackSnapshotV1 } from '../../../shared/types/integrationPlatform';
import type { TrackLyrics } from '../../../shared/types/lyrics';
import type { StageBridgeSnapshot } from '../../../shared/types/stage';
import { StageBridgeService, createStageBridgeSnapshot } from './StageBridgeService';
import { getStageBridgeClientCount, resetStageBridgeRuntimeForTests } from './StageBridgeRuntime';

class FakeEventHub {
  private snapshot: IntegrationPlaybackSnapshotV1;
  private readonly listeners = new Set<(event: IntegrationEventEnvelopeV1) => void>();

  constructor(snapshot: IntegrationPlaybackSnapshotV1) {
    this.snapshot = snapshot;
  }

  getSnapshot(): IntegrationPlaybackSnapshotV1 {
    return this.snapshot;
  }

  subscribe(listener: (event: IntegrationEventEnvelopeV1) => void): () => void {
    this.listeners.add(listener);
    listener({ version: 1, id: 'initial', type: 'snapshot', occurredAt: this.snapshot.observedAt, snapshot: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  setSnapshot(snapshot: IntegrationPlaybackSnapshotV1): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener({ version: 1, id: String(snapshot.revision), type: 'playback.track.changed', occurredAt: snapshot.observedAt, snapshot });
    }
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

const createPlayback = (patch: Partial<IntegrationPlaybackSnapshotV1> = {}): IntegrationPlaybackSnapshotV1 => ({
  version: 1,
  revision: 1,
  observedAt: '2026-06-30T00:00:00.000Z',
  state: 'playing',
  track: {
    id: 'track-1',
    title: 'Signal',
    artist: 'ECHO',
    album: 'Bridge',
    albumArtist: 'ECHO',
    artworkUrl: 'echo-cover://track-1',
  },
  durationMs: 180_000,
  positionMs: 42_000,
  volume: 1,
  output: {
    mode: 'exclusive',
    deviceName: 'TEAC USB DAC',
    backend: 'wasapi-exclusive',
  },
  ...patch,
});

const telemetry = {
  visualSpectrum: Array.from({ length: 32 }, (_, index) => index / 31),
  visualEnergy: 0.72,
  visualTransient: 0.35,
};

const lyrics: TrackLyrics = {
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'local',
  kind: 'synced',
  title: 'Signal',
  artist: 'ECHO',
  album: 'Bridge',
  durationSeconds: 180,
  offsetMs: 0,
  score: 100,
  cachedAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  lines: [
    { timeMs: 30_000, text: 'First line' },
    { timeMs: 42_000, text: 'Current line', translation: '当前行' },
    { timeMs: 48_000, text: 'Next line' },
  ],
};

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as T;
};

const wait = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

describe('StageBridgeService', () => {
  let service: StageBridgeService | null = null;

  afterEach(async () => {
    await service?.stop();
    service = null;
    resetStageBridgeRuntimeForTests();
  });

  it('builds the v1 Stage response from a semantic snapshot and adapter data', async () => {
    const snapshot = await createStageBridgeSnapshot(createPlayback(), telemetry, () => ({
      getLyricsForTrack: async () => lyrics,
    }));

    expect(snapshot).toMatchObject({
      version: 1,
      integration: 'stage',
      state: 'playing',
      track: {
        title: 'Signal',
        artist: 'ECHO',
        positionSeconds: 42,
      },
      lyrics: {
        kind: 'synced',
        current: {
          text: 'Current line',
          translation: '当前行',
        },
        next: {
          text: 'Next line',
        },
      },
      audio: {
        visualEnergy: 0.72,
        visualTransient: 0.35,
      },
    });
    expect(snapshot.audio.visualSpectrum).toHaveLength(32);
    expect(JSON.stringify(snapshot)).not.toContain('private.flac');
  });

  it('preserves the existing OBS and Stage API gates and response paths', async () => {
    const eventHub = new FakeEventHub(createPlayback());
    service = new StageBridgeService({
      port: 0,
      eventHub,
      telemetrySource: { read: () => telemetry },
      getLyrics: () => ({ getLyricsForTrack: async () => lyrics }),
    });
    let status = await service.configure({ obsEnabled: false, apiEnabled: false });
    expect(status.running).toBe(false);

    status = await service.configure({ obsEnabled: true, apiEnabled: false });
    expect(status.running).toBe(true);
    expect(status.obsUrl).toBe(`${status.url}/obs`);
    expect((await fetch(`${status.url}/obs`)).ok).toBe(true);
    expect((await fetch(`${status.url}/api/stage/status`)).status).toBe(403);

    status = await service.configure({ obsEnabled: true, apiEnabled: true });
    const snapshot = await readJson<StageBridgeSnapshot>(`${status.url}/api/stage/status`);
    expect(snapshot.lyrics.current?.text).toBe('Current line');
    expect(eventHub.subscriberCount).toBe(1);
  });

  it('refreshes read-only telemetry only while an SSE client exists and cleans up the EventHub subscription', async () => {
    const eventHub = new FakeEventHub(createPlayback());
    let telemetryReads = 0;
    service = new StageBridgeService({
      port: 0,
      eventHub,
      telemetrySource: {
        read: () => {
          telemetryReads += 1;
          return telemetry;
        },
      },
      getLyrics: () => ({ getLyricsForTrack: async () => lyrics }),
    });
    const status = await service.configure({ obsEnabled: false, apiEnabled: true });
    expect(telemetryReads).toBe(0);

    let request: ReturnType<typeof get>;
    await new Promise<void>((resolve, reject) => {
      request = get(`${status.url}/events`, (response) => {
        response.setEncoding('utf8');
        response.once('data', (chunk) => {
          try {
            expect(String(chunk)).toContain('event: snapshot');
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
    });

    expect(service.getServerStatus().eventClients).toBe(1);
    expect(getStageBridgeClientCount()).toBe(1);
    await wait(320);
    expect(telemetryReads).toBeGreaterThanOrEqual(2);

    request!.destroy();
    await wait(80);
    expect(service.getServerStatus().eventClients).toBe(0);
    expect(getStageBridgeClientCount()).toBe(0);
    const readsAfterDisconnect = telemetryReads;
    await wait(320);
    expect(telemetryReads).toBe(readsAfterDisconnect);

    await service.stop();
    expect(eventHub.subscriberCount).toBe(0);
    service = null;
  });
});
