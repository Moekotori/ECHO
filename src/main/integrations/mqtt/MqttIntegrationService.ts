import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import type { AppSettings } from '../../../shared/types/appSettings';
import type {
  MqttIntegrationSettings,
  MqttIntegrationSettingsPatch,
  MqttIntegrationStatus,
} from '../../../shared/types/mqttIntegration';
import { getAppSettings, setAppSettings } from '../../app/appSettings';
import { IntegrationAdapterRuntime } from '../core/IntegrationAdapterRuntime';
import { MqttCredentialStore } from './MqttCredentialStore';
import {
  createMqttIntegrationTopics,
  MqttIntegrationAdapter,
} from './MqttIntegrationAdapter';

const validBrokerProtocols = new Set(['mqtt:', 'mqtts:', 'ws:', 'wss:']);
const mqttIdentifierPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const mqttDeviceIdPattern = /^[A-Za-z0-9_-]{3,64}$/u;
const mqttTopicPrefixPattern = /^(?!\/)(?!.*\/\/)[A-Za-z0-9_/-]{1,128}(?<!\/)$/u;

const normalizeBrokerUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new Error('invalid_mqtt_broker_url');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('invalid_mqtt_broker_url');
  }
  if (!validBrokerProtocols.has(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('invalid_mqtt_broker_url');
  }
  return url.toString().replace(/\/$/u, '');
};

const normalizeOptionalIdentifier = (value: unknown, code: string): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !mqttIdentifierPattern.test(value.trim())) {
    throw new Error(code);
  }
  return value.trim();
};

const normalizeOptionalUsername = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('invalid_mqtt_username');
  }
  return value;
};

const normalizeTopicPrefix = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !mqttTopicPrefixPattern.test(value.trim())) {
    throw new Error(code);
  }
  return value.trim();
};

const createDeviceId = (): string => `echo-${randomBytes(6).toString('hex')}`;

const settingsFromAppSettings = (settings: AppSettings): MqttIntegrationSettings => {
  const deviceId = settings.mqttDeviceId && mqttDeviceIdPattern.test(settings.mqttDeviceId)
    ? settings.mqttDeviceId
    : createDeviceId();
  return {
    enabled: settings.mqttIntegrationEnabled === true,
    brokerUrl: settings.mqttBrokerUrl ?? 'mqtt://127.0.0.1:1883',
    username: settings.mqttUsername ?? null,
    clientId: settings.mqttClientId ?? `echo-next-${deviceId}`,
    deviceId,
    topicPrefix: settings.mqttTopicPrefix ?? 'echo',
    homeAssistantDiscoveryEnabled: settings.mqttHomeAssistantDiscoveryEnabled === true,
    homeAssistantDiscoveryPrefix: settings.mqttHomeAssistantDiscoveryPrefix ?? 'homeassistant',
  };
};

export type MqttIntegrationServiceOptions = {
  credentialStore?: MqttCredentialStore;
  createRuntime?: () => IntegrationAdapterRuntime;
  createAdapter?: (
    settings: MqttIntegrationSettings,
    password: string | null,
  ) => MqttIntegrationAdapter;
  getSettings?: () => AppSettings;
  setSettings?: (patch: Partial<AppSettings>) => AppSettings;
  appVersion?: string;
};

export class MqttIntegrationService {
  private readonly credentialStore: MqttCredentialStore;
  private readonly createRuntime: () => IntegrationAdapterRuntime;
  private readonly createAdapter: (
    settings: MqttIntegrationSettings,
    password: string | null,
  ) => MqttIntegrationAdapter;
  private readonly getSettings: () => AppSettings;
  private readonly setSettings: (patch: Partial<AppSettings>) => AppSettings;
  private runtime: IntegrationAdapterRuntime | null = null;
  private adapter: MqttIntegrationAdapter | null = null;
  private syncQueue: Promise<void> = Promise.resolve();
  private lifecycleError: string | null = null;

  constructor(options: MqttIntegrationServiceOptions = {}) {
    this.credentialStore = options.credentialStore ?? new MqttCredentialStore();
    this.createRuntime = options.createRuntime ?? (() => new IntegrationAdapterRuntime());
    this.getSettings = options.getSettings ?? getAppSettings;
    this.setSettings = options.setSettings ?? setAppSettings;
    const appVersion = options.appVersion ?? app.getVersion();
    this.createAdapter = options.createAdapter ?? ((settings, password) =>
      new MqttIntegrationAdapter({ settings, password, appVersion }));
  }

  getStatus(): MqttIntegrationStatus {
    const settings = this.ensureStableIdentity();
    const diagnostics = this.adapter?.getDiagnostics();
    return {
      settings,
      phase: diagnostics?.phase ?? (settings.enabled ? 'connecting' : 'disabled'),
      connected: diagnostics?.connected ?? false,
      passwordConfigured: this.credentialStore.hasPassword(),
      error: diagnostics?.error ?? this.lifecycleError,
      lastConnectedAt: diagnostics?.lastConnectedAt ?? null,
      lastCommandAt: diagnostics?.lastCommandAt ?? null,
      topics: createMqttIntegrationTopics(settings),
    };
  }

