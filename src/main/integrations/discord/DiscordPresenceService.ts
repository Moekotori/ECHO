import type { AudioStatus } from '../../../shared/types/audio';
import type { DiscordPresenceStatus, DiscordPresenceTrack } from '../../../shared/types/discordPresence';

export type { DiscordPresenceStatus, DiscordPresenceTrack };

export interface DiscordPresenceService {
  initialize(): Promise<void> | void;
  dispose(): Promise<void> | void;
  setEnabled(enabled: boolean): void;
  updateFromAudioStatus(status: AudioStatus): Promise<void> | void;
  clearActivity(): Promise<void> | void;
  getStatus(): DiscordPresenceStatus;
}
