import { hostname } from 'node:os';
import {
  connect as connectMqtt,
  type IClientOptions,
  type MqttClient,
} from 'mqtt';
import type {
  IntegrationEventEnvelopeV1,
  IntegrationPlaybackAction,
  IntegrationPlaybackSnapshotV1,
} from '../../../shared/types/integrationPlatform';
import type {
  MqttIntegrationPhase,
  MqttIntegrationSettings,
  MqttIntegrationTopics,
} from '../../../shared/types/mqttIntegration';
import type {
  IntegrationAdapter,
  IntegrationAdapterContext,
} from '../core/IntegrationAdapterRuntime';

type MqttClientFactory = (brokerUrl: string, options: IClientOptions) => MqttClient;

export type MqttIntegrationAdapterOptions = {
  settings: MqttIntegrationSettings;
  password: string | null;
  appVersion: string;
  deviceName?: string;
  connect?: MqttClientFactory;
  now?: () => number;
  commandLimit?: number;
  commandWindowMs?: number;
};

type AdapterDiagnostics = {
  phase: MqttIntegrationPhase;
  connected: boolean;
  error: string | null;
  lastConnectedAt: string | null;
  lastCommandAt: string | null;
};

type CommandWindow = {
  startedAt: number;
  count: number;
};

const requestIdPattern = /^[A-Za-z0-9._:-]{1,64}$/u;
const clientIdPattern = /^[A-Za-z0-9._:-]{1,64}$/u;
const completedRequestTtlMs = 5 * 60_000;
const maxCompletedRequests = 512;

const safeSnapshot = (snapshot: IntegrationPlaybackSnapshotV1): Record<string, unknown> => ({
  version: 1,
  revision: snapshot.revision,
  observedAt: snapshot.observedAt,
  state: snapshot.state === 'ended' ? 'stopped' : snapshot.state,
  track: snapshot.track ? {
    id: snapshot.track.id,
    title: snapshot.track.title,
    artist: snapshot.track.artist,
    album: snapshot.track.album,
    albumArtist: snapshot.track.albumArtist,
  } : null,
  positionMs: snapshot.positionMs,
  durationMs: snapshot.durationMs,
  volume: snapshot.volume,
  output: {
    mode: snapshot.output.mode,
    deviceName: snapshot.output.deviceName,
    backend: snapshot.output.backend,
  },
});

const toSafeEvent = (event: IntegrationEventEnvelopeV1): Record<string, unknown> => ({
  version: event.version,
  id: event.id,
  type: event.type,
  occurredAt: event.occurredAt,
  snapshot: safeSnapshot(event.snapshot),
});

const parseRecord = (payload: Buffer): Record<string, unknown> => {
  const value = JSON.parse(payload.toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_command_payload');
  }
  return value as Record<string, unknown>;
};

const normalizeAction = (value: Record<string, unknown>): IntegrationPlaybackAction => {
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  if (!requestIdPattern.test(requestId)) {
    throw new Error('invalid_request_id');
  }
  switch (value.action) {
    case 'play':
    case 'pause':
    case 'stop':
    case 'previous':
    case 'next':
      return { requestId, action: value.action };
    case 'seek': {
      const positionMs = Number(value.positionMs);
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new Error('invalid_seek_position');
      }
      return { requestId, action: 'seek', positionMs };
    }
    case 'setVolume': {
      const volume = Number(value.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new Error('invalid_volume');
      }
      return { requestId, action: 'setVolume', volume };
    }
    case 'setPlaybackOrder':
      if (value.mode !== 'sequential' && value.mode !== 'shuffle' && value.mode !== 'repeat-one') {
        throw new Error('invalid_playback_order');
      }
      return { requestId, action: 'setPlaybackOrder', mode: value.mode };
    default:
      throw new Error('unsupported_playback_action');
  }
};

