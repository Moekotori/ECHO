import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { markStartupStage } from '../../diagnostics/StartupDiagnostics';
import { WallpaperEngineBridgeService } from './WallpaperEngineBridgeService';

let defaultWallpaperEngineBridgeService: WallpaperEngineBridgeService | null = null;

export const getWallpaperEngineBridgeService = (): WallpaperEngineBridgeService => {
  if (!defaultWallpaperEngineBridgeService) {
    defaultWallpaperEngineBridgeService = new WallpaperEngineBridgeService();
  }
  return defaultWallpaperEngineBridgeService;
};

export const initializeWallpaperEngineBridgeIntegration = async (): Promise<void> => {
  markStartupStage('wallpaper-engine-bridge:start');
  try {
    const status = await getWallpaperEngineBridgeService().start();
    markStartupStage('wallpaper-engine-bridge:ready', { url: status.url });
  } catch (error) {
    markStartupStage('wallpaper-engine-bridge:failed', { error: error instanceof Error ? error.message : String(error) });
    getCrashReportService().getLogger()?.warn('main', '[WallpaperEngineBridge] failed to start localhost bridge', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const disposeWallpaperEngineBridgeIntegration = async (): Promise<void> => {
  if (!defaultWallpaperEngineBridgeService) {
    return;
  }

  await defaultWallpaperEngineBridgeService.stop();
};
