import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCrashRecoveryDialogForTests, showCrashRecoveryDialog } from './CrashRecoveryDialog';

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  openCrashReportFile: vi.fn(),
  relaunch: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    relaunch: mocks.relaunch,
    exit: mocks.exit,
  },
  dialog: {
    showMessageBox: mocks.showMessageBox,
  },
}));

vi.mock('./CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => ({
      error: vi.fn(),
    }),
    openCrashReportFile: mocks.openCrashReportFile,
  }),
}));

describe('CrashRecoveryDialog', () => {
  beforeEach(() => {
    resetCrashRecoveryDialogForTests();
    mocks.relaunch.mockReset();
    mocks.exit.mockReset();
    mocks.showMessageBox.mockReset();
    mocks.openCrashReportFile.mockReset();
  });

  it('restarts the app when the restart button is chosen', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 0 });

    await showCrashRecoveryDialog('renderer', 'Renderer process gone: crashed');

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ buttons: ['Restart ECHO', 'Open crash report', 'Ignore'] }),
    );
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    expect(mocks.exit).toHaveBeenCalledWith(0);
  });

  it('opens the crash report file when crash report is chosen', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 1 });

    await showCrashRecoveryDialog('main', 'Boom');

    expect(mocks.openCrashReportFile).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
