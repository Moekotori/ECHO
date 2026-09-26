import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getPortableDataPath,
  getScoopAppName,
  isScoopInstallation,
  resolveScoopCurrentExePath,
  runScoopUpdate,
} from './scoopService';

describe('scoopService', () => {
  const isWindows = process.platform === 'win32';

  describe('isScoopInstallation', () => {
    it('detects Scoop paths on Windows', () => {
      if (!isWindows) {
        expect(isScoopInstallation('C:\\Users\\test\\scoop\\apps\\echo-music-player\\26.9.25\\ECHO NEXT.exe')).toBe(false);
        return;
      }

      expect(isScoopInstallation('C:\\Users\\test\\scoop\\apps\\echo-music-player\\26.9.25\\ECHO NEXT.exe')).toBe(true);
      expect(isScoopInstallation('C:/Users/test/scoop/apps/echo-music-player/current/ECHO NEXT.exe')).toBe(true);
      expect(isScoopInstallation('D:\\Scoop\\apps\\echo\\current\\echo.exe')).toBe(true);
      expect(isScoopInstallation('C:\\Program Files\\ECHO NEXT\\ECHO NEXT.exe')).toBe(false);
    });
  });

  describe('getScoopAppName', () => {
    it('extracts app name from path', () => {
      expect(getScoopAppName('C:\\Users\\test\\scoop\\apps\\echo-music-player\\26.9.25\\ECHO NEXT.exe')).toBe('echo-music-player');
      expect(getScoopAppName('D:/scoop/apps/echo/current/ECHO.exe')).toBe('echo');
      expect(getScoopAppName('C:\\Program Files\\ECHO\\ECHO.exe')).toBeNull();
    });
  });

  describe('resolveScoopCurrentExePath', () => {
    it('rewrites version directory to current', () => {
      if (!isWindows) {
        return;
      }

      const input = 'C:\\Users\\test\\scoop\\apps\\echo-music-player\\26.9.25\\ECHO NEXT.exe';
      const expected = 'C:\\Users\\test\\scoop\\apps\\echo-music-player\\current\\ECHO NEXT.exe';
      expect(resolveScoopCurrentExePath(input)).toBe(expected);

      const alreadyCurrent = 'C:\\Users\\test\\scoop\\apps\\echo-music-player\\current\\ECHO NEXT.exe';
      expect(resolveScoopCurrentExePath(alreadyCurrent)).toBe(alreadyCurrent);
    });

    it('returns non-Scoop path unchanged', () => {
      const regular = 'C:\\Program Files\\ECHO NEXT\\ECHO NEXT.exe';
      expect(resolveScoopCurrentExePath(regular)).toBe(regular);
    });
  });

  describe('getPortableDataPath', () => {
    it('returns null for empty or whitespace string', () => {
      expect(getPortableDataPath('')).toBeNull();
      expect(getPortableDataPath('   ')).toBeNull();
      expect(getPortableDataPath(null as never)).toBeNull();
      expect(getPortableDataPath(undefined as never)).toBeNull();
    });

    it('returns null when data folder does not exist', () => {
      expect(getPortableDataPath('C:\\nonexistent\\path\\ECHO.exe')).toBeNull();
    });

    it('returns directory when <dir>/data exists', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'echo-test-portable-'));
      try {
        const dataDir = join(tempDir, 'data');
        mkdirSync(dataDir, { recursive: true });
        const exePath = join(tempDir, 'ECHO.exe');
        expect(getPortableDataPath(exePath)).toBe(resolve(dataDir));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('resolves to .../apps/<app>/current/data when given a versioned Scoop path', () => {
      if (!isWindows) {
        return;
      }
      const tempDir = mkdtempSync(join(tmpdir(), 'echo-test-scoop-'));
      try {
        const scoopAppDir = join(tempDir, 'scoop', 'apps', 'echo-music-player');
        const currentData = join(scoopAppDir, 'current', 'data');
        const versionedExe = join(scoopAppDir, '26.9.25', 'ECHO NEXT.exe');
        mkdirSync(currentData, { recursive: true });
        mkdirSync(dirname(versionedExe), { recursive: true });

        expect(getPortableDataPath(versionedExe)).toBe(resolve(currentData));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('runScoopUpdate', () => {
    it('spawns visible foreground terminal using cmd /c start and pwsh on Windows', () => {
      if (!isWindows) {
        expect(runScoopUpdate()).toBe(false);
        return;
      }

      const unrefMock = vi.fn();
      const spawnMock = vi.fn().mockReturnValue({ unref: unrefMock });

      const result = runScoopUpdate({
        appName: 'echo-music-player',
        pid: 12345,
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      expect(spawnMock).toHaveBeenCalledWith(
        'cmd.exe',
        expect.arrayContaining([
          '/c',
          'start',
          'ECHO Next - Scoop Updater',
          'pwsh.exe',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          expect.stringContaining("$appName = 'echo-music-player'"),
          expect.stringContaining('scoop update $appName'),
        ]),
        expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
      );
      expect(unrefMock).toHaveBeenCalled();
    });

    it('verifies PowerShell command contains the resolved current executable path and fallback', () => {
      if (!isWindows) {
        return;
      }

      const unrefMock = vi.fn();
      let capturedScript = '';
      const spawnMock = vi.fn().mockImplementation((_cmd, args) => {
        const cmdIndex = args.indexOf('-Command');
        if (cmdIndex !== -1) {
          capturedScript = args[cmdIndex + 1];
        }
        return { unref: unrefMock };
      });

      const result = runScoopUpdate({
        appName: 'echo-music-player',
        pid: 54321,
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      const expectedExe = resolveScoopCurrentExePath(process.execPath);
      expect(capturedScript).toContain(expectedExe);
      expect(capturedScript).toContain("$appName = 'echo-music-player'");
      expect(capturedScript).toContain('scoop update $appName');
      expect(capturedScript).toContain('scoop which $appName');
      expect(capturedScript).toContain('Wait-Process -Id 54321');
      expect(capturedScript).toContain('Test-Path -LiteralPath $targetExe');
      expect(capturedScript).toContain('Test-Path -LiteralPath $fallback');
      expect(capturedScript).toContain('Start-Process -FilePath $targetExe -WorkingDirectory (Split-Path -Parent $targetExe)');
      expect(capturedScript).toContain('Start-Process -FilePath $fallback -WorkingDirectory (Split-Path -Parent $fallback)');
    });
    it('supports custom shell override in options', () => {
      if (!isWindows) {
        return;
      }

      const unrefMock = vi.fn();
      const spawnMock = vi.fn().mockReturnValue({ unref: unrefMock });

      const result = runScoopUpdate({
        appName: 'echo-music-player',
        shell: 'pwsh',
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      expect(spawnMock).toHaveBeenCalledWith(
        'cmd.exe',
        expect.arrayContaining(['/c', 'start', 'ECHO Next - Scoop Updater', 'pwsh']),
        expect.anything(),
      );
    });

    it('escapes single quotes in appName to prevent PowerShell injection', () => {
      if (!isWindows) {
        return;
      }

      const unrefMock = vi.fn();
      let capturedScript = '';
      const spawnMock = vi.fn().mockImplementation((_cmd, args) => {
        const cmdIndex = args.indexOf('-Command');
        if (cmdIndex !== -1) {
          capturedScript = args[cmdIndex + 1];
        }
        return { unref: unrefMock };
      });

      const result = runScoopUpdate({
        appName: "echo'player",
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      expect(capturedScript).toContain("$appName = 'echo''player'");
      expect(capturedScript).toContain('scoop update $appName');
    });
  });
});
