import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IntegrationEventEnvelopeV1, IntegrationPlaybackSnapshotV1 } from '../../../shared/types/integrationPlatform';
import type { StageBridgeLyricLine, StageBridgeServerStatus, StageBridgeSnapshot } from '../../../shared/types/stage';
import type { TrackLyrics } from '../../../shared/types/lyrics';
import { getLyricsService } from '../../lyrics/LyricsService';
import { getIntegrationEventHub } from '../core/IntegrationEventHub';
import {
  createAudioSessionStageVisualTelemetrySource,
  type StageVisualTelemetrySnapshot,
  type StageVisualTelemetrySource,
} from './StageVisualTelemetrySource';
import { decrementStageBridgeClients, incrementStageBridgeClients } from './StageBridgeRuntime';

export const defaultStageBridgeHost = '127.0.0.1';
export const defaultStageBridgePort = 47669;
export const stageBridgeVersion = 1;

type StageEventHub = {
  getSnapshot: () => IntegrationPlaybackSnapshotV1;
  subscribe: (listener: (event: IntegrationEventEnvelopeV1) => void) => () => void;
};

type StageLyricsService = {
  getLyricsForTrack: (trackId: string, options?: { networkEnabled?: boolean; autoSearch?: boolean }) => Promise<TrackLyrics | null>;
};

export type StageBridgeServiceOptions = {
  host?: string;
  port?: number;
  eventHub?: StageEventHub;
  telemetrySource?: StageVisualTelemetrySource;
  getLyrics?: () => StageLyricsService;
};

type SseClient = {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
};

type StageBridgeEnabledState = {
  obsEnabled: boolean;
  apiEnabled: boolean;
};

const emptySpectrum = (): number[] => Array.from({ length: 32 }, () => 0);

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const finiteSeconds = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const normalizeUnitArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return emptySpectrum();
  }

  return Array.from({ length: 32 }, (_, index) => {
    const item = Number(value[index] ?? 0);
    return Number.isFinite(item) ? Math.round(clampUnit(item) * 1000) / 1000 : 0;
  });
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

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

const toStageLyricLine = (line: TrackLyrics['lines'][number] | undefined): StageBridgeLyricLine | null =>
  line
    ? {
        timeMs: Math.max(0, Math.round(line.timeMs)),
        text: line.text,
        translation: line.translation ?? null,
        romanization: line.romanization ?? null,
      }
    : null;

const findSyncedLyricLine = (lyrics: TrackLyrics, positionMs: number): { current: StageBridgeLyricLine | null; next: StageBridgeLyricLine | null } => {
  const lines = lyrics.lines
    .filter((line) => line.timeMs >= 0 && line.text.trim().length > 0)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (!lines.length) {
    return { current: null, next: null };
  }

  let currentIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].timeMs <= positionMs) {
      currentIndex = index;
    } else {
      break;
    }
  }

  if (currentIndex < 0) {
    return { current: null, next: toStageLyricLine(lines[0]) };
  }

  return {
    current: toStageLyricLine(lines[currentIndex]),
    next: toStageLyricLine(lines[currentIndex + 1]),
  };
};

const plainLyricLine = (lyrics: TrackLyrics): StageBridgeLyricLine | null => {
  const text = (lyrics.plainText ?? lyrics.lines.map((line) => line.text).join('\n')).trim();
  return text
    ? {
        timeMs: 0,
        text: text.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? text.slice(0, 160),
        translation: null,
        romanization: null,
      }
    : null;
};

