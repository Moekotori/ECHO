import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let resolveDispose: (() => void) | null = null;
  const settings = { smtcEnabled: true, smtcLyricsEnabled: false };
  const service = {
    initialize: vi.fn(),
    dispose: vi.fn(() => new Promise<void>((resolve) => {
      resolveDispose = resolve;
    })),
    setMetadata: vi.fn(),
    setPlaybackState: vi.fn(),
    setTimeline: vi.fn(),
    setEnabledActions: vi.fn(),
    onCommand: vi.fn(() => () => undefined),
  };

  return {
    settings,
    service,
    disposeAndReset: vi.fn(),
    resolveDispose: () => resolveDispose?.(),
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:\\Project\\ECHONext',
    getPath: () => 'D:\\Echo',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}));

vi.mock('../../app/appSettings', () => ({
  getAppSettings: () => mocks.settings,
}));

vi.mock('../../app/windowManager', () => ({ getMainWindow: () => null }));

vi.mock('../../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => ({
      state: 'idle',
      currentTrackId: null,
      currentFilePath: null,
      currentTrackTitle: null,
      positionSeconds: 0,
      durationSeconds: 0,
    }),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('../../diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  }),
}));

vi.mock('../../library/LibraryService', () => ({
  getLibraryService: () => ({
    getTrack: () => null,
    getTrackByPath: () => null,
    resolveCoverAsset: () => null,
  }),
}));

vi.mock('./getSmtcService', () => ({
  getSmtcService: () => mocks.service,
  disposeAndResetSmtcService: mocks.disposeAndReset,
}));

beforeEach(() => {
  mocks.settings.smtcEnabled = true;
  mocks.service.initialize.mockClear();
  mocks.service.dispose.mockClear();
  mocks.disposeAndReset.mockClear();
});

describe('SMTC lifecycle serialization', () => {
  it('does not reinitialize when SMTC is disabled during recovery', async () => {
    const { initializeSmtcIntegration, recoverSmtcIntegration } = await import('./SmtcStatusSync');
    await initializeSmtcIntegration();
    expect(mocks.service.initialize).toHaveBeenCalledTimes(1);

    const recovery = recoverSmtcIntegration('test-host-failure');
    await vi.waitFor(() => expect(mocks.service.dispose).toHaveBeenCalledTimes(1));
    mocks.settings.smtcEnabled = false;
    mocks.resolveDispose();

    await expect(recovery).resolves.toBe(false);
    expect(mocks.disposeAndReset).toHaveBeenCalledTimes(1);
    expect(mocks.service.initialize).toHaveBeenCalledTimes(1);
  });
});
