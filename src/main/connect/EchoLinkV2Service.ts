import { app } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import QRCode from 'qrcode';
import type {
  EchoLinkBasicStatus,
  EchoLinkPairedClient,
  EchoLinkPairingSession,
  EchoLinkPlaybackOrderMode,
  EchoLinkV2PlaybackSnapshot,
  EchoLinkV2Scope,
  EchoLinkV2StatusResponse,
} from '../../shared/types/echoLink';
import type {
  IntegrationEventEnvelopeV1,
  IntegrationPlaybackAction,
  IntegrationPlaybackActionResult,
  IntegrationPlaybackSnapshotV1,
} from '../../shared/types/integrationPlatform';
import { getIntegrationActionRouter } from '../integrations/core/IntegrationActionRouter';
import { getIntegrationEventHub } from '../integrations/core/IntegrationEventHub';
import { getPlaybackSessionStore } from '../audio/PlaybackSessionStore';
import {
  EchoLinkV2ClientStore,
  hashEchoLinkAccessToken,
} from './EchoLinkV2ClientStore';
import {
  createEchoLinkMobileRemoteIcon,
  createEchoLinkMobileRemoteHtml,
  createEchoLinkMobileRemoteManifest,
  createEchoLinkMobileRemotePairingUrl,
  echoLinkMobileRemoteIconPath,
  echoLinkMobileRemoteManifestPath,
  echoLinkMobileRemotePath,
} from './EchoLinkMobileRemote';
import {
  resolveEchoLinkV2CurrentArtwork,
  type EchoLinkV2Artwork,
} from './EchoLinkV2Artwork';

const pairingTtlMs = 2 * 60 * 1000;
const eventTicketTtlMs = 60 * 1000;
const actionDedupeTtlMs = 5 * 60 * 1000;
const heartbeatIntervalMs = 15 * 1000;
const maxJsonBodyBytes = 16 * 1024;
const maxPairingAttemptsPerMinute = 5;
const maxActionsPerMinute = 60;
const maxEventConnectionsPerClient = 4;
const maxActionCacheEntriesPerClient = 128;

export const echoLinkV2Scopes: EchoLinkV2Scope[] = [
  'status:read',
  'events:read',
  'playback:control',
];

const playbackActions = [
  'play',
  'pause',
  'stop',
  'previous',
  'next',
  'seek',
  'setVolume',
  'setPlaybackOrder',
] as const;

export type EchoLinkV2RuntimeState = {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  addresses: string[];
  deviceId: string;
  deviceName: string;
  error: string | null;
};

type EventHubLike = {
  getSnapshot: () => IntegrationPlaybackSnapshotV1;
  subscribe: (listener: (event: IntegrationEventEnvelopeV1) => void) => () => void;
};

type ActionRouterLike = {
  execute: (action: IntegrationPlaybackAction) => Promise<IntegrationPlaybackActionResult>;
};

type PairingRecord = {
  id: string;
  secret: string;
  expiresAtEpochMs: number;
};

type EventTicketRecord = {
  clientId: string;
  remoteAddress: string;
  expiresAtEpochMs: number;
};

type EventConnection = {
  close: () => void;
};

type CachedAction = {
  expiresAtEpochMs: number;
  promise: Promise<IntegrationPlaybackActionResult>;
};

export type EchoLinkV2ServiceOptions = {
  getRuntime: () => EchoLinkV2RuntimeState;
  eventHub?: EventHubLike;
  actionRouter?: ActionRouterLike;
  clientStore?: EchoLinkV2ClientStore;
  clientStorePath?: string | null;
  now?: () => number;
  randomToken?: (bytes: number) => string;
  artworkProvider?: (snapshot: IntegrationPlaybackSnapshotV1) => Promise<EchoLinkV2Artwork | null>;
  getPlaybackOrder?: () => EchoLinkPlaybackOrderMode;
};

class EchoLinkV2HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message = code,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const safeHeader = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const normalizeRemoteAddress = (value: string | undefined): string =>
  (value ?? '').replace(/^::ffff:/u, '');