export const createStageBridgeSnapshot = async (
  playback: IntegrationPlaybackSnapshotV1,
  telemetry: StageVisualTelemetrySnapshot = { visualEnergy: 0, visualTransient: 0, visualSpectrum: emptySpectrum() },
  getLyrics: () => StageLyricsService = getLyricsService,
): Promise<StageBridgeSnapshot> => {
  const durationSeconds = finiteSeconds(playback.durationMs / 1000);
  const positionSeconds = finiteSeconds(playback.positionMs / 1000);
  let lyrics: TrackLyrics | null = null;

  if (playback.track?.id) {
    try {
      lyrics = await getLyrics().getLyricsForTrack(playback.track.id, { networkEnabled: false, autoSearch: false });
    } catch {
      lyrics = null;
    }
  }

  const positionMs = Math.max(0, Math.round(positionSeconds * 1000 + (lyrics?.offsetMs ?? 0)));
  const syncedLine = lyrics?.kind === 'synced' ? findSyncedLyricLine(lyrics, positionMs) : { current: null, next: null };
  const currentPlain = lyrics && lyrics.kind !== 'synced' ? plainLyricLine(lyrics) : null;
  return {
    version: stageBridgeVersion,
    app: 'ECHO',
    integration: 'stage',
    generatedAt: new Date().toISOString(),
    state: playback.state,
    track: {
      id: playback.track?.id ?? null,
      title: playback.track?.title ?? null,
      artist: playback.track?.artist ?? null,
      album: playback.track?.album ?? null,
      coverUrl: playback.track?.artworkUrl ?? null,
      durationSeconds,
      positionSeconds,
      progress: durationSeconds > 0 ? Math.round(clampUnit(positionSeconds / durationSeconds) * 10000) / 10000 : 0,
    },
    lyrics: {
      kind: lyrics?.kind ?? 'empty',
      provider: lyrics?.provider ?? null,
      current: syncedLine.current ?? currentPlain,
      next: syncedLine.next,
      offsetMs: lyrics?.offsetMs ?? 0,
    },
    audio: {
      outputMode: playback.output.mode,
      outputBackend: playback.output.backend,
      visualEnergy: Number.isFinite(telemetry.visualEnergy) ? clampUnit(telemetry.visualEnergy) : 0,
      visualTransient: Number.isFinite(telemetry.visualTransient) ? clampUnit(telemetry.visualTransient) : 0,
      visualSpectrum: normalizeUnitArray(telemetry.visualSpectrum),
    },
  };
};

const helperScript = `(() => {
  let source = null;
  window.echoStage = {
    connect(onSnapshot, options = {}) {
      const endpoint = options.eventsUrl || new URL('/events', location.href).toString();
      if (source) source.close();
      source = new EventSource(endpoint);
      source.addEventListener('snapshot', (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          if (typeof onSnapshot === 'function') onSnapshot(snapshot);
        } catch (_) {
          // Ignore malformed stage events.
        }
      });
      return () => {
        if (source) source.close();
        source = null;
      };
    },
    async snapshot(options = {}) {
      const endpoint = options.snapshotUrl || new URL('/snapshot', location.href).toString();
      const response = await fetch(endpoint, { cache: 'no-store' });
      return response.json();
    }
  };
})();`;

