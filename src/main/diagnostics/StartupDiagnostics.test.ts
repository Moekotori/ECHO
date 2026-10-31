import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getExceptionLogPath,
  getExceptionRecordsSnapshot,
  getExceptionSummarySnapshot,
  resetExceptionRecorderForTests,
  recordDiagnosticConsoleProblem,
  recordDiagnosticException,
} from './ExceptionRecorder';
import {
  collectStartupPersistentStateSnapshot,
  createStartupDiagnosticsTracker,
  createSafeModePowerShellTailArgs,
  getSafeModeStartupLogPath,
  openEarlySafeModeShellIfEnabled,
  openSafeModeStartupConsoleIfEnabled,
  readSafeModeEnabledFromSettingsFile,
  recordSafeModeStartupBanner,
  resetStartupDiagnosticsForTests,
} from './StartupDiagnostics';

const safeModeContext = {
  appVersion: '1.2.3',
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64',
  userDataPath: 'D:\\Users\\mochi\\AppData\\Roaming\\ECHO NEXT',
};
const tempDirs: string[] = [];

const makeTempUserData = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-safe-mode-'));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  resetStartupDiagnosticsForTests();
  resetExceptionRecorderForTests();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createStartupDiagnosticsTracker', () => {
  it('records ordered startup stages with elapsed time and slow flags', () => {
    const messages: string[] = [];
    const levels: Array<'info' | 'warn' | undefined> = [];
    const times = [1000, 1250, 3500, 3600];
    const tracker = createStartupDiagnosticsTracker(() => times.shift() ?? 3600, (message, level) => {
      messages.push(message);
      levels.push(level);
    });

    const first = tracker.mark('main:module-loaded');
    const second = tracker.mark('data-protection:startup:complete', { databasePath: 'D:\\Music\\echo.sqlite' });
    const third = tracker.mark('startup:ready');

    expect(first).toMatchObject({ index: 1, stage: 'main:module-loaded', elapsedMs: 250, deltaMs: 250, slow: false });
    expect(second).toMatchObject({ index: 2, stage: 'data-protection:startup:complete', elapsedMs: 2500, deltaMs: 2250, slow: true });
    expect(second.details).toEqual({ databasePath: { basename: 'echo.sqlite', pathHash: expect.any(String) } });
    expect(third).toMatchObject({ index: 3, stage: 'startup:ready', elapsedMs: 2600, deltaMs: 100, slow: false });
    expect(tracker.snapshot()).toHaveLength(3);
    expect(messages[1]).toContain('SLOW');
    expect(levels).toEqual(['info', 'warn', 'info']);
  });

  it('captures persistent state files without exposing raw paths', () => {
    const userDataPath = makeTempUserData();
    writeFileSync(join(userDataPath, 'echo-settings.json'), '{"safeModeEnabled":false}\n', 'utf8');
    writeFileSync(join(userDataPath, 'accounts.json'), '{"providers":[]}\n', 'utf8');

    const snapshot = collectStartupPersistentStateSnapshot({
      ...safeModeContext,
      userDataPath,
      appPath: 'G:\\ECHO-main',
      execPath: 'G:\\ECHO-main\\ECHO NEXT.exe',
    }, () => Date.now());

    expect(snapshot.userData).toEqual({ basename: expect.stringContaining('echo-safe-mode-'), pathHash: expect.any(String) });
    expect(snapshot.appPath).toEqual({ basename: 'ECHO-main', pathHash: expect.any(String) });
    expect(snapshot.execPath).toEqual({ basename: 'ECHO NEXT.exe', pathHash: expect.any(String) });
    expect(snapshot.files.find((file) => file.name === 'echo-settings.json')).toMatchObject({
      exists: true,
      sizeBytes: expect.any(Number),
      modifiedAgeMs: expect.any(Number),
    });
    expect(snapshot.files.find((file) => file.name === 'echo-library.sqlite')).toMatchObject({
      exists: false,
    });
  });
});

