import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadFeatureUnlockStatus } from '../../shared/constants/featureUnlocks';

const mocks = vi.hoisted(() => ({
  downloadStatus: null as DownloadFeatureUnlockStatus | null,
  proLicenseStatus: {
    valid: false,
    enabled: false,
    features: [] as string[],
    checkedAt: '2026-06-21T00:00:00.000Z',
  },
  plugins: [] as Array<{
    id: string;
    enabled: boolean;
    status: 'disabled' | 'enabled' | 'running' | 'error';
    disabledByHost?: boolean;
  }>,
}));

vi.mock('./PluginService', () => ({
  getPluginService: () => ({
    list: () => ({ directory: 'D:\\Echo\\plugins', plugins: mocks.plugins }),
    getEchoProLicenseStatus: () => mocks.proLicenseStatus,
  }),
}));

vi.mock('./privateEntitlements', () => ({
  getPrivateEntitlementsProvider: () => ({
    getDownloadStatus: () => mocks.downloadStatus,
  }),
}));

describe('DownloadFeatureUnlockService', () => {
  beforeEach(() => {
    mocks.downloadStatus = null;
    mocks.proLicenseStatus = {
      valid: false,
      enabled: false,
      features: [],
      checkedAt: '2026-06-21T00:00:00.000Z',
    };
    mocks.plugins = [];
    vi.resetModules();
  });

  it('blocks when the downloads unlock plugin is missing', async () => {
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    const status = service.getStatus();

    expect(status).toMatchObject({
      unlocked: false,
      pluginInstalled: false,
      pluginEnabled: false,
      reason: 'plugin-missing',
    });
  });

  it('unlocks when the dedicated downloads plugin is enabled', async () => {
    mocks.plugins = [{
      id: 'echo.downloads-unlock',
      enabled: true,
      status: 'running',
    }];
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    const status = service.getStatus();

    expect(status).toMatchObject({
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      reason: 'unlocked',
    });
  });

  it('does not unlock downloads from the ECHO Pro plugin alone', async () => {
    mocks.proLicenseStatus = {
      valid: true,
      enabled: true,
      features: ['echo-pro'],
      checkedAt: '2026-06-21T00:00:00.000Z',
    };
    mocks.plugins = [{
      id: 'echo.pro-unlock',
      enabled: true,
      status: 'running',
    }];
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: false,
      pluginInstalled: false,
      pluginEnabled: false,
      reason: 'plugin-missing',
    });
  });

  it('unlocks downloads when the ECHO Pro license contains the downloads feature', async () => {
    mocks.proLicenseStatus = {
      valid: true,
      enabled: true,
      features: ['echo-pro', 'downloads'],
      checkedAt: '2026-06-21T00:00:00.000Z',
    };
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      reason: 'unlocked',
    });
  });

  it('unlocks only when the private overlay reports Pro plus plugin authorization', async () => {
    mocks.downloadStatus = {
      featureId: 'downloads',
      pluginId: 'echo.downloads-unlock',
      requiredVersion: 'plugin:echo.downloads-unlock:v1',
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      reason: 'unlocked',
      checkedAt: '2026-06-21T00:00:00.000Z',
    };
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      reason: 'unlocked',
    });
  });

  it('throws the legacy lock error when asserted', async () => {
    const { DownloadFeatureUnlockService } = await import('./DownloadFeatureUnlockService');
    const service = new DownloadFeatureUnlockService();

    expect(() => service.assertUnlocked()).toThrow('downloads_plugin_unlock_required');
  });
});
