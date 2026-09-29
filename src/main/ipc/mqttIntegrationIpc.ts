import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  MqttIntegrationSettingsPatch,
  MqttIntegrationStatus,
} from '../../shared/types/mqttIntegration';
import { getMqttIntegrationService } from '../integrations/mqtt/MqttIntegrationService';

const normalizePatch = (value: unknown): MqttIntegrationSettingsPatch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_mqtt_settings_patch');
  }
  const patch = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'enabled',
    'brokerUrl',
    'username',
    'clientId',
    'topicPrefix',
    'homeAssistantDiscoveryEnabled',
    'homeAssistantDiscoveryPrefix',
    'password',
  ]);
  if (Object.keys(patch).some((key) => !allowedKeys.has(key))) {
    throw new Error('invalid_mqtt_settings_patch');
  }
  return patch as MqttIntegrationSettingsPatch;
};

export const registerMqttIntegrationIpc = (): void => {
  ipcMain.handle(
    IpcChannels.MqttIntegrationGetStatus,
    (): MqttIntegrationStatus => getMqttIntegrationService().getStatus(),
  );
  ipcMain.handle(
    IpcChannels.MqttIntegrationUpdateSettings,
    (_event, patch: unknown): Promise<MqttIntegrationStatus> =>
      getMqttIntegrationService().updateSettings(normalizePatch(patch)),
  );
};

