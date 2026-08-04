import { installPrivateOverlayRuntime } from '#echo-private-overlay-runtime';
import { markStartupStage } from '../diagnostics/StartupDiagnostics';

export const initializePrivateOverlay = (): void => {
  try {
    const result = installPrivateOverlayRuntime();
    markStartupStage('main:private-overlay-initialized', {
      installed: result.installed,
      source: result.source,
      features: result.features,
    });
  } catch (error) {
    markStartupStage('main:private-overlay-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
