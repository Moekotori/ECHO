import QRCode from 'qrcode';
import { hqPlayerConnectDeviceId, type ConnectDevice, type ConnectSessionStatus } from '../../../shared/types/connect';
import type { EchoLinkBasicStatus } from '../../../shared/types/echoLink';
import type { MqttIntegrationSettings, MqttIntegrationStatus, MqttIntegrationTopics } from '../../../shared/types/mqttIntegration';

export const isConnectBrowserPreview =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  new URLSearchParams(window.location.search).get('connectPreview') === '1';

export const connectBrowserPreviewStatus: ConnectSessionStatus = {
  deviceId: 'preview-dlna-living-room',
  protocol: 'dlna',
  state: 'playing',
  currentTrackId: 'connect-preview-track',
  metadata: {
    title: 'Snow Halation',
    artist: 'μ’s',
    album: 'μ’s Best Album',
    albumArtist: 'μ’s',
    durationSeconds: 248,
    coverHttpUrl: '',
  },
  positionSeconds: 92,
  durationSeconds: 248,
  volume: 72,
  latencyMs: 86,
  error: null,
  updatedAt: new Date().toISOString(),
};

const previewCapabilities = {
  canPlay: true,
  canPause: true,
  canStop: true,
  canSeek: true,
  canSetVolume: true,
  supportsMetadata: true,
  supportsSetNext: false,
  requiresTranscode: false,
};

export const connectBrowserPreviewDevices: ConnectDevice[] = [
  {
    id: 'preview-dlna-living-room',
    name: '客厅数播',
    protocol: 'dlna',
    model: 'N130',
    manufacturer: 'Silent Angel',
    address: '192.168.1.42',
    capabilities: { ...previewCapabilities, supportsSetNext: true, supportedMimeTypes: ['audio/flac', 'audio/wav', 'audio/mpeg'] },
    state: 'connected',
    lastSeenAt: new Date().toISOString(),
    unsupportedReason: null,
  },
  {
    id: 'preview-airplay-study',
    name: '书房 AirPlay',
    protocol: 'airplay',
    model: 'HomePod',
    manufacturer: 'Apple',
    address: '192.168.1.55',
    capabilities: { ...previewCapabilities, canSeek: false, supportedMimeTypes: ['audio/alac', 'audio/aac'] },
    state: 'available',
    lastSeenAt: new Date().toISOString(),
    unsupportedReason: null,
  },
  {
    id: hqPlayerConnectDeviceId,
    name: 'HQPlayer Desktop',
    protocol: 'hqplayer',
    model: 'Desktop 5',
    manufacturer: 'Signalyst',
    address: '127.0.0.1:4321',
    capabilities: { ...previewCapabilities, supportedMimeTypes: ['audio/flac', 'audio/wav', 'audio/dsd'] },
    state: 'available',
    lastSeenAt: new Date().toISOString(),
    unsupportedReason: null,
  },
];

const cloneEchoLinkBasicStatus = (status: EchoLinkBasicStatus): EchoLinkBasicStatus => ({
  ...status,
  addresses: [...status.addresses],
  clients: status.clients.map((client) => ({ ...client, scopes: [...client.scopes] })),
});

let previewEchoLinkBasicStatus: EchoLinkBasicStatus = {
  enabled: true,
  running: true,
  host: '192.168.1.89',
  port: 26789,
  addresses: ['192.168.1.89'],
  deviceId: 'echo-next-preview',
  deviceName: 'ECHO Next',
  pairingActive: false,
  clients: [
    {
      id: 'preview-mobile-remote',
      name: 'ECHO Mobile Remote',
      platform: 'Android',
      scopes: ['status:read', 'events:read', 'playback:control'],
      createdAt: '2026-07-17T12:21:00.000Z',
      lastSeenAt: '2026-08-03T08:12:00.000Z',
    },
    {
      id: 'preview-tablet-remote',
      name: '客厅平板',
      platform: 'iPadOS',
      scopes: ['status:read', 'events:read', 'playback:control'],
      createdAt: '2026-07-22T05:18:00.000Z',
      lastSeenAt: '2026-08-03T08:08:00.000Z',
    },
  ],
  error: null,
  updatedAt: new Date().toISOString(),
};

