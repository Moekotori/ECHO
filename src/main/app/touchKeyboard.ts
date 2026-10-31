import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { win32 as pathWin32 } from 'node:path';

type TouchKeyboardDependencies = {
  exists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
  programFiles?: string;
  systemRoot?: string;
  spawnProcess?: (file: string) => ChildProcess;
};

const launchDetached = (file: string, spawnProcess: NonNullable<TouchKeyboardDependencies['spawnProcess']>): boolean => {
  try {
    const child = spawnProcess(file);
    child.unref?.();
    return true;
  } catch {
    return false;
  }
};

export const getWindowsTouchKeyboardCandidates = (dependencies: TouchKeyboardDependencies = {}): string[] => {
  const programFiles = dependencies.programFiles ?? process.env.ProgramFiles ?? 'C:\\Program Files';
  const systemRoot = dependencies.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';

  return [
    pathWin32.join(programFiles, 'Common Files', 'microsoft shared', 'ink', 'TabTip.exe'),
    pathWin32.join(systemRoot, 'System32', 'osk.exe'),
  ];
};

export const showWindowsTouchKeyboard = (dependencies: TouchKeyboardDependencies = {}): boolean => {
  if ((dependencies.platform ?? process.platform) !== 'win32') {
    return false;
  }

  const exists = dependencies.exists ?? existsSync;
  const spawnProcess =
    dependencies.spawnProcess ??
    ((file: string): ChildProcess => spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false }));

  for (const candidate of getWindowsTouchKeyboardCandidates(dependencies)) {
    if (exists(candidate) && launchDetached(candidate, spawnProcess)) {
      return true;
    }
  }

  return false;
};