describe('safe mode startup console', () => {
  it('reads the persistent Safe mode flag from the early settings file', () => {
    const userDataPath = makeTempUserData();

    expect(readSafeModeEnabledFromSettingsFile(userDataPath)).toBe(false);

    writeFileSync(join(userDataPath, 'echo-settings.json'), `${JSON.stringify({ safeModeEnabled: true })}\n`, 'utf8');
    expect(readSafeModeEnabledFromSettingsFile(userDataPath)).toBe(true);

    writeFileSync(join(userDataPath, 'echo-settings.json'), `${JSON.stringify({ safeModeEnabled: 'true' })}\n`, 'utf8');
    expect(readSafeModeEnabledFromSettingsFile(userDataPath)).toBe(false);
  });

  it('opens an early PowerShell tail before Electron app readiness when Safe mode is enabled', () => {
    const userDataPath = makeTempUserData();
    const child = { unref: vi.fn() };
    const spawner = vi.fn(() => child);
    writeFileSync(join(userDataPath, 'echo-settings.json'), `${JSON.stringify({ safeModeEnabled: true })}\n`, 'utf8');

    expect(openEarlySafeModeShellIfEnabled({ ...safeModeContext, userDataPath }, spawner as never)).toBe(true);

    const logPath = getSafeModeStartupLogPath(userDataPath);
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toContain('ECHO Safe mode early startup shell');
    expect(spawner).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass']),
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
    );
    expect(readFileSync(getExceptionLogPath(userDataPath), 'utf8')).toContain('Only exceptions');
    expect(child.unref).toHaveBeenCalled();
  });

  it('colors warnings yellow and hard errors red in the early PowerShell bug watch', () => {
    const args = createSafeModePowerShellTailArgs('D:\\Echo\\exceptions.safe.log', 'D:\\Echo\\startup-safe-mode.log');
    const command = args.at(-1) ?? '';

    expect(command).toContain('ECHO Safe Mode Bug Watch');
    expect(command).toContain('Read-EchoNewLines');
    expect(command).toContain("'exception'");
    expect(command).toContain("'startup'");
    expect(command).toContain("ForegroundColor Yellow");
    expect(command).toContain("ForegroundColor Red");
    expect(command).toContain("\\[warn\\]");
    expect(command).toContain("\\[(fatal|error)\\]");
    expect(command).toContain("Write-EchoWatchLine");
  });

  it('writes only explicit exceptions into the exception recorder log', () => {
    const userDataPath = makeTempUserData();
    writeFileSync(join(userDataPath, 'echo-settings.json'), `${JSON.stringify({ safeModeEnabled: true })}\n`, 'utf8');
    openEarlySafeModeShellIfEnabled(
      {
        ...safeModeContext,
        userDataPath,
      },
      vi.fn(() => ({ unref: vi.fn() })) as never,
    );

    recordDiagnosticException({
      source: 'renderer',
      severity: 'error',
      type: 'error',
      message: 'Renderer exploded',
    });

    const exceptionLog = readFileSync(getExceptionLogPath(userDataPath), 'utf8');
    expect(exceptionLog).toContain('Renderer exploded');
    expect(exceptionLog).not.toContain('playback status');
    expect(getExceptionRecordsSnapshot()).toHaveLength(1);
  });

  it('promotes console warnings and errors without recording ordinary playback chatter', () => {
    expect(recordDiagnosticConsoleProblem({
      id: 1,
      timestamp: '2026-05-21T00:00:00.000Z',
      source: 'stdout',
      level: 'info',
      message: 'playback status tick position=12',
    })).toBeNull();

    expect(recordDiagnosticConsoleProblem({
      id: 2,
      timestamp: '2026-05-21T00:00:01.000Z',
      source: 'stderr',
      level: 'error',
      message: 'echo-audio-host timeout_waiting_for_ready',
    })).toMatchObject({ severity: 'error', source: 'console', type: 'stderr-error-problem' });

    expect(recordDiagnosticConsoleProblem({
      id: 3,
      timestamp: '2026-05-21T00:00:02.000Z',
      source: 'renderer',
      level: 'warn',
      message: 'slow route load after settings hydration',
      details: { sourceId: 'SettingsPage.tsx', line: 88 },
    })).toMatchObject({ severity: 'warn', source: 'console', type: 'renderer-warn-problem' });

    expect(getExceptionSummarySnapshot()).toMatchObject({
      total: 2,
      bySeverity: { warn: 1, error: 1, fatal: 0 },
      bySource: { console: 2 },
    });
  });

  it('does not open the early PowerShell tail when Safe mode is disabled', () => {
    const userDataPath = makeTempUserData();
    const spawner = vi.fn();

    expect(openEarlySafeModeShellIfEnabled({ ...safeModeContext, userDataPath }, spawner as never)).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });

  it('records a startup error when the early PowerShell tail cannot open', () => {
    const userDataPath = makeTempUserData();
    writeFileSync(join(userDataPath, 'echo-settings.json'), `${JSON.stringify({ safeModeEnabled: true })}\n`, 'utf8');

    expect(openEarlySafeModeShellIfEnabled(
      { ...safeModeContext, userDataPath },
      vi.fn(() => {
        throw new Error('PowerShell unavailable');
      }) as never,
    )).toBe(false);

    expect(getExceptionRecordsSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          source: 'startup',
          type: 'safe-mode-shell-open-failed',
          message: 'PowerShell unavailable',
        }),
      ]),
    );
  });

  it('opens the debug console and records a banner when enabled', () => {
    const openConsole = vi.fn();

    expect(openSafeModeStartupConsoleIfEnabled({ safeModeEnabled: true }, safeModeContext, openConsole)).toBe(true);
    expect(openConsole).toHaveBeenCalledTimes(1);
  });

  it('does not open the debug console when disabled', () => {
    const openConsole = vi.fn();

    expect(openSafeModeStartupConsoleIfEnabled({ safeModeEnabled: false }, safeModeContext, openConsole)).toBe(false);
    expect(openConsole).not.toHaveBeenCalled();
  });

  it('redacts the userData path in the safe mode banner', () => {
    expect(() => recordSafeModeStartupBanner(safeModeContext)).not.toThrow();
  });
});
