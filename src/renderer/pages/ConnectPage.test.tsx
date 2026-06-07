// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../shared/types/appSettings';
import { hqPlayerConnectDeviceId, type ConnectDevice, type ConnectSessionStatus } from '../../shared/types/connect';
import type {
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendState,
  HqPlayerPlaybackHandoffPlan,
  HqPlayerSettings,
  HqPlayerStatus,
} from '../../shared/types/hqplayer';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectPage } from './ConnectPage';

const queueMock = {
  currentTrack: {
    mediaType: 'local',
    id: 'track-1',
    path: 'D:\\Music\\song.flac',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
  },
  lastPlayedTrack: null,
};

const playbackStatusMock = {
  audioStatus: {
    currentFilePath: 'D:\\Music\\song.flac',
    positionSeconds: 12,
  },
  playbackStatus: null,
};

vi.mock('../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueMock,
}));

vi.mock('../stores/playbackStatusStore', () => ({
  useSharedPlaybackStatus: () => playbackStatusMock,
}));

const hqSettings: HqPlayerSettings = {
  enabled: true,
  connectionMode: 'localDesktop',
  host: '127.0.0.1',
  port: 4321,
  executablePath: null,
  allowLaunch: false,
  mediaServerEnabled: true,
  mediaServerPort: null,
  defaultPlaybackBackend: 'hqplayer',
  profileName: null,
};

const hqStatus = (state: HqPlayerStatus['state']): HqPlayerStatus => ({
  enabled: true,
  state,
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: 4321,
  },
  mediaServerEnabled: true,
  defaultPlaybackBackend: 'hqplayer',
  profileName: null,
  lastCheckedAt: '2026-05-21T01:00:00.000Z',
  lastError: null,
});

const hqControl = (sendState: HqPlayerPlaybackControlSendState = 'prepared'): HqPlayerPlaybackControlPlan => ({
  state: 'prepared',
  reason: null,
  action: 'play-source',
  transport: 'dry-run',
  endpoint: {
    connectionMode: 'localDesktop',
    host: '127.0.0.1',
    port: 4321,
  },
  profileName: null,
  source: {
    trackId: 'track-1',
    mediaType: 'local',
    url: 'D:\\Music\\song.flac',
    exposure: 'local-file',
    mimeType: 'audio/flac',
    expiresAt: null,
    hasHeaders: false,
  },
  metadata: {
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    durationSeconds: 180,
  },
  startSeconds: 12,
  createdAt: '2026-05-21T01:00:00.000Z',
  send: {
    state: sendState,
    reason: null,
    transport: 'official-control-tcp',
    command: 'PlayNextURI+Play+Seek',
    endpoint: {
      connectionMode: 'localDesktop',
      host: '127.0.0.1',
      port: 4321,
    },
    startedAt: '2026-05-21T01:00:00.000Z',
    finishedAt: sendState === 'sent' ? '2026-05-21T01:00:00.012Z' : '2026-05-21T01:00:00.000Z',
    elapsedMs: sendState === 'sent' ? 12 : 0,
    message: null,
    response: sendState === 'sent' ? '<PlayNextURI result="OK"/>\n<Play result="OK"/>\n<Seek result="OK"/>' : null,
  },
});

const hqHandoff = (control = hqControl()): HqPlayerPlaybackHandoffPlan => ({
  state: 'ready',
  reason: null,
  endpoint: control.endpoint,
  defaultPlaybackBackend: 'hqplayer',
  profileName: null,
  source: {
    trackId: 'track-1',
    mediaType: 'local',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    url: 'D:\\Music\\song.flac',
    exposure: 'local-file',
    headers: {},
    mimeType: 'audio/flac',
    expiresAt: null,
    durationSeconds: 180,
    startSeconds: 12,
    mediaServer: null,
    streaming: null,
  },
  fallback: null,
  control,
  createdAt: '2026-05-21T01:00:00.000Z',
});

