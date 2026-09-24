import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import type {
  IntegrationEventEnvelopeV1,
  IntegrationPlaybackSnapshotV1,
} from '../../../shared/types/integrationPlatform';
import type { MqttIntegrationSettings } from '../../../shared/types/mqttIntegration';
import type { IntegrationAdapterContext } from '../core/IntegrationAdapterRuntime';
import { MqttIntegrationAdapter } from './MqttIntegrationAdapter';

const settings: MqttIntegrationSettings = {
  enabled: true,
  brokerUrl: 'mqtt://127.0.0.1:1883',
  username: 'echo',
  clientId: 'echo-next-test',
  deviceId: 'echo-test',
  topicPrefix: 'echo',
  homeAssistantDiscoveryEnabled: true,
  homeAssistantDiscoveryPrefix: 'homeassistant',
};

const snapshot: IntegrationPlaybackSnapshotV1 = {
  version: 1,
  revision: 3,
  observedAt: '2026-07-28T00:00:00.000Z',
  state: 'playing',
  track: {
    id: 'track-1',
    title: 'Test Track',
    artist: 'ECHO',
    album: 'Connected',
    albumArtist: 'ECHO',
    artworkUrl: 'file:///D:/private/secret-cover.jpg',
  },
  positionMs: 12_000,
  durationMs: 240_000,
  volume: 0.42,
  output: {
    mode: 'shared',
    deviceName: 'Speakers',
    backend: 'wasapi',
  },
};

class FakeMqttClient extends EventEmitter {
  connected = false;
  readonly published: Array<{ topic: string; payload: string; options: unknown }> = [];
  readonly subscriptions: string[][] = [];
  ended = false;

  async publishAsync(topic: string, payload: string | Buffer, options?: unknown): Promise<unknown> {
    this.published.push({ topic, payload: payload.toString(), options });
    return undefined;
  }

  async subscribeAsync(topics: string | string[], _options?: unknown): Promise<unknown> {
    this.subscriptions.push(Array.isArray(topics) ? topics : [topics]);
    return [];
  }

  async endAsync(): Promise<void> {
    this.ended = true;
    this.connected = false;
  }
}

const createContext = () => {
  let listener: ((event: IntegrationEventEnvelopeV1) => void) | null = null;
  const execute = vi.fn(async (action) => ({
    requestId: action.requestId,
    ok: true as const,
    completedAt: '2026-07-28T00:00:01.000Z',
  }));
  const context: IntegrationAdapterContext = {
    events: {
      getSnapshot: () => snapshot,
      subscribe: (nextListener) => {
        listener = nextListener;
        nextListener({
          version: 1,
          id: '1',
          type: 'snapshot',
          occurredAt: snapshot.observedAt,
          snapshot,
        });
        return () => {
          listener = null;
        };
      },
    },
    actions: { execute },
  };
  return { context, execute, emit: (event: IntegrationEventEnvelopeV1) => listener?.(event) };
};

describe('MqttIntegrationAdapter', () => {
  it('publishes safe state plus Home Assistant device discovery without a fake media_player', async () => {
    const client = new FakeMqttClient();
    const { context } = createContext();
    const adapter = new MqttIntegrationAdapter({
      settings,
      password: 'secret',
      appVersion: '26.7.27',
      deviceName: 'Studio',
      connect: () => client as unknown as MqttClient,
    });

    await adapter.start(context);
    client.connected = true;
    client.emit('connect');

    await vi.waitFor(() => expect(adapter.getDiagnostics().connected).toBe(true));
    expect(client.subscriptions[0]).toEqual([
      'echo/echo-test/command',
      'echo/echo-test/ha/command/+',
      'homeassistant/status',
    ]);

    const state = client.published.find((entry) => entry.topic === 'echo/echo-test/state');
    expect(state?.payload).toContain('"Test Track"');
    expect(state?.payload).not.toContain('secret-cover.jpg');
    expect(state?.payload).not.toContain('artworkUrl');

    const discovery = client.published.find(
      (entry) => entry.topic === 'homeassistant/device/echo-test/config',
    );
    expect(discovery).toBeDefined();
    expect(discovery?.payload).toContain('"p":"sensor"');
    expect(discovery?.payload).toContain('"p":"number"');
    expect(discovery?.payload).toContain('"p":"button"');
    expect(discovery?.payload).not.toContain('media_player');

    await adapter.stop();
    expect(client.ended).toBe(true);
  });

  it('routes strict MQTT commands, publishes correlated results, and rejects duplicates', async () => {
    const client = new FakeMqttClient();
    const { context, execute } = createContext();
    const adapter = new MqttIntegrationAdapter({
      settings: { ...settings, homeAssistantDiscoveryEnabled: false },
      password: null,
      appVersion: '26.7.27',
      connect: () => client as unknown as MqttClient,
      now: () => 1_000,
    });
    await adapter.start(context);
    client.connected = true;
    client.emit('connect');
    await vi.waitFor(() => expect(adapter.getDiagnostics().connected).toBe(true));

    const command = Buffer.from(JSON.stringify({
      version: 1,
      requestId: 'node-red-1',
      clientId: 'node-red',
      action: 'setVolume',
      volume: 0.5,
    }));
    client.emit('message', 'echo/echo-test/command', command);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith({
      requestId: 'node-red-1',
      action: 'setVolume',
      volume: 0.5,
    });
    expect(client.published).toContainEqual(expect.objectContaining({
      topic: 'echo/echo-test/result/node-red/node-red-1',
      payload: expect.stringContaining('"ok":true'),
    }));

    client.emit('message', 'echo/echo-test/command', command);
    await vi.waitFor(() => expect(client.published).toContainEqual(expect.objectContaining({
      topic: 'echo/echo-test/result/node-red/node-red-1',
      payload: expect.stringContaining('duplicate_request_id'),
    })));
    expect(execute).toHaveBeenCalledTimes(1);

    await adapter.stop();
  });

  it('maps Home Assistant volume commands through the same action router', async () => {
    const client = new FakeMqttClient();
    const { context, execute } = createContext();
    const adapter = new MqttIntegrationAdapter({
      settings,
      password: null,
      appVersion: '26.7.27',
      connect: () => client as unknown as MqttClient,
      now: () => 2_000,
    });
    await adapter.start(context);
    client.connected = true;
    client.emit('connect');
    await vi.waitFor(() => expect(adapter.getDiagnostics().connected).toBe(true));

    client.emit('message', 'echo/echo-test/ha/command/volume', Buffer.from('35'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith({
      requestId: 'ha-2000-1',
      action: 'setVolume',
      volume: 0.35,
    }));

    await adapter.stop();
  });
});

