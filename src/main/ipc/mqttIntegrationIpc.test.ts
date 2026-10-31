import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getStatus: vi.fn(() => ({ phase: 'disabled' })),
  updateSettings: vi.fn(async () => ({ phase: 'connecting' })),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
}));

vi.mock('../integrations/mqtt/MqttIntegrationService', () => ({
  getMqttIntegrationService: () => ({
    getStatus: mocks.getStatus,
    updateSettings: mocks.updateSettings,
  }),
}));

import { registerMqttIntegrationIpc } from './mqttIntegrationIpc';

describe('registerMqttIntegrationIpc', () => {
  beforeEach(() => {
    mocks.handle.mockReset();
    mocks.getStatus.mockClear();
    mocks.updateSettings.mockClear();
  });

  it('registers status and settings handlers', async () => {
    registerMqttIntegrationIpc();
    const handlers = Object.fromEntries(
      mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]),
    ) as Record<string, (...args: unknown[]) => unknown>;

    expect(handlers[IpcChannels.MqttIntegrationGetStatus]?.()).toEqual({ phase: 'disabled' });
    await expect(handlers[IpcChannels.MqttIntegrationUpdateSettings]?.(
      null,
      { enabled: true, password: 'secret' },
    )).resolves.toEqual({ phase: 'connecting' });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ enabled: true, password: 'secret' });
  });

  it('rejects unknown fields before they reach the service', async () => {
    registerMqttIntegrationIpc();
    const handlers = Object.fromEntries(
      mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]),
    ) as Record<string, (...args: unknown[]) => unknown>;

    expect(() => handlers[IpcChannels.MqttIntegrationUpdateSettings]?.(
      null,
      { enabled: true, accessToken: 'nope' },
    )).toThrow('invalid_mqtt_settings_patch');
  });
});

