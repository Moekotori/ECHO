import { recoverSmtcIntegration } from '../integrations/smtc/SmtcStatusSync';
import { getCrashReportService } from './CrashReportService';

export type RuntimeSelfHealSource = 'uncaughtException' | 'unhandledRejection';

const logInfo = (message: string, payload?: unknown): void => {
  try {
    getCrashReportService().getLogger()?.info('main', message, payload);
  } catch {
    console.info(message, payload ?? '');
  }
};

const logWarn = (message: string, payload?: unknown): void => {
  try {
    getCrashReportService().getLogger()?.warn('main', message, payload);
  } catch {
    console.warn(message, payload ?? '');
  }
};

export const recoverClosedHelperPipe = async (
  source: RuntimeSelfHealSource,
  error: Error,
): Promise<boolean> => {
  const code = (error as NodeJS.ErrnoException).code ?? null;
  logInfo('[self-heal] attempting closed helper pipe recovery', {
    source,
    message: error.message,
    code,
  });

  try {
    const recovered = await recoverSmtcIntegration(`closed-helper-pipe:${source}`);
    logInfo('[self-heal] closed helper pipe recovery finished', {
      source,
      recovered,
      action: 'recover-smtc-integration',
    });
    return recovered;
  } catch (recoveryError) {
    logWarn('[self-heal] closed helper pipe recovery failed', {
      source,
      message: error.message,
      code,
      error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
    });
    return false;
  }
};
