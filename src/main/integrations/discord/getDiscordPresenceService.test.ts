import { describe, expect, it, vi } from 'vitest';
import { NoopDiscordPresenceService } from './NoopDiscordPresenceService';
import { createDiscordPresenceService } from './getDiscordPresenceService';

vi.mock('../../app/appSettings', () => ({
  getAppSettings: () => ({ discordRichPresenceEnabled: false }),
  setAppSettings: vi.fn(),
}));

vi.mock('../../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: vi.fn(),
  }),
}));

vi.mock('../../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => null,
  }),
}));

describe('getDiscordPresenceService', () => {
  it('creates a no-op service when Discord Rich Presence is disabled', () => {
    expect(createDiscordPresenceService(false)).toBeInstanceOf(NoopDiscordPresenceService);
  });
});
