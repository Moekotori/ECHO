import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hqPlayerConnectDeviceId, type ConnectStartRequest } from '../../shared/types/connect';
import type { LibraryTrack } from '../../shared/types/library';
import type { HqPlayerConnectionTestResult, HqPlayerSettings, HqPlayerStatus } from '../../shared/types/hqplayer';
import type { DlnaDevice } from './DlnaClient';

const mocks = vi.hoisted(() => {
  const audioSession = {
    getStatus: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  const libraryService = {
    getTrack: vi.fn(),
    resolveCoverAsset: vi.fn(),
  };

  return {
    audioSession,
    libraryService,
  };
});

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => mocks.audioSession,
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => mocks.libraryService,
}));

const localTrack: LibraryTrack = {
  id: 'track-1',
  path: 'D:\\Music\\song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
};

const dlnaDevice = (overrides: Partial<DlnaDevice> = {}): DlnaDevice => ({
  id: 'dlna:uuid:streamer-1',
  name: 'Living Room Streamer',
  protocol: 'dlna',
  model: 'N130',
  manufacturer: 'Silent Angel',
  address: '192.168.1.42',
  capabilities: {
    canPlay: true,
    canPause: true,
    canStop: true,
    canSeek: true,
    canSetVolume: true,
    supportsMetadata: true,
    supportsSetNext: false,
    supportedMimeTypes: ['audio/flac', 'audio/wav', 'audio/mpeg'],
    requiresTranscode: false,
  },
  state: 'available',
  lastSeenAt: '2026-05-21T01:00:00.000Z',
  unsupportedReason: null,
  descriptionUrl: 'http://192.168.1.42:49152/description.xml',
  udn: 'uuid:streamer-1',
  services: {
    avTransport: {
      serviceType: 'urn:schemas-upnp-org:service:AVTransport:1',
      controlUrl: 'http://192.168.1.42:49152/upnp/control/avtransport',
    },
    renderingControl: {
      serviceType: 'urn:schemas-upnp-org:service:RenderingControl:1',
      controlUrl: 'http://192.168.1.42:49152/upnp/control/rendering',
    },
    connectionManager: null,
  },
  ...overrides,
});

const hqStatus = (state: HqPlayerStatus['state'] = 'disabled'): HqPlayerStatus => ({
  enabled: state !== 'disabled',
  state,
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: 4321,
  },
  mediaServerEnabled: false,
  defaultPlaybackBackend: 'ask',
  profileName: null,
  lastCheckedAt: null,
  lastError: null,
});

const hqSettings = (patch: Partial<HqPlayerSettings> = {}): HqPlayerSettings => ({
  enabled: false,
  connectionMode: 'localDesktop',
  host: '127.0.0.1',
  port: 4321,
  executablePath: null,
  allowLaunch: false,
  mediaServerEnabled: false,
  mediaServerPort: null,
  defaultPlaybackBackend: 'ask',
  profileName: null,
  ...patch,
});

const hqConnectionOk = (settings: HqPlayerSettings = hqSettings({ enabled: true })): HqPlayerConnectionTestResult => ({
  ok: true,
  state: 'available',
  endpoint: {
    connectionMode: settings.connectionMode,
    host: settings.host,
    port: settings.port,
  },
  elapsedMs: 8,
  checkedAt: '2026-05-21T01:00:00.000Z',
  error: null,
  playbackStatus: {
    state: 'playing',
    stateCode: 2,
    track: 1,
    trackId: localTrack.id,
    tracksTotal: 1,
    queued: false,
    positionSeconds: 7,
    durationSeconds: 180,
    volume: null,
    activeMode: null,
    activeFilter: null,
    activeShaper: null,
    activeRate: null,
    activeBits: null,
    activeChannels: null,
    inputFill: null,
    outputFill: null,
    outputDelayUs: null,
    apodizing: null,
    metadata: null,
    receivedAt: '2026-05-21T01:00:00.000Z',
  },
});

