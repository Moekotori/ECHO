import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IntegrationEventEnvelopeV1,
  IntegrationPlaybackAction,
  IntegrationPlaybackActionResult,
  IntegrationPlaybackSnapshotV1,
} from '../../shared/types/integrationPlatform';
import type { EchoLinkPlaybackOrderMode, EchoLinkV2StatusResponse } from '../../shared/types/echoLink';
import { EchoLinkV2ClientStore } from './EchoLinkV2ClientStore';
import { EchoLinkV2Service, type EchoLinkV2RuntimeState } from './EchoLinkV2Service';

const snapshot: IntegrationPlaybackSnapshotV1 = {
  version: 1,
  revision: 1,
  observedAt: '2026-07-17T00:00:00.000Z',
  state: 'playing',
  track: {
    id: 'track-1',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Album Artist',
    artworkUrl: 'file:///D:/private-cover.jpg',
  },
  positionMs: 1_000,
  durationMs: 120_000,
  volume: 0.5,
  output: {
    mode: 'shared',
    deviceName: 'Speakers',
    backend: 'wasapi-internal',
  },
};

class FakeEventHub {
  private readonly listeners = new Set<(event: IntegrationEventEnvelopeV1) => void>();

  getSnapshot(): IntegrationPlaybackSnapshotV1 {
    return snapshot;
  }

  subscribe(listener: (event: IntegrationEventEnvelopeV1) => void): () => void {
    this.listeners.add(listener);
    listener({
      version: 1,
      id: '1',
      type: 'snapshot',
      occurredAt: snapshot.observedAt,
      snapshot,
    });
    return () => this.listeners.delete(listener);
  }
}

