import { describe, expect, it, vi } from 'vitest';
import type { HqPlayerPlaybackControlPlan, HqPlayerSettings } from '../../../shared/types/hqplayer';
import type { PlayableTrack } from '../../../shared/types/remoteSources';
import { defaultHqPlayerSettings } from '../../app/appSettings';
import type { HqPlayerMediaServerBridge } from './HqPlayerMediaServer';
import {
  HqPlayerService,
  type HqPlayerControlSender,
  type HqPlayerMediaResolver,
  type HqPlayerSettingsStore,
  type HqPlayerTcpProbe,
} from './HqPlayerService';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
  },
}));

const createStore = (initial: Partial<HqPlayerSettings> = {}): HqPlayerSettingsStore => {
  let settings: HqPlayerSettings = { ...defaultHqPlayerSettings, ...initial };

  return {
    read: () => settings,
    write: (next) => {
      settings = next;
      return settings;
    },
  };
};

const createResolver = (): HqPlayerMediaResolver => ({
  createRemoteStreamUrl: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:43129/remote-stream/token',
    expiresAt: '2026-05-20T01:00:00.000Z',
  }),
  resolveStreamingPlayback: vi.fn().mockResolvedValue({
    provider: 'netease',
    providerTrackId: 'song-1',
    url: 'https://cdn.example/song.flac',
    expiresAt: '2026-05-20T01:00:00.000Z',
    mimeType: 'audio/flac',
    bitrate: 900000,
    sampleRate: 96000,
    bitDepth: 24,
    codec: 'flac',
    headers: {},
    requiresProxy: false,
    supportsRange: true,
  }),
});

const createMediaServer = (): HqPlayerMediaServerBridge => ({
  createUrl: vi.fn().mockResolvedValue({
    url: 'http://192.168.1.10:17890/hqplayer-media/token',
    expiresAt: '2026-05-20T02:00:00.000Z',
    port: 17890,
    bindHost: '0.0.0.0',
    publicHost: '192.168.1.10',
    remoteAccess: true,
    publicHostCandidates: ['192.168.1.10'],
  }),
});

const createSentResult = (plan: HqPlayerPlaybackControlPlan) => ({
  state: 'sent' as const,
  reason: null,
  transport: 'official-control-tcp' as const,
  command: 'PlayNextURI+Play' as const,
  endpoint: plan.endpoint,
  startedAt: '2026-05-21T01:00:00.000Z',
  finishedAt: '2026-05-21T01:00:00.012Z',
  elapsedMs: 12,
  message: null,
  response: '<PlayNextURI result="OK"/>\n<Play result="OK"/>',
});

const localTrack: PlayableTrack = {
  mediaType: 'local',
  trackId: 'local-1',
  path: 'D:\\Music\\song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 180,
};

const remoteTrack: PlayableTrack = {
  mediaType: 'remote',
  trackId: 'remote-1',
  sourceId: 'webdav-1',
  remotePath: '/music/song.flac',
  stableKey: 'remote-song',
  title: 'Remote Song',
  artist: 'Artist',
  album: 'Album',
  duration: 240,
};

const streamingTrack: PlayableTrack = {
  mediaType: 'streaming',
  trackId: 'streaming-1',
  provider: 'netease',
  providerTrackId: 'song-1',
  quality: 'hires',
  stableKey: 'netease:song-1',
  title: 'Streaming Song',
  artist: 'Artist',
  album: 'Album',
  duration: 220,
  playable: true,
};