export const createMqttIntegrationTopics = (
  settings: MqttIntegrationSettings,
): MqttIntegrationTopics => {
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

export class MqttIntegrationAdapter implements IntegrationAdapter {
  readonly id = 'mqtt';
  private readonly settings: MqttIntegrationSettings;
  private readonly password: string | null;
  private readonly appVersion: string;
  private readonly deviceName: string;
  private readonly connect: MqttClientFactory;
  private readonly now: () => number;
  private readonly commandLimit: number;
  private readonly commandWindowMs: number;
  private readonly topics: MqttIntegrationTopics;
  private readonly completedRequests = new Map<string, number>();
  private readonly commandWindows = new Map<string, CommandWindow>();
  private client: MqttClient | null = null;
  private context: IntegrationAdapterContext | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private latestSnapshot: IntegrationPlaybackSnapshotV1 | null = null;
  private commandQueue: Promise<void> = Promise.resolve();
  private homeAssistantRequestSequence = 0;
  private diagnostics: AdapterDiagnostics = {
    phase: 'disabled',
    connected: false,
    error: null,
    lastConnectedAt: null,
    lastCommandAt: null,
  };

  constructor(options: MqttIntegrationAdapterOptions) {
    this.settings = options.settings;
    this.password = options.password;
    this.appVersion = options.appVersion;
    this.deviceName = options.deviceName ?? hostname();
    this.connect = options.connect ?? connectMqtt;
    this.now = options.now ?? Date.now;
    this.commandLimit = options.commandLimit ?? 20;
    this.commandWindowMs = options.commandWindowMs ?? 10_000;
    this.topics = createMqttIntegrationTopics(this.settings);
  }

  async start(context: IntegrationAdapterContext): Promise<void> {
    if (this.client) {
      return;
    }
    this.context = context;
    this.latestSnapshot = context.events.getSnapshot();
    this.unsubscribeEvents = context.events.subscribe(this.handleIntegrationEvent);
    this.diagnostics = {
      ...this.diagnostics,
      phase: 'connecting',
      connected: false,
      error: null,
    };
    const client = this.connect(this.settings.brokerUrl, {
      clientId: this.settings.clientId,
      username: this.settings.username ?? undefined,
      password: this.password ?? undefined,
      protocolVersion: 5,
      reconnectPeriod: 2_000,
      connectTimeout: 10_000,
      clean: true,
      will: {
        topic: this.topics.availability,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
    this.client = client;
    client.on('connect', this.handleConnect);
    client.on('message', this.handleMessage);
    client.on('error', this.handleError);
    client.on('close', this.handleClose);
  }

  async stop(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    const client = this.client;
    this.client = null;
    this.context = null;
    if (client) {
      client.off('connect', this.handleConnect);
      client.off('message', this.handleMessage);
      client.off('error', this.handleError);
      client.off('close', this.handleClose);
      if (client.connected) {
        await client.publishAsync(this.topics.availability, 'offline', { qos: 1, retain: true })
          .catch(() => undefined);
      }
      await client.endAsync().catch(() => undefined);
    }
    await this.commandQueue.catch(() => undefined);
    this.diagnostics = {
      ...this.diagnostics,
      phase: 'disabled',
      connected: false,
      error: null,
    };
  }

  getDiagnostics(): AdapterDiagnostics {
    return { ...this.diagnostics };
  }

  async clearHomeAssistantDiscovery(): Promise<void> {
    const client = this.client;
    const discoveryTopic = this.topics.homeAssistantDiscovery;
    if (client?.connected && discoveryTopic) {
      await client.publishAsync(discoveryTopic, '', { qos: 1, retain: true });
    }
  }

  private readonly handleConnect = (): void => {
    this.commandQueue = this.commandQueue
      .then(() => this.initializeConnectedClient())
      .catch((error) => this.recordError(error));
  };

  private readonly handleMessage = (topic: string, payload: Buffer): void => {
    this.commandQueue = this.commandQueue
      .then(() => this.processMessage(topic, payload))
      .catch((error) => this.recordError(error));
  };

  private readonly handleError = (error: Error): void => {
    this.recordError(error);
  };

  private readonly handleClose = (): void => {
    if (this.client) {
      this.diagnostics = {
        ...this.diagnostics,
        phase: this.diagnostics.error ? 'error' : 'connecting',
        connected: false,
      };
    }
  };

  private readonly handleIntegrationEvent = (event: IntegrationEventEnvelopeV1): void => {
    this.latestSnapshot = event.snapshot;
    const client = this.client;
    if (!client?.connected) {
      return;
    }
    void Promise.all([
      client.publishAsync(this.topics.state, JSON.stringify(safeSnapshot(event.snapshot)), {
        qos: 0,
        retain: true,
      }),
      client.publishAsync(this.topics.event, JSON.stringify(toSafeEvent(event)), {
        qos: 0,
        retain: false,
      }),
    ]).catch((error) => this.recordError(error));
  };

  private async initializeConnectedClient(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const subscriptions = [
      this.topics.command,
      `${this.topics.root}/ha/command/+`,
      ...(this.settings.homeAssistantDiscoveryEnabled
        ? [`${this.settings.homeAssistantDiscoveryPrefix}/status`]
        : []),
    ];
    await client.subscribeAsync(subscriptions, { qos: 1 });
    await client.publishAsync(this.topics.availability, 'online', { qos: 1, retain: true });
    if (this.latestSnapshot) {
      await client.publishAsync(this.topics.state, JSON.stringify(safeSnapshot(this.latestSnapshot)), {
        qos: 0,
        retain: true,
      });
    }
    if (this.settings.homeAssistantDiscoveryEnabled) {
      await this.publishHomeAssistantDiscovery();
    }
    this.diagnostics = {
      ...this.diagnostics,
      phase: 'connected',
      connected: true,
      error: null,
      lastConnectedAt: new Date(this.now()).toISOString(),
    };
  }

  private async processMessage(topic: string, payload: Buffer): Promise<void> {
    if (
      this.settings.homeAssistantDiscoveryEnabled &&
      topic === `${this.settings.homeAssistantDiscoveryPrefix}/status`
    ) {
      if (payload.toString('utf8').trim().toLowerCase() === 'online') {
        await this.publishHomeAssistantDiscovery();
        if (this.latestSnapshot && this.client?.connected) {
          await this.client.publishAsync(
            this.topics.state,
            JSON.stringify(safeSnapshot(this.latestSnapshot)),
            { qos: 0, retain: true },
          );
        }
      }
      return;
    }

    if (topic.startsWith(`${this.topics.root}/ha/command/`)) {
      await this.processHomeAssistantCommand(topic, payload);
      return;
    }

    if (topic !== this.topics.command) {
      return;
    }

    let clientId = 'unknown';
    let requestId = 'unknown';
    try {
      const value = parseRecord(payload);
      if (value.version !== 1) {
        throw new Error('invalid_command_version');
      }
      clientId = typeof value.clientId === 'string' ? value.clientId.trim() : '';
      if (!clientIdPattern.test(clientId)) {
        throw new Error('invalid_client_id');
      }
      const action = normalizeAction(value);
      requestId = action.requestId;
      this.assertCommandAllowed(clientId, requestId);
      await this.executeAction(clientId, action);
    } catch (error) {
      await this.publishResult(clientId, requestId, false, error);
    }
  }

  private async processHomeAssistantCommand(topic: string, payload: Buffer): Promise<void> {
    const command = topic.slice(`${this.topics.root}/ha/command/`.length);
    const requestId = `ha-${this.now()}-${++this.homeAssistantRequestSequence}`;
    let action: IntegrationPlaybackAction;
    if (command === 'volume') {
      const volumePercent = Number(payload.toString('utf8'));
      if (!Number.isFinite(volumePercent) || volumePercent < 0 || volumePercent > 100) {
        await this.publishResult('home-assistant', requestId, false, new Error('invalid_volume'));
        return;
      }
      action = { requestId, action: 'setVolume', volume: volumePercent / 100 };
    } else if (
      command === 'play' ||
      command === 'pause' ||
      command === 'stop' ||
      command === 'previous' ||
      command === 'next'
    ) {
      if (payload.toString('utf8').trim() !== 'PRESS') {
        await this.publishResult('home-assistant', requestId, false, new Error('invalid_button_payload'));
        return;
      }
      action = { requestId, action: command };
    } else {
      return;
    }
    try {
      this.assertCommandAllowed('home-assistant', requestId);
      await this.executeAction('home-assistant', action);
    } catch (error) {
      await this.publishResult('home-assistant', requestId, false, error);
    }
  }

  private assertCommandAllowed(clientId: string, requestId: string): void {
    const now = this.now();
    for (const [key, completedAt] of this.completedRequests) {
      if (now - completedAt > completedRequestTtlMs) {
        this.completedRequests.delete(key);
      }
    }
    const dedupeKey = `${clientId}:${requestId}`;
    if (this.completedRequests.has(dedupeKey)) {
      throw new Error('duplicate_request_id');
    }
    const currentWindow = this.commandWindows.get(clientId);
    const nextWindow = !currentWindow || now - currentWindow.startedAt >= this.commandWindowMs
      ? { startedAt: now, count: 1 }
      : { ...currentWindow, count: currentWindow.count + 1 };
    this.commandWindows.set(clientId, nextWindow);
    if (nextWindow.count > this.commandLimit) {
      throw new Error('command_rate_limited');
    }
    this.completedRequests.set(dedupeKey, now);
    while (this.completedRequests.size > maxCompletedRequests) {
      const oldest = this.completedRequests.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completedRequests.delete(oldest);
    }
  }

  private async executeAction(clientId: string, action: IntegrationPlaybackAction): Promise<void> {
    if (!this.context) {
      throw new Error('mqtt_adapter_not_started');
    }
    const result = await this.context.actions.execute(action);
    this.diagnostics = {
      ...this.diagnostics,
      lastCommandAt: new Date(this.now()).toISOString(),
    };
    await this.publishResult(clientId, action.requestId, true, null, result.completedAt);
  }

  private async publishResult(
    clientId: string,
    requestId: string,
    ok: boolean,
    error: unknown,
    completedAt = new Date(this.now()).toISOString(),
  ): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      return;
    }
    const safeClientId = clientIdPattern.test(clientId) ? clientId : 'unknown';
    const safeRequestId = requestIdPattern.test(requestId) ? requestId : 'unknown';
    await client.publishAsync(
      `${this.topics.result}/${safeClientId}/${safeRequestId}`,
      JSON.stringify({
        version: 1,
        requestId: safeRequestId,
        clientId: safeClientId,
        ok,
        completedAt,
        ...(ok ? {} : { error: error instanceof Error ? error.message : String(error) }),
      }),
      { qos: 1, retain: false },
    );
  }

  private async publishHomeAssistantDiscovery(): Promise<void> {
    const client = this.client;
    const discoveryTopic = this.topics.homeAssistantDiscovery;
    if (!client?.connected || !discoveryTopic) {
      return;
    }
    const unique = (suffix: string): string => `echo_${this.settings.deviceId}_${suffix}`;
    const commandTopic = (action: string): string => `${this.topics.root}/ha/command/${action}`;
    const payload = {
      dev: {
        ids: [`echo_${this.settings.deviceId}`],
        name: `ECHO ${this.deviceName}`,
        mf: 'ECHO',
        mdl: 'ECHO NEXT',
        sw: this.appVersion,
      },
      o: {
        name: 'ECHO NEXT',
        sw: this.appVersion,
        url: 'https://echonext.moe/',
      },
      availability_topic: this.topics.availability,
      payload_available: 'online',
      payload_not_available: 'offline',
      cmps: {
        playback_state: {
          p: 'sensor',
          unique_id: unique('playback_state'),
          name: '播放状态',
          icon: 'mdi:play-circle',
          state_topic: this.topics.state,
          value_template: '{{ value_json.state }}',
        },
        now_playing: {
          p: 'sensor',
          unique_id: unique('now_playing'),
          name: '正在播放',
          icon: 'mdi:music',
          state_topic: this.topics.state,
          value_template: "{{ value_json.track.title | default('') if value_json.track else '' }}",
        },
        volume: {
          p: 'number',
          unique_id: unique('volume'),
          name: '音量',
          icon: 'mdi:volume-high',
          min: 0,
          max: 100,
          step: 1,
          mode: 'slider',
          state_topic: this.topics.state,
          value_template: '{{ (value_json.volume * 100) | round(0) }}',
          command_topic: commandTopic('volume'),
        },
        play: {
          p: 'button',
          unique_id: unique('play'),
          name: '播放',
          icon: 'mdi:play',
          command_topic: commandTopic('play'),
          payload_press: 'PRESS',
        },
        pause: {
          p: 'button',
          unique_id: unique('pause'),
          name: '暂停',
          icon: 'mdi:pause',
          command_topic: commandTopic('pause'),
          payload_press: 'PRESS',
        },
        stop: {
          p: 'button',
          unique_id: unique('stop'),
          name: '停止',
          icon: 'mdi:stop',
          command_topic: commandTopic('stop'),
          payload_press: 'PRESS',
        },
        previous: {
          p: 'button',
          unique_id: unique('previous'),
          name: '上一首',
          icon: 'mdi:skip-previous',
          command_topic: commandTopic('previous'),
          payload_press: 'PRESS',
        },
        next: {
          p: 'button',
          unique_id: unique('next'),
          name: '下一首',
          icon: 'mdi:skip-next',
          command_topic: commandTopic('next'),
          payload_press: 'PRESS',
        },
      },
    };
    await client.publishAsync(discoveryTopic, JSON.stringify(payload), { qos: 1, retain: true });
  }

  private recordError(error: unknown): void {
    this.diagnostics = {
      ...this.diagnostics,
      phase: 'error',
      connected: this.client?.connected === true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
