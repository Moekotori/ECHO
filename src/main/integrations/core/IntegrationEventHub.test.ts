import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { IntegrationPlaybackSnapshotV1 } from '../../../shared/types/integrationPlatform';
import { IntegrationEventHub } from './IntegrationEventHub';

class FakeAudioSession extends EventEmitter {
  constructor(public status: AudioStatus) {
    super();
  }

  getStatus(): AudioStatus {
    return this.status;
  }

  update(patch: Partial<AudioStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }
}

const createStatus = (): AudioStatus => ({
  state: 'paused',
  currentFilePath: 'D:\\Music\\private.flac',
  currentTrackId: 'track-1',
  currentTrackTitle: 'Song',
  currentTrackArtist: 'Artist',
  currentTrackAlbum: 'Album',
  currentTrackAlbumArtist: 'Album Artist',
  currentTrackCoverUrl: 'https://example.test/cover.jpg',
  positionSeconds: 1,
  durationSeconds: 120,
  volume: 0.6,
  outputMode: 'shared',
  outputDeviceName: 'Speakers',
  outputBackend: 'wasapi',
} as AudioStatus);

afterEach(() => {
  vi.useRealTimers();
});

describe('IntegrationEventHub', () => {
  it('publishes a sanitized initial snapshot and removes its audio listener on dispose', () => {
    const audio = new FakeAudioSession(createStatus());
    const hub = new IntegrationEventHub({ audioSession: audio, now: () => 1_000 });
    const events: unknown[] = [];

    const unsubscribe = hub.subscribe((event) => events.push(event));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'snapshot',
      snapshot: {
        state: 'paused',
        track: { id: 'track-1', title: 'Song', artist: 'Artist' },
        positionMs: 1_000,
        durationMs: 120_000,
        volume: 0.6,
        output: { mode: 'shared', deviceName: 'Speakers', backend: 'wasapi' },
      },
    });
    expect(JSON.stringify(events[0])).not.toContain('private.flac');
    expect(JSON.stringify(events[0])).not.toContain('currentFilePath');
    expect(audio.listenerCount('status')).toBe(1);

    unsubscribe();
    hub.dispose();
    expect(audio.listenerCount('status')).toBe(0);
  });

  it('refreshes the authoritative audio status when a remote client connects', () => {
    const audio = new FakeAudioSession({
      ...createStatus(),
      state: 'idle',
      currentTrackId: null,
      currentTrackTitle: null,
      currentTrackArtist: null,
      currentTrackAlbum: null,
      currentTrackAlbumArtist: null,
      currentTrackCoverUrl: null,
    });
    const hub = new IntegrationEventHub({ audioSession: audio, now: () => 1_000 });

    hub.start();
    audio.status = {
      ...createStatus(),
      state: 'playing',
      currentTrackId: 'track-connected',
      currentTrackTitle: 'Already Playing',
      currentTrackArtist: 'Current Artist',
      positionSeconds: 36,
    };

    const snapshot = hub.getSnapshot();
    const events: Array<{ snapshot: IntegrationPlaybackSnapshotV1 }> = [];
    hub.subscribe((event) => events.push(event));

    expect(snapshot).toMatchObject({
      state: 'playing',
      track: {
        id: 'track-connected',
        title: 'Already Playing',
        artist: 'Current Artist',
      },
      positionMs: 36_000,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.snapshot).toMatchObject({
      state: 'playing',
      track: {
        id: 'track-connected',
        title: 'Already Playing',
      },
      positionMs: 36_000,
    });
    hub.dispose();
  });

  it('emits semantic changes immediately and coalesces progress to the latest snapshot', () => {
    vi.useFakeTimers();
    let now = 0;
    const audio = new FakeAudioSession(createStatus());
    const hub = new IntegrationEventHub({ audioSession: audio, now: () => now, progressIntervalMs: 500 });
    const events: Array<{ type: string; snapshot: { positionMs: number } }> = [];
    hub.subscribe((event) => events.push(event));

    audio.update({ state: 'playing' });
    expect(events.at(-1)?.type).toBe('playback.state.changed');

    audio.update({ positionSeconds: 2 });
    expect(events.at(-1)).toMatchObject({ type: 'playback.progress.changed', snapshot: { positionMs: 2_000 } });

    now = 100;
    audio.update({ positionSeconds: 3 });
    now = 200;
    audio.update({ positionSeconds: 4 });
    expect(events.at(-1)?.snapshot.positionMs).toBe(2_000);

    now = 500;
    vi.advanceTimersByTime(400);
    expect(events.at(-1)).toMatchObject({ type: 'playback.progress.changed', snapshot: { positionMs: 4_000 } });
    hub.dispose();
  });
});
