import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';

const scoopPathRegex = /[\\/]scoop[\\/]apps[\\/]([^\\/]+)[\\/]([^\\/]+)/i;

/**
 * Checks whether the application is running from a Scoop installation directory.
 */
export const isScoopInstallation = (execPath: string = process.execPath): boolean => {
  if (process.platform !== 'win32') {
    return false;
  }
  return scoopPathRegex.test(normalize(execPath));
};

/**
 * Extracts the Scoop package name from the executable path (e.g. 'echo-music-player').
 */
export const getScoopAppName = (execPath: string = process.execPath): string | null => {
  const match = scoopPathRegex.exec(normalize(execPath));
  return match ? match[1] : null;
};

/**
 * Rewrites a versioned Scoop executable path (e.g. .../apps/app/1.0.0/app.exe)
 * to the stable current link (e.g. .../apps/app/current/app.exe).
 */
export const resolveScoopCurrentExePath = (execPath: string = process.execPath): string => {
  if (!isScoopInstallation(execPath)) {
    return execPath;
  }
  const normalized = normalize(execPath);
  return normalized.replace(/([\\/]scoop[\\/]apps[\\/][^\\/]+[\\/])([^\\/]+)/i, '$1current');
};

/**
 * Checks if a portable 'data' directory exists adjacent to the executable.
 * In Scoop with 'persist: "data"', Scoop links <app>/current/data -> <persist>/data.
 */
export const getPortableDataPath = (execPath: string = process.execPath): string | null => {
  if (!execPath || typeof execPath !== 'string' || !execPath.trim()) {
    return null;
  }
  try {
    const targetExecPath = isScoopInstallation(execPath)
      ? resolveScoopCurrentExePath(execPath)
      : execPath;
    const candidate = join(dirname(targetExecPath), 'data');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return resolve(candidate);
    }
  } catch {
    // Ignore filesystem probe errors
  }
  return null;
};

export interface RunScoopUpdateOptions {
  appName?: string;
  pid?: number;
  spawnFn?: typeof spawn;
  shell?: string;
}

/**
 * Launches a detached PowerShell helper to execute `scoop update && scoop update <app>`,
 * wait for the current ECHO instance to terminate, and then restart the updated version.
 */
export const runScoopUpdate = (options: RunScoopUpdateOptions = {}): boolean => {
  if (process.platform !== 'win32') {
    return false;
  }

  const appName = options.appName ?? getScoopAppName() ?? 'echo-music-player';
  const pid = options.pid ?? process.pid;
  const spawnProcess = options.spawnFn ?? spawn;
  const targetRestartExe = resolveScoopCurrentExePath(process.execPath);
  const escapedTargetExe = targetRestartExe.replace(/'/g, "''");
  const escapedAppName = appName.replace(/'/g, "''");

  const script = [
    `$Host.UI.RawUI.WindowTitle = 'ECHO Next - Scoop Updater'`,
    `$appName = '${escapedAppName}'`,
    `Write-Host 'Waiting for ECHO Next (PID ${pid}) to exit...' -ForegroundColor Cyan`,
    `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    `Start-Sleep -Milliseconds 800`,
    `Write-Host 'Updating Scoop buckets...' -ForegroundColor Cyan`,
    `scoop update`,
    `Write-Host "Updating $appName via Scoop..." -ForegroundColor Cyan`,
    `scoop update $appName`,
    `Write-Host "Restarting $appName..." -ForegroundColor Green`,
    `$targetExe = '${escapedTargetExe}'`,
    `if (Test-Path -LiteralPath $targetExe) { Start-Process -FilePath $targetExe -WorkingDirectory (Split-Path -Parent $targetExe) } else { $fallback = (scoop which $appName); if ($fallback -and (Test-Path -LiteralPath $fallback)) { Start-Process -FilePath $fallback -WorkingDirectory (Split-Path -Parent $fallback) } else { Write-Warning 'Could not locate updated executable to restart.' ; Start-Sleep -Seconds 3 } }`,
    `Start-Sleep -Seconds 2`,
  ].join('; ');

  const shellCmd = options.shell ?? 'pwsh.exe';
  const windowTitle = 'ECHO Next - Scoop Updater';

  try {
    const child = spawnProcess(
      'cmd.exe',
      ['/c', 'start', windowTitle, shellCmd, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        detached: true,
        stdio: 'ignore',
        cwd: tmpdir(),
        windowsHide: false,
      },
    );

    child.unref();
    return true;
  } catch (error) {
    console.error('[scoop] failed to spawn scoop updater script', error);
    return false;
  }
};
