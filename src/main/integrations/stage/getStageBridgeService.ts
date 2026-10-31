import type { AppSettings } from '../../../shared/types/appSettings';
import { getAppSettings } from '../../app/appSettings';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { markStartupStage } from '../../diagnostics/StartupDiagnostics';
import { StageBridgeService } from './StageBridgeService';

let defaultStageBridgeService: StageBridgeService | null = null;

export const getStageBridgeService = (): StageBridgeService => {
  if (!defaultStageBridgeService) {
    defaultStageBridgeService = new StageBridgeService();
  }
  return defaultStageBridgeService;
};

const readEnabledState = (settings: Pick<AppSettings, 'obsBrowserSourceEnabled' | 'stageApiEnabled'>) => ({
  obsEnabled: settings.obsBrowserSourceEnabled === true,
  apiEnabled: settings.stageApiEnabled === true,
});

export const syncStageBridgeIntegrationFromSettings = async (settings: AppSettings = getAppSettings()): Promise<void> => {
  const enabledState = readEnabledState(settings);
  try {
    const status = await getStageBridgeService().configure(enabledState);
    markStartupStage(status.running ? 'stage-bridge:ready' : 'stage-bridge:stopped', {
      url: status.url,
      obsEnabled: enabledState.obsEnabled,
      apiEnabled: enabledState.apiEnabled,
    });
  } catch (error) {
    markStartupStage('stage-bridge:failed', { error: error instanceof Error ? error.message : String(error) });
    getCrashReportService().getLogger()?.warn('main', '[StageBridge] failed to update localhost bridge', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const initializeStageBridgeIntegration = async (): Promise<void> => {
  markStartupStage('stage-bridge:init');
  await syncStageBridgeIntegrationFromSettings();
};

export const disposeStageBridgeIntegration = async (): Promise<void> => {
  if (!defaultStageBridgeService) {
    return;
  }

  await defaultStageBridgeService.stop();
};
