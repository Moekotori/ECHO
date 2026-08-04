import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EchoProAccountService } from './EchoProAccountService';

const electronMocks = vi.hoisted(() => ({
  encryptionAvailable: true,
}));

vi.mock('./MachineIdentity', () => ({
  getEchoProMachineHwidHash: () => 'a'.repeat(64),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getVersion: () => '26.6.14',
  },
  safeStorage: {
    isEncryptionAvailable: () => electronMocks.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value: Buffer) => {
      const raw = value.toString('utf8');
      if (!raw.startsWith('sealed:')) {
        throw new Error('bad seal');
      }
      return raw.slice('sealed:'.length);
    },
  },
}));

const tempDirs: string[] = [];

const makeStoragePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-pro-account-'));
  tempDirs.push(dir);
  return join(dir, 'echo-pro-account.json');
};

const storedStatus = {
  loggedIn: true,
  username: 'moe',
  displayName: 'Moe',
  pro: true,
  status: 'active',
  machineCount: 1,
  maxMachineCount: 2,
  checkedAt: '2026-06-21T00:00:00.000Z',
  lastError: null,
};

afterEach(() => {
  electronMocks.encryptionAvailable = true;
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('EchoProAccountService account storage', () => {
  it('migrates legacy plaintext session tokens to safeStorage envelopes', () => {
    const storagePath = makeStoragePath();
    writeFileSync(storagePath, `${JSON.stringify({ sessionToken: 'legacy-token', status: storedStatus }, null, 2)}\n`);

    const service = new EchoProAccountService(storagePath);
    const persisted = readFileSync(storagePath, 'utf8');
    const parsed = JSON.parse(persisted) as { encryptedSessionToken?: string; sessionToken?: string | null };

    expect(service.getSessionToken()).toBe('legacy-token');
    expect(parsed.sessionToken).toBeNull();
    expect(parsed.encryptedSessionToken).toMatch(/^safe:/u);
    expect(persisted).not.toContain('legacy-token');
  });

  it('reads safeStorage encrypted session tokens', () => {
    const storagePath = makeStoragePath();
    const encryptedSessionToken = `safe:${Buffer.from('sealed:stored-token', 'utf8').toString('base64')}`;
    writeFileSync(storagePath, `${JSON.stringify({ encryptedSessionToken, sessionToken: null, status: storedStatus }, null, 2)}\n`);

    const service = new EchoProAccountService(storagePath);

    expect(service.getSessionToken()).toBe('stored-token');
    expect(service.getStatus().pro).toBe(true);
  });
});

describe('EchoProAccountService feature verification', () => {
  it('verifies Pro feature gates through the server and caches successful checks', async () => {
    const storagePath = makeStoragePath();
    const encryptedSessionToken = `safe:${Buffer.from('sealed:stored-token', 'utf8').toString('base64')}`;
    writeFileSync(storagePath, `${JSON.stringify({ encryptedSessionToken, sessionToken: null, status: storedStatus }, null, 2)}\n`);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({
        unlocked: true,
        reason: 'unlocked',
        cacheSeconds: 3600,
        user: {
          username: 'moe',
          displayName: 'Moe',
          pro: true,
          status: 'active',
          machineCount: 1,
          maxMachineCount: 2,
        },
      }),
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new EchoProAccountService(storagePath);
    await expect(service.verifyFeature('remote-sources')).resolves.toMatchObject({ pro: true });
    await expect(service.verifyFeature('remote-sources')).resolves.toMatchObject({ pro: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://echonext.moe/api/echo-pro/verify');
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      appId: 'echo-next',
      featureId: 'connect',
      pluginId: 'echo.connect-donator-unlock',
      requiredVersion: 'plugin:echo.connect-donator-unlock:v1',
      authMode: 'account',
      hwidHash: 'a'.repeat(64),
      appVersion: '26.6.14',
      requestedFeature: 'remote-sources',
    });
  });

  it('rejects Pro feature gates when server verification does not unlock the feature', async () => {
    const storagePath = makeStoragePath();
    const encryptedSessionToken = `safe:${Buffer.from('sealed:stored-token', 'utf8').toString('base64')}`;
    writeFileSync(storagePath, `${JSON.stringify({ encryptedSessionToken, sessionToken: null, status: storedStatus }, null, 2)}\n`);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        unlocked: false,
        reason: 'license-invalid',
        user: {
          username: 'moe',
          displayName: 'Moe',
          pro: false,
          status: 'active',
          machineCount: 1,
          maxMachineCount: 2,
        },
      }),
      status: 200,
    })));

    const service = new EchoProAccountService(storagePath);

    await expect(service.verifyFeature('plugins')).rejects.toThrow('license-invalid');
  });
});

describe('EchoProAccountService key redemption', () => {
  it('redeems ECHO Pro keys with the current machine hash for server-side binding', async () => {
    const storagePath = makeStoragePath();
    const encryptedSessionToken = `safe:${Buffer.from('sealed:stored-token', 'utf8').toString('base64')}`;
    writeFileSync(storagePath, `${JSON.stringify({ encryptedSessionToken, sessionToken: null, status: storedStatus }, null, 2)}\n`);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        redeemedAt: '2026-06-22T00:00:00.000Z',
        user: {
          username: 'moe',
          displayName: 'Moe',
          pro: true,
          status: 'active',
          machineCount: 1,
          maxMachineCount: 2,
        },
      }),
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new EchoProAccountService(storagePath);

    await expect(service.redeemKey('ECHO-AAAAA-BBBBB-CCCCC-DDDDD')).resolves.toMatchObject({
      ok: true,
      status: { pro: true },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://echonext.moe/api/echo-pro/keys/redeem');
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      key: 'ECHO-AAAAA-BBBBB-CCCCC-DDDDD',
      hwidHash: 'a'.repeat(64),
    });
  });
});

describe('EchoProAccountService settings cloud status', () => {
  it('reports cloud sync as quietly unavailable when the Pro account is not logged in', async () => {
    const service = new EchoProAccountService(makeStoragePath());

    await expect(service.getSettingsCloudStatus()).resolves.toMatchObject({
      available: false,
      lastError: null,
    });
  });

  it('reports cloud sync as quietly unavailable when the account is not Pro', async () => {
    const storagePath = makeStoragePath();
    const encryptedSessionToken = `safe:${Buffer.from('sealed:stored-token', 'utf8').toString('base64')}`;
    writeFileSync(storagePath, `${JSON.stringify({
      encryptedSessionToken,
      sessionToken: null,
      status: { ...storedStatus, pro: false },
    }, null, 2)}\n`);
    const service = new EchoProAccountService(storagePath);

    await expect(service.getSettingsCloudStatus()).resolves.toMatchObject({
      available: false,
      lastError: null,
    });
  });

  it('still rejects cloud sync writes when the Pro account is not logged in', async () => {
    const service = new EchoProAccountService(makeStoragePath());

    await expect(service.saveSettingsCloud({
      settings: {},
      librarySync: {
        version: 1,
        savedAt: '2026-06-22T00:00:00.000Z',
        streamingPlaylists: [],
        streamingFavorites: {
          version: 1,
          updatedAt: '2026-06-22T00:00:00.000Z',
          providers: { bilibili: [], youtube: [], soundcloud: [] },
          collections: [],
        },
      },
      appVersion: '26.6.14',
      deviceName: null,
    })).rejects.toThrow('ECHO Pro account login is required.');
  });
});
