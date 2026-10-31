export type MqttIntegrationPhase = 'disabled' | 'connecting' | 'connected' | 'error';

export type MqttIntegrationSettings = {
  enabled: boolean;
  brokerUrl: string;
  username: string | null;
  clientId: string;
  deviceId: string;
  topicPrefix: string;
  homeAssistantDiscoveryEnabled: boolean;
  homeAssistantDiscoveryPrefix: string;
};

export type MqttIntegrationSettingsPatch = Partial<
  Omit<MqttIntegrationSettings, 'deviceId'>
> & {
  password?: string | null;
};

export type MqttIntegrationTopics = {
  root: string;
  state: string;
  event: string;
  command: string;
  result: string;
  availability: string;
  homeAssistantDiscovery: string | null;
};

export type MqttIntegrationStatus = {
  settings: MqttIntegrationSettings;
  phase: MqttIntegrationPhase;
  connected: boolean;
  passwordConfigured: boolean;
  error: string | null;
  lastConnectedAt: string | null;
  lastCommandAt: string | null;
  topics: MqttIntegrationTopics;
};

