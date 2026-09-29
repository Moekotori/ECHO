import { EventEmitter } from 'node:events';
import type { SmtcCommand, SmtcDiagnostics, SmtcEnabledActions, SmtcPlaybackState, SmtcService, SmtcTrackMetadata } from './SmtcService';

export class NoopSmtcService implements SmtcService {
  private readonly commands = new EventEmitter();
  private initialized = false;

  initialize(): void {
    this.initialized = true;
    // Non-Windows platforms and unavailable bridges intentionally do nothing.
  }

  dispose(): void {
    this.initialized = false;
    this.commands.removeAllListeners();
  }

  setPlaybackState(state: SmtcPlaybackState): void {
    void state;
    // no-op
  }

  setMetadata(metadata: SmtcTrackMetadata): void {
    void metadata;
    // no-op
  }

  setTimeline(positionSeconds: number, durationSeconds: number): void {
    void positionSeconds;
    void durationSeconds;
    // no-op
  }

  setEnabledActions(actions: SmtcEnabledActions): void {
    void actions;
    // no-op
  }

  onCommand(handler: (command: SmtcCommand) => void): () => void {
    this.commands.on('command', handler);
    return () => this.commands.off('command', handler);
  }

  getDiagnostics(): SmtcDiagnostics {
    return {
      enabled: false,
      platform: process.platform,
      hostState: process.platform === 'win32' ? 'disabled' : 'unsupported',
      initialized: this.initialized,
      hostPath: null,
      lastMetadataAt: null,
      lastMetadataTrackId: null,
      lastMetadataTitle: null,
      lastMetadataArtist: null,
      lastPlaybackState: null,
      lastPlaybackStateAt: null,
      lastTimelineAt: null,
      lastTimelinePositionSeconds: null,
      lastTimelineDurationSeconds: null,
      enabledActions: null,
      lastCommand: null,
      lastCommandAt: null,
      lastError: null,
      recentErrors: [],
      recoveryInFlight: false,
      recoveryAttemptsInWindow: 0,
      canRecover: false,
      lastRecoveryAt: null,
      lyricsEnabled: false,
    };
  }
}