const createHqPlayerService = (initial: Partial<HqPlayerSettings> = {}) => {
  let settings = hqSettings(initial);
  return {
    getSettings: vi.fn(() => settings),
    setSettings: vi.fn().mockImplementation((patch: Partial<HqPlayerSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }),
    getStatus: vi.fn().mockImplementation(() => ({
      ...hqStatus(settings.enabled ? 'available' : 'disabled'),
      enabled: settings.enabled,
      endpoint: {
        connectionMode: settings.connectionMode,
        host: settings.host,
        port: settings.port,
      },
    })),
    testConnection: vi.fn().mockImplementation(async (patch?: Partial<HqPlayerSettings>) => hqConnectionOk({ ...settings, ...patch })),
    createPlaybackHandoff: vi.fn().mockResolvedValue({
      state: 'ready',
      reason: null,
      control: {
        state: 'prepared',
        reason: null,
      },
    }),
    sendLastPlaybackControl: vi.fn().mockResolvedValue({
      state: 'sent',
      reason: null,
      message: null,
    }),
    seekPlayback: vi.fn().mockResolvedValue({
      state: 'sent',
      reason: null,
      message: null,
    }),
    stopPlayback: vi.fn().mockResolvedValue({
      state: 'sent',
      reason: null,
      message: null,
    }),
  };
};

const hqConnectionRefused: HqPlayerConnectionTestResult = {
  ok: false,
  state: 'unavailable',
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: 4321,
  },
  elapsedMs: 12,
  checkedAt: '2026-05-21T01:00:00.000Z',
  error: 'hqplayer_connection_refused',
};

const hqConnectionWithoutPlayback: HqPlayerConnectionTestResult = {
  ok: true,
  state: 'available',
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: 4321,
  },
  elapsedMs: 8,
  checkedAt: '2026-05-21T01:00:00.000Z',
  error: null,
  playbackStatus: null,
};