describe('HqPlayerService', () => {
  it('keeps HQPlayer disabled without probing the network by default', async () => {
    const probe = vi.fn<HqPlayerTcpProbe>();
    const service = new HqPlayerService(createStore(), probe);

    expect(service.getStatus()).toMatchObject({
      enabled: false,
      state: 'disabled',
      endpoint: {
        host: '127.0.0.1',
        port: 4321,
      },
    });

    await expect(service.testConnection()).resolves.toMatchObject({
      ok: false,
      state: 'disabled',
      error: 'hqplayer_disabled',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('normalizes saved settings through the shared app-settings rules', () => {
    const service = new HqPlayerService(createStore());

    expect(
      service.setSettings({
        enabled: true,
        connectionMode: 'remote',
        host: '  10.0.0.8\n',
        port: 4321,
        defaultPlaybackBackend: 'ask',
      }),
    ).toMatchObject({
      enabled: true,
      connectionMode: 'remote',
      host: '10.0.0.8',
      port: 4321,
      defaultPlaybackBackend: 'ask',
    });
  });

  it('reports an available endpoint when the configured control port accepts a TCP connection', async () => {
    const probe = vi.fn<HqPlayerTcpProbe>().mockResolvedValue({
      ok: true,
      elapsedMs: 12,
      error: null,
    });
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        host: '127.0.0.1',
        port: 4321,
      }),
      probe,
    );

    await expect(service.testConnection()).resolves.toMatchObject({
      ok: true,
      state: 'available',
      elapsedMs: 12,
      endpoint: {
        host: '127.0.0.1',
        port: 4321,
      },
      error: null,
    });
    expect(probe).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 4321,
      timeoutMs: 1500,
    });
    expect(service.getStatus()).toMatchObject({
      state: 'available',
      lastError: null,
    });
  });

  it('keeps read-only HQPlayer control details on the status snapshot', async () => {
    const probe = vi.fn<HqPlayerTcpProbe>().mockResolvedValue({
      ok: true,
      elapsedMs: 18,
      error: null,
      controlInfo: {
        name: 'Living Room',
        product: 'HQPlayer Desktop',
        version: '5.17.2',
        platform: 'Windows',
        engine: '5.29.2',
        receivedAt: '2026-05-21T01:00:00.000Z',
      },
      playbackStatus: {
        state: 'playing',
        stateCode: 2,
        track: 1,
        trackId: 'track-1',
        tracksTotal: 1,
        queued: false,
        positionSeconds: 12,
        durationSeconds: 180,
        volume: -3,
        activeMode: 'poly-sinc',
        activeFilter: 'sinc-M',
        activeShaper: 'ASDM7',
        activeRate: 2822400,
        activeBits: 1,
        activeChannels: 2,
        inputFill: 0.5,
        outputFill: 0.7,
        outputDelayUs: 12000,
        apodizing: 1,
        metadata: null,
        receivedAt: '2026-05-21T01:00:00.000Z',
      },
    });
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        host: '127.0.0.1',
        port: 4321,
      }),
      probe,
    );

    await expect(service.testConnection()).resolves.toMatchObject({
      ok: true,
      controlInfo: {
        product: 'HQPlayer Desktop',
        engine: '5.29.2',
      },
      playbackStatus: {
        state: 'playing',
        activeRate: 2822400,
      },
    });
    expect(service.getStatus()).toMatchObject({
      controlInfo: {
        name: 'Living Room',
      },
      playbackStatus: {
        state: 'playing',
        durationSeconds: 180,
      },
    });
  });

  it('keeps handoff in ECHO when HQPlayer is not the selected playback backend', async () => {
    const resolver = createResolver();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'echoNative',
      }),
      undefined,
      resolver,
    );

    await expect(service.createPlaybackHandoff({ item: localTrack })).resolves.toMatchObject({
      state: 'fallback',
      reason: 'echo_native_selected',
      control: {
        state: 'skipped',
        reason: 'handoff_not_ready',
        action: 'none',
        transport: 'dry-run',
      },
      fallback: {
        backend: 'echoNative',
      },
      source: null,
    });
    expect(resolver.createRemoteStreamUrl).not.toHaveBeenCalled();
    expect(resolver.resolveStreamingPlayback).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation when the default backend is ask', async () => {
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'ask',
      }),
      undefined,
      createResolver(),
    );

    await expect(service.createPlaybackHandoff({ item: localTrack })).resolves.toMatchObject({
      state: 'needs-confirmation',
      reason: 'hqplayer_confirmation_required',
      fallback: null,
      source: null,
    });
  });

  it('allows an explicit confirmed handoff even when the default backend is ECHO', async () => {
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'echoNative',
      }),
      undefined,
      createResolver(),
    );

    await expect(service.createPlaybackHandoff({ item: localTrack, confirmed: true })).resolves.toMatchObject({
      state: 'ready',
      reason: null,
      source: {
        trackId: 'local-1',
        exposure: 'local-file',
      },
      control: {
        state: 'prepared',
        reason: null,
      },
    });
  });

  it('creates a ready local-desktop handoff for local files after confirmation', async () => {
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'ask',
      }),
      undefined,
      createResolver(),
    );

    await expect(service.createPlaybackHandoff({ item: localTrack, confirmed: true, startSeconds: 12 })).resolves.toMatchObject({
      state: 'ready',
      reason: null,
      source: {
        trackId: 'local-1',
        url: 'D:\\Music\\song.flac',
        exposure: 'local-file',
        startSeconds: 12,
      },
      control: {
        state: 'prepared',
        reason: null,
        action: 'play-source',
        transport: 'dry-run',
        profileName: null,
        source: {
          trackId: 'local-1',
          url: 'D:\\Music\\song.flac',
          exposure: 'local-file',
          hasHeaders: false,
        },
        metadata: {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          durationSeconds: 180,
        },
        startSeconds: 12,
      },
    });
    expect(service.getLastPlaybackHandoffPlan()).toMatchObject({
      state: 'ready',
      source: {
        trackId: 'local-1',
      },
    });
    expect(service.getLastPlaybackControlPlan()).toMatchObject({
      state: 'prepared',
      source: {
        trackId: 'local-1',
      },
    });
  });

  it('exposes remote tracks through the existing loopback stream URL for local desktop HQPlayer', async () => {
    const resolver = createResolver();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      resolver,
    );

    await expect(service.createPlaybackHandoff({ item: remoteTrack })).resolves.toMatchObject({
      state: 'ready',
      source: {
        trackId: 'remote-1',
        url: 'http://127.0.0.1:43129/remote-stream/token',
        exposure: 'loopback-http',
        expiresAt: '2026-05-20T01:00:00.000Z',
      },
    });
    expect(resolver.createRemoteStreamUrl).toHaveBeenCalledWith({
      trackId: 'remote-1',
      sourceId: 'webdav-1',
      remotePath: '/music/song.flac',
      stableKey: 'remote-song',
    });
  });

  it('uses a prepared resolved source for preflight without resolving the remote stream again', async () => {
    const resolver = createResolver();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      resolver,
    );

    await expect(
      service.createPlaybackHandoff({
        item: remoteTrack,
        resolvedSource: {
          filePath: 'http://127.0.0.1:43129/remote-stream/prepared',
          inputHeaders: undefined,
          mimeType: null,
          durationSeconds: 240,
          probe: { durationSeconds: 240 },
        },
      }),
    ).resolves.toMatchObject({
      state: 'ready',
      source: {
        url: 'http://127.0.0.1:43129/remote-stream/prepared',
        exposure: 'loopback-http',
      },
    });
    expect(resolver.createRemoteStreamUrl).not.toHaveBeenCalled();
  });

  it('falls back when a remote HQPlayer cannot access local files before the media server exists', async () => {
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        connectionMode: 'remote',
        port: 4321,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      createResolver(),
    );

    await expect(service.createPlaybackHandoff({ item: localTrack })).resolves.toMatchObject({
      state: 'fallback',
      reason: 'remote_hqplayer_requires_media_server',
      fallback: {
        backend: 'echoNative',
      },
      source: null,
    });
  });

  it('falls back for streaming sources that require headers HQPlayer cannot receive yet', async () => {
    const resolver = createResolver();
    vi.mocked(resolver.resolveStreamingPlayback).mockResolvedValueOnce({
      provider: 'netease',
      providerTrackId: 'song-1',
      url: 'https://cdn.example/song.flac',
      expiresAt: '2026-05-20T01:00:00.000Z',
      mimeType: 'audio/flac',
      bitrate: 900000,
      sampleRate: 96000,
      bitDepth: 24,
      codec: 'flac',
      headers: { Referer: 'https://music.163.com/' },
      requiresProxy: false,
      supportsRange: true,
    });
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      resolver,
    );

    await expect(service.createPlaybackHandoff({ item: streamingTrack })).resolves.toMatchObject({
      state: 'fallback',
      reason: 'source_requires_headers',
      source: null,
    });
  });

  it('uses the opt-in media server for remote HQPlayer local-file handoff', async () => {
    const mediaServer = createMediaServer();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        connectionMode: 'remote',
        port: 4321,
        mediaServerEnabled: true,
        mediaServerPort: 17890,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      createResolver(),
      mediaServer,
    );

    await expect(service.createPlaybackHandoff({ item: localTrack })).resolves.toMatchObject({
      state: 'ready',
      source: {
        url: 'http://192.168.1.10:17890/hqplayer-media/token',
        exposure: 'media-server',
        expiresAt: '2026-05-20T02:00:00.000Z',
        mediaServer: {
          publicHost: '192.168.1.10',
          bindHost: '0.0.0.0',
          port: 17890,
          remoteAccess: true,
          publicHostCandidates: ['192.168.1.10'],
        },
      },
    });
    expect(mediaServer.createUrl).toHaveBeenCalledWith(
      {
        url: 'D:\\Music\\song.flac',
        mimeType: null,
      },
      {
        port: 17890,
        remoteAccess: true,
        preferredRemoteHost: '127.0.0.1',
      },
    );
  });

  it('uses the media server to hide streaming request headers from HQPlayer', async () => {
    const resolver = createResolver();
    vi.mocked(resolver.resolveStreamingPlayback).mockResolvedValueOnce({
      provider: 'netease',
      providerTrackId: 'song-1',
      url: 'https://cdn.example/song.flac',
      expiresAt: '2026-05-20T01:00:00.000Z',
      mimeType: 'audio/flac',
      bitrate: 900000,
      sampleRate: 96000,
      bitDepth: 24,
      codec: 'flac',
      headers: { Referer: 'https://music.163.com/' },
      requiresProxy: false,
      supportsRange: true,
    });
    const mediaServer = createMediaServer();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        mediaServerEnabled: true,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      resolver,
      mediaServer,
    );

    await expect(service.createPlaybackHandoff({ item: streamingTrack })).resolves.toMatchObject({
      state: 'ready',
      source: {
        url: 'http://192.168.1.10:17890/hqplayer-media/token',
        exposure: 'media-server',
        headers: {},
        mediaServer: {
          publicHost: '192.168.1.10',
          port: 17890,
        },
      },
      control: {
        state: 'prepared',
        source: {
          exposure: 'media-server',
          hasHeaders: false,
        },
      },
    });
    expect(mediaServer.createUrl).toHaveBeenCalledWith(
      {
        url: 'https://cdn.example/song.flac',
        headers: { Referer: 'https://music.163.com/' },
        mimeType: 'audio/flac',
      },
      {
        port: null,
        remoteAccess: false,
        preferredRemoteHost: null,
      },
    );
  });

  it('sends only a ready handoff through the HQPlayer control sender', async () => {
    const sender = vi.fn<HqPlayerControlSender>().mockImplementation(async (plan) => createSentResult(plan));
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'hqplayer',
      }),
      undefined,
      createResolver(),
      createMediaServer(),
      sender,
    );

    await service.createPlaybackHandoff({ item: localTrack });
    const result = await service.sendLastPlaybackControl();

    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0]?.[0]).toMatchObject({
      state: 'prepared',
      source: {
        url: 'D:\\Music\\song.flac',
      },
    });
    expect(result).toMatchObject({
      state: 'sent',
      reason: null,
    });
    expect(service.getLastPlaybackControlPlan()).toMatchObject({
      send: {
        state: 'sent',
      },
    });
    expect(service.getLastPlaybackHandoffPlan()).toMatchObject({
      control: {
        send: {
          state: 'sent',
        },
      },
    });
  });

  it('does not send fallback or confirmation-only handoffs', async () => {
    const sender = vi.fn<HqPlayerControlSender>();
    const service = new HqPlayerService(
      createStore({
        enabled: true,
        port: 4321,
        defaultPlaybackBackend: 'ask',
      }),
      undefined,
      createResolver(),
      createMediaServer(),
      sender,
    );

    await service.createPlaybackHandoff({ item: localTrack });
    const result = await service.sendLastPlaybackControl();

    expect(sender).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: 'skipped',
      reason: 'handoff_not_ready',
    });
    expect(service.getLastPlaybackControlPlan()).toMatchObject({
      state: 'skipped',
      send: {
        state: 'skipped',
        reason: 'handoff_not_ready',
      },
    });
  });
});
