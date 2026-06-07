import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  handle: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    quit: mocks.quit,
    relaunch: mocks.relaunch,
  },
  ipcMain: {
    handle: mocks.handle,
  },
}));

vi.mock('../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    clearLastCrashSummary: vi.fn(),
    exportDiagnosticsMarkdown: vi.fn(),
    exportDiagnosticsZip: vi.fn(),
    getLastCrashSummary: vi.fn(),
    openAudioCrashReportFile: vi.fn(),
    openCrashReportFile: vi.fn(),
    openDiagnosticsFolder: vi.fn(),
  }),
}));

vi.mock('../diagnostics/DevConsoleService', () => ({
  clearDevConsole: vi.fn(),
  getDevConsoleSnapshot: vi.fn(),
  openDevConsoleDevTools: vi.fn(),
  openDevConsoleWindow: vi.fn(),
  recordPerformanceStall: vi.fn(),
  recordRendererRuntimeError: vi.fn(),
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getDiagnostics: vi.fn(),
  }),
}));

describe('registerDiagnosticsIpc', () => {
  beforeEach(() => {
    mocks.exit.mockReset();
    mocks.handle.mockReset();
    mocks.quit.mockReset();
    mocks.relaunch.mockReset();
  });

  it('relaunches through the normal quit path so shutdown cleanup can run', async () => {
    const { registerDiagnosticsIpc } = await import('./diagnosticsIpc');

    registerDiagnosticsIpc();

    const relaunchHandler = mocks.handle.mock.calls.find(([channel]) => channel === IpcChannels.DiagnosticsRelaunchApp)?.[1];

    expect(relaunchHandler).toBeTypeOf('function');
    relaunchHandler();

    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
  });
});
