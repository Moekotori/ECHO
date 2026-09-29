import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appDataPath: '',
  userDataPath: '',
  execFileSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'appData' ? mocks.appDataPath : mocks.userDataPath,
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

import {
  getRawMachineIdentity,
  readLinuxMachineId,
  resetEchoProMachineIdentityCacheForTests,
} from './MachineIdentity';

describe('MachineIdentity', () => {
  beforeEach(() => {
    mocks.appDataPath = mkdtempSync(join(tmpdir(), 'echo-machine-identity-'));
    mocks.userDataPath = join(mocks.appDataPath, 'ECHO NEXT');
    mkdirSync(mocks.userDataPath, { recursive: true });
    mocks.execFileSync.mockReset();
    resetEchoProMachineIdentityCacheForTests();
  });

  afterEach(() => {
    resetEchoProMachineIdentityCacheForTests();
    rmSync(mocks.appDataPath, { recursive: true, force: true });
  });

  it('keeps one identity when Windows registry access changes during the same process', () => {
    mocks.execFileSync
      .mockImplementationOnce(() => {
        throw new Error('registry temporarily unavailable');
      })
      .mockReturnValueOnce('    MachineGuid    REG_SZ    later-guid\n');

    const first = getRawMachineIdentity();
    const second = getRawMachineIdentity();

    expect(first).toMatch(/^local:/u);
    expect(second).toBe(first);
    expect(mocks.execFileSync).toHaveBeenCalledTimes(process.platform === 'win32' ? 1 : 0);
  });

  it('reuses the persisted identity after restart instead of switching sources', () => {
    mocks.execFileSync.mockImplementationOnce(() => {
      throw new Error('registry temporarily unavailable');
    });
    const first = getRawMachineIdentity();

    resetEchoProMachineIdentityCacheForTests();
    mocks.execFileSync.mockReturnValue('    MachineGuid    REG_SZ    later-guid\n');
    const afterRestart = getRawMachineIdentity();

    expect(afterRestart).toBe(first);
  });

  it.runIf(process.platform === 'win32')('recovers the stable identity from the legacy ECHO data directory', () => {
    const legacyIdentityDirectory = join(mocks.appDataPath, 'ECHO', 'identity');
    mkdirSync(legacyIdentityDirectory, { recursive: true });
    writeFileSync(join(legacyIdentityDirectory, 'echo-pro-machine-id'), 'local:legacy-stable-device-id\n', 'utf8');
    mocks.execFileSync.mockReturnValue('    MachineGuid    REG_SZ    ignored-guid\n');

    expect(getRawMachineIdentity()).toBe('local:legacy-stable-device-id');
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('reads a normalized Linux machine id from the standard fallback paths', () => {
    const readTextFile = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('/etc/machine-id unavailable');
      })
      .mockReturnValueOnce('ABCDEF0123456789ABCDEF0123456789\n');

    expect(readLinuxMachineId(readTextFile)).toBe('abcdef0123456789abcdef0123456789');
    expect(readTextFile).toHaveBeenNthCalledWith(1, '/etc/machine-id');
    expect(readTextFile).toHaveBeenNthCalledWith(2, '/var/lib/dbus/machine-id');
  });

  it('rejects malformed Linux machine ids instead of weakening the identity boundary', () => {
    expect(readLinuxMachineId(() => 'uninitialized\n')).toBeNull();
    expect(readLinuxMachineId(() => '../../not-a-machine-id\n')).toBeNull();
  });
});