const isLanAddress = (address: string): boolean =>
  address === '::1' ||
  /^127\./u.test(address) ||
  /^10\./u.test(address) ||
  /^192\.168\./u.test(address) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./u.test(address) ||
  /^169\.254\./u.test(address);

const writeCorsHeaders = (response: ServerResponse): void => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Cache-Control', 'no-store');
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  writeCorsHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(body)}\n`);
};

const writeError = (
  response: ServerResponse,
  statusCode: number,
  code: string,
  message = code,
  requestId?: string,
): void => {
  writeJson(response, statusCode, {
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
    },
  });
};

const writeMobileRemoteHtml = (response: ServerResponse): void => {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; connect-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.end(createEchoLinkMobileRemoteHtml());
};

const writeMobileRemoteAsset = (
  response: ServerResponse,
  contentType: string,
  body: string,
): void => {
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'public, max-age=86400');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(body);
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxJsonBodyBytes) {
      throw new EchoLinkV2HttpError(413, 'request_body_too_large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new EchoLinkV2HttpError(400, 'request_body_required');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new EchoLinkV2HttpError(400, 'invalid_json');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeRequiredText = (value: unknown, code: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new EchoLinkV2HttpError(400, code);
  }
  return value.trim();
};

const secretEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
};

const toV2PlaybackSnapshot = (
  snapshot: IntegrationPlaybackSnapshotV1,
  playbackOrder: EchoLinkPlaybackOrderMode,
): EchoLinkV2PlaybackSnapshot => ({
  version: 1,
  revision: snapshot.revision,
  observedAt: snapshot.observedAt,
  state: snapshot.state === 'ended' ? 'stopped' : snapshot.state,
  track: snapshot.track
    ? {
        id: snapshot.track.id,
        title: snapshot.track.title,
        artist: snapshot.track.artist,
        album: snapshot.track.album,
      }
    : null,
  positionMs: snapshot.positionMs,
  durationMs: snapshot.durationMs,
  volume: snapshot.volume,
  playbackOrder,
  output: {
    mode: snapshot.output.mode,
    deviceName: snapshot.output.deviceName,
  },
});

const normalizePlaybackAction = (value: unknown): IntegrationPlaybackAction => {
  if (!isRecord(value)) {
    throw new EchoLinkV2HttpError(400, 'invalid_action');
  }
  const requestId = normalizeRequiredText(value.requestId, 'invalid_request_id', 64);
  if (!/^[A-Za-z0-9._:-]+$/u.test(requestId)) {
    throw new EchoLinkV2HttpError(400, 'invalid_request_id', 'invalid_request_id', requestId);
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
        throw new EchoLinkV2HttpError(400, 'invalid_seek_position', 'invalid_seek_position', requestId);
      }
      return { requestId, action: 'seek', positionMs };
    }
    case 'setVolume': {
      const volume = Number(value.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new EchoLinkV2HttpError(400, 'invalid_volume', 'invalid_volume', requestId);
      }
      return { requestId, action: 'setVolume', volume };
    }
    case 'setPlaybackOrder': {
      if (value.mode !== 'sequential' && value.mode !== 'shuffle' && value.mode !== 'repeat-one') {
        throw new EchoLinkV2HttpError(400, 'invalid_playback_order', 'invalid_playback_order', requestId);
      }
      return { requestId, action: 'setPlaybackOrder', mode: value.mode };
    }
    default:
      throw new EchoLinkV2HttpError(400, 'unsupported_playback_action', 'unsupported_playback_action', requestId);
  }
};

const getPersistedPlaybackOrder = (): EchoLinkPlaybackOrderMode => {
  const mode = getPlaybackSessionStore().load()?.mode;
  if (mode?.repeatMode === 'one') {
    return 'repeat-one';
  }
  return mode?.isShuffleEnabled ? 'shuffle' : 'sequential';
};

const defaultClientStorePath = (): string | null => {
  try {
    return join(app.getPath('userData'), 'echo-link-clients.json');
  } catch {
    return null;
  }
};

export class EchoLinkV2Service {
  private readonly getRuntime: () => EchoLinkV2RuntimeState;
  private readonly eventHub: EventHubLike;
  private readonly actionRouter: ActionRouterLike;
  private readonly clientStore: EchoLinkV2ClientStore;
  private readonly now: () => number;
  private readonly randomToken: (bytes: number) => string;
  private readonly artworkProvider: (
    snapshot: IntegrationPlaybackSnapshotV1,
  ) => Promise<EchoLinkV2Artwork | null>;
  private readonly getPlaybackOrder: () => EchoLinkPlaybackOrderMode;
  private pairing: PairingRecord | null = null;
  private readonly eventTickets = new Map<string, EventTicketRecord>();
  private readonly eventConnections = new Map<string, Set<EventConnection>>();
  private readonly pairingAttempts = new Map<string, number[]>();
  private readonly actionAttempts = new Map<string, number[]>();
  private readonly actionCache = new Map<string, CachedAction>();
  private updatedAt: string;

  constructor(options: EchoLinkV2ServiceOptions) {
    this.getRuntime = options.getRuntime;
    this.eventHub = options.eventHub ?? getIntegrationEventHub();
    this.actionRouter = options.actionRouter ?? getIntegrationActionRouter();
    this.clientStore = options.clientStore ?? new EchoLinkV2ClientStore({
      filePath: options.clientStorePath === undefined ? defaultClientStorePath() : options.clientStorePath,
    });
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? ((bytes) => randomBytes(bytes).toString('base64url'));
    this.artworkProvider = options.artworkProvider ?? resolveEchoLinkV2CurrentArtwork;
    this.getPlaybackOrder = options.getPlaybackOrder ?? getPersistedPlaybackOrder;
    this.updatedAt = new Date(this.now()).toISOString();
  }

  getManagerStatus(): EchoLinkBasicStatus {
    this.cleanupExpiredState();
    const runtime = this.getRuntime();
    return {
      enabled: runtime.enabled,
      running: runtime.running,
      host: runtime.host,
      port: runtime.port,
      addresses: [...runtime.addresses],
      deviceId: runtime.deviceId,
      deviceName: runtime.deviceName,
      pairingActive: Boolean(this.pairing),
      clients: this.clientStore.listClients(),
      error: runtime.error,
      updatedAt: this.updatedAt,
    };
  }

  async startPairing(): Promise<EchoLinkPairingSession> {
    const runtime = this.getRuntime();
    if (!runtime.enabled || !runtime.running) {
      throw new Error('echo_link_basic_not_running');
    }

    const pairing: PairingRecord = {
      id: this.randomToken(16),
      secret: this.randomToken(32),
      expiresAtEpochMs: this.now() + pairingTtlMs,
    };
    this.pairing = pairing;
    this.touch();
    const uri = new URL('echo://pair');
    uri.searchParams.set('version', '2');
    uri.searchParams.set('scheme', 'http');
    uri.searchParams.set('host', runtime.host);
    uri.searchParams.set('port', String(runtime.port));
    uri.searchParams.set('pairingId', pairing.id);
    uri.searchParams.set('secret', pairing.secret);
    uri.searchParams.set('name', runtime.deviceName);
    const pairingUri = uri.toString();
    const webRemoteUrl = createEchoLinkMobileRemotePairingUrl(
      runtime.host,
      runtime.port,
      pairingUri,
    );
    const qrDataUrl = await QRCode.toDataURL(webRemoteUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    });

    return {
      id: pairing.id,
      pairingUri,
      webRemoteUrl,
      qrDataUrl,
      expiresAt: new Date(pairing.expiresAtEpochMs).toISOString(),
    };
  }

  cancelPairing(): EchoLinkBasicStatus {
    this.pairing = null;
    this.touch();
    return this.getManagerStatus();
  }

  revokeClient(clientId: string): EchoLinkBasicStatus {
    if (!this.clientStore.revokeClient(clientId)) {
      throw new Error('paired_client_not_found');
    }
    this.closeClientConnections(clientId);
    for (const [ticket, record] of this.eventTickets) {
      if (record.clientId === clientId) {
        this.eventTickets.delete(ticket);
      }
    }
    this.touch();
    return this.getManagerStatus();
  }

  disable(): void {
    this.pairing = null;
    this.eventTickets.clear();
    for (const clientId of [...this.eventConnections.keys()]) {
      this.closeClientConnections(clientId);
    }
    this.touch();
  }

  dispose(): void {
    this.disable();
    this.pairingAttempts.clear();
    this.actionAttempts.clear();
    this.actionCache.clear();
  }

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/echo-link/v2/')) {
      return false;
    }

    try {
      this.assertLanRequest(request);
      if (request.method === 'OPTIONS') {
        writeCorsHeaders(response);
        response.statusCode = 204;
        response.end();
        return true;
      }
      if (!this.getRuntime().enabled) {
        throw new EchoLinkV2HttpError(404, 'echo_link_basic_disabled');
      }

      if (
        request.method === 'GET' &&
        (url.pathname === echoLinkMobileRemotePath || url.pathname === `${echoLinkMobileRemotePath}/`)
      ) {
        writeMobileRemoteHtml(response);
        return true;
      }
      if (request.method === 'GET' && url.pathname === echoLinkMobileRemoteManifestPath) {
        writeMobileRemoteAsset(
          response,
          'application/manifest+json; charset=utf-8',
          createEchoLinkMobileRemoteManifest(),
        );
        return true;
      }
      if (request.method === 'GET' && url.pathname === echoLinkMobileRemoteIconPath) {
        writeMobileRemoteAsset(response, 'image/svg+xml; charset=utf-8', createEchoLinkMobileRemoteIcon());
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/echo-link/v2/pair') {
        await this.handlePair(request, response);
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/echo-link/v2/status') {
        const client = this.authenticateRequest(request, 'status:read');
        this.recordClientSeen(client);
        writeJson(response, 200, this.createStatusResponse());
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/echo-link/v2/artwork/current') {
        const client = this.authenticateRequest(request, 'status:read');
        this.recordClientSeen(client);
        const artwork = await this.artworkProvider(this.eventHub.getSnapshot());
        if (!artwork) {
          throw new EchoLinkV2HttpError(404, 'artwork_not_found');
        }
        writeCorsHeaders(response);
        response.statusCode = 200;
        response.setHeader('Content-Type', artwork.mimeType);
        response.setHeader('Content-Length', String(artwork.data.byteLength));
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(artwork.data);
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/echo-link/v2/actions/playback') {
        await this.handlePlaybackAction(request, response);
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/echo-link/v2/events/ticket') {
        this.handleEventTicket(request, response);
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/echo-link/v2/events') {
        this.handleEvents(request, response, url);
        return true;
      }
      throw new EchoLinkV2HttpError(404, 'not_found');
    } catch (error) {
      const normalized = this.normalizeError(error);
      if (!response.headersSent) {
        writeError(
          response,
          normalized.statusCode,
          normalized.code,
          normalized.message,
          normalized.requestId,
        );
      } else if (!response.writableEnded) {
        response.end();
      }
      return true;
    }
  }

  private async handlePair(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
    this.consumeRateLimit(
      this.pairingAttempts,
      remoteAddress,
      maxPairingAttemptsPerMinute,
      'pairing_rate_limited',
    );
    this.cleanupExpiredState();
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new EchoLinkV2HttpError(400, 'invalid_pairing_request');
    }
    const pairingId = normalizeRequiredText(body.pairingId, 'invalid_pairing_id', 128);
    const secret = normalizeRequiredText(body.secret, 'invalid_pairing_secret', 256);
    const clientName = normalizeRequiredText(body.clientName, 'invalid_client_name', 80);
    const platform = typeof body.platform === 'string' && body.platform.trim()
      ? body.platform.trim().slice(0, 80)
      : null;
    const pairing = this.pairing;
    if (
      !pairing ||
      pairing.expiresAtEpochMs <= this.now() ||
      pairing.id !== pairingId ||
      !secretEquals(pairing.secret, secret)
    ) {
      throw new EchoLinkV2HttpError(401, 'invalid_or_expired_pairing');
    }

    const accessToken = this.randomToken(32);
    const clientId = `client-${this.randomToken(12)}`;
    const createdAt = new Date(this.now()).toISOString();
    let client: EchoLinkPairedClient;
    try {
      client = this.clientStore.addClient({
        id: clientId,
        name: clientName,
        platform,
        tokenHash: hashEchoLinkAccessToken(accessToken),
        scopes: echoLinkV2Scopes,
        createdAt,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      throw new EchoLinkV2HttpError(409, code);
    }

    this.pairing = null;
    this.touch();
    const runtime = this.getRuntime();
    writeJson(response, 201, {
      apiVersion: 2,
      clientId: client.id,
      accessToken,
      scopes: client.scopes,
      apiBaseUrl: `http://${runtime.host}:${runtime.port}/echo-link/v2`,
    });
  }

  private async handlePlaybackAction(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const client = this.authenticateRequest(request, 'playback:control');
    this.recordClientSeen(client);
    this.consumeRateLimit(
      this.actionAttempts,
      client.id,
      maxActionsPerMinute,
      'playback_action_rate_limited',
    );
    const action = normalizePlaybackAction(await readJsonBody(request));
    this.cleanupExpiredState();
    const key = `${client.id}:${action.requestId}`;
    let cached = this.actionCache.get(key);
    if (!cached) {
      cached = {
        expiresAtEpochMs: this.now() + actionDedupeTtlMs,
        promise: this.actionRouter.execute(action),
      };
      this.actionCache.set(key, cached);
      this.trimActionCache(client.id);
    }
    const result = await cached.promise;
    writeJson(response, 200, result);
  }

  private handleEventTicket(request: IncomingMessage, response: ServerResponse): void {
    const client = this.authenticateRequest(request, 'events:read');
    this.recordClientSeen(client);
    const ticket = this.randomToken(24);
    const expiresAtEpochMs = this.now() + eventTicketTtlMs;
    this.eventTickets.set(ticket, {
      clientId: client.id,
      remoteAddress: normalizeRemoteAddress(request.socket.remoteAddress),
      expiresAtEpochMs,
    });
    writeJson(response, 201, {
      ticket,
      eventsUrl: `/echo-link/v2/events?ticket=${encodeURIComponent(ticket)}`,
      expiresAt: new Date(expiresAtEpochMs).toISOString(),
    });
  }

  private handleEvents(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const client = this.authenticateEventRequest(request, url);
    this.recordClientSeen(client);
    const existing = this.eventConnections.get(client.id) ?? new Set<EventConnection>();
    if (existing.size >= maxEventConnectionsPerClient) {
      throw new EchoLinkV2HttpError(429, 'event_connection_limit_reached');
    }

    writeCorsHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    let closed = false;
    let unsubscribe = (): void => undefined;
    const heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) {
        response.write(': heartbeat\n\n');
      }
    }, heartbeatIntervalMs);
    heartbeat.unref?.();
    const connection: EventConnection = {
      close: () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        existing.delete(connection);
        if (existing.size === 0) {
          this.eventConnections.delete(client.id);
        }
        if (!response.writableEnded) {
          response.end();
        }
      },
    };
    const onClose = (): void => connection.close();
    request.once('close', onClose);
    existing.add(connection);
    this.eventConnections.set(client.id, existing);
    unsubscribe = this.eventHub.subscribe((event) => {
      if (closed || response.writableEnded) {
        return;
      }
      const outbound = {
        version: 1,
        id: event.id,
        type: event.type,
        occurredAt: event.occurredAt,
        snapshot: toV2PlaybackSnapshot(event.snapshot, this.getPlaybackOrder()),
      };
      response.write(`event: ${event.type}\nid: ${event.id}\ndata: ${JSON.stringify(outbound)}\n\n`);
    });
  }

  private createStatusResponse(): EchoLinkV2StatusResponse {
    const runtime = this.getRuntime();
    return {
      apiVersion: 2,
      device: {
        id: runtime.deviceId,
        name: runtime.deviceName,
      },
      capabilities: {
        scopes: [...echoLinkV2Scopes],
        playbackActions: [...playbackActions],
      },
      playback: toV2PlaybackSnapshot(this.eventHub.getSnapshot(), this.getPlaybackOrder()),
    };
  }

  private authenticateRequest(
    request: IncomingMessage,
    requiredScope: EchoLinkV2Scope,
  ): EchoLinkPairedClient {
    const authorization = safeHeader(request.headers.authorization);
    if (!authorization?.startsWith('Bearer ')) {
      throw new EchoLinkV2HttpError(401, 'unauthorized');
    }
    const client = this.clientStore.authenticate(authorization.slice('Bearer '.length));
    if (!client) {
      throw new EchoLinkV2HttpError(401, 'unauthorized');
    }
    if (!client.scopes.includes(requiredScope)) {
      throw new EchoLinkV2HttpError(403, 'insufficient_scope');
    }
    return client;
  }

  private authenticateEventRequest(request: IncomingMessage, url: URL): EchoLinkPairedClient {
    const authorization = safeHeader(request.headers.authorization);
    if (authorization) {
      return this.authenticateRequest(request, 'events:read');
    }
    this.cleanupExpiredState();
    const ticket = url.searchParams.get('ticket');
    const record = ticket ? this.eventTickets.get(ticket) : null;
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
    if (!record || record.expiresAtEpochMs <= this.now() || record.remoteAddress !== remoteAddress) {
      throw new EchoLinkV2HttpError(401, 'invalid_or_expired_event_ticket');
    }
    const client = this.clientStore.listClients().find((item) => item.id === record.clientId);
    if (!client || !client.scopes.includes('events:read')) {
      throw new EchoLinkV2HttpError(401, 'invalid_or_expired_event_ticket');
    }
    return client;
  }

  private recordClientSeen(client: EchoLinkPairedClient): void {
    this.clientStore.touchClient(client.id, new Date(this.now()).toISOString());
  }

  private assertLanRequest(request: IncomingMessage): void {
    if (!isLanAddress(normalizeRemoteAddress(request.socket.remoteAddress))) {
      throw new EchoLinkV2HttpError(403, 'lan_only');
    }
  }

  private consumeRateLimit(
    store: Map<string, number[]>,
    key: string,
    limit: number,
    code: string,
  ): void {
    const cutoff = this.now() - 60_000;
    const recent = (store.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= limit) {
      store.set(key, recent);
      throw new EchoLinkV2HttpError(429, code);
    }
    recent.push(this.now());
    store.set(key, recent);
  }

  private trimActionCache(clientId: string): void {
    const prefix = `${clientId}:`;
    const clientKeys = [...this.actionCache.keys()].filter((key) => key.startsWith(prefix));
    while (clientKeys.length > maxActionCacheEntriesPerClient) {
      const oldest = clientKeys.shift();
      if (oldest) {
        this.actionCache.delete(oldest);
      }
    }
  }

  private cleanupExpiredState(): void {
    const now = this.now();
    if (this.pairing && this.pairing.expiresAtEpochMs <= now) {
      this.pairing = null;
      this.touch();
    }
    for (const [ticket, record] of this.eventTickets) {
      if (record.expiresAtEpochMs <= now) {
        this.eventTickets.delete(ticket);
      }
    }
    for (const [key, record] of this.actionCache) {
      if (record.expiresAtEpochMs <= now) {
        this.actionCache.delete(key);
      }
    }
  }

  private closeClientConnections(clientId: string): void {
    const connections = [...(this.eventConnections.get(clientId) ?? [])];
    for (const connection of connections) {
      connection.close();
    }
    this.eventConnections.delete(clientId);
  }

  private normalizeError(error: unknown): EchoLinkV2HttpError {
    if (error instanceof EchoLinkV2HttpError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    switch (message) {
      case 'main_window_unavailable':
      case 'main_window_playback_controller_unavailable':
        return new EchoLinkV2HttpError(503, message);
      case 'main_window_playback_command_timeout':
        return new EchoLinkV2HttpError(504, message);
      case 'playback_action_unavailable':
        return new EchoLinkV2HttpError(409, message);
      default:
        return new EchoLinkV2HttpError(500, 'internal_error');
    }
  }

  private touch(): void {
    this.updatedAt = new Date(this.now()).toISOString();
  }
}