const connectStatus: ConnectSessionStatus = {
  deviceId: null,
  protocol: null,
  state: 'idle',
  currentTrackId: null,
  metadata: null,
  positionSeconds: 0,
  durationSeconds: 0,
  latencyMs: null,
  error: null,
  updatedAt: '2026-05-21T01:00:00.000Z',
};

const hqPlayerDevice: ConnectDevice = {
  id: hqPlayerConnectDeviceId,
  name: 'HQPlayer Desktop',
  protocol: 'hqplayer',
  model: 'Local Desktop Control',
  manufacturer: 'Signalyst',
  address: '127.0.0.1:4321',
  capabilities: {
    canPlay: false,
    canPause: false,
    canStop: false,
    canSeek: false,
    canSetVolume: false,
    supportsMetadata: true,
    supportsSetNext: false,
    supportedMimeTypes: [],
    requiresTranscode: false,
  },
  state: 'available',
  lastSeenAt: null,
  unsupportedReason: null,
};

const hqPlayerConnectStatus: ConnectSessionStatus = {
  deviceId: hqPlayerConnectDeviceId,
  protocol: 'hqplayer',
  state: 'playing',
  currentTrackId: 'track-1',
  metadata: {
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtist: null,
    durationSeconds: 180,
    coverHttpUrl: '',
  },
  positionSeconds: 12,
  durationSeconds: 180,
  latencyMs: 12,
  error: null,
  updatedAt: '2026-05-21T01:00:00.000Z',
};

const renderConnectPage = () =>
  render(
    <I18nProvider>
      <ConnectPage />
    </I18nProvider>,
  );

const dlnaDevice: ConnectDevice = {
  id: 'dlna:uuid-streamer-1',
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
  discovery: {
    deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1',
    descriptionUrl: 'http://192.168.1.42:49152/description.xml',
    presentationUrl: null,
    modelName: 'N130',
    modelNumber: 'v2',
    modelDescription: 'Network Transport',
    serialNumber: 'SA-001',
    udn: 'uuid-streamer-1',
  },
};

const dlnaConnectStatus: ConnectSessionStatus = {
  deviceId: dlnaDevice.id,
  protocol: 'dlna',
  state: 'playing',
  currentTrackId: 'track-1',
  metadata: {
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtist: null,
    durationSeconds: 180,
    coverHttpUrl: 'http://192.168.1.20:45000/connect/cover/token',
  },
  positionSeconds: 12,
  durationSeconds: 180,
  latencyMs: 86,
  error: null,
  updatedAt: '2026-05-21T01:00:00.000Z',
  httpEvents: [
    {
      id: 'event-cover',
      at: '2026-05-21T01:00:01.000Z',
      remoteAddress: '192.168.1.42',
      method: 'GET',
      path: '/connect/cover/token',
      kind: 'cover',
      statusCode: 200,
      bytes: 1234,
      range: null,
      userAgent: 'Matrix',
      message: 'image/jpeg',
    },
  ],
};

