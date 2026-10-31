import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLegacyEntitlementRecovery } from '../app/legacyEntitlementRecovery';

export const echoProMachineIdentityRecovery = createLegacyEntitlementRecovery('echo-pro-hwid');

const hashText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const machineIdentityPattern = /^(?:win|linux|local):[a-z0-9:_-]{12,160}$/iu;
const linuxMachineIdPattern = /^[a-f0-9]{32}$/u;
const linuxMachineIdPaths = ['/etc/machine-id', '/var/lib/dbus/machine-id'] as const;
const legacyWindowsUserDataFolderNames = ['ECHO', 'echo-next', 'ECHO Next'] as const;
let cachedRawMachineIdentity: string | null = null;

const getWindowsMachineGuid = (): string | null => {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    );
    const match = /MachineGuid\s+REG_\w+\s+([^\r\n]+)/iu.exec(output);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
};

export const readLinuxMachineId = (
  readTextFile: (filePath: string) => string = (filePath) => readFileSync(filePath, 'utf8'),
): string | null => {
  for (const filePath of linuxMachineIdPaths) {
    try {
      const machineId = readTextFile(filePath).trim().toLowerCase();
      if (linuxMachineIdPattern.test(machineId)) {
        return machineId;
      }
    } catch {
      // Some distributions only provide one of the standard machine-id files.
    }
  }
  return null;
};

const getLinuxMachineId = (): string | null =>
  process.platform === 'linux' ? readLinuxMachineId() : null;

const getFallbackIdentityFile = (): string => join(app.getPath('userData'), 'identity', 'echo-pro-machine-id');

const readMachineIdentityFile = (filePath: string): string | null => {
  try {
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8').trim();
      if (machineIdentityPattern.test(existing)) {
        return existing;
      }
    }
  } catch {
    // A missing or temporarily unreadable identity file is handled by the caller.
  }
  return null;
};

const readPersistedMachineIdentity = (): string | null =>
  readMachineIdentityFile(getFallbackIdentityFile());

const readLegacyWindowsMachineIdentity = (): string | null => {
  if (process.platform !== 'win32') {
    return null;
  }
  const currentUserDataPath = app.getPath('userData').toLocaleLowerCase();
  const appDataPath = app.getPath('appData');
  for (const folderName of legacyWindowsUserDataFolderNames) {
    const legacyRoot = join(appDataPath, folderName);
    if (legacyRoot.toLocaleLowerCase() === currentUserDataPath) {
      continue;
    }
    const identity = readMachineIdentityFile(join(legacyRoot, 'identity', 'echo-pro-machine-id'));
    if (identity?.startsWith('win:') || identity?.startsWith('local:')) {
      return identity;
    }
  }
  return null;
};

const persistMachineIdentity = (identity: string): string => {
  const filePath = getFallbackIdentityFile();
  try {
    mkdirSync(join(app.getPath('userData'), 'identity'), { recursive: true });
    writeFileSync(filePath, `${identity}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: existsSync(filePath) ? 'w' : 'wx',
    });
    return identity;
  } catch {
    // Another app instance may have won the initial creation race.
    return readPersistedMachineIdentity() ?? identity;
  }
};

export const getRawMachineIdentity = (): string => {
  if (cachedRawMachineIdentity) {
    return cachedRawMachineIdentity;
  }

  const persisted = readPersistedMachineIdentity() ?? readLegacyWindowsMachineIdentity();
  if (persisted) {
    if (process.platform === 'win32' && persisted.startsWith('win:')) {
      const currentMachineGuid = getWindowsMachineGuid();
      if (currentMachineGuid && persisted.slice(4).toLowerCase() !== currentMachineGuid.toLowerCase()) {
        cachedRawMachineIdentity = persistMachineIdentity(`win:${currentMachineGuid}`);
        return cachedRawMachineIdentity;
      }
    }
    if (process.platform === 'linux' && persisted.startsWith('linux:')) {
      const currentMachineId = getLinuxMachineId();
      if (currentMachineId && persisted.slice(6).toLowerCase() !== currentMachineId) {
        cachedRawMachineIdentity = persistMachineIdentity(`linux:${currentMachineId}`);
        return cachedRawMachineIdentity;
      }
    }
    cachedRawMachineIdentity = persistMachineIdentity(persisted);
    return cachedRawMachineIdentity;
  }

  const machineGuid = getWindowsMachineGuid();
  if (machineGuid) {
    cachedRawMachineIdentity = persistMachineIdentity(`win:${machineGuid}`);
    return cachedRawMachineIdentity;
  }

  const linuxMachineId = getLinuxMachineId();
  if (linuxMachineId) {
    cachedRawMachineIdentity = persistMachineIdentity(`linux:${linuxMachineId}`);
    return cachedRawMachineIdentity;
  }

  cachedRawMachineIdentity = persistMachineIdentity(`local:${randomUUID()}`);
  return cachedRawMachineIdentity;
};

export const resetEchoProMachineIdentityCacheForTests = (): void => {
  cachedRawMachineIdentity = null;
};

export const getEchoProMachineHwidHash = (): string =>
  hashText(`echo-connect-donator:${getRawMachineIdentity()}`);

export const getEchoProMachineCode = (): string =>
  hashText(`echo-pro-machine-v1:${getRawMachineIdentity()}`);