describe('EchoLinkV2Service', () => {
  let tempRoot: string;
  let clientStorePath: string;
  let server: Server;
  let service: EchoLinkV2Service;
  let runtime: EchoLinkV2RuntimeState;
  let baseUrl: string;
  let now: number;
  let randomSequence: number;
  let playbackOrder: EchoLinkPlaybackOrderMode;
  let executeAction: ReturnType<typeof vi.fn<(action: IntegrationPlaybackAction) => Promise<IntegrationPlaybackActionResult>>>;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'echo-link-v2-'));
    clientStorePath = join(tempRoot, 'echo-link-clients.json');
    now = Date.parse('2026-07-17T00:00:00.000Z');
    randomSequence = 0;
    playbackOrder = 'sequential';
    executeAction = vi.fn(async (action: IntegrationPlaybackAction) => {
      if (action.action === 'setPlaybackOrder') {
        playbackOrder = action.mode;
      }
      return {
        requestId: action.requestId,
        ok: true as const,
        completedAt: new Date(now).toISOString(),
      };
    });
    runtime = {
      enabled: true,
      running: false,
      host: '127.0.0.1',
      port: 0,
      addresses: ['127.0.0.1'],
      deviceId: 'echo-pc',
      deviceName: 'ECHO Test',
      error: null,
    };
    service = new EchoLinkV2Service({
      getRuntime: () => runtime,
      eventHub: new FakeEventHub(),
      actionRouter: { execute: executeAction },
      clientStore: new EchoLinkV2ClientStore({ filePath: clientStorePath }),
      now: () => now,
      randomToken: (bytes) => `token-${bytes}-${++randomSequence}`,
      getPlaybackOrder: () => playbackOrder,
      artworkProvider: async () => ({
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png',
      }),
    });
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${runtime.port}`);
      void service.handleRequest(request, response, url);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    runtime.port = address && typeof address !== 'string' ? address.port : 0;
    runtime.running = true;
    baseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  afterEach(async () => {
    service.dispose();
    server.close();
    await once(server, 'close');
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const pairClient = async (): Promise<{ accessToken: string; clientId: string }> => {
    const pairing = await service.startPairing();
    const pairingUrl = new URL(pairing.pairingUri);
    const response = await fetch(`${baseUrl}/echo-link/v2/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingId: pairingUrl.searchParams.get('pairingId'),
        secret: pairingUrl.searchParams.get('secret'),
        clientName: 'Living Room',
        platform: 'test',
      }),
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<{ accessToken: string; clientId: string }>;
  };

  it('pairs once, stores only the token hash, serves safe status and deduplicates actions', async () => {
    const pairing = await service.startPairing();
    const pairingUrl = new URL(pairing.pairingUri);
    const webRemoteUrl = new URL(pairing.webRemoteUrl);
    expect(webRemoteUrl.pathname).toBe('/echo-link/v2/remote');
    expect(webRemoteUrl.search).toBe('');
    expect(new URLSearchParams(webRemoteUrl.hash.slice(1)).get('pair')).toBe(pairing.pairingUri);
    expect(pairing.qrDataUrl).toMatch(/^data:image\/png;base64,/u);
    const body = {
      pairingId: pairingUrl.searchParams.get('pairingId'),
      secret: pairingUrl.searchParams.get('secret'),
      clientName: 'Living Room',
      platform: 'test',
    };
    const pairedResponse = await fetch(`${baseUrl}/echo-link/v2/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const paired = await pairedResponse.json() as { accessToken: string; clientId: string };
    expect(pairedResponse.status).toBe(201);
    const stored = readFileSync(clientStorePath, 'utf8');
    expect(stored).not.toContain(paired.accessToken);
    expect(stored).not.toContain(String(body.secret));

    const replay = await fetch(`${baseUrl}/echo-link/v2/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(401);

    const auth = { Authorization: `Bearer ${paired.accessToken}` };
    const statusResponse = await fetch(`${baseUrl}/echo-link/v2/status`, { headers: auth });
    expect(statusResponse.status).toBe(200);
    const statusText = await statusResponse.text();
    const status = JSON.parse(statusText) as EchoLinkV2StatusResponse;
    expect(statusText).toContain('Song');
    expect(statusText).not.toContain('private-cover.jpg');
    expect(statusText).not.toContain('wasapi-internal');
    expect(status.playback.playbackOrder).toBe('sequential');
    expect(status.capabilities.playbackActions).toContain('setPlaybackOrder');

    const artworkResponse = await fetch(`${baseUrl}/echo-link/v2/artwork/current`, { headers: auth });
    expect(artworkResponse.status).toBe(200);
    expect(artworkResponse.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await artworkResponse.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const actionBody = JSON.stringify({ requestId: 'request-1', action: 'next' });
    const firstAction = await fetch(`${baseUrl}/echo-link/v2/actions/playback`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: actionBody,
    });
    const repeatedAction = await fetch(`${baseUrl}/echo-link/v2/actions/playback`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: actionBody,
    });
    expect(firstAction.status).toBe(200);
    expect(repeatedAction.status).toBe(200);
    expect(executeAction).toHaveBeenCalledTimes(1);

    const orderAction = await fetch(`${baseUrl}/echo-link/v2/actions/playback`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'request-order-1', action: 'setPlaybackOrder', mode: 'shuffle' }),
    });
    expect(orderAction.status).toBe(200);
    expect(executeAction).toHaveBeenLastCalledWith({
      requestId: 'request-order-1',
      action: 'setPlaybackOrder',
      mode: 'shuffle',
    });
    const updatedStatus = await fetch(`${baseUrl}/echo-link/v2/status`, { headers: auth });
    expect(((await updatedStatus.json()) as EchoLinkV2StatusResponse).playback.playbackOrder).toBe('shuffle');

    service.revokeClient(paired.clientId);
    const revokedStatus = await fetch(`${baseUrl}/echo-link/v2/status`, { headers: auth });
    expect(revokedStatus.status).toBe(401);
    const revokedArtwork = await fetch(`${baseUrl}/echo-link/v2/artwork/current`, { headers: auth });
    expect(revokedArtwork.status).toBe(401);
  });

  it('issues a short event ticket and sends a sanitized initial SSE snapshot', async () => {
    const paired = await pairClient();
    const ticketResponse = await fetch(`${baseUrl}/echo-link/v2/events/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${paired.accessToken}` },
    });
    expect(ticketResponse.status).toBe(201);
    const ticket = await ticketResponse.json() as { eventsUrl: string };
    const controller = new AbortController();
    const eventResponse = await fetch(`${baseUrl}${ticket.eventsUrl}`, { signal: controller.signal });
    expect(eventResponse.status).toBe(200);
    const reader = eventResponse.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('event: snapshot');
    expect(text).toContain('"title":"Song"');
    expect(text).toContain('"playbackOrder":"sequential"');
    expect(text).not.toContain('private-cover.jpg');
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('expires pairing sessions and handles CORS preflight without authentication', async () => {
    const pairing = await service.startPairing();
    const pairingUrl = new URL(pairing.pairingUri);
    now += 2 * 60 * 1000 + 1;
    const expired = await fetch(`${baseUrl}/echo-link/v2/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingId: pairingUrl.searchParams.get('pairingId'),
        secret: pairingUrl.searchParams.get('secret'),
        clientName: 'Expired',
      }),
    });
    expect(expired.status).toBe(401);

    const preflight = await fetch(`${baseUrl}/echo-link/v2/status`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('serves the same-origin mobile remote without authentication only while Basic is enabled', async () => {
    const response = await fetch(`${baseUrl}/echo-link/v2/remote`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data: blob:");
    expect(response.headers.get('content-security-policy')).toContain("manifest-src 'self'");
    expect(html).toContain('ECHO Link Remote');
    expect(html).toContain("location.origin + '/echo-link/v2'");
    expect(html).toContain('/echo-link/v2/remote/manifest.webmanifest');
    expect(html).toContain("window.addEventListener('pageshow'");
    expect(html).toContain("window.addEventListener('online'");
    expect(html).toContain("window.addEventListener('beforeinstallprompt'");

    const manifestResponse = await fetch(`${baseUrl}/echo-link/v2/remote/manifest.webmanifest`);
    const manifest = await manifestResponse.json() as {
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{ src: string; purpose: string }>;
    };
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get('content-type')).toContain('application/manifest+json');
    expect(manifestResponse.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(manifest).toMatchObject({
      start_url: '/echo-link/v2/remote',
      scope: '/echo-link/v2/',
      display: 'standalone',
    });
    expect(manifest.icons).toContainEqual(expect.objectContaining({
      src: '/echo-link/v2/remote/icon.svg',
      purpose: 'any maskable',
    }));

    const iconResponse = await fetch(`${baseUrl}/echo-link/v2/remote/icon.svg`);
    const icon = await iconResponse.text();
    expect(iconResponse.status).toBe(200);
    expect(iconResponse.headers.get('content-type')).toContain('image/svg+xml');
    expect(icon).toContain('<svg');
    expect(icon).toContain('aria-label="ECHO Link"');

    runtime.enabled = false;
    const disabled = await fetch(`${baseUrl}/echo-link/v2/remote`);
    expect(disabled.status).toBe(404);
    const disabledManifest = await fetch(`${baseUrl}/echo-link/v2/remote/manifest.webmanifest`);
    expect(disabledManifest.status).toBe(404);
  });
});