const installEchoBridge = (
  status: HqPlayerStatus,
  settings: HqPlayerSettings = hqSettings,
  initialConnectStatus: ConnectSessionStatus = connectStatus,
  devices: ConnectDevice[] = [hqPlayerDevice],
) => {
  const sentControl = hqControl('sent');
  let appSettings: Partial<AppSettings> = {
    connectAutoStartReceiversEnabled: false,
    airPlayReceiverProtocol: 'airplay1',
  };
  const bridge = {
    app: {
      getSettings: vi.fn(async () => appSettings),
      setSettings: vi.fn(async (patch: Partial<AppSettings>) => {
        appSettings = { ...appSettings, ...patch };
        return appSettings;
      }),
    },
    connect: {
      listDevices: vi.fn().mockResolvedValue(devices),
      refresh: vi.fn().mockResolvedValue(devices),
      getStatus: vi.fn().mockResolvedValue(initialConnectStatus),
      connect: vi.fn().mockResolvedValue(hqPlayerConnectStatus),
      disconnect: vi.fn().mockResolvedValue(connectStatus),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
      getReceiverStatus: vi.fn().mockResolvedValue({
        enabled: false,
        state: 'disabled',
        advertisedName: 'ECHO Next',
        addresses: [],
        currentClient: null,
        currentUri: null,
        metadata: null,
        positionSeconds: 0,
        durationSeconds: 0,
        volume: 100,
        error: null,
        debugEvents: [],
        updatedAt: '2026-05-21T01:00:00.000Z',
      }),
      setReceiverEnabled: vi.fn(),
      stopReceiverPlayback: vi.fn(),
      onReceiverStatus: vi.fn(() => () => undefined),
      getAirPlayReceiverStatus: vi.fn().mockResolvedValue({
        enabled: false,
        state: 'disabled',
        advertisedName: 'ECHO Next (AirPlay)',
        nativeAvailable: false,
        currentSourceId: null,
        currentClient: null,
        metadata: null,
        currentLyricLine: null,
        artworkUrl: null,
        positionSeconds: 0,
        durationSeconds: 0,
        volume: 100,
        error: null,
        debugEvents: [],
        updatedAt: '2026-05-21T01:00:00.000Z',
      }),
      setAirPlayReceiverEnabled: vi.fn(),
      stopAirPlayReceiverPlayback: vi.fn(),
      onAirPlayReceiverStatus: vi.fn(() => () => undefined),
    },
    hqPlayer: {
      getSettings: vi.fn().mockResolvedValue(settings),
      setSettings: vi.fn().mockImplementation(async (patch: HqPlayerSettings) => ({ ...settings, ...patch })),
      getStatus: vi.fn().mockResolvedValue(status),
      testConnection: vi.fn().mockResolvedValue({
        ok: true,
        state: 'available',
        endpoint: {
          connectionMode: 'localDesktop',
          host: '127.0.0.1',
          port: 4321,
        },
        elapsedMs: 12,
        checkedAt: '2026-05-21T01:00:00.000Z',
        error: null,
      }),
      createPlaybackHandoff: vi.fn().mockResolvedValue(hqHandoff()),
      sendLastPlaybackControl: vi.fn().mockResolvedValue(sentControl.send),
      getLastPlaybackHandoff: vi.fn()
        .mockResolvedValueOnce(hqHandoff())
        .mockResolvedValue(hqHandoff(sentControl)),
      getLastPlaybackControl: vi.fn()
        .mockResolvedValueOnce(hqControl())
        .mockResolvedValue(sentControl),
    },
    playback: {
      playLocalFile: vi.fn().mockResolvedValue({
        state: 'playing',
        currentTrackId: 'radio-stream:test',
        positionMs: 0,
        durationMs: 0,
        filePath: 'https://radio.example.test/live.mp3',
      }),
      stop: vi.fn().mockResolvedValue({
        state: 'stopped',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      }),
    },
  };
  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: bridge,
  });
  return bridge;
};

