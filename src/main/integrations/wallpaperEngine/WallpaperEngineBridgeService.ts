import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AudioStatus } from '../../../shared/types/audio';
import { getAudioSession } from '../../audio/AudioSession';
import {
  decrementWallpaperEngineBridgeClients,
  getWallpaperEngineBridgeClientCount,
  incrementWallpaperEngineBridgeClients,
} from './WallpaperEngineBridgeRuntime';

export const defaultWallpaperEngineBridgeHost = '127.0.0.1';
export const defaultWallpaperEngineBridgePort = 47668;
export const wallpaperEngineBridgeVersion = 1;

type WallpaperEngineAudioSession = EventEmitter & {
  getStatus: () => AudioStatus;
};

export type WallpaperEngineBridgeServiceOptions = {
  host?: string;
  port?: number;
  audioSession?: WallpaperEngineAudioSession;
};

export type WallpaperEngineBridgeServerStatus = {
  running: boolean;
  host: string;
  port: number | null;
  url: string | null;
  eventClients: number;
};

export type WallpaperEngineBridgeSnapshot = {
  version: 1;
  app: 'ECHO';
  integration: 'wallpaper-engine';
  generatedAt: string;
  eventClients: number;
  state: AudioStatus['state'];
  outputMode: AudioStatus['outputMode'];
  outputBackend: string | null;
  outputDeviceName: string | null;
  track: {
    id: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    coverUrl: string | null;
    durationSeconds: number;
    positionSeconds: number;
  };
  audio: {
    visualSpectrum: number[];
    visualSpectrumVersion: 2;
    visualEnergy: number;
    visualTransient: number;
    visualTelemetryState: 'pcm' | 'priming' | 'fallback';
    inputPeakDb: number | null;
    inputRmsDb: number | null;
    estimatedOutputPeakDb: number | null;
    estimatedOutputRmsDb: number | null;
    headroomDb: number | null;
    meterSource: 'pre_native_estimated_post_dsp' | null;
  };
  capabilities: {
    preNativeAudioTelemetry: true;
    supportsWasapiShared: true;
    supportsWasapiExclusive: true;
    supportsAsio: true;
  };
};

type SseClient = {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
};

const emptySpectrum = (): number[] => Array.from({ length: 32 }, () => 0);

const normalizeUnitArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return emptySpectrum();
  }

  return Array.from({ length: 32 }, (_, index) => {
    const item = Number(value[index] ?? 0);
    return Number.isFinite(item) ? Math.max(0, Math.min(1, Math.round(item * 1000) / 1000)) : 0;
  });
};

const finiteSeconds = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const writeCorsHeaders = (response: ServerResponse, contentType: string): void => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentType);
};

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  writeCorsHeaders(response, 'application/json; charset=utf-8');
  response.statusCode = statusCode;
  response.end(`${JSON.stringify(payload)}\n`);
};

const helperScript = `(() => {
  const endpoint = 'http://127.0.0.1:${defaultWallpaperEngineBridgePort}/events';
  let source = null;
  window.echoWallpaperEngineBridge = {
    connect(onSnapshot) {
      if (source) source.close();
      source = new EventSource(endpoint);
      source.addEventListener('snapshot', (event) => {
        try {
          onSnapshot(JSON.parse(event.data));
        } catch (_) {
          // Ignore malformed bridge events.
        }
      });
      return () => {
        if (source) source.close();
        source = null;
      };
    }
  };
})();`;

export const createWallpaperEngineBridgeSnapshot = (status: AudioStatus): WallpaperEngineBridgeSnapshot => {
  const audioLevels = status.audioLevels;

  return {
    version: wallpaperEngineBridgeVersion,
    app: 'ECHO',
    integration: 'wallpaper-engine',
    generatedAt: new Date().toISOString(),
    eventClients: getWallpaperEngineBridgeClientCount(),
    state: status.state,
    outputMode: status.outputMode,
    outputBackend: status.outputBackend,
    outputDeviceName: status.outputDeviceName,
    track: {
      id: status.currentTrackId,
      title: status.currentTrackTitle ?? null,
      artist: status.currentTrackArtist ?? null,
      album: status.currentTrackAlbum ?? null,
      coverUrl: status.currentTrackCoverUrl ?? null,
      durationSeconds: finiteSeconds(status.durationSeconds),
      positionSeconds: finiteSeconds(status.positionSeconds),
    },
    audio: {
      visualSpectrum: normalizeUnitArray(audioLevels?.visualSpectrum),
      visualSpectrumVersion: 2,
      visualEnergy: Number.isFinite(audioLevels?.visualEnergy) ? Math.max(0, Math.min(1, audioLevels?.visualEnergy ?? 0)) : 0,
      visualTransient: Number.isFinite(audioLevels?.visualTransient) ? Math.max(0, Math.min(1, audioLevels?.visualTransient ?? 0)) : 0,
      visualTelemetryState: audioLevels?.visualTelemetryState ?? 'fallback',
      inputPeakDb: audioLevels?.inputPeakDb ?? null,
      inputRmsDb: audioLevels?.inputRmsDb ?? null,
      estimatedOutputPeakDb: audioLevels?.estimatedOutputPeakDb ?? null,
      estimatedOutputRmsDb: audioLevels?.estimatedOutputRmsDb ?? null,
      headroomDb: audioLevels?.headroomDb ?? null,
      meterSource: audioLevels?.meterSource ?? null,
    },
    capabilities: {
      preNativeAudioTelemetry: true,
      supportsWasapiShared: true,
      supportsWasapiExclusive: true,
      supportsAsio: true,
    },
  };
};

