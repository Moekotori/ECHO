import type { AppSettings } from '../../shared/types/appSettings';
import { getAppSettings } from '../app/appSettings';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { markStartupStage } from '../diagnostics/StartupDiagnostics';
import { getEchoLinkService } from './EchoLinkService';

export const syncEchoLinkBasicIntegrationFromSettings = async (
  settings: AppSettings = getAppSettings(),
): Promise<void> => {
  try {
    const status = await getEchoLinkService().setBasicEnabled(settings.echoLinkBasicEnabled === true);
    markStartupStage(status.running ? 'echo-link-basic:ready' : 'echo-link-basic:stopped', {
      enabled: status.enabled,
      host: status.host,
      port: status.port,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markStartupStage('echo-link-basic:failed', { error: message });
    getCrashReportService().getLogger()?.warn('main', '[EchoLinkBasic] failed to update LAN gateway', {
      error: message,
    });
  }
};

export const initializeEchoLinkBasicIntegration = async (): Promise<void> => {
  markStartupStage('echo-link-basic:init');
  await syncEchoLinkBasicIntegrationFromSettings();
};