describe('ConnectService HQPlayer output device', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audioSession.getStatus.mockReturnValue({
      state: 'playing',
      currentTrackId: localTrack.id,
      currentFilePath: localTrack.path,
      positionSeconds: 7,
    });
    mocks.audioSession.pause.mockResolvedValue({});
    mocks.audioSession.stop.mockReturnValue({});
    mocks.libraryService.getTrack.mockReturnValue(localTrack);
    mocks.libraryService.resolveCoverAsset.mockReturnValue(null);
  });

  it('lists HQPlayer as a synthetic Connect output device', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    expect(service.listDevices()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: hqPlayerConnectDeviceId,
        name: 'HQPlayer Desktop',
        protocol: 'hqplayer',
        state: 'unavailable',
        capabilities: expect.objectContaining({
          canPlay: false,
          canPause: false,
          canStop: false,
          canSetVolume: false,
        }),
      }),
    ]));
  });

  it('surfaces the last HQPlayer control probe on the synthetic device', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    hqPlayer.getStatus.mockReturnValue({
      ...hqStatus('available'),
      lastCheckedAt: '2026-05-21T01:00:00.000Z',
      controlInfo: {
        name: 'Living Room',
        product: 'HQPlayer Desktop',
        version: '5.17.2',
        platform: 'Windows',
        engine: '5.29.2',
        receivedAt: '2026-05-21T01:00:01.000Z',
      },
    });
    const service = new ConnectService(hqPlayer);

    expect(service.listDevices()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: hqPlayerConnectDeviceId,
        model: 'HQPlayer Desktop 5.17.2',
        lastSeenAt: '2026-05-21T01:00:01.000Z',
      }),
    ]));
  });

  it('keeps recently missed DLNA streamers visible as unavailable instead of dropping them', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);
    const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
    const firstSeenAt = Date.parse('2026-05-21T01:00:00.000Z');

    merge.mergeDiscoveredDlnaDevices([dlnaDevice()], firstSeenAt);
    merge.mergeDiscoveredDlnaDevices([], firstSeenAt + 60_000);

    expect(service.listDevices()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'dlna:uuid:streamer-1',
        state: 'unavailable',
        lastSeenAt: '2026-05-21T01:00:00.000Z',
        unsupportedReason: expect.stringContaining('本次扫描未响应'),
      }),
    ]));
  });

  it('drops old missed DLNA streamers after the retention window', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);
    const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
    const firstSeenAt = Date.parse('2026-05-21T01:00:00.000Z');

    merge.mergeDiscoveredDlnaDevices([dlnaDevice()], firstSeenAt);
    merge.mergeDiscoveredDlnaDevices([], firstSeenAt + (11 * 60_000));

    expect(service.listDevices()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'dlna:uuid:streamer-1',
      }),
    ]));
  });

  it('hands DLNA renderers a playable URL with album art metadata before pausing local playback', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-connect-service-'));
    try {
      const audioPath = join(tempRoot, 'song.flac');
      const coverPath = join(tempRoot, 'cover.jpg');
      writeFileSync(audioPath, Buffer.from('audio', 'utf8'));
      writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const trackWithCover: LibraryTrack = {
        ...localTrack,
        path: audioPath,
        coverId: 'cover-1',
        coverThumb: 'echo-cover://thumb/cover-1',
      };
      const soapCalls: Array<{ soapAction: string | null; body: string }> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        soapCalls.push({
          soapAction: typeof init?.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
            ? String((init.headers as Record<string, string>).SOAPAction ?? '')
            : null,
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return {
          ok: true,
          text: () => Promise.resolve('<s:Envelope><s:Body /></s:Envelope>'),
        };
      }));
      mocks.libraryService.resolveCoverAsset.mockReturnValue({ filePath: coverPath });
      mocks.audioSession.getStatus.mockReturnValue({
        state: 'playing',
        currentTrackId: trackWithCover.id,
        currentFilePath: audioPath,
        positionSeconds: 7,
      });
      const { ConnectService } = await import('./ConnectService');
      const hqPlayer = createHqPlayerService();
      const service = new ConnectService(hqPlayer);
      const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
      merge.mergeDiscoveredDlnaDevices([dlnaDevice({ address: '127.0.0.1' })], Date.parse('2026-05-21T01:00:00.000Z'));

      await expect(service.connect({
        deviceId: 'dlna:uuid:streamer-1',
        track: trackWithCover,
        filePath: audioPath,
        positionSeconds: 7,
      })).resolves.toMatchObject({
        deviceId: 'dlna:uuid:streamer-1',
        protocol: 'dlna',
        state: 'playing',
        currentTrackId: trackWithCover.id,
        metadata: expect.objectContaining({
          coverHttpUrl: expect.stringContaining('/connect/cover/'),
        }),
      });

      const setUriCall = soapCalls.find((call) => call.soapAction?.includes('#SetAVTransportURI'));
      expect(setUriCall?.body).toContain('CurrentURI');
      expect(setUriCall?.body).toContain('/connect/audio/');
      expect(setUriCall?.body).toContain('song.flac');
      expect(setUriCall?.body).toContain('&lt;upnp:albumArtURI dlna:profileID=&quot;JPEG_TN&quot;&gt;');
      expect(setUriCall?.body).toContain('/connect/cover/');
      expect(setUriCall?.body).toContain('cover.jpg');
      expect(soapCalls.some((call) => call.soapAction?.includes('#Play'))).toBe(true);
      expect(mocks.audioSession.pause).toHaveBeenCalledOnce();
      await service.dispose();
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('proxies HTTP artwork through the local Connect server instead of handing the renderer URL to DLNA devices', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-connect-service-'));
    try {
      const audioPath = join(tempRoot, 'song.flac');
      writeFileSync(audioPath, Buffer.from('audio', 'utf8'));
      const trackWithRemoteCover: LibraryTrack = {
        ...localTrack,
        path: audioPath,
        coverId: null,
        coverThumb: 'https://covers.example.test/cover.webp',
      };
      const soapCalls: Array<{ soapAction: string | null; body: string }> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        soapCalls.push({
          soapAction: typeof init?.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
            ? String((init.headers as Record<string, string>).SOAPAction ?? '')
            : null,
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return {
          ok: true,
          text: () => Promise.resolve('<s:Envelope><s:Body /></s:Envelope>'),
        };
      }));
      mocks.libraryService.resolveCoverAsset.mockReturnValue(null);
      mocks.audioSession.getStatus.mockReturnValue({
        state: 'playing',
        currentTrackId: trackWithRemoteCover.id,
        currentFilePath: audioPath,
        positionSeconds: 0,
      });
      const { ConnectService } = await import('./ConnectService');
      const service = new ConnectService(createHqPlayerService());
      const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
      merge.mergeDiscoveredDlnaDevices([dlnaDevice({ address: '127.0.0.1' })], Date.parse('2026-05-21T01:00:00.000Z'));

      await service.connect({
        deviceId: 'dlna:uuid:streamer-1',
        track: trackWithRemoteCover,
        filePath: audioPath,
      });

      const setUriCall = soapCalls.find((call) => call.soapAction?.includes('#SetAVTransportURI'));
      expect(setUriCall?.body).toContain('/connect/cover/');
      expect(setUriCall?.body).not.toContain('covers.example.test');
      await service.dispose();
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('proxies HTTP audio through the local Connect server before handing it to DLNA devices', async () => {
    const remoteAudioUrl = 'https://cdn.example.test/audio/song.flac?token=fresh';
    const trackWithRemoteAudio: LibraryTrack = {
      ...localTrack,
      path: remoteAudioUrl,
      sourceUrl: remoteAudioUrl,
      coverId: null,
    } as LibraryTrack & { sourceUrl: string };
    const soapCalls: Array<{ soapAction: string | null; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      soapCalls.push({
        soapAction: typeof init?.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
          ? String((init.headers as Record<string, string>).SOAPAction ?? '')
          : null,
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return {
        ok: true,
        text: () => Promise.resolve('<s:Envelope><s:Body /></s:Envelope>'),
      };
    }));
    mocks.libraryService.resolveCoverAsset.mockReturnValue(null);
    mocks.audioSession.getStatus.mockReturnValue({
      state: 'playing',
      currentTrackId: trackWithRemoteAudio.id,
      currentFilePath: remoteAudioUrl,
      positionSeconds: 0,
    });
    const { ConnectService } = await import('./ConnectService');
    const service = new ConnectService(createHqPlayerService());
    const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
    merge.mergeDiscoveredDlnaDevices([dlnaDevice({ address: '127.0.0.1' })], Date.parse('2026-05-21T01:00:00.000Z'));

    await service.connect({
      deviceId: 'dlna:uuid:streamer-1',
      track: trackWithRemoteAudio,
      filePath: remoteAudioUrl,
    });

    const setUriCall = soapCalls.find((call) => call.soapAction?.includes('#SetAVTransportURI'));
    expect(setUriCall?.body).toContain('/connect/audio/');
    expect(setUriCall?.body).toContain('song.flac');
    expect(setUriCall?.body).not.toContain('cdn.example.test');
    await service.dispose();
  });

  it('keeps FLAC direct when a renderer advertises application/flac', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-connect-service-'));
    try {
      const audioPath = join(tempRoot, 'song.flac');
      writeFileSync(audioPath, Buffer.from('flac', 'utf8'));
      const soapCalls: Array<{ soapAction: string | null; body: string }> = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        soapCalls.push({
          soapAction: typeof init?.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
            ? String((init.headers as Record<string, string>).SOAPAction ?? '')
            : null,
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return {
          ok: true,
          text: () => Promise.resolve('<s:Envelope><s:Body /></s:Envelope>'),
        };
      }));
      mocks.libraryService.resolveCoverAsset.mockReturnValue(null);
      mocks.audioSession.getStatus.mockReturnValue({
        state: 'playing',
        currentTrackId: localTrack.id,
        currentFilePath: audioPath,
        positionSeconds: 0,
      });
      const { ConnectService } = await import('./ConnectService');
      const service = new ConnectService(createHqPlayerService());
      const merge = service as unknown as { mergeDiscoveredDlnaDevices: (devices: DlnaDevice[], now?: number) => void };
      merge.mergeDiscoveredDlnaDevices([
        dlnaDevice({
          address: '127.0.0.1',
          capabilities: {
            ...dlnaDevice().capabilities,
            supportedMimeTypes: ['application/flac'],
          },
        }),
      ], Date.parse('2026-05-21T01:00:00.000Z'));

      await service.connect({
        deviceId: 'dlna:uuid:streamer-1',
        track: { ...localTrack, path: audioPath },
        filePath: audioPath,
      });

      const setUriCall = soapCalls.find((call) => call.soapAction?.includes('#SetAVTransportURI'));
      expect(setUriCall?.body).toContain('/connect/audio/');
      expect(setUriCall?.body).toContain('application/flac');
      expect(setUriCall?.body).not.toContain('/connect/transcode/');
      await service.dispose();
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('connects HQPlayer through the official control sender after releasing local ECHO playback', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);
    const request: ConnectStartRequest = {
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
      positionSeconds: 7,
    };

    await expect(service.connect(request)).resolves.toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: localTrack.id,
      positionSeconds: 7,
    });

    expect(hqPlayer.setSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
    }));
    expect(hqPlayer.testConnection).toHaveBeenCalledTimes(2);
    expect(hqPlayer.createPlaybackHandoff).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true,
      startSeconds: 7,
      item: expect.objectContaining({
        mediaType: 'local',
        trackId: localTrack.id,
        path: localTrack.path,
      }),
    }));
    expect(hqPlayer.sendLastPlaybackControl).toHaveBeenCalledOnce();
    expect(mocks.audioSession.stop).toHaveBeenCalledOnce();
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop.mock.invocationCallOrder[0]).toBeLessThan(
      hqPlayer.sendLastPlaybackControl.mock.invocationCallOrder[0],
    );
  });

  it('preserves configured remote HQPlayer endpoint when connecting', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService({
      enabled: true,
      connectionMode: 'remote',
      host: '10.0.0.8',
      port: 4322,
      mediaServerEnabled: true,
    });
    const service = new ConnectService(hqPlayer);

    await expect(service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    })).resolves.toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
    });

    expect(hqPlayer.setSettings).not.toHaveBeenCalled();
    expect(hqPlayer.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      connectionMode: 'remote',
      host: '10.0.0.8',
      port: 4322,
      mediaServerEnabled: true,
    }));
    expect(mocks.audioSession.pause).toHaveBeenCalledOnce();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
    expect(mocks.audioSession.pause.mock.invocationCallOrder[0]).toBeLessThan(
      hqPlayer.sendLastPlaybackControl.mock.invocationCallOrder[0],
    );
  });

  it('seeks the active HQPlayer session through HQPlayer control instead of DLNA', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    });

    await expect(service.seek(42.6)).resolves.toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      positionSeconds: 42.6,
    });
    expect(hqPlayer.seekPlayback).toHaveBeenCalledWith(42.6);
  });

  it('stops HQPlayer playback before disconnecting the active HQPlayer session', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    });

    await expect(service.disconnect()).resolves.toMatchObject({
      deviceId: null,
      protocol: null,
      state: 'idle',
    });
    expect(hqPlayer.stopPlayback).toHaveBeenCalledOnce();
  });

  it('routes stop to HQPlayer control when HQPlayer is the active output', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    });

    await expect(service.stop()).resolves.toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'stopped',
      positionSeconds: 0,
    });
    expect(hqPlayer.stopPlayback).toHaveBeenCalledOnce();
  });

  it('keeps a natural HQPlayer track end actionable when the stopped status resets position', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:00.000Z'));
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
      positionSeconds: 7,
    });

    vi.setSystemTime(new Date('2026-05-21T01:02:55.000Z'));
    const stopped = hqConnectionOk().playbackStatus!;
    hqPlayer.testConnection.mockResolvedValue({
      ...hqConnectionOk(),
      playbackStatus: {
        ...stopped,
        state: 'stopped',
        stateCode: 0,
        positionSeconds: 0,
        durationSeconds: 0,
      },
    });

    await (service as unknown as { syncHqPlayerSessionStatus: () => Promise<void> }).syncHqPlayerSessionStatus();

    expect(service.getStatus()).toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'stopped',
      currentTrackId: localTrack.id,
      positionSeconds: localTrack.duration,
      durationSeconds: localTrack.duration,
    });
    await service.dispose();
  });

  it('does not let zero HQPlayer playing positions reset the local session clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:00.000Z'));
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
      positionSeconds: 7,
    });

    vi.setSystemTime(new Date('2026-05-21T01:00:30.000Z'));
    hqPlayer.testConnection.mockResolvedValue({
      ...hqConnectionOk(),
      playbackStatus: {
        ...hqConnectionOk().playbackStatus!,
        state: 'playing',
        stateCode: 2,
        positionSeconds: 0,
        durationSeconds: localTrack.duration,
      },
    });

    await (service as unknown as { syncHqPlayerSessionStatus: () => Promise<void> }).syncHqPlayerSessionStatus();

    expect(service.getStatus()).toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: localTrack.id,
      positionSeconds: 37,
      durationSeconds: localTrack.duration,
    });
    await service.dispose();
  });

  it('marks HQPlayer ended from the local session clock when Status is temporarily unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T01:00:00.000Z'));
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    const service = new ConnectService(hqPlayer);

    await service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
      positionSeconds: 7,
    });

    vi.setSystemTime(new Date('2026-05-21T01:03:10.000Z'));
    hqPlayer.testConnection.mockResolvedValue(hqConnectionWithoutPlayback);

    await (service as unknown as { syncHqPlayerSessionStatus: () => Promise<void> }).syncHqPlayerSessionStatus();

    expect(service.getStatus()).toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'stopped',
      currentTrackId: localTrack.id,
      positionSeconds: localTrack.duration,
      durationSeconds: localTrack.duration,
    });
    await service.dispose();
  });

  it('keeps HQPlayer connection failures visible on the Connect session', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    hqPlayer.testConnection.mockResolvedValueOnce(hqConnectionRefused);
    const service = new ConnectService(hqPlayer);

    await expect(service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    })).rejects.toThrow('hqplayer_connection_refused');

    expect(service.getStatus()).toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'error',
      error: 'hqplayer_connection_refused',
    });
    expect(hqPlayer.sendLastPlaybackControl).not.toHaveBeenCalled();
    expect(mocks.audioSession.stop).not.toHaveBeenCalled();
  });

  it('does not mark HQPlayer as playing until Status confirms playback', async () => {
    const { ConnectService } = await import('./ConnectService');
    const hqPlayer = createHqPlayerService();
    hqPlayer.testConnection.mockResolvedValue(hqConnectionWithoutPlayback);
    const service = new ConnectService(hqPlayer);

    await expect(service.connect({
      deviceId: hqPlayerConnectDeviceId,
      track: localTrack,
      filePath: localTrack.path,
    })).rejects.toThrow(/未确认播放/u);

    expect(hqPlayer.sendLastPlaybackControl).toHaveBeenCalledOnce();
    expect(mocks.audioSession.stop).toHaveBeenCalledOnce();
    expect(service.getStatus()).toMatchObject({
      deviceId: hqPlayerConnectDeviceId,
      protocol: 'hqplayer',
      state: 'error',
      error: expect.stringMatching(/未确认播放/u),
    });
    expect(mocks.audioSession.pause).not.toHaveBeenCalled();
  });
});