type EchoLinkBasicBridge = NonNullable<NonNullable<Window['echo']>['echoLink']>;

export const connectBrowserPreviewEchoLinkBridge: EchoLinkBasicBridge = {
  getStatus: async () => cloneEchoLinkBasicStatus(previewEchoLinkBasicStatus),
  setEnabled: async (enabled) => {
    previewEchoLinkBasicStatus = {
      ...previewEchoLinkBasicStatus,
      enabled,
      running: enabled,
      pairingActive: enabled ? previewEchoLinkBasicStatus.pairingActive : false,
      updatedAt: new Date().toISOString(),
    };
    return cloneEchoLinkBasicStatus(previewEchoLinkBasicStatus);
  },
  startPairing: async () => {
    const pairingUri = 'echo://pair?version=2&host=192.168.1.89&port=26789&pairingId=preview&secret=preview-only';
    const webRemoteUrl = `http://192.168.1.89:26789/echo-link/v2/remote#pair=${encodeURIComponent(pairingUri)}`;
    previewEchoLinkBasicStatus = {
      ...previewEchoLinkBasicStatus,
      pairingActive: true,
      updatedAt: new Date().toISOString(),
    };
    return {
      id: 'preview-pairing',
      pairingUri,
      webRemoteUrl,
      qrDataUrl: await QRCode.toDataURL(webRemoteUrl, { width: 420, margin: 2 }),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
  },
  cancelPairing: async () => {
    previewEchoLinkBasicStatus = {
      ...previewEchoLinkBasicStatus,
      pairingActive: false,
      updatedAt: new Date().toISOString(),
    };
    return cloneEchoLinkBasicStatus(previewEchoLinkBasicStatus);
  },
  revokeClient: async (clientId) => {
    previewEchoLinkBasicStatus = {
      ...previewEchoLinkBasicStatus,
      clients: previewEchoLinkBasicStatus.clients.filter((client) => client.id !== clientId),
      updatedAt: new Date().toISOString(),
    };
    return cloneEchoLinkBasicStatus(previewEchoLinkBasicStatus);
  },
};

const buildPreviewMqttTopics = (settings: MqttIntegrationSettings): MqttIntegrationTopics => {
  const root = `${settings.topicPrefix}/${settings.deviceId}`;
  return {
    root,
    state: `${root}/state`,
    event: `${root}/event`,
    command: `${root}/command`,
    result: `${root}/result`,
    availability: `${root}/availability`,
    homeAssistantDiscovery: settings.homeAssistantDiscoveryEnabled
      ? `${settings.homeAssistantDiscoveryPrefix}/device/${settings.deviceId}/config`
      : null,
  };
};

let previewMqttSettings: MqttIntegrationSettings = {
  enabled: false,
  brokerUrl: 'mqtt://127.0.0.1:1883',
  username: null,
  clientId: 'echo-next-preview',
  deviceId: 'echo-next-preview',
  topicPrefix: 'echo',
  homeAssistantDiscoveryEnabled: false,
  homeAssistantDiscoveryPrefix: 'homeassistant',
};

const createPreviewMqttStatus = (): MqttIntegrationStatus => ({
  settings: { ...previewMqttSettings },
  phase: previewMqttSettings.enabled ? 'connected' : 'disabled',
  connected: previewMqttSettings.enabled,
  passwordConfigured: false,
  error: null,
  lastConnectedAt: previewMqttSettings.enabled ? new Date().toISOString() : null,
  lastCommandAt: null,
  topics: buildPreviewMqttTopics(previewMqttSettings),
});

type MqttIntegrationBridge = NonNullable<NonNullable<Window['echo']>['mqttIntegration']>;

export const connectBrowserPreviewMqttBridge: MqttIntegrationBridge = {
  getStatus: async () => createPreviewMqttStatus(),
  updateSettings: async (patch) => {
    const { password: _password, ...settingsPatch } = patch;
    previewMqttSettings = { ...previewMqttSettings, ...settingsPatch };
    return createPreviewMqttStatus();
  },
};