describe('ConnectPage HQPlayer controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('echo-next.locale', 'zh-CN');
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'echo');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shows HQPlayer as a Connect output device and routes connection through Connect', async () => {
    const bridge = installEchoBridge(hqStatus('available'));
    renderConnectPage();

    await screen.findByText('HQPlayer Desktop');
    const row = screen.getByText('HQPlayer Desktop').closest('article');
    expect(row).toBeTruthy();
    const connectButton = row?.querySelector('button');
    expect(connectButton).toBeTruthy();

    fireEvent.click(connectButton as HTMLButtonElement);

    await waitFor(() => expect(bridge.connect.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: hqPlayerConnectDeviceId,
        track: expect.objectContaining({ id: 'track-1' }),
        filePath: 'D:\\Music\\song.flac',
        positionSeconds: 12,
      }),
    ));
    expect(bridge.hqPlayer.sendLastPlaybackControl).not.toHaveBeenCalled();
  });

  it('copies AirPlay debug events from the receiver panel', async () => {
    const bridge = installEchoBridge(hqStatus('available'));
    bridge.connect.getAirPlayReceiverStatus.mockResolvedValue({
      enabled: true,
      state: 'ready',
      advertisedName: 'ECHO Next (AirPlay)',
      nativeAvailable: true,
      currentSourceId: null,
      currentClient: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
      volume: 100,
      error: null,
      debugEvents: [{
        id: 'airplay-debug-1',
        at: '2026-05-21T01:00:01.000Z',
        remoteAddress: '192.168.1.10:53124',
        method: 'ENC',
        path: '/airplay2',
        action: 'probe-error',
        statusCode: 400,
        message: 'control frame decrypt failed cipher=chacha20-poly1305',
      }],
      updatedAt: '2026-05-21T01:00:01.000Z',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderConnectPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Copy AirPlay Debug' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('control frame decrypt failed')));
    expect(writeText.mock.calls[0]?.[0]).toContain('192.168.1.10:53124 ENC /airplay2 #probe-error 400');
  });

  it('saves the AirPlay protocol setting and restarts the active receiver', async () => {
    const bridge = installEchoBridge(hqStatus('available'));
    const enabledAirPlayStatus = {
      enabled: true,
      state: 'idle',
      protocol: 'airplay1',
      advertisedName: 'ECHO Next (AirPlay)',
      nativeAvailable: true,
      currentSourceId: null,
      currentClient: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
      volume: 100,
      error: null,
      debugEvents: [],
      updatedAt: '2026-05-21T01:00:00.000Z',
    } as const;
    bridge.connect.getAirPlayReceiverStatus.mockResolvedValue(enabledAirPlayStatus);
    bridge.connect.setAirPlayReceiverEnabled
      .mockResolvedValueOnce({ ...enabledAirPlayStatus, enabled: false, state: 'disabled' })
      .mockResolvedValueOnce({ ...enabledAirPlayStatus, protocol: 'airplay2' });

    renderConnectPage();

    fireEvent.click(await screen.findByRole('button', { name: 'AirPlay 2 实验' }));

    await waitFor(() => expect(bridge.app.setSettings).toHaveBeenCalledWith({ airPlayReceiverProtocol: 'airplay2' }));
    expect(bridge.connect.setAirPlayReceiverEnabled).toHaveBeenNthCalledWith(1, false);
    expect(bridge.connect.setAirPlayReceiverEnabled).toHaveBeenNthCalledWith(2, true);
  });

  it('saves and plays a manual internet radio stream from Connect', async () => {
    const bridge = installEchoBridge(hqStatus('available'));
    renderConnectPage();

    const form = await screen.findByLabelText('网络电台表单');
    fireEvent.change(within(form).getByPlaceholderText('例如 Groove Salad'), {
      target: { value: 'Test FM' },
    });
    fireEvent.change(within(form).getByPlaceholderText('https://example.com/live.mp3'), {
      target: { value: 'https://radio.example.test/live.mp3' },
    });

    fireEvent.click(within(form).getByRole('button', { name: '收藏' }));

    const storedStations = JSON.parse(window.localStorage.getItem('echo.connect.radioStations.v2') ?? '[]');
    expect(storedStations[0]).toEqual(expect.objectContaining({
      name: 'Test FM',
      url: 'https://radio.example.test/live.mp3',
    }));

    fireEvent.submit(form);

    await waitFor(() => expect(bridge.connect.disconnect).toHaveBeenCalled());
    await waitFor(() => expect(bridge.playback.playLocalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'https://radio.example.test/live.mp3',
        trackId: expect.stringMatching(/^radio-stream:/u),
        metadata: expect.objectContaining({
          title: 'Test FM',
          artist: 'Internet Radio',
        }),
        probe: expect.objectContaining({
          durationSeconds: 0,
          channels: 2,
        }),
      }),
    ));
  });

  it('seeds default internet radio stations and keeps deletions local', async () => {
    installEchoBridge(hqStatus('available'));
    const { unmount } = renderConnectPage();

    await screen.findByText('Gensokyo Radio 东方');
    expect(screen.getByText('东方 Project 同人音乐电台，适合长时间后台播放。')).toBeTruthy();
    expect(screen.getByText('ANISONG')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除 Zeno' }));
    expect(screen.queryByText('Zeno')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('echo.connect.radioStations.v2') ?? '[]')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Zeno' })]),
    );

    unmount();
    renderConnectPage();

    expect(screen.queryByText('Zeno')).toBeNull();
    await screen.findByText('Gensokyo Radio 东方');
  });

  it('shows DLNA streamer model, address, and metadata support directly in the device list', async () => {
    installEchoBridge(hqStatus('available'), hqSettings, connectStatus, [dlnaDevice, hqPlayerDevice]);
    renderConnectPage();

    await screen.findByText('Living Room Streamer');
    expect(screen.getByText('DLNA / UPnP · Silent Angel · N130 · v2')).toBeTruthy();
    expect(screen.getByText('局域网 192.168.1.42')).toBeTruthy();
    expect(screen.getByText('可定位 · 可调音量 · 封面/元数据 · 可直连 · FLAC / WAV / MP3')).toBeTruthy();
    expect(screen.getByText('1 台数播 · 2 个入口 · 已隐藏 0')).toBeTruthy();
  });

  it('hides a noisy LAN device from the list and restores it locally', async () => {
    installEchoBridge(hqStatus('available'), hqSettings, connectStatus, [dlnaDevice, hqPlayerDevice]);
    renderConnectPage();

    await screen.findByText('Living Room Streamer');
    const row = screen.getByText('Living Room Streamer').closest('article');
    expect(row).toBeTruthy();

    fireEvent.contextMenu(row as HTMLElement);

    await waitFor(() => expect(screen.queryByText('DLNA / UPnP · Silent Angel · N130 · v2')).toBeNull());
    expect(screen.getByText('已隐藏设备')).toBeTruthy();
    expect(screen.getAllByText((_, node) => node?.textContent?.trim() === '0 台数播 · 1 个入口 · 已隐藏 1').length).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem('echo.connect.hiddenDevices.v1') ?? '[]')).toContain(dlnaDevice.id);

    fireEvent.click(screen.getByRole('button', { name: 'Living Room Streamer' }));

    await screen.findByText('Living Room Streamer');
    expect(screen.queryByText('已隐藏设备')).toBeNull();
  });

  it('remembers the LAN streamer section collapsed state', async () => {
    installEchoBridge(hqStatus('available'));
    const { unmount } = renderConnectPage();

    await screen.findByText('HQPlayer Desktop');
    fireEvent.click(screen.getByRole('button', { name: '折叠局域网数播' }));

    await waitFor(() => expect(screen.queryByText('HQPlayer Desktop')).toBeNull());
    expect(window.localStorage.getItem('echo.connect.deviceSectionCollapsed.v1')).toBe('true');

    unmount();
    renderConnectPage();

    expect(screen.queryByText('HQPlayer Desktop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开局域网数播' }));
    await screen.findByText('HQPlayer Desktop');
  });

  it('shows wildcard DLNA format support without hiding the device capability', async () => {
    installEchoBridge(hqStatus('available'), hqSettings, connectStatus, [{
      ...dlnaDevice,
      id: 'dlna:uuid-streamer-2',
      name: 'Universal Streamer',
      capabilities: {
        ...dlnaDevice.capabilities,
        supportedMimeTypes: ['*/*'],
      },
    }]);
    renderConnectPage();

    await screen.findByText('Universal Streamer');
    expect(screen.getByText('可定位 · 可调音量 · 封面/元数据 · 可直连 · 全格式接收')).toBeTruthy();
  });

  it('shows the active DLNA streamer and cover handoff in the now-playing panel', async () => {
    installEchoBridge(hqStatus('available'), hqSettings, dlnaConnectStatus, [dlnaDevice, hqPlayerDevice]);
    renderConnectPage();

    await screen.findByText('Living Room Streamer');
    expect(screen.getByText('DLNA / UPnP · Living Room Streamer')).toBeTruthy();
    expect(screen.getByText('Silent Angel · N130 · v2 · 局域网 192.168.1.42')).toBeTruthy();
    expect(screen.getByText('封面 URL 已发送 · 投送握手 86ms · 状态轮询约 3s')).toBeTruthy();
    expect(screen.getByText(/GET cover 200 1234B/u)).toBeTruthy();
  });

  it('connects local HQPlayer with the default desktop endpoint instead of requiring a typed port', async () => {
    const bridge = installEchoBridge(hqStatus('unavailable'), {
      ...hqSettings,
      enabled: false,
      port: null,
      defaultPlaybackBackend: 'echoNative',
    });
    renderConnectPage();

    fireEvent.click(await screen.findByRole('button', { name: /检测 HQPlayer/u }));

    await waitFor(() => expect(bridge.hqPlayer.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        connectionMode: 'localDesktop',
        host: '127.0.0.1',
        port: 4321,
        defaultPlaybackBackend: 'echoNative',
      }),
    ));
    expect(bridge.hqPlayer.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 4321,
      }),
    );
  });

  it('keeps the HQPlayer details collapsed while disabled and expands after enabling', async () => {
    const bridge = installEchoBridge(hqStatus('disabled'), {
      ...hqSettings,
      enabled: false,
    });
    const { container } = renderConnectPage();

    await screen.findByText('HQPlayer Desktop');
    await waitFor(() => expect(container.querySelector('.connect-hqplayer-collapsed')).toBeTruthy());
    expect(container.querySelector('.connect-hqplayer-layout')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '启用 HQPlayer' }));

    await waitFor(() => expect(bridge.hqPlayer.setSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })));
    await waitFor(() => expect(container.querySelector('.connect-hqplayer-layout')).toBeTruthy());
    expect(container.querySelector('.connect-hqplayer-collapsed')).toBeNull();
  });

  it('shows read-only HQPlayer probe details in the diagnostics area', async () => {
    installEchoBridge({
      ...hqStatus('available'),
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
    renderConnectPage();

    await screen.findByText('HQPlayer Desktop 5.17.2');
    expect(screen.getByText('5.29.2')).toBeTruthy();
    expect(screen.getByText(/播放中/u)).toBeTruthy();
    expect(screen.getByText(/2822400Hz/u)).toBeTruthy();
  });

  it('keeps enabled local HQPlayer passive until the user manually tests it', async () => {
    const bridge = installEchoBridge(hqStatus('unavailable'), hqSettings);
    renderConnectPage();

    await screen.findByText('HQPlayer Desktop');
    await waitFor(() => expect(bridge.hqPlayer.getStatus).toHaveBeenCalled());
    expect(bridge.hqPlayer.testConnection).not.toHaveBeenCalled();
  });

  it('stops the active HQPlayer session when HQPlayer is disabled', async () => {
    const bridge = installEchoBridge(hqStatus('available'), hqSettings, hqPlayerConnectStatus);
    renderConnectPage();

    await screen.findByText('HQPlayer Desktop');
    const hqPlayerToggle = screen
      .getAllByRole('button', { name: /HQPlayer/u })
      .find((button) => button.className.includes('toggle-btn'));
    expect(hqPlayerToggle).toBeTruthy();

    fireEvent.click(hqPlayerToggle as HTMLButtonElement);

    await waitFor(() => expect(bridge.connect.disconnect).toHaveBeenCalled());
    await waitFor(() => expect(bridge.hqPlayer.setSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  });

  it('disables unsupported transport controls while HQPlayer is the active output', async () => {
    installEchoBridge(hqStatus('available'), hqSettings, hqPlayerConnectStatus);
    renderConnectPage();

    await screen.findByText('HQPlayer Desktop');

    const controls = screen.getByLabelText('Connect 控制');
    expect((within(controls).getByRole('button', { name: '播放' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(controls).getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(controls).getByRole('button', { name: '停止' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(controls).getByRole('button', { name: '断开' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
