import { app, dialog } from 'electron';
import { getCrashReportService } from './CrashReportService';

type CrashRecoveryReason = 'main' | 'renderer';

let recoveryDialogVisible = false;

const restartApp = (): void => {
  app.relaunch();
  app.exit(0);
};

export const showCrashRecoveryDialog = async (reason: CrashRecoveryReason, message: string): Promise<void> => {
  if (recoveryDialogVisible) {
    return;
  }

  recoveryDialogVisible = true;

  try {
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'ECHO crash report',
      message: reason === 'renderer' ? 'ECHO renderer process crashed.' : 'ECHO main process crashed.',
      detail: `${message}\n\nCrash report has been saved as a single readable file on this machine. You can restart ECHO or open the report file for debugging.`,
      buttons: ['Restart ECHO', 'Open crash report', 'Ignore'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (result.response === 0) {
      restartApp();
      return;
    }

    if (result.response === 1) {
      await getCrashReportService().openCrashReportFile();
    }
  } catch (error) {
    getCrashReportService().getLogger()?.error('crash', 'failed to show crash recovery dialog', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    recoveryDialogVisible = false;
  }
};

export const resetCrashRecoveryDialogForTests = (): void => {
  recoveryDialogVisible = false;
};
