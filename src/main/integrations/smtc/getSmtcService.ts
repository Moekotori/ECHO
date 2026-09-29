import { getAppSettings } from '../../app/appSettings';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { NoopSmtcService } from './NoopSmtcService';
import type { SmtcService } from './SmtcService';
import { WindowsSmtcService } from './WindowsSmtcService';

let smtcService: SmtcService | null = null;

const createLogger = () => ({
  info: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.info('main', message, payload);
  },
  warn: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.warn('main', message, payload);
    console.warn(message, payload ?? '');
  },
});

const isSmtcEnabled = (): boolean => {
  try {
    return getAppSettings().smtcEnabled !== false;
  } catch {
    return true;
  }
};

export const createSmtcService = (platform = process.platform): SmtcService => {
  if (platform !== 'win32' || !isSmtcEnabled()) {
    return new NoopSmtcService();
  }

  try {
    return new WindowsSmtcService(createLogger());
  } catch (error) {
    createLogger().warn('[SMTC] Failed to create Windows SMTC service; using no-op fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NoopSmtcService();
  }
};

export const getSmtcService = (): SmtcService => {
  smtcService ??= createSmtcService();
  return smtcService;
};

export const disposeAndResetSmtcService = async (): Promise<void> => {
  const service = smtcService;
  smtcService = null;
  await service?.dispose();
};

export const resetSmtcServiceForTests = (): void => {
  void disposeAndResetSmtcService();
};
