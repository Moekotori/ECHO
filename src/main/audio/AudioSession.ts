import { EventEmitter } from 'node:events';
import type { AudioStatus } from '../../shared/types/audio';
import type { PlaybackMemory } from './PlaybackMemoryStore';
import { getDaemonClient } from './DaemonClient';

// ---------------------------------------------------------------------------
// Error Recovery Handler
// ---------------------------------------------------------------------------

export type AudioErrorRecoveryHandler = (error: Error, status: AudioStatus) => boolean;

// ---------------------------------------------------------------------------
// Audio Session — thin wrapper around echo-audio-daemon via DaemonClient
// ---------------------------------------------------------------------------

export class AudioSession extends EventEmitter {
  private status: AudioStatus = { state: 'idle' } as AudioStatus;
  private audioErrorRecoveryHandler: AudioErrorRecoveryHandler | null = null;

  constructor() {
    super();
    this.setMaxListeners(64);

    const client = getDaemonClient();
    client.on('event.status', (params: unknown) => {
      const s = params as AudioStatus;
      this.status = s;
      this.emit('status', s);
    });
  }

  // ----- state query -----

  getStatus(): AudioStatus {
    return this.status;
  }

  getDiagnostics(): Record<string, unknown> {
    return {};
  }

  // ----- playback control -----

  async play(): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('play');
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async pause(): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('pause');
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  stop(): AudioStatus {
    getDaemonClient().command('stop').catch(() => undefined);
    return this.status;
  }

  async seek(seconds: number): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('seek', { seconds });
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async playLocalFile(request: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('playLocalFile', request);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async prepareLocalFile(request: Record<string, unknown>): Promise<void> {
    try {
      await getDaemonClient().command('prepareLocalFile', request);
    } catch { /* daemon not ready */ }
  }

  async playPcmStream(request: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('playPcmStream', request);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  async restorePlaybackMemory(memory: PlaybackMemory): Promise<void> {
    try {
      await getDaemonClient().command('restorePlaybackMemory', memory);
    } catch { /* daemon not ready */ }
  }

  async setOutput(settings: Record<string, unknown>): Promise<AudioStatus> {
    try {
      const result = await getDaemonClient().command('setOutput', settings);
      if (result) this.status = result as AudioStatus;
    } catch { /* daemon not ready */ }
    return this.status;
  }

  setAudioErrorRecoveryHandler(handler: AudioErrorRecoveryHandler | null): void {
    this.audioErrorRecoveryHandler = handler;
  }

  dispose(): void {
    this.removeAllListeners();
  }

  async disposeGracefully(reason = 'app-quit'): Promise<void> {
    try {
      await getDaemonClient().command('shutdown', { reason });
    } catch { /* daemon not running */ }
    this.dispose();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultAudioSession: AudioSession | null = null;

export const getAudioSession = (): AudioSession => {
  defaultAudioSession ??= new AudioSession();
  return defaultAudioSession;
};

export const disposeDefaultAudioSessionGracefully = async (reason = 'app-quit'): Promise<void> => {
  if (!defaultAudioSession) return;
  const session = defaultAudioSession;
  defaultAudioSession = null;
  await session.disposeGracefully(reason);
};