  async updateSettings(patch: MqttIntegrationSettingsPatch): Promise<MqttIntegrationStatus> {
    const current = this.ensureStableIdentity();
    const appPatch: Partial<AppSettings> = {};
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw new Error('invalid_mqtt_enabled_state');
      appPatch.mqttIntegrationEnabled = patch.enabled;
    }
    if (patch.brokerUrl !== undefined) {
      appPatch.mqttBrokerUrl = normalizeBrokerUrl(patch.brokerUrl);
    }
    if (patch.username !== undefined) {
      appPatch.mqttUsername = normalizeOptionalUsername(patch.username);
    }
    if (patch.clientId !== undefined) {
      appPatch.mqttClientId =
        normalizeOptionalIdentifier(patch.clientId, 'invalid_mqtt_client_id') ??
        `echo-next-${current.deviceId}`;
    }
    if (patch.topicPrefix !== undefined) {
      appPatch.mqttTopicPrefix = normalizeTopicPrefix(
        patch.topicPrefix,
        'invalid_mqtt_topic_prefix',
      );
    }
    if (patch.homeAssistantDiscoveryEnabled !== undefined) {
      if (typeof patch.homeAssistantDiscoveryEnabled !== 'boolean') {
        throw new Error('invalid_mqtt_home_assistant_discovery_state');
      }
      appPatch.mqttHomeAssistantDiscoveryEnabled = patch.homeAssistantDiscoveryEnabled;
    }
    if (patch.homeAssistantDiscoveryPrefix !== undefined) {
      appPatch.mqttHomeAssistantDiscoveryPrefix = normalizeTopicPrefix(
        patch.homeAssistantDiscoveryPrefix,
        'invalid_mqtt_home_assistant_discovery_prefix',
      );
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'password')) {
      if (patch.password !== null && patch.password !== undefined && typeof patch.password !== 'string') {
        throw new Error('invalid_mqtt_password');
      }
      if (typeof patch.password === 'string' && patch.password.length > 512) {
        throw new Error('invalid_mqtt_password');
      }
      this.credentialStore.setPassword(patch.password ?? null);
    }
    if (
      current.homeAssistantDiscoveryEnabled &&
      (
        patch.homeAssistantDiscoveryEnabled === false ||
        (
          patch.homeAssistantDiscoveryPrefix !== undefined &&
          patch.homeAssistantDiscoveryPrefix !== current.homeAssistantDiscoveryPrefix
        )
      )
    ) {
      await this.adapter?.clearHomeAssistantDiscovery();
    }
    if (Object.keys(appPatch).length > 0) {
      this.setSettings(appPatch);
    }
    await this.syncFromSettings();
    return this.getStatus();
  }

  async syncFromSettings(): Promise<void> {
    this.syncQueue = this.syncQueue.then(() => this.performSync());
    await this.syncQueue;
  }

  async dispose(): Promise<void> {
    await this.syncQueue.catch(() => undefined);
    await this.stopRuntime();
  }

  private ensureStableIdentity(): MqttIntegrationSettings {
    let appSettings = this.getSettings();
    let settings = settingsFromAppSettings(appSettings);
    const patch: Partial<AppSettings> = {};
    if (appSettings.mqttDeviceId !== settings.deviceId) {
      patch.mqttDeviceId = settings.deviceId;
    }
    if (!appSettings.mqttClientId) {
      patch.mqttClientId = settings.clientId;
    }
    if (Object.keys(patch).length > 0) {
      appSettings = this.setSettings(patch);
      settings = settingsFromAppSettings(appSettings);
    }
    return settings;
  }

  private async performSync(): Promise<void> {
    await this.stopRuntime();
    const settings = this.ensureStableIdentity();
    this.lifecycleError = null;
    if (!settings.enabled) {
      return;
    }
    try {
      const runtime = this.createRuntime();
      const adapter = this.createAdapter(settings, this.credentialStore.getPassword());
      runtime.register(adapter);
      this.runtime = runtime;
      this.adapter = adapter;
      await runtime.start(adapter.id);
    } catch (error) {
      this.lifecycleError = error instanceof Error ? error.message : String(error);
      await this.stopRuntime();
      throw error;
    }
  }

  private async stopRuntime(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.adapter = null;
    if (runtime) {
      await runtime.dispose();
    }
  }
}

let defaultMqttIntegrationService: MqttIntegrationService | null = null;

export const getMqttIntegrationService = (): MqttIntegrationService => {
  defaultMqttIntegrationService ??= new MqttIntegrationService();
  return defaultMqttIntegrationService;
};

export const initializeMqttIntegration = async (): Promise<void> => {
  await getMqttIntegrationService().syncFromSettings();
};

export const disposeMqttIntegration = async (): Promise<void> => {
  const service = defaultMqttIntegrationService;
  defaultMqttIntegrationService = null;
  await service?.dispose();
};
