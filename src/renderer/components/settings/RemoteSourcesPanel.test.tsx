// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteSourcesPanel } from './RemoteSourcesPanel';
import type {
  RemoteBackgroundGlobalStatus,
  RemoteBackgroundJobKind,
  RemoteBackgroundJobStatus,
  RemoteDirectoryItem,
  RemoteSource,
  RemoteSourceOverview,
  RemoteSyncStatus,
  RemoteTrackLookupItem,
} from '../../../shared/types/remoteSources';

const remoteApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  getOverview: vi.fn(),
  previewAlbumGrouping: vi.fn(),
  listIssues: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
  delete: vi.fn(),
  test: vi.fn(),
  browse: vi.fn(),
  sync: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  createStreamUrl: vi.fn(),
  lookupTracks: vi.fn(),
  startBackgroundJobs: vi.fn(),
  pauseBackgroundJobs: vi.fn(),
  resumeBackgroundJobs: vi.fn(),
  getJobStatus: vi.fn(),
  retryFailedJobs: vi.fn(),
  setBackgroundPaused: vi.fn(),
  getBackgroundGlobalStatus: vi.fn(),
  updateRuntimeLimits: vi.fn(),
  createBaiduAuthUrl: vi.fn(),
  exchangeBaiduAuthCode: vi.fn(),
  startBaiduOAuthLogin: vi.fn(),
}));

const appApiMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  openExternalUrl: vi.fn(),
}));

const playbackQueueMocks = vi.hoisted(() => ({
  appendToQueue: vi.fn(),
  playTrack: vi.fn(),
}));

vi.mock('../../utils/echoBridge', () => ({
  getAppBridge: () => appApiMocks,
  getRemoteSourcesBridge: () => remoteApiMocks,
}));

vi.mock('../../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => playbackQueueMocks,
}));

const jobKinds: RemoteBackgroundJobKind[] = ['metadata', 'cover', 'lyrics', 'mv', 'duration-backfill'];

