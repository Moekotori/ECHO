import type { AudioStatus } from '../../../shared/types/audio';
import type { DiscordPresenceService, DiscordPresenceStatus } from './DiscordPresenceService';

export class NoopDiscordPresenceService implements DiscordPresenceService {
  constructor(private enabled = false) {}

  initialize(): void {
    // no-op
  }

  dispose(): void {
    // no-op
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  updateFromAudioStatus(status: AudioStatus): void {
    void status;
    // no-op
  }

  clearActivity(): void {
    // no-op
  }

  getStatus(): DiscordPresenceStatus {
    return {
      enabled: this.enabled,
      available: false,
      connected: false,
      lastError: null,
      lastUpdatedAt: null,
    };
  }
}