const obsPage = (): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ECHO OBS Stage</title>
  <style>
    :root { color-scheme: dark; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
    html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
    body { display: grid; place-items: end center; }
    .stage { width: min(92vw, 1180px); padding: 32px 42px 44px; box-sizing: border-box; color: #fff; text-align: center; text-shadow: 0 3px 18px rgba(0,0,0,.68), 0 1px 2px rgba(0,0,0,.9); }
    .lyric { font-size: clamp(36px, 6vw, 86px); font-weight: 800; line-height: 1.12; letter-spacing: 0; overflow-wrap: anywhere; opacity: 0; transform: translateY(14px); transition: opacity .22s ease, transform .22s ease; }
    .lyric[data-visible="true"] { opacity: 1; transform: translateY(0); }
    .translation { margin-top: 14px; font-size: clamp(20px, 2.6vw, 34px); font-weight: 650; opacity: .82; overflow-wrap: anywhere; }
    .track { margin-top: 18px; display: inline-flex; max-width: 100%; gap: 10px; align-items: center; justify-content: center; padding: 8px 18px; border-radius: 999px; background: rgba(8, 10, 16, .42); backdrop-filter: blur(12px); font-size: clamp(16px, 2vw, 24px); font-weight: 700; opacity: .88; }
    .dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #ff6b9a; box-shadow: 0 0 18px rgba(255,107,154,.8); }
    .track span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <main class="stage">
    <div id="lyric" class="lyric">ECHO</div>
    <div id="translation" class="translation"></div>
    <div class="track"><i class="dot"></i><span id="track">Waiting for playback</span></div>
  </main>
  <script src="/echo-stage.js"></script>
  <script>
    const lyric = document.getElementById('lyric');
    const translation = document.getElementById('translation');
    const track = document.getElementById('track');
    let lastText = '';
    const setText = (snapshot) => {
      const title = snapshot?.track?.title || 'ECHO';
      const artist = snapshot?.track?.artist || '';
      const current = snapshot?.lyrics?.current;
      const nextText = current?.text || title;
      if (nextText !== lastText) {
        lyric.dataset.visible = 'false';
        window.setTimeout(() => {
          lyric.textContent = nextText;
          translation.textContent = current?.translation || current?.romanization || '';
          lyric.dataset.visible = 'true';
          lastText = nextText;
        }, 120);
      }
      track.textContent = artist ? artist + ' - ' + title : title;
    };
    window.echoStage.snapshot().then(setText).catch(() => undefined);
    window.echoStage.connect(setText);
  </script>
</body>
</html>`;

export class StageBridgeService {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly eventHub: StageEventHub;
  private readonly telemetrySource: StageVisualTelemetrySource;
  private readonly getLyrics: () => StageLyricsService;
  private server: Server | null = null;
  private boundPort: number | null = null;
  private enabledState: StageBridgeEnabledState = { obsEnabled: false, apiEnabled: false };
  private readonly clients = new Set<SseClient>();
  private unsubscribeEventHub: (() => void) | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private latestPlayback: IntegrationPlaybackSnapshotV1 | null = null;
  private broadcastInFlight = false;
  private broadcastPending = false;
  private cachedLyricsTrackId: string | null = null;
  private cachedLyricsPromise: Promise<TrackLyrics | null> | null = null;
  private readonly cachedLyricsService: StageLyricsService = {
    getLyricsForTrack: (trackId) => this.getCachedLyrics(trackId),
  };
  private readonly integrationListener = (event: IntegrationEventEnvelopeV1): void => {
    this.latestPlayback = event.snapshot;
  };

  constructor(options: StageBridgeServiceOptions = {}) {
    this.host = options.host ?? defaultStageBridgeHost;
    this.requestedPort = options.port ?? defaultStageBridgePort;
    this.eventHub = options.eventHub ?? getIntegrationEventHub();
    this.telemetrySource = options.telemetrySource ?? createAudioSessionStageVisualTelemetrySource();
    this.getLyrics = options.getLyrics ?? getLyricsService;
  }

  async configure(enabledState: StageBridgeEnabledState): Promise<StageBridgeServerStatus> {
    this.enabledState = enabledState;
    if (enabledState.obsEnabled || enabledState.apiEnabled) {
      return this.start();
    }

    await this.stop();
    return this.getServerStatus();
  }

  async start(): Promise<StageBridgeServerStatus> {
    if (this.server) {
      return this.getServerStatus();
    }

    this.latestPlayback = this.eventHub.getSnapshot();
    this.unsubscribeEventHub = this.eventHub.subscribe(this.integrationListener);
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
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
      this.unsubscribeEventHub?.();
      this.unsubscribeEventHub = null;
      this.server = null;
      this.boundPort = null;
      throw error;
    }

    return this.getServerStatus();
  }

  async stop(): Promise<void> {
    this.unsubscribeEventHub?.();
    this.unsubscribeEventHub = null;
    this.stopRefreshTimer();
    for (const client of [...this.clients]) {
      this.closeClient(client);
    }
    this.latestPlayback = null;
    this.cachedLyricsTrackId = null;
    this.cachedLyricsPromise = null;

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

  getServerStatus(): StageBridgeServerStatus {
    const port = this.boundPort;
    const baseUrl = port === null ? null : `http://${this.host}:${port}`;
    return {
      running: this.server !== null,
      host: this.host,
      port,
      url: baseUrl,
      obsUrl: baseUrl ? `${baseUrl}/obs` : null,
      eventClients: this.clients.size,
      obsEnabled: this.enabledState.obsEnabled,
      apiEnabled: this.enabledState.apiEnabled,
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
          integration: 'stage',
          endpoints: ['/snapshot', '/events', '/obs', '/echo-stage.js'],
        });
        return;
      case '/snapshot':
      case '/api/stage':
      case '/api/stage/status':
        if (!this.enabledState.apiEnabled && url.pathname.startsWith('/api/')) {
          writeJson(response, 403, { error: 'stage_api_disabled' });
          return;
        }
        writeJson(response, 200, await this.createSnapshot());
        return;
      case '/echo-stage.js':
        writeCorsHeaders(response, 'text/javascript; charset=utf-8');
        response.statusCode = 200;
        response.end(helperScript);
        return;
      case '/events':
        if (!this.enabledState.apiEnabled && !this.enabledState.obsEnabled) {
          writeJson(response, 403, { error: 'stage_api_disabled' });
          return;
        }
        this.openEventStream(request, response);
        return;
      case '/obs':
        if (!this.enabledState.obsEnabled) {
          writeJson(response, 403, { error: 'obs_browser_source_disabled' });
          return;
        }
        writeCorsHeaders(response, 'text/html; charset=utf-8');
        response.statusCode = 200;
        response.end(obsPage().replace('ECHO OBS Stage', escapeHtml('ECHO OBS Stage')));
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

    const client: SseClient = {
      response,
      heartbeat: setInterval(() => {
        response.write(': keep-alive\n\n');
      }, 15_000),
    };
    this.clients.add(client);
    incrementStageBridgeClients();
    this.startRefreshTimer();
    void this.writeSnapshot(response);

    const close = (): void => this.closeClient(client);
    request.on('close', close);
    response.on('close', close);
  }

  private closeClient(client: SseClient): void {
    if (!this.clients.delete(client)) {
      return;
    }

    clearInterval(client.heartbeat);
    decrementStageBridgeClients();
    if (this.clients.size === 0) {
      this.stopRefreshTimer();
    }
    if (!client.response.destroyed) {
      client.response.end();
    }
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer || this.clients.size === 0) {
      return;
    }
    this.refreshTimer = setInterval(() => this.requestBroadcast(), 250);
    this.refreshTimer.unref?.();
  }

  private stopRefreshTimer(): void {
    if (!this.refreshTimer) {
      return;
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.broadcastPending = false;
  }

  private requestBroadcast(): void {
    if (this.clients.size === 0) {
      return;
    }
    if (this.broadcastInFlight) {
      this.broadcastPending = true;
      return;
    }
    this.broadcastInFlight = true;
    void this.broadcastSnapshot().finally(() => {
      this.broadcastInFlight = false;
      if (this.broadcastPending && this.clients.size > 0) {
        this.broadcastPending = false;
        this.requestBroadcast();
      }
    });
  }

  private async broadcastSnapshot(): Promise<void> {
    if (this.clients.size === 0) {
      return;
    }

    const snapshot = await this.createSnapshot();
    if (this.clients.size === 0) {
      return;
    }
    const event = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of this.clients) {
      client.response.write(event);
    }
  }

  private async writeSnapshot(response: ServerResponse): Promise<void> {
    const snapshot = await this.createSnapshot();
    if (response.destroyed) {
      return;
    }
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  }

  private createSnapshot(): Promise<StageBridgeSnapshot> {
    const playback = this.latestPlayback ?? this.eventHub.getSnapshot();
    return createStageBridgeSnapshot(playback, this.telemetrySource.read(), () => this.cachedLyricsService);
  }

  private getCachedLyrics(trackId: string): Promise<TrackLyrics | null> {
    if (this.cachedLyricsTrackId === trackId && this.cachedLyricsPromise) {
      return this.cachedLyricsPromise;
    }
    this.cachedLyricsTrackId = trackId;
    this.cachedLyricsPromise = this.getLyrics()
      .getLyricsForTrack(trackId, { networkEnabled: false, autoSearch: false })
      .catch(() => null);
    return this.cachedLyricsPromise;
  }
}