const remoteSource = (overrides: Partial<RemoteSource> = {}): RemoteSource => ({
  id: 'source-1',
  provider: 'webdav',
  displayName: 'Mock AList',
  status: 'enabled',
  baseUrl: 'http://127.0.0.1:18080/dav',
  username: 'user',
  authType: 'basic',
  config: { rootPath: '/音乐 Space/', scanConcurrency: 2, metadataConcurrency: 1, coverConcurrency: 3 },
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const syncStatus = (sourceId = 'source-1'): RemoteSyncStatus => ({
  sourceId,
  status: 'idle',
  phase: 'idle',
  discoveredCount: 0,
  parsedCount: 0,
  writtenCount: 0,
  skippedCount: 0,
  missingCount: 0,
  failedCount: 0,
  currentPath: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
});

const jobStatus = (sourceId = 'source-1'): RemoteBackgroundJobStatus => {
  const empty = Object.fromEntries(jobKinds.map((kind) => [kind, 0])) as Record<RemoteBackgroundJobKind, number>;
  return {
    sourceId,
    paused: false,
    concurrency: { metadata: 2, cover: 2, lyrics: 1, mv: 1, 'duration-backfill': 1 },
    pending: empty,
    running: empty,
    completed: empty,
    failed: empty,
    skipped: empty,
    current: [],
    lastError: null,
    updatedAt: null,
  };
};

type GlobalStatusOverrides = Partial<Omit<RemoteBackgroundGlobalStatus, 'concurrency'>> & {
  concurrency?: Partial<Record<RemoteBackgroundJobKind, number>>;
};

const defaultGlobalConcurrency: Record<RemoteBackgroundJobKind, number> = { metadata: 2, cover: 2, lyrics: 1, mv: 1, 'duration-backfill': 1 };

const globalStatus = (overrides: GlobalStatusOverrides = {}): RemoteBackgroundGlobalStatus => ({
  paused: overrides.paused ?? false,
  playbackActive: overrides.playbackActive ?? false,
  concurrency: { ...defaultGlobalConcurrency, ...(overrides.concurrency ?? {}) },
  updatedAt: overrides.updatedAt ?? null,
});

const directoryItem = (overrides: Partial<RemoteDirectoryItem> = {}): RemoteDirectoryItem => ({
  sourceId: 'source-1',
  provider: 'webdav',
  path: '/音乐 Space/Echo Song.mp3',
  name: 'Echo Song.mp3',
  kind: 'file',
  sizeBytes: 16,
  modifiedAt: null,
  etag: null,
  contentType: 'audio/mpeg',
  audio: true,
  ...overrides,
});

const lookupTrack = (overrides: Partial<RemoteTrackLookupItem> = {}): RemoteTrackLookupItem => ({
  trackId: 'remote-track-1',
  sourceId: 'source-1',
  remotePath: '/音乐 Space/Echo Song.mp3',
  title: 'Indexed Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  duration: 123,
  codec: 'mp3',
  coverThumb: null,
  metadataStatus: 'ok',
  coverStatus: 'pending',
  lyricsStatus: 'not_found',
  mvStatus: 'pending',
  availability: 'available',
  ...overrides,
});

const emptyStatusCounts = () => ({ pending: 0, searching: 0, partial: 0, ok: 0, not_found: 0, error: 0 });

const overviewFor = (items: RemoteSource[]): RemoteSourceOverview => {
  const overviewItems = items.map((source) => ({
    sourceId: source.id,
    provider: source.provider,
    displayName: source.displayName,
    status: source.status,
    syncMode: source.syncMode,
    trackCount: source.indexedTrackCount,
    albumCount: source.indexedTrackCount > 0 ? 1 : 0,
    artistCount: source.indexedTrackCount > 0 ? 1 : 0,
    totalSizeBytes: source.indexedTrackCount * 1024,
    missingTrackCount: 0,
    metadata: { ...emptyStatusCounts(), ok: source.indexedTrackCount },
    cover: { ...emptyStatusCounts(), ok: source.indexedTrackCount },
    lyrics: { ...emptyStatusCounts(), ok: source.indexedTrackCount },
    mv: emptyStatusCounts(),
    lastSyncAt: source.lastSyncAt,
    lastError: source.lastError,
  }));

  return {
    totalSources: overviewItems.length,
    enabledSources: overviewItems.filter((source) => source.status === 'enabled').length,
    disabledSources: overviewItems.filter((source) => source.status === 'disabled').length,
    errorSources: overviewItems.filter((source) => source.status === 'error').length,
    trackCount: overviewItems.reduce((total, source) => total + source.trackCount, 0),
    albumCount: overviewItems.reduce((total, source) => total + source.albumCount, 0),
    artistCount: overviewItems.reduce((total, source) => total + source.artistCount, 0),
    totalSizeBytes: overviewItems.reduce((total, source) => total + source.totalSizeBytes, 0),
    missingTrackCount: overviewItems.reduce((total, source) => total + source.missingTrackCount, 0),
    metadata: { ...emptyStatusCounts(), ok: overviewItems.reduce((total, source) => total + source.metadata.ok, 0) },
    cover: { ...emptyStatusCounts(), ok: overviewItems.reduce((total, source) => total + source.cover.ok, 0) },
    lyrics: { ...emptyStatusCounts(), ok: overviewItems.reduce((total, source) => total + source.lyrics.ok, 0) },
    mv: emptyStatusCounts(),
    sources: overviewItems,
  };
};

describe('RemoteSourcesPanel', () => {
  let sources: RemoteSource[] = [];

  beforeEach(() => {
    sources = [];
    remoteApiMocks.startBaiduOAuthLogin = vi.fn();
    for (const mock of Object.values(remoteApiMocks)) {
      mock?.mockReset();
    }
    for (const mock of Object.values(playbackQueueMocks)) {
      mock.mockReset();
    }
    for (const mock of Object.values(appApiMocks)) {
      mock.mockReset();
    }
    remoteApiMocks.list.mockImplementation(() => Promise.resolve(sources));
    remoteApiMocks.getOverview.mockImplementation(() => Promise.resolve(overviewFor(sources)));
    remoteApiMocks.previewAlbumGrouping.mockResolvedValue({
      sourceId: null,
      sourceCount: 1,
      trackCount: 18,
      currentStrategy: 'conservative',
      targetStrategy: 'standard',
      currentAlbumCount: 3,
      targetAlbumCount: 2,
    });
    remoteApiMocks.listIssues.mockResolvedValue([]);
    remoteApiMocks.create.mockImplementation(async (input) => {
      const source = remoteSource({
        id: 'created-source',
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        username: input.username,
        authType: input.authType,
        config: input.config,
        syncMode: input.syncMode,
      });
      sources = [source];
      return source;
    });
    remoteApiMocks.update.mockImplementation(async (input) => {
      sources = sources.map((source) => (source.id === input.id ? { ...source, ...input } : source));
      return sources.find((source) => source.id === input.id) ?? remoteSource(input);
    });
    remoteApiMocks.disconnect.mockImplementation(async (sourceId) => {
      sources = sources.map((source) => (
        source.id === sourceId
          ? { ...source, status: 'disabled', indexedTrackCount: 0, lastError: null }
          : source
      ));
    });
    remoteApiMocks.delete.mockImplementation(async (sourceId) => {
      sources = sources.filter((source) => source.id !== sourceId);
    });
    remoteApiMocks.test.mockResolvedValue({
      ok: true,
      status: 'enabled',
      message: '连接成功。',
      testedAt: '2026-01-01T00:00:00.000Z',
    });
    remoteApiMocks.browse.mockResolvedValue([directoryItem()]);
    remoteApiMocks.sync.mockResolvedValue(syncStatus('created-source'));
    remoteApiMocks.cancelSync.mockResolvedValue(syncStatus());
    remoteApiMocks.getSyncStatus.mockImplementation((sourceId) => Promise.resolve(syncStatus(sourceId)));
    remoteApiMocks.lookupTracks.mockResolvedValue([]);
    remoteApiMocks.getJobStatus.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.startBackgroundJobs.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.pauseBackgroundJobs.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.resumeBackgroundJobs.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.retryFailedJobs.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.updateRuntimeLimits.mockImplementation((sourceId) => Promise.resolve(jobStatus(sourceId)));
    remoteApiMocks.setBackgroundPaused.mockResolvedValue(globalStatus());
    remoteApiMocks.getBackgroundGlobalStatus.mockResolvedValue(globalStatus());
    remoteApiMocks.createBaiduAuthUrl.mockResolvedValue('https://openapi.baidu.com/oauth/2.0/authorize?response_type=code');
    remoteApiMocks.exchangeBaiduAuthCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 2592000,
      expiresAt: '2026-06-27T00:00:00.000Z',
      scope: 'basic netdisk',
      tokenSecret: '{"type":"baidu-oauth-token","accessToken":"access-token","refreshToken":"refresh-token"}',
    });
    remoteApiMocks.startBaiduOAuthLogin.mockResolvedValue({
      accessToken: 'login-access-token',
      refreshToken: 'login-refresh-token',
      expiresIn: 2592000,
      expiresAt: '2026-06-27T00:00:00.000Z',
      scope: 'basic netdisk',
      tokenSecret: '{"type":"baidu-oauth-token","accessToken":"login-access-token","refreshToken":"login-refresh-token"}',
    });
    appApiMocks.getSettings.mockResolvedValue({ remoteCoverLoadPerformanceMode: 'balanced' });
    appApiMocks.setSettings.mockImplementation(async (patch) => patch);
    appApiMocks.openExternalUrl.mockResolvedValue(undefined);
    playbackQueueMocks.playTrack.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('tests and saves a WebDAV source with the configured root path', async () => {
    const { container } = render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Mock AList' } });
    fireEvent.change(inputs[1], { target: { value: 'http://127.0.0.1:18080/dav' } });
    fireEvent.change(inputs[2], { target: { value: 'user' } });
    fireEvent.change(inputs[3], { target: { value: 'secret' } });
    fireEvent.change(inputs[4], { target: { value: '/音乐 Space/' } });

    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));
    await waitFor(() => expect(screen.getAllByText(/连接成功/u).length).toBeGreaterThan(0));
    expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'webdav',
      displayName: 'Mock AList',
      baseUrl: 'http://127.0.0.1:18080/dav',
      username: 'user',
      secret: 'secret',
      config: expect.objectContaining({ rootPath: '/音乐 Space/', coverConcurrency: 2 }),
    }));

    fireEvent.click(screen.getByRole('button', { name: /保存并同步/u }));
    await waitFor(() => expect(remoteApiMocks.create).toHaveBeenCalled());
    expect(remoteApiMocks.sync).toHaveBeenCalledWith('created-source');
  });

  it('submits unauthenticated WebDAV when credentials are blank', async () => {
    const { container } = render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Open WebDAV' } });
    fireEvent.change(inputs[1], { target: { value: 'http://127.0.0.1:18080/dav' } });

    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));
    await waitFor(() => expect(remoteApiMocks.test).toHaveBeenCalled());

    expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'webdav',
      displayName: 'Open WebDAV',
      baseUrl: 'http://127.0.0.1:18080/dav',
      username: null,
      secret: null,
      authType: 'none',
    }));
  });

  it('opens Baidu OAuth and stores the exchanged token secret for testing', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.change(screen.getByLabelText('百度 App Key'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('百度 Secret Key'), { target: { value: 'client-secret' } });
    fireEvent.change(screen.getByLabelText('Redirect URI'), { target: { value: 'oob' } });
    fireEvent.change(screen.getByLabelText('授权码'), { target: { value: 'https://example.test/callback?code=auth-code&state=state-1' } });

    fireEvent.click(screen.getByRole('button', { name: /打开授权页/u }));
    await waitFor(() => expect(remoteApiMocks.createBaiduAuthUrl).toHaveBeenCalledWith({
      clientId: 'client-id',
      redirectUri: 'oob',
      qrcode: true,
      responseType: 'code',
    }));
    expect(await screen.findByText('https://openapi.baidu.com/oauth/2.0/authorize?response_type=code')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /换取 Token/u }));
    await waitFor(() => expect(remoteApiMocks.exchangeBaiduAuthCode).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
      code: 'https://example.test/callback?code=auth-code&state=state-1',
    }));

    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));
    await waitFor(() => expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'baidu',
      baseUrl: null,
      username: null,
      authType: 'token',
      secret: '{"type":"baidu-oauth-token","accessToken":"access-token","refreshToken":"refresh-token"}',
      config: expect.objectContaining({ credentialMode: 'oauth-refresh' }),
    })));
  });

  it('uses the built-in ECHO Baidu app with the oob desktop authorization flow', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /登录账号/u }));

    await waitFor(() => expect(remoteApiMocks.createBaiduAuthUrl).toHaveBeenCalledWith({
      clientId: null,
      redirectUri: 'oob',
      qrcode: true,
      responseType: 'code',
    }));
    expect(await screen.findByText('已打开百度官方授权页。授权成功后会显示授权码，请复制到“授权码”输入框，再点“换取 Token”。')).toBeTruthy();
    expect(screen.getByPlaceholderText('授权完成后把 code 粘贴到这里')).toBeTruthy();
  });

  it('falls back to an auth URL when the running preload has no auto login bridge', async () => {
    (remoteApiMocks as { startBaiduOAuthLogin?: unknown }).startBaiduOAuthLogin = undefined;
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.change(screen.getByLabelText('Redirect URI'), { target: { value: 'http://127.0.0.1:53682/baidu/oauth/callback' } });
    fireEvent.click(screen.getByRole('button', { name: /登录账号/u }));

    await waitFor(() => expect(remoteApiMocks.createBaiduAuthUrl).toHaveBeenCalledWith({
      clientId: null,
      redirectUri: 'http://127.0.0.1:53682/baidu/oauth/callback',
      qrcode: true,
      responseType: 'code',
    }));
    expect(await screen.findByText('当前运行中的 ECHO 需要重启后才能自动回调登录；已先打开授权页，请复制页面里的 code 到“授权码”后换取 Token。')).toBeTruthy();
  });

  it('shows inline Baidu OAuth feedback when manual access token is missing', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.click(screen.getByRole('button', { name: /填入 Access Token/u }));
    await waitFor(() => expect(screen.getAllByText('请先粘贴 access_token 或包含 access_token 的完整地址。').length).toBeGreaterThan(0));
  });

  it('logs into Baidu through the loopback OAuth flow and fills the token secret', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.change(screen.getByLabelText('百度 App Key'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('百度 Secret Key'), { target: { value: 'client-secret' } });
    fireEvent.change(screen.getByLabelText('Redirect URI'), { target: { value: 'http://127.0.0.1:53682/baidu/oauth/callback' } });

    fireEvent.click(screen.getByRole('button', { name: /登录账号/u }));
    await waitFor(() => expect(remoteApiMocks.startBaiduOAuthLogin).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://127.0.0.1:53682/baidu/oauth/callback',
    }));
    expect(await screen.findByText('登录完成，已拿到可自动续期的百度网盘 Token。现在可以测试连接或保存。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));
    await waitFor(() => expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'baidu',
      authType: 'token',
      secret: '{"type":"baidu-oauth-token","accessToken":"login-access-token","refreshToken":"login-refresh-token"}',
      config: expect.objectContaining({
        credentialMode: 'oauth-refresh',
        rootPath: '/',
      }),
    })));
  });

  it('opens Baidu developer help in the system browser', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.click(screen.getByRole('button', { name: /开放平台/u }));

    await waitFor(() => expect(appApiMocks.openExternalUrl).toHaveBeenCalledWith('https://pan.baidu.com/union'));
    expect(await screen.findByText('百度网盘开放平台 已用系统默认浏览器打开。ECHO 已内置专用 AppKey；这里仅用于查看或覆盖开发配置。')).toBeTruthy();
  });

  it('fills Baidu access token from an implicit auth callback', async () => {
    render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /百度网盘/u }));
    fireEvent.click(screen.getByRole('button', { name: /高级设置/u }));
    fireEvent.change(screen.getByLabelText('百度 App Key'), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText('Access Token 回调'), {
      target: { value: 'https://openapi.baidu.com/oauth/2.0/login_success#expires_in=2592000&access_token=implicit-token' },
    });

    fireEvent.click(screen.getByRole('button', { name: /打开 Token 页/u }));
    await waitFor(() => expect(remoteApiMocks.createBaiduAuthUrl).toHaveBeenCalledWith({
      clientId: 'client-id',
      redirectUri: 'oob',
      qrcode: true,
      responseType: 'token',
    }));

    fireEvent.click(screen.getByRole('button', { name: /填入 Access Token/u }));
    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));

    await waitFor(() => expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'baidu',
      authType: 'token',
      secret: 'implicit-token',
      config: expect.objectContaining({ credentialMode: 'access-token' }),
    })));
  });

  it('shows Baidu credential renewal status on source cards', async () => {
    sources = [
      remoteSource({
        provider: 'baidu',
        displayName: 'Baidu OAuth',
        baseUrl: null,
        username: null,
        authType: 'token',
        config: { rootPath: '/Music', credentialMode: 'oauth-refresh' },
      }),
      remoteSource({
        id: 'baidu-token',
        provider: 'baidu',
        displayName: 'Baidu Token',
        baseUrl: null,
        username: null,
        authType: 'token',
        config: { rootPath: '/Music', credentialMode: 'access-token' },
      }),
    ];

    render(<RemoteSourcesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /百度网盘.*2 个/u }));

    await waitFor(() => expect(screen.getAllByText('Baidu OAuth').length).toBeGreaterThan(0));
    expect(screen.getByText('OAuth 自动续期')).toBeTruthy();
    expect(screen.getByText('Access Token 手动续期')).toBeTruthy();
  });

  it('keeps Basic WebDAV auth when username has an empty password', async () => {
    const { container } = render(<RemoteSourcesPanel />);
    await waitFor(() => expect(remoteApiMocks.list).toHaveBeenCalled());

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Empty Password WebDAV' } });
    fireEvent.change(inputs[1], { target: { value: 'http://127.0.0.1:18080/dav' } });
    fireEvent.change(inputs[2], { target: { value: 'user-no-pass' } });
    fireEvent.change(inputs[3], { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /测试连接/u }));
    await waitFor(() => expect(remoteApiMocks.test).toHaveBeenCalled());

    expect(remoteApiMocks.test).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'webdav',
      username: 'user-no-pass',
      secret: '',
      authType: 'basic',
    }));
  });

  it('browses folders from the remote workbench and returns to the root', async () => {
    sources = [remoteSource()];
    remoteApiMocks.browse.mockImplementation(async (_sourceId, path) => {
      if (path === '/音乐 Space/Album') {
        return [
          directoryItem({
            path: '/音乐 Space/Album/Deep Cut.flac',
            name: 'Deep Cut.flac',
            sizeBytes: 32,
            contentType: 'audio/flac',
          }),
        ];
      }
      return [
        directoryItem({
          path: '/音乐 Space/Album',
          name: 'Album',
          kind: 'directory',
          sizeBytes: null,
          contentType: null,
          audio: false,
        }),
        directoryItem({
          path: '/音乐 Space/Root Song.flac',
          name: 'Root Song.flac',
          sizeBytes: 32,
          contentType: 'audio/flac',
        }),
        directoryItem({
          path: '/音乐 Space/cover.jpg',
          name: 'cover.jpg',
          kind: 'file',
          sizeBytes: 4,
          contentType: 'image/jpeg',
          audio: false,
        }),
      ];
    });
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Root Song.flac');
    expect(remoteApiMocks.browse).toHaveBeenCalledWith('source-1', null);

    fireEvent.click(screen.getByRole('button', { name: /^Album$/u }));
    await screen.findByText('Deep Cut.flac');
    expect(remoteApiMocks.browse).toHaveBeenCalledWith('source-1', '/音乐 Space/Album');

    fireEvent.click(screen.getByRole('button', { name: /上级/u }));
    await waitFor(() => expect(remoteApiMocks.browse).toHaveBeenLastCalledWith('source-1', null));
    await screen.findByText('Root Song.flac');
  });

  it('shows browse errors in the file browser', async () => {
    sources = [remoteSource()];
    remoteApiMocks.browse.mockRejectedValueOnce(new Error('network down'));
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findAllByText('network down');
    expect(screen.getByRole('button', { name: /^重试$/u })).toBeTruthy();
    expect(remoteApiMocks.lookupTracks).not.toHaveBeenCalled();
  });

  it('uses indexed remote tracks when browser files are already in the library', async () => {
    sources = [remoteSource()];
    remoteApiMocks.lookupTracks.mockResolvedValue([lookupTrack()]);
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Indexed Echo Song');
    expect(remoteApiMocks.lookupTracks).toHaveBeenCalledWith('source-1', ['/音乐 Space/Echo Song.mp3']);
    expect(screen.getAllByText('已入库').length).toBeGreaterThan(0);
    expect(screen.getByText(/Echo Artist/u)).toBeTruthy();
    expect(screen.getByText(/元数据 完成/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^播放$/u }));
    await waitFor(() => expect(playbackQueueMocks.playTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-track-1',
        mediaType: 'remote',
        remotePath: '/音乐 Space/Echo Song.mp3',
        title: 'Indexed Echo Song',
      }),
      expect.objectContaining({ forceNewQueueItem: true }),
    ));
  });

  it('filters browser items by audio, indexed, and unindexed status', async () => {
    sources = [remoteSource()];
    remoteApiMocks.browse.mockResolvedValue([
      directoryItem({
        path: '/音乐 Space/Album',
        name: 'Album',
        kind: 'directory',
        sizeBytes: null,
        contentType: null,
        audio: false,
      }),
      directoryItem({
        path: '/音乐 Space/Indexed.flac',
        name: 'Indexed.flac',
        contentType: 'audio/flac',
        audio: true,
      }),
      directoryItem({
        path: '/音乐 Space/Loose.mp3',
        name: 'Loose.mp3',
        contentType: 'audio/mpeg',
        audio: true,
      }),
      directoryItem({
        path: '/音乐 Space/readme.txt',
        name: 'readme.txt',
        kind: 'file',
        sizeBytes: 8,
        contentType: 'text/plain',
        audio: false,
      }),
    ]);
    remoteApiMocks.lookupTracks.mockResolvedValue([
      lookupTrack({
        remotePath: '/音乐 Space/Indexed.flac',
        title: 'Indexed Song',
      }),
    ]);
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Indexed Song');
    expect(screen.getByText('文件夹 1')).toBeTruthy();
    expect(screen.getByText('音频 2')).toBeTruthy();
    expect(screen.getByText('已入库 1')).toBeTruthy();
    expect(screen.getByText('未索引 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^已入库$/u }));
    expect(screen.getByText('Indexed Song')).toBeTruthy();
    expect(screen.queryByText('Loose.mp3')).toBeNull();
    expect(screen.queryByText('Album')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^未索引$/u }));
    expect(screen.getByText('Loose.mp3')).toBeTruthy();
    expect(screen.queryByText('Indexed Song')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^音频$/u }));
    expect(screen.getByText('Loose.mp3')).toBeTruthy();
    expect(screen.getByText('Indexed Song')).toBeTruthy();
    expect(screen.queryByText('readme.txt')).toBeNull();
  });

  it('offers play and queue actions only for audio files', async () => {
    sources = [remoteSource()];
    remoteApiMocks.browse.mockResolvedValue([
      directoryItem({
        path: '/音乐 Space/Echo Song.mp3',
        name: 'Echo Song.mp3',
        contentType: 'audio/mpeg',
        audio: true,
      }),
      directoryItem({
        path: '/音乐 Space/readme.txt',
        name: 'readme.txt',
        kind: 'file',
        sizeBytes: 8,
        contentType: 'text/plain',
        audio: false,
      }),
    ]);
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Echo Song.mp3');
    expect(screen.getByText('不可播放')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^播放$/u }));
    await waitFor(() => expect(playbackQueueMocks.playTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'remote',
        sourceId: 'source-1',
        remotePath: '/音乐 Space/Echo Song.mp3',
        title: 'Echo Song',
      }),
      expect.objectContaining({ forceNewQueueItem: true }),
    ));

    fireEvent.click(screen.getByRole('button', { name: /加入队列/u }));
    expect(playbackQueueMocks.appendToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'remote',
        sourceId: 'source-1',
        remotePath: '/音乐 Space/Echo Song.mp3',
      }),
      expect.objectContaining({ type: 'manual' }),
    );
  });

  it('confirms before deleting an existing source', async () => {
    sources = [remoteSource()];
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(remoteApiMocks.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(remoteApiMocks.delete).toHaveBeenCalledWith('source-1'));
  });

  it('confirms before disconnecting an existing source', async () => {
    sources = [remoteSource()];
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /断开/u }));
    expect(remoteApiMocks.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /断开/u }));
    await waitFor(() => expect(remoteApiMocks.disconnect).toHaveBeenCalledWith('source-1'));
  });

  it('starts a cover scan for missing remote covers', async () => {
    sources = [remoteSource()];
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    expect(remoteApiMocks.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /加载封面/u }));

    await waitFor(() => expect(remoteApiMocks.updateRuntimeLimits).toHaveBeenCalledWith('source-1', { coverConcurrency: 2 }));
    await waitFor(() => expect(remoteApiMocks.startBackgroundJobs).toHaveBeenCalledWith('source-1', ['cover']));
    expect(remoteApiMocks.startBackgroundJobs.mock.invocationCallOrder[0]).toBeGreaterThan(remoteApiMocks.updateRuntimeLimits.mock.invocationCallOrder[0]);
    await screen.findByText('\u5df2\u52a0\u5165\u4e00\u5c0f\u6279\u7f3a\u5931\u5c01\u9762\u626b\u63cf\u4efb\u52a1\u3002');
    expect(remoteApiMocks.list).toHaveBeenCalledTimes(1);
  });

  it('applies the selected cover loading performance mode to manual cover jobs', async () => {
    sources = [remoteSource()];
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /局域网极速/u }));
    await waitFor(() => expect(appApiMocks.setSettings).toHaveBeenCalledWith({ remoteCoverLoadPerformanceMode: 'lan' }));

    fireEvent.click(screen.getByRole('button', { name: /加载封面/u }));

    await waitFor(() => expect(remoteApiMocks.updateRuntimeLimits).toHaveBeenCalledWith('source-1', { coverConcurrency: 48 }));
    await waitFor(() => expect(remoteApiMocks.startBackgroundJobs).toHaveBeenCalledWith('source-1', ['cover']));
  });

  it('saves custom remote background concurrency and applies it to current sources', async () => {
    sources = [remoteSource()];
    appApiMocks.getSettings.mockResolvedValue({
      remoteCoverLoadPerformanceMode: 'balanced',
      remoteBackgroundConcurrency: { metadata: 3, cover: 6, lyrics: 2, mv: 1, durationBackfill: 2 },
    });
    render(<RemoteSourcesPanel />);

    const coverInput = await screen.findByLabelText('后台封面并发') as HTMLInputElement;
    expect(coverInput.value).toBe('6');
    remoteApiMocks.getOverview.mockClear();
    remoteApiMocks.getJobStatus.mockClear();
    remoteApiMocks.getSyncStatus.mockClear();

    fireEvent.change(screen.getByLabelText('后台元数据并发'), { target: { value: '5' } });
    fireEvent.change(coverInput, { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('后台歌词并发'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('后台 MV 并发'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('后台时长回填并发'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /应用后台并发/u }));

    await waitFor(() => expect(appApiMocks.setSettings).toHaveBeenCalledWith({
      remoteBackgroundConcurrency: { metadata: 5, cover: 12, lyrics: 3, mv: 2, durationBackfill: 4 },
    }));
    await waitFor(() => expect(remoteApiMocks.updateRuntimeLimits).toHaveBeenCalledWith('source-1', {
      metadataConcurrency: 5,
      coverConcurrency: 12,
      lyricsConcurrency: 3,
      mvConcurrency: 2,
      durationBackfillConcurrency: 4,
    }));
    await waitFor(() => {
      expect(screen.getAllByText('并发 12').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('并发 5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('并发 4').length).toBeGreaterThan(0);
    expect(remoteApiMocks.getOverview).not.toHaveBeenCalled();
    expect(remoteApiMocks.getJobStatus).not.toHaveBeenCalled();
    expect(remoteApiMocks.getSyncStatus).not.toHaveBeenCalled();
    await screen.findByText(/后台任务并发已保存/u);
  });

  it('refreshes visible cover overview while background jobs are running', async () => {
    sources = [remoteSource({ indexedTrackCount: 8 })];
    const coverOverview = (ok: number, pending: number): RemoteSourceOverview => {
      const nextOverview = overviewFor(sources);
      const cover = { ...emptyStatusCounts(), ok, pending };
      return {
        ...nextOverview,
        cover,
        sources: nextOverview.sources.map((source) => ({ ...source, cover })),
      };
    };
    const initialOverview = coverOverview(2, 6);
    const updatedOverview = coverOverview(5, 3);
    const runningStatus = jobStatus();
    remoteApiMocks.getOverview.mockImplementation((sourceId?: string | null) => (
      Promise.resolve(sourceId === 'source-1' ? updatedOverview : initialOverview)
    ));
    remoteApiMocks.getJobStatus.mockImplementation((sourceId) => Promise.resolve({
      ...runningStatus,
      sourceId,
      pending: { ...runningStatus.pending, cover: 3 },
      running: { ...runningStatus.running, cover: 1 },
    }));
    const intervalCallbacks: Array<() => void> = [];
    vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        intervalCallbacks.push(handler as () => void);
      }
      return setTimeout(() => undefined, 0) as unknown as ReturnType<typeof window.setInterval>;
    });

    render(<RemoteSourcesPanel />);

    await screen.findByText(/已加载 2 \/ 8/u);
    const progressbar = screen.getByRole('progressbar', { name: 'Mock AList 封面加载进度' });
    expect(progressbar.querySelector('.remote-scan-progress-track span')?.getAttribute('style')).toContain('25%');
    await waitFor(() => expect(intervalCallbacks.length).toBeGreaterThanOrEqual(2));
    remoteApiMocks.getOverview.mockClear();

    await act(async () => {
      intervalCallbacks.forEach((callback) => callback());
    });

    await waitFor(() => expect(remoteApiMocks.getOverview).toHaveBeenCalledWith('source-1'));
    await screen.findByText(/已加载 5 \/ 8/u);
    expect(progressbar.querySelector('.remote-scan-progress-track span')?.getAttribute('style')).toContain('63%');
  });

  it('previews and applies the selected remote album merge strategy', async () => {
    appApiMocks.getSettings.mockResolvedValue({ remoteCoverLoadPerformanceMode: 'balanced', remoteAlbumMergeStrategy: 'conservative' });
    appApiMocks.setSettings.mockImplementation(async (patch) => ({ remoteAlbumMergeStrategy: patch.remoteAlbumMergeStrategy }));
    render(<RemoteSourcesPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /普通合并/u }));
    await waitFor(() => expect(remoteApiMocks.previewAlbumGrouping).toHaveBeenCalledWith('standard'));
    fireEvent.click(screen.getByRole('button', { name: /应用并重新整理分组/u }));

    await waitFor(() => expect(appApiMocks.setSettings).toHaveBeenCalledWith({ remoteAlbumMergeStrategy: 'standard' }));
    await screen.findByText(/3 -> 2/);
  });

  it('shows playback low-load status while keeping manual background actions clear', async () => {
    sources = [remoteSource()];
    const status = jobStatus();
    remoteApiMocks.getJobStatus.mockResolvedValue({
      ...status,
      pending: { ...status.pending, cover: 1, lyrics: 1 },
    });
    remoteApiMocks.getBackgroundGlobalStatus.mockResolvedValue(globalStatus({
      playbackActive: true,
      concurrency: { metadata: 1, cover: 0, lyrics: 0, mv: 0, 'duration-backfill': 1 },
    }));
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    expect(screen.getByText('\u4f4e\u8d1f\u8f7d\u8fd0\u884c')).toBeTruthy();
    expect(screen.getByText(/\u64ad\u653e\u4e2d\uff0c\u540e\u53f0\u4efb\u52a1\u5df2\u964d\u4f4e\u8d1f\u8f7d/u)).toBeTruthy();
    expect(screen.getByText(/\u64ad\u653e\u4e2d\uff0c\u5c01\u9762\u548c\u6b4c\u8bcd\u7b49\u540e\u53f0\u4efb\u52a1/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /\u52a0\u8f7d\u5c01\u9762/u }));

    await waitFor(() => expect(remoteApiMocks.updateRuntimeLimits).toHaveBeenCalledWith('source-1', { coverConcurrency: 2 }));
    await waitFor(() => expect(remoteApiMocks.startBackgroundJobs).toHaveBeenCalledWith('source-1', ['cover']));
    await screen.findByText('\u5df2\u52a0\u5165\u7f3a\u5931\u5c01\u9762\u4efb\u52a1\uff1b\u64ad\u653e\u4e2d\u4f1a\u4fdd\u6301\u4f4e\u8d1f\u8f7d\uff0c\u7a7a\u95f2\u540e\u7ee7\u7eed\u5904\u7406\u3002');
  });

  it('shows remote overview, source recommendations, and issue previews', async () => {
    sources = [remoteSource({ indexedTrackCount: 8 })];
    remoteApiMocks.getOverview.mockResolvedValue({
      ...overviewFor(sources),
      trackCount: 8,
      albumCount: 2,
      artistCount: 3,
      totalSizeBytes: 4096,
      metadata: { ...emptyStatusCounts(), ok: 6, error: 2 },
      sources: [
        {
          ...overviewFor(sources).sources[0],
          trackCount: 8,
          albumCount: 2,
          artistCount: 3,
          totalSizeBytes: 4096,
          metadata: { ...emptyStatusCounts(), ok: 6, error: 2 },
        },
      ],
    });
    remoteApiMocks.listIssues.mockResolvedValue([
      {
        id: 'remote-track-1',
        sourceId: 'source-1',
        provider: 'webdav',
        kind: 'metadata',
        status: 'error',
        title: 'Echo Song',
        artist: 'Echo Artist',
        album: 'Echo Album',
        remotePath: '/music/Echo Song.flac',
        sizeBytes: 4096,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    expect(screen.getAllByText('已索引歌曲').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/有 2 首元数据异常/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /查看元数据问题/u }));
    await waitFor(() => expect(remoteApiMocks.listIssues).toHaveBeenCalledWith('source-1', 'metadata', 6));
    await screen.findByText('Echo Song');
  });

  it('summarizes provider tabs and per-source health for the remote console', async () => {
    sources = [
      remoteSource({ indexedTrackCount: 4 }),
      remoteSource({
        id: 'source-2',
        provider: 'subsonic',
        displayName: 'Navidrome',
        baseUrl: 'https://music.example.test',
        indexedTrackCount: 12,
      }),
    ];
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    expect(screen.getByText('远程库控制台')).toBeTruthy();
    expect(screen.getByRole('button', { name: /网盘 \/ WebDAV.*1 个.*4 首/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Subsonic \/ Navidrome.*1 个.*12 首/u })).toBeTruthy();
    expect(screen.getByLabelText('Mock AList 补齐进度')).toBeTruthy();
    expect(screen.getByText('1 个来源')).toBeTruthy();
  });

  it('keeps remote matching and retry actions lightweight', async () => {
    sources = [remoteSource()];
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');

    fireEvent.click(screen.getByRole('button', { name: /\u5339\u914d\u6b4c\u8bcd/u }));
    await waitFor(() => expect(remoteApiMocks.startBackgroundJobs).toHaveBeenCalledWith('source-1', ['lyrics']));
    await screen.findByText('\u5df2\u52a0\u5165\u4e00\u5c0f\u6279\u6b4c\u8bcd\u5339\u914d\u4efb\u52a1\uff1b\u7f51\u76d8\u6765\u6e90\u4e0d\u518d\u6279\u91cf\u5339\u914d MV\u3002');
    expect(remoteApiMocks.startBackgroundJobs).not.toHaveBeenCalledWith('source-1', ['lyrics', 'mv']);

    fireEvent.click(screen.getByRole('button', { name: /\u4ec5\u91cd\u8bd5\u5931\u8d25\u5143\u6570\u636e/u }));
    await waitFor(() => expect(remoteApiMocks.retryFailedJobs).toHaveBeenCalledWith('source-1', ['metadata', 'duration-backfill']));
    expect(remoteApiMocks.retryFailedJobs).not.toHaveBeenCalledWith('source-1', ['metadata', 'cover', 'lyrics', 'mv', 'duration-backfill']);
  });

  it('marks active, paused, and disabled remote controls visually', async () => {
    sources = [remoteSource({ status: 'disabled' })];
    const status = jobStatus();
    remoteApiMocks.getJobStatus.mockResolvedValue({
      ...status,
      paused: true,
      pending: { ...status.pending, cover: 2 },
    });
    remoteApiMocks.resumeBackgroundJobs.mockResolvedValue({ ...status, paused: false });
    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    const coverButton = screen.getByRole('button', { name: /加载封面/u });
    expect(coverButton.getAttribute('data-state')).toBe('active');
    expect(coverButton.getAttribute('aria-pressed')).toBe('true');

    const pauseButton = screen.getByRole('button', { name: /恢复后台任务/u });
    expect(pauseButton.getAttribute('data-state')).toBe('paused');
    fireEvent.click(pauseButton);
    await waitFor(() => expect(remoteApiMocks.resumeBackgroundJobs).toHaveBeenCalledWith('source-1'));

    const enableButton = screen.getByRole('button', { name: /启用/u });
    expect(enableButton.getAttribute('data-state')).toBe('off');
  });

  it('disconnects a source and clears the browser state even if the refresh fails', async () => {
    sources = [remoteSource()];
    remoteApiMocks.lookupTracks.mockResolvedValue([lookupTrack()]);
    remoteApiMocks.list
      .mockImplementationOnce(() => Promise.resolve(sources))
      .mockImplementation(() => Promise.reject(new Error('refresh failed')));
    remoteApiMocks.disconnect.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Indexed Echo Song');

    fireEvent.click(screen.getByRole('button', { name: /断开/u }));

    await waitFor(() => expect(remoteApiMocks.disconnect).toHaveBeenCalledWith('source-1'));
    await waitFor(() => expect(screen.getAllByText('Mock AList').length).toBeGreaterThan(0));
    await screen.findByText('已禁用');
    expect(screen.queryByText('Indexed Echo Song')).toBeNull();
  });

  it('deletes a source from the browser source list', async () => {
    sources = [remoteSource()];
    remoteApiMocks.lookupTracks.mockResolvedValue([lookupTrack()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RemoteSourcesPanel />);

    await screen.findAllByText('Mock AList');
    fireEvent.click(screen.getByRole('button', { name: /打开根目录/u }));
    await screen.findByText('Indexed Echo Song');

    fireEvent.click(screen.getByRole('button', { name: '删除来源 Mock AList' }));

    await waitFor(() => expect(remoteApiMocks.delete).toHaveBeenCalledWith('source-1'));
    await screen.findByText('还没有 网盘 / WebDAV 来源');
    expect(screen.queryByText('Indexed Echo Song')).toBeNull();
  });
});