export class WallpaperEngineBridgeService {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly audioSession: WallpaperEngineAudioSession;
  private server: Server | null = null;
  private boundPort: number | null = null;
  private readonly clients = new Set<SseClient>();
  private readonly statusListener = (status: AudioStatus): void => {
    this.broadcastSnapshot(status);
  };

  constructor(options: WallpaperEngineBridgeServiceOptions = {}) {
    this.host = options.host ?? defaultWallpaperEngineBridgeHost;
    this.requestedPort = options.port ?? defaultWallpaperEngineBridgePort;
    this.audioSession = options.audioSession ?? getAudioSession();
  }

  async start(): Promise<WallpaperEngineBridgeServerStatus> {
    if (this.server) {
      return this.getServerStatus();
    }

    this.audioSession.on('status', this.statusListener);
    const server = createServer((request, response) => this.handleRequest(request, response));
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.requestedPort, this.host, () => {
          server.off('error', reject);
          const address = server.address() as AddressInfo | null;
          this.boundPort = address?.port ?? this.requestedPort;
          resolve();
        });
      });
    } catch (error) {
      this.audioSession.off('status', this.statusListener);
      this.server = null;
      this.boundPort = null;
      throw error;
    }

    return this.getServerStatus();
  }

  async stop(): Promise<void> {
    this.audioSession.off('status', this.statusListener);
    for (const client of [...this.clients]) {
      this.closeClient(client);
    }

    const server = this.server;
    this.server = null;
    this.boundPort = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  getServerStatus(): WallpaperEngineBridgeServerStatus {
    const port = this.boundPort;
    return {
      running: this.server !== null,
      host: this.host,
      port,
      url: port === null ? null : `http://${this.host}:${port}`,
      eventClients: this.clients.size,
    };
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === 'OPTIONS') {
      writeCorsHeaders(response, 'text/plain; charset=utf-8');
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    const url = new URL(request.url ?? '/', `http://${this.host}:${this.boundPort ?? this.requestedPort}`);
    switch (url.pathname) {
      case '/':
      case '/health':
        writeJson(response, 200, {
          ...this.getServerStatus(),
          integration: 'wallpaper-engine',
          endpoints: ['/snapshot', '/events', '/echo-wallpaper-engine.js'],
        });
        return;
      case '/snapshot':
        writeJson(response, 200, createWallpaperEngineBridgeSnapshot(this.audioSession.getStatus()));
        return;
      case '/echo-wallpaper-engine.js':
        writeCorsHeaders(response, 'text/javascript; charset=utf-8');
        response.statusCode = 200;
        response.end(helperScript);
        return;
      case '/events':
        this.openEventStream(request, response);
        return;
      default:
        writeJson(response, 404, { error: 'not_found' });
    }
  }

  private openEventStream(request: IncomingMessage, response: ServerResponse): void {
    writeCorsHeaders(response, 'text/event-stream; charset=utf-8');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.statusCode = 200;
    response.flushHeaders?.();

    incrementWallpaperEngineBridgeClients();
    const client: SseClient = {
      response,
      heartbeat: setInterval(() => {
        response.write(': keep-alive\n\n');
      }, 15_000),
    };
    this.clients.add(client);
    this.writeSnapshot(response, this.audioSession.getStatus());

    const close = (): void => this.closeClient(client);
    request.on('close', close);
    response.on('close', close);
  }

  private closeClient(client: SseClient): void {
    if (!this.clients.delete(client)) {
      return;
    }

    clearInterval(client.heartbeat);
    decrementWallpaperEngineBridgeClients();
    if (!client.response.destroyed) {
      client.response.end();
    }
  }

  private broadcastSnapshot(status: AudioStatus): void {
    if (this.clients.size === 0) {
      return;
    }

    for (const client of this.clients) {
      this.writeSnapshot(client.response, status);
    }
  }

  private writeSnapshot(response: ServerResponse, status: AudioStatus): void {
    response.write(`event: snapshot\ndata: ${JSON.stringify(createWallpaperEngineBridgeSnapshot(status))}\n\n`);
  }
}
