import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const sourceRoot = process.env.ECHO_PRO_LOCAL_MIGRATION_SOURCE?.trim() ?? '';
const fixtureRoot = sourceRoot
  ? mkdtempSync(join(tmpdir(), 'echo-pro-local-migration-'))
  : join(tmpdir(), 'echo-pro-local-migration-unused');

vi.mock('electron', () => {
  const electronMock = {
    app: {
      getPath: (name: string) => name === 'appData' ? dirname(sourceRoot) : fixtureRoot,
      getVersion: () => '26.7.18',
      isPackaged: true,
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    shell: {
      openPath: vi.fn(async () => ''),
      trashItem: vi.fn(async () => undefined),
    },
  };
  return { ...electronMock, default: electronMock };
});

describe.skipIf(!sourceRoot)('real local ECHO Pro migration', () => {
  beforeAll(() => {
    mkdirSync(join(fixtureRoot, 'plugins'), { recursive: true });
    cpSync(
      join(sourceRoot, 'plugins', 'echo.pro-unlock'),
      join(fixtureRoot, 'plugins', 'echo.pro-unlock'),
      { recursive: true },
    );
    copyFileSync(
      join(sourceRoot, 'plugins', 'plugin-state.json'),
      join(fixtureRoot, 'plugins', 'plugin-state.json'),
    );
    cpSync(join(sourceRoot, 'identity'), join(fixtureRoot, 'identity'), { recursive: true });
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('migrates the real enabled plugin, survives plugin removal and retains offline grace after restart', async () => {
    const { PluginService } = await import('./PluginService');
    const entitlementPath = join(fixtureRoot, 'entitlements', 'echo-pro-entitlement.json');
    expect(existsSync(entitlementPath)).toBe(false);

    const service = new PluginService(join(fixtureRoot, 'plugins'));
    expect(service.list().plugins.some((plugin) => plugin.id === 'echo.pro-unlock')).toBe(false);
    expect(service.getEchoProLicenseStatus()).toMatchObject({
      valid: true,
      reason: 'unlocked',
    });
    expect(service.getEchoProLicenseSource()).toBe('native-license');
    expect(existsSync(entitlementPath)).toBe(true);

    const envelope = JSON.parse(readFileSync(entitlementPath, 'utf8')) as {
      source: string;
      license: { licenseId: string };
      offlineUntil: string;
    };
    expect(envelope.source).toBe('legacy-plugin-migration');
    expect(envelope.license.licenseId).toMatch(/^lic_[a-f0-9]{16}$/u);
    expect(Date.parse(envelope.offlineUntil)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(existsSync(join(fixtureRoot, 'plugins', 'echo.pro-unlock'))).toBe(false);
    expect(existsSync(join(
      fixtureRoot,
      'entitlements',
      `legacy-plugin-backup-${envelope.license.licenseId}`,
    ))).toBe(true);

    const restarted = new PluginService(join(fixtureRoot, 'plugins'));
    expect(restarted.list().plugins.some((plugin) => plugin.id === 'echo.pro-unlock')).toBe(false);
    expect(restarted.getEchoProLicenseStatus()).toMatchObject({
      valid: true,
      reason: 'unlocked',
      licenseId: envelope.license.licenseId,
    });
    const { getLocalProEntitlementSnapshot } = await import('./LocalProEntitlements');
    expect(getLocalProEntitlementSnapshot('echo-pro')).toMatchObject({
      unlocked: true,
      source: 'native-license',
    });

    const fetchMock = vi.fn(async () => {
      throw new Error('simulated_offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    const migratedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(migratedAt + 13 * 60 * 60 * 1000);
    try {
      await restarted.ensureEchoProLicenseOnlineFresh();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(restarted.getEchoProLicenseStatus()).toMatchObject({
        valid: true,
        reason: 'unlocked',
        licenseId: envelope.license.licenseId,
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
