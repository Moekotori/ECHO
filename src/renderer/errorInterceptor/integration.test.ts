// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveErrorInterceptorPolicy } from '../../shared/utils/errorInterceptorPolicy';
import type { ErrorInterceptorPolicy } from '../../shared/utils/errorInterceptorPolicy';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

// ---------------------------------------------------------------------------
//  Helper: simulate the window event listener registration pattern from
//  src/renderer/main.tsx (lines 839–861)
// ---------------------------------------------------------------------------
function simulateErrorListenerRegistration(policy: ErrorInterceptorPolicy): void {
  if (policy.enabled) {
    window.addEventListener('error', () => {
      /* reportRendererError call omitted – only the guard is under test */
    });
  }
}

// ---------------------------------------------------------------------------
//  Tests 1–3: resolveErrorInterceptorPolicy with env var
// ---------------------------------------------------------------------------
describe('resolveErrorInterceptorPolicy (env)', () => {
  afterEach(restoreEnv);

  it('returns enabled:true source:default when no env var is set', () => {
    delete process.env.ECHO_DISABLE_ERROR_INTERCEPTOR;
    expect(resolveErrorInterceptorPolicy()).toEqual({
      enabled: true,
      source: 'default',
    } satisfies ErrorInterceptorPolicy);
  });

  it("returns enabled:false source:env when ECHO_DISABLE_ERROR_INTERCEPTOR='1'", () => {
    process.env.ECHO_DISABLE_ERROR_INTERCEPTOR = '1';
    expect(resolveErrorInterceptorPolicy()).toEqual({
      enabled: false,
      source: 'env',
    } satisfies ErrorInterceptorPolicy);
  });

  it("returns enabled:true source:default when ECHO_DISABLE_ERROR_INTERCEPTOR='0'", () => {
    process.env.ECHO_DISABLE_ERROR_INTERCEPTOR = '0';
    expect(resolveErrorInterceptorPolicy()).toEqual({
      enabled: true,
      source: 'default',
    } satisfies ErrorInterceptorPolicy);
  });
});

// ---------------------------------------------------------------------------
//  Test 4: URL query param ?noErrorInterceptor → { enabled: false, source: 'url' }
// ---------------------------------------------------------------------------
describe('resolveErrorInterceptorPolicy (URL param)', () => {
  afterEach(() => {
    restoreEnv();
    window.history.replaceState({}, '', '/');
  });

  it('returns enabled:false source:url when window.location.search contains ?noErrorInterceptor', () => {
    delete process.env.ECHO_DISABLE_ERROR_INTERCEPTOR;
    window.history.replaceState({}, '', '/?noErrorInterceptor');

    expect(resolveErrorInterceptorPolicy()).toEqual({
      enabled: false,
      source: 'url',
    } satisfies ErrorInterceptorPolicy);
  });
});

// ---------------------------------------------------------------------------
//  Test 5: When disabled, window.onerror listener is NOT registered
// ---------------------------------------------------------------------------
describe('window error listener gating', () => {
  afterEach(() => {
    restoreEnv();
    window.history.replaceState({}, '', '/');
  });

  it('registers window error listener when policy is enabled', () => {
    delete process.env.ECHO_DISABLE_ERROR_INTERCEPTOR;
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    const policy = resolveErrorInterceptorPolicy();
    simulateErrorListenerRegistration(policy);

    expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it('does NOT register window error listener when policy is disabled via env', () => {
    process.env.ECHO_DISABLE_ERROR_INTERCEPTOR = '1';
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    const policy = resolveErrorInterceptorPolicy();
    simulateErrorListenerRegistration(policy);

    expect(addEventListenerSpy).not.toHaveBeenCalledWith('error', expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it('does NOT register window error listener when policy is disabled via URL param', () => {
    delete process.env.ECHO_DISABLE_ERROR_INTERCEPTOR;
    window.history.replaceState({}, '', '/?noErrorInterceptor');
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    const policy = resolveErrorInterceptorPolicy();
    simulateErrorListenerRegistration(policy);

    expect(addEventListenerSpy).not.toHaveBeenCalledWith('error', expect.any(Function));
    addEventListenerSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
//  Test 6: IPC handler gate – when env var is set, handler returns early
//  Mirrors the test in src/main/ipc/diagnosticsIpc.test.ts
// ---------------------------------------------------------------------------

// Hoisted mocks – vitest hoists vi.mock() / vi.hoisted() above imports.
// createMockIpcMain() cannot be called here (imports not yet resolved), so we
// build the equivalent mock inline using vi.fn() which IS available at hoist time.
const ipcGateMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      on: vi.fn(),
      handlers,
    },
    crashReportService: {
      reportRendererError: vi.fn(),
    },
    recordRendererRuntimeError: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: {
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: ipcGateMocks.mockIpcMain,
}));

vi.mock('../../main/diagnostics/CrashReportService', () => ({
  getCrashReportService: () => ipcGateMocks.crashReportService,
}));

vi.mock('../../main/diagnostics/DevConsoleService', () => ({
  clearDevConsole: vi.fn(),
  getDevConsoleSnapshot: vi.fn(),
  openDevConsoleDevTools: vi.fn(),
  openDevConsoleWindow: vi.fn(),
  recordPerformanceStall: vi.fn(),
  recordRendererRuntimeError: ipcGateMocks.recordRendererRuntimeError,
}));

vi.mock('../../main/audio/AudioSession', () => ({
  getAudioSession: () => ({
    getDiagnostics: vi.fn(),
  }),
}));

describe('IPC handler gate for DiagnosticsReportRendererError', () => {
  beforeEach(() => {
    ipcGateMocks.mockIpcMain.handlers.clear();
    ipcGateMocks.crashReportService.reportRendererError.mockReset();
    ipcGateMocks.recordRendererRuntimeError.mockReset();
  });

  afterEach(restoreEnv);

  it('returns early without calling CrashReportService when ECHO_DISABLE_ERROR_INTERCEPTOR=1', async () => {
    process.env.ECHO_DISABLE_ERROR_INTERCEPTOR = '1';

    const { registerDiagnosticsIpc } = await import('../../main/ipc/diagnosticsIpc');
    registerDiagnosticsIpc();

    const handler = ipcGateMocks.mockIpcMain.handlers.get(IpcChannels.DiagnosticsReportRendererError);
    expect(handler).toBeTypeOf('function');

    (handler as Function)(null, { message: 'test error from renderer' });

    expect(ipcGateMocks.crashReportService.reportRendererError).not.toHaveBeenCalled();
    expect(ipcGateMocks.recordRendererRuntimeError).not.toHaveBeenCalled();
  });

  it('calls CrashReportService when ECHO_DISABLE_ERROR_INTERCEPTOR is not set', async () => {
    delete process.env.ECHO_DISABLE_ERROR_INTERCEPTOR;

    const { registerDiagnosticsIpc } = await import('../../main/ipc/diagnosticsIpc');
    registerDiagnosticsIpc();

    const handler = ipcGateMocks.mockIpcMain.handlers.get(IpcChannels.DiagnosticsReportRendererError);
    expect(handler).toBeTypeOf('function');

    (handler as Function)(null, { message: 'legitimate error' });

    expect(ipcGateMocks.crashReportService.reportRendererError).toHaveBeenCalledTimes(1);
    expect(ipcGateMocks.recordRendererRuntimeError).toHaveBeenCalledTimes(1);
  });
});
