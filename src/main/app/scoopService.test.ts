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
    it('uses powershell.exe as default shell and passes -EncodedCommand with base64 encoded UTF-16LE script', () => {
      if (!isWindows) {
        expect(runScoopUpdate()).toBe(false);
        return;
      }

      const unrefMock = vi.fn();
      let capturedArgs: string[] = [];
      const spawnMock = vi.fn().mockImplementation((_cmd, args) => {
        capturedArgs = args;
        return { unref: unrefMock };
      });

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
          'powershell.exe',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          expect.any(String),
        ]),
        expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
      );
      expect(unrefMock).toHaveBeenCalled();

      const encodedCmdIdx = capturedArgs.indexOf('-EncodedCommand');
      expect(encodedCmdIdx).toBeGreaterThan(-1);
      const encodedScript = capturedArgs[encodedCmdIdx + 1];
      const decodedScript = Buffer.from(encodedScript, 'base64').toString('utf16le');

      expect(decodedScript).toContain("$appName = 'echo-music-player'");
      expect(decodedScript).toContain('Wait-Process -Id 12345');
      expect(decodedScript).toContain('$oldVer = (scoop list $appName | Select-String $appName).Line');
      expect(decodedScript).toContain('scoop update');
      expect(decodedScript).toContain('scoop update $appName');
      expect(decodedScript).toContain('if ($LASTEXITCODE -ne 0)');
      expect(decodedScript).toContain('$newVer = (scoop list $appName | Select-String $appName).Line');
      expect(decodedScript).toContain(
        "Write-Warning 'Scoop bucket has not updated yet. You are currently on the latest version available in Scoop.'",
      );
      expect(decodedScript).toContain('Start-Process -FilePath $targetExe');
      expect(decodedScript).toContain('Start-Process -FilePath $fallback');
    });

    it('allows custom shell override', () => {
      if (!isWindows) {
        return;
      }

      const unrefMock = vi.fn();
      const spawnMock = vi.fn().mockReturnValue({ unref: unrefMock });

      const result = runScoopUpdate({
        appName: 'echo-music-player',
        shell: 'pwsh.exe',
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      expect(spawnMock).toHaveBeenCalledWith(
        'cmd.exe',
        expect.arrayContaining(['/c', 'start', 'ECHO Next - Scoop Updater', 'pwsh.exe']),
        expect.anything(),
      );
    });

    it('handles failure gracefully', () => {
      if (!isWindows) {
        return;
      }

      const spawnMock = vi.fn().mockImplementation(() => {
        throw new Error('Failed to spawn');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = runScoopUpdate({
        appName: 'echo-music-player',
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('escapes single quotes in appName to prevent PowerShell injection', () => {
      if (!isWindows) {
        return;
      }

      const unrefMock = vi.fn();
      let capturedArgs: string[] = [];
      const spawnMock = vi.fn().mockImplementation((_cmd, args) => {
        capturedArgs = args;
        return { unref: unrefMock };
      });

      const result = runScoopUpdate({
        appName: "echo'player",
        spawnFn: spawnMock as never,
      });

      expect(result).toBe(true);
      const encodedCmdIdx = capturedArgs.indexOf('-EncodedCommand');
      const decodedScript = Buffer.from(capturedArgs[encodedCmdIdx + 1], 'base64').toString('utf16le');
      expect(decodedScript).toContain("$appName = 'echo''player'");
    });
  });
});
