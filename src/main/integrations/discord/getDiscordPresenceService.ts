import { getAppSettings, setAppSettings } from '../../app/appSettings';
import { getAudioSession } from '../../audio/AudioSession';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { NoopDiscordPresenceService } from './NoopDiscordPresenceService';
import type { DiscordPresenceService, DiscordPresenceStatus } from './DiscordPresenceService';
import { RpcDiscordPresenceService } from './RpcDiscordPresenceService';

let discordPresenceService: DiscordPresenceService | null = null;

const createLogger = () => ({
  info: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.info('main', message, payload);
  },
  warn: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.warn('main', message, payload);
    console.warn(message, payload ?? '');
  },
});

const isDiscordPresenceEnabled = (): boolean => {
  try {
    return getAppSettings().discordRichPresenceEnabled === true;
  } catch {
    return false;
  }
};

export const createDiscordPresenceService = (enabled = isDiscordPresenceEnabled()): DiscordPresenceService => {
  if (!enabled) {
    return new NoopDiscordPresenceService(false);
  }

  try {
    return new RpcDiscordPresenceService({ enabled, logger: createLogger() });
  } catch (error) {
    createLogger().warn('[DiscordPresence] Failed to create RPC service; using no-op fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NoopDiscordPresenceService(enabled);
  }
};

export const getDiscordPresenceService = (): DiscordPresenceService => {
  discordPresenceService ??= createDiscordPresenceService();
  return discordPresenceService;
};

export const setDiscordPresenceEnabled = async (enabled: boolean): Promise<DiscordPresenceStatus> => {
  setAppSettings({ discordRichPresenceEnabled: enabled });
  if (!enabled) {
    await discordPresenceService?.clearActivity();
  }
  await discordPresenceService?.dispose();
  discordPresenceService = createDiscordPresenceService(enabled);
  discordPresenceService.setEnabled(enabled);

  if (enabled) {
    await discordPresenceService.initialize();
    await discordPresenceService.updateFromAudioStatus(getAudioSession().getStatus());
  }

  return discordPresenceService.getStatus();
};

export const resetDiscordPresenceServiceForTests = (): void => {
  void discordPresenceService?.dispose();
  discordPresenceService = null;
};
