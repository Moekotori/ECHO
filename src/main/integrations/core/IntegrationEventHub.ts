import type { AudioStatus } from '../../../shared/types/audio';
import type {
  IntegrationEventEnvelopeV1,
  IntegrationEventType,
  IntegrationPlaybackSnapshotV1,
  IntegrationTrackSnapshot,
} from '../../../shared/types/integrationPlatform';
import { getAudioSession } from '../../audioPublicApi';

type AudioStatusSource = {
  getStatus: () => AudioStatus;
  on: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
  off: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
};

type IntegrationEventListener = (event: IntegrationEventEnvelopeV1) => void;

export type IntegrationEventHubOptions = {
  audioSession?: AudioStatusSource;
  now?: () => number;
  progressIntervalMs?: number;
};

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const createTrackSnapshot = (status: AudioStatus): IntegrationTrackSnapshot | null => {
  const track = {
    id: status.currentTrackId ?? null,
    title: status.currentTrackTitle ?? null,
    artist: status.currentTrackArtist ?? null,
    album: status.currentTrackAlbum ?? null,
    albumArtist: status.currentTrackAlbumArtist ?? null,
    artworkUrl: status.currentTrackCoverUrl ?? null,
  };

  return Object.values(track).some((value) => typeof value === 'string' && value.length > 0)
    ? track
    : null;
};

const sameTrack = (
  left: IntegrationTrackSnapshot | null,
  right: IntegrationTrackSnapshot | null,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameOutput = (
  left: IntegrationPlaybackSnapshotV1['output'],
  right: IntegrationPlaybackSnapshotV1['output'],
): boolean =>
  left.mode === right.mode &&
  left.deviceName === right.deviceName &&
  left.backend === right.backend;

export class IntegrationEventHub {
  private readonly audioSession: AudioStatusSource;
  private readonly now: () => number;
  private readonly progressIntervalMs: number;
  private readonly listeners = new Set<IntegrationEventListener>();
  private started = false;
  private snapshotRevision = 0;
  private eventSequence = 0;
  private snapshot: IntegrationPlaybackSnapshotV1 | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProgressEventAt = Number.NEGATIVE_INFINITY;

  constructor(options: IntegrationEventHubOptions = {}) {
    this.audioSession = options.audioSession ?? getAudioSession();
    this.now = options.now ?? Date.now;
    this.progressIntervalMs = options.progressIntervalMs ?? 500;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.snapshot = this.toSnapshot(this.audioSession.getStatus());
    this.audioSession.on('status', this.handleAudioStatus);
  }

  getSnapshot(): IntegrationPlaybackSnapshotV1 {
    this.start();
    this.refreshSnapshot();
    return { ...this.snapshot!, track: this.snapshot!.track ? { ...this.snapshot!.track } : null, output: { ...this.snapshot!.output } };
  }

  subscribe(listener: IntegrationEventListener): () => void {
    this.start();
    this.refreshSnapshot();
    this.listeners.add(listener);
    listener(this.createEnvelope('snapshot', this.snapshot!));
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.started) {
      this.audioSession.off('status', this.handleAudioStatus);
    }
    this.started = false;
    this.listeners.clear();
    this.snapshot = null;
    this.snapshotRevision = 0;
    this.lastProgressEventAt = Number.NEGATIVE_INFINITY;
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private readonly handleAudioStatus = (status: AudioStatus): void => {
    const previous = this.snapshot;
    const next = this.toSnapshot(status);
    this.snapshot = next;

    if (!previous) {
      this.publish('snapshot', next);
      return;
    }

    const immediateTypes: IntegrationEventType[] = [];
    if (previous.state !== next.state) {
      immediateTypes.push('playback.state.changed');
    }
    if (!sameTrack(previous.track, next.track)) {
      immediateTypes.push('playback.track.changed');
    }
    if (previous.volume !== next.volume) {
      immediateTypes.push('playback.volume.changed');
    }
    if (!sameOutput(previous.output, next.output)) {
      immediateTypes.push('playback.output.changed');
    }

    if (immediateTypes.length > 0) {
      for (const type of immediateTypes) {
        this.publish(type, next);
      }
      return;
    }

    if (previous.positionMs !== next.positionMs || previous.durationMs !== next.durationMs) {
      this.scheduleProgress(next);
    }
  };

  private refreshSnapshot(): void {
    this.snapshot = this.toSnapshot(this.audioSession.getStatus());
  }

  private scheduleProgress(snapshot: IntegrationPlaybackSnapshotV1): void {
    const elapsed = this.now() - this.lastProgressEventAt;
    if (elapsed >= this.progressIntervalMs) {
      this.publish('playback.progress.changed', snapshot);
      this.lastProgressEventAt = this.now();
      return;
    }

    if (this.progressTimer) {
      return;
    }

    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      if (!this.snapshot) {
        return;
      }
      this.publish('playback.progress.changed', this.snapshot);
      this.lastProgressEventAt = this.now();
    }, Math.max(0, this.progressIntervalMs - elapsed));
    this.progressTimer.unref?.();
  }

  private publish(type: IntegrationEventType, snapshot: IntegrationPlaybackSnapshotV1): void {
    const event = this.createEnvelope(type, snapshot);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private createEnvelope(
    type: IntegrationEventType,
    snapshot: IntegrationPlaybackSnapshotV1,
  ): IntegrationEventEnvelopeV1 {
    return {
      version: 1,
      id: String(++this.eventSequence),
      type,
      occurredAt: new Date(this.now()).toISOString(),
      snapshot: {
        ...snapshot,
        track: snapshot.track ? { ...snapshot.track } : null,
        output: { ...snapshot.output },
      },
    };
  }

  private toSnapshot(status: AudioStatus): IntegrationPlaybackSnapshotV1 {
    return {
      version: 1,
      revision: ++this.snapshotRevision,
      observedAt: new Date(this.now()).toISOString(),
      state: status.state,
      track: createTrackSnapshot(status),
      positionMs: Math.round(finiteNonNegative(status.positionSeconds) * 1000),
      durationMs: Math.round(finiteNonNegative(status.durationSeconds) * 1000),
      volume: clampUnit(status.volume),
      output: {
        mode: status.outputMode,
        deviceName: status.outputDeviceName ?? null,
        backend: status.outputBackend ?? null,
      },
    };
  }
}

let defaultHub: IntegrationEventHub | null = null;

export const getIntegrationEventHub = (): IntegrationEventHub => {
  defaultHub ??= new IntegrationEventHub();
  defaultHub.start();
  return defaultHub;
};

export const disposeIntegrationEventHub = (): void => {
  defaultHub?.dispose();
  defaultHub = null;
};
