import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLegacyEntitlementRecovery } from '../app/legacyEntitlementRecovery';

export const echoProMachineIdentityRecovery = createLegacyEntitlementRecovery('echo-pro-hwid');

const hashText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const getWindowsMachineGuid = (): string | null => {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', timeout: 1_500, windowsHide: true },
    );
    const match = /MachineGuid\s+REG_\w+\s+([^\r\n]+)/iu.exec(output);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
};

const getFallbackIdentityFile = (): string => join(app.getPath('userData'), 'identity', 'echo-pro-machine-id');

const getOrCreateFallbackMachineId = (): string => {
  const filePath = getFallbackIdentityFile();
  try {
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8').trim();
      if (/^[a-z0-9:_-]{16,160}$/iu.test(existing)) {
        return existing;
      }
    }

    const next = `local:${randomUUID()}`;
    mkdirSync(join(app.getPath('userData'), 'identity'), { recursive: true });
    writeFileSync(filePath, `${next}\n`, { encoding: 'utf8', mode: 0o600 });
    return next;
  } catch {
    return `runtime:${process.platform}:${app.getPath('userData')}`;
  }
};

export const getRawMachineIdentity = (): string => {
  const machineGuid = getWindowsMachineGuid();
  if (machineGuid) {
    return `win:${machineGuid}`;
  }

  return getOrCreateFallbackMachineId();
};

export const getEchoProMachineHwidHash = (): string =>
  hashText(`echo-connect-donator:${getRawMachineIdentity()}`);

export const getEchoProMachineCode = (): string =>
  hashText(`echo-pro-machine-v1:${getRawMachineIdentity()}`);
