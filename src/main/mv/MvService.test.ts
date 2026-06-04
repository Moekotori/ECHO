import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../database/createDatabase';
import type { EchoDatabase } from '../database/createDatabase';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvMatchCandidate } from '../../shared/types/mv';
import { MvService } from './MvService';
import type { MainMvOnlineProvider, ResolvedMvStreamVariant } from './OnlineMvProviders';

const appSettingsMock = vi.hoisted(() => {
  const defaultValue = {
    mvEnabledProviders: ['bilibili', 'youtube'],
    mvProviderOrder: ['bilibili', 'youtube'],
    mvAutoSearch: true,
    mvAutoPreload: true,
    mvAutoApplyThreshold: 0.7,
    mvPreferHighestViewCount: false,
    mvImmersiveBackground: true,
    mvImmersiveBackgroundScalePercent: 115,
    mvImmersiveBackgroundOffsetXPercent: 50,
    mvImmersiveBackgroundOffsetYPercent: 50,
    mvHideLyrics: false,
    mvMaxQuality: 'max',
    mvAllow60fps: true,
  };

  return {
    defaultValue,
    current: { ...defaultValue },
  };
});

vi.mock('../app/appSettings', () => ({
  getAppSettings: () => appSettingsMock.current,
  setAppSettings: vi.fn((patch: Partial<typeof appSettingsMock.current>) => {
    appSettingsMock.current = { ...appSettingsMock.current, ...patch };
    return appSettingsMock.current;
  }),
}));

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-mv-service-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const makeTrack = (path: string, id = 'track-1'): LibraryTrack => ({
  id,
  path,
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  albumArtist: 'Echo Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const insertTrack = (database: EchoDatabase, track: LibraryTrack): void => {
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO folders (id, path, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('folder-1', join(tempRoots[0] ?? tmpdir(), 'Music'), 'Music', timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO tracks (
        id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
        track_no, disc_no, year, genre, duration, codec, sample_rate, bit_depth, bitrate,
        cover_id, field_sources_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      track.id,
      track.path,
      'folder-1',
      1,
      1,
      track.title,
      track.artist,
      track.album,
      track.albumArtist,
      track.trackNo,
      track.discNo,
      track.year,
      track.genre,
      track.duration,
      track.codec,
      track.sampleRate,
      track.bitDepth,
      track.bitrate,
      track.coverId,
      '{}',
      timestamp,
      timestamp,
    );
};

const createHarness = (onlineProviders: MainMvOnlineProvider[] = []) => {
  const root = makeTempRoot();
  const audioPath = join(root, 'Echo Song.flac');
  writeFileSync(audioPath, 'audio');
  const track = makeTrack(audioPath);
  const database = createDatabase(':memory:');
  insertTrack(database, track);
  const shellOpener = {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
  };
  const service = new MvService(database, { getTrack: (trackId) => (trackId === track.id ? track : null) }, undefined, shellOpener, onlineProviders);

  return { database, root, service, shellOpener, track };
};

const makeResolvedVariant = (overrides: Partial<ResolvedMvStreamVariant> = {}): ResolvedMvStreamVariant => ({
  id: 'bilibili-qn-80',
  label: '1080p',
  qualityTier: '1080p',
  width: 1920,
  height: 1080,
  fps: null,
  codec: 'avc1',
  container: 'mp4',
  mimeType: 'video/mp4',
  protocol: 'direct',
  playableInApp: true,
  requiresAccount: false,
  expiresAt: null,
  url: 'https://cdn.example/echo-1080.mp4',
  headers: {},
  rawProviderJson: { provider: 'bilibili', resolver: 'test', qn: 80, qualityRank: 3 },
  ...overrides,
});

const makeExternalVariant = (
  url = 'https://www.bilibili.com/video/BV1external',
  rawProviderJson: unknown | null = null,
): ResolvedMvStreamVariant => ({
  id: 'bilibili:external',
  label: 'Bilibili',
  qualityTier: 'auto',
  width: null,
  height: null,
  fps: null,
  codec: null,
  container: null,
  mimeType: null,
  protocol: 'external',
  playableInApp: false,
  requiresAccount: false,
  expiresAt: null,
  url,
  headers: {},
  rawProviderJson,
});

const makeSqliteCorruptError = (): Error & { code: string } => {
  const error = new Error('SqliteError: database disk image is malformed') as Error & { code: string };
  error.code = 'SQLITE_CORRUPT';
  return error;
};

afterEach(() => {
  appSettingsMock.current = { ...appSettingsMock.defaultValue };
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('MvService', () => {
  it('clears stale Bilibili external and DASH stream cache rows without deleting selected MV rows', () => {
    const database = createDatabase(':memory:');
    const track = makeTrack('D:\\Music\\Echo Song.flac');
    insertTrack(database, track);
    const timestamp = new Date().toISOString();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    database
      .prepare(
        `INSERT INTO track_videos (
          id, track_id, provider, source_type, source_id, title, url, provider_url, score, selected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'video-stale-cache',
        track.id,
        'bilibili',
        'search_candidate',
        'BV1stale',
        'Echo Song MV',
        'https://www.bilibili.com/video/BV1stale',
        'https://www.bilibili.com/video/BV1stale',
        0.9,
        1,
        timestamp,
        timestamp,
      );

    const insertStream = database.prepare(
      `INSERT INTO track_video_streams (
        id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
        mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStream.run(
      'stream-external',
      'video-stale-cache',
      'bilibili',
      'bilibili:external',
      'Bilibili',
      'auto',
      null,
      null,
      null,
      null,
      null,
      null,
      'external',
      'https://www.bilibili.com/video/BV1stale',
      '{}',
      0,
      0,
      null,
      null,
      timestamp,
      timestamp,
    );
    insertStream.run(
      'stream-dash-direct',
      'video-stale-cache',
      'bilibili',
      'bilibili-dash-qn-80',
      '1080p',
      '1080p',
      1920,
      1080,
      null,
      'avc1',
      'mp4',
      'video/mp4',
      'direct',
      'https://upos.example/video.m4s?e=1',
      '{}',
      1,
      0,
      null,
      JSON.stringify({ provider: 'bilibili', resolver: 'bilibili-dash-video-v4', source: 'dash-video' }),
      timestamp,
      timestamp,
    );
    insertStream.run(
      'stream-mp4',
      'video-stale-cache',
      'bilibili',
      'bilibili-qn-64',
      '720p',
      '720p',
      1280,
      720,
      null,
      'avc1',
      'mp4',
      'video/mp4',
      'direct',
      'https://upos.example/video.mp4?e=1',
      '{}',
      1,
      0,
      null,
      JSON.stringify({ provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl' }),
      timestamp,
      timestamp,
    );
    insertStream.run(
      'stream-muted-dash',
      'video-stale-cache',
      'bilibili',
      'bilibili-dash-qn-80-muted',
      '1080p',
      '1080p',
      1920,
      1080,
      null,
      'avc1',
      'mp4',
      'video/mp4',
      'direct',
      'https://upos.example/video-muted.m4s?e=1',
      '{}',
      1,
      0,
      null,
      JSON.stringify({ provider: 'bilibili', resolver: 'bilibili-dash-video-v4', source: 'dash-video', mutedVideoOnly: true }),
      timestamp,
      timestamp,
    );

    new MvService(database, { getTrack: (trackId) => (trackId === track.id ? track : null) });

    expect(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM track_videos').get()?.count).toBe(1);
    expect(database.prepare<[], { variant_id: string }>('SELECT variant_id FROM track_video_streams ORDER BY variant_id').all()).toEqual([
      { variant_id: 'bilibili-dash-qn-80-muted' },
      { variant_id: 'bilibili-qn-64' },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[mv] Cleared stale Bilibili MV stream cache rows.',
      expect.objectContaining({ rows: 2 }),
    );
  });

  it('bindLocalVideo sets the video as selected', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');

    const video = service.bindLocalVideo(track.id, videoPath);

    expect(video.selected).toBe(true);
    expect(service.getSelectedVideo(track.id)?.id).toBe(video.id);
    expect(video.filePath).toBeNull();
  });

  it('selectVideo clears other selected videos for the same track', async () => {
    const { root, service, track } = createHarness();
    const firstPath = join(root, 'Echo Song.mp4');
    const secondPath = join(root, 'Echo Artist - Echo Song.webm');
    writeFileSync(firstPath, 'video');
    writeFileSync(secondPath, 'video');
    const first = service.bindLocalVideo(track.id, firstPath);
    const second = service.bindLocalVideo(track.id, secondPath);

    await service.selectVideo(track.id, first.id);
    const videos = service.getVideoCandidates(track.id);

    expect(videos.find((video) => video.id === first.id)?.selected).toBe(true);
    expect(videos.find((video) => video.id === second.id)?.selected).toBe(false);
  });

  it('clearSelectedVideo keeps candidates', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');
    service.bindLocalVideo(track.id, videoPath);

    service.clearSelectedVideo(track.id);

    expect(service.getSelectedVideo(track.id)).toBeNull();
    expect(service.getVideoCandidates(track.id)).toHaveLength(1);
  });

  it('saves MV offset only on the selected video for the current track', async () => {
    const { root, service, track } = createHarness();
    const firstPath = join(root, 'Echo Song.mp4');
    const secondPath = join(root, 'Echo Song Live.mp4');
    writeFileSync(firstPath, 'video');
    writeFileSync(secondPath, 'video');
    const first = service.bindLocalVideo(track.id, firstPath);
    const second = service.bindLocalVideo(track.id, secondPath);

    const updated = service.setVideoOffset(track.id, 750);
    await service.selectVideo(track.id, first.id);

    expect(updated?.id).toBe(second.id);
    expect(updated?.offsetMs).toBe(750);
    expect(service.getSelectedVideo(track.id)?.offsetMs).toBe(0);
    expect(service.getVideoCandidates(track.id).find((video) => video.id === second.id)?.offsetMs).toBe(750);
  });

  it('clamps saved MV offsets to the wide synchronization range', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');
    service.bindLocalVideo(track.id, videoPath);

    expect(service.setVideoOffset(track.id, 700000)?.offsetMs).toBe(600000);
    expect(service.setVideoOffset(track.id, -700000)?.offsetMs).toBe(-600000);
  });

  it('automatically searches and applies a network MV candidate at 70 percent or higher when enabled', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1auto',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1auto',
      providerUrl: 'https://www.bilibili.com/video/BV1auto',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.76,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);

    const selected = await service.getSelectedOrAutoApplyVideo(track.id);

    expect(provider.search).toHaveBeenCalledOnce();
    expect(selected).toMatchObject({
      provider: 'bilibili',
      selected: true,
      title: 'Echo Song Official MV',
    });
    expect(service.getSelectedVideo(track.id)?.id).toBe(selected?.id);
  });

  it('keeps a manually selected search candidate when auto search runs again', async () => {
    const highScoreCandidate: MvMatchCandidate = {
      id: 'bilibili:BV1auto',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1auto',
      providerUrl: 'https://www.bilibili.com/video/BV1auto',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.92,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const manualCandidate: MvMatchCandidate = {
      ...highScoreCandidate,
      id: 'bilibili:BV1manual',
      title: 'Echo Song Live MV',
      url: 'https://www.bilibili.com/video/BV1manual',
      providerUrl: 'https://www.bilibili.com/video/BV1manual',
      score: 0.74,
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [highScoreCandidate, manualCandidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };

    const candidates = await service.searchNetworkCandidates(track.id);
    const selectedManually = await service.selectVideo(track.id, candidates.find((candidate) => candidate.title === 'Echo Song Live MV')!.id);
    await service.resolveStreams(selectedManually.id);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: true };

    await service.searchNetworkCandidates(track.id);

    expect(service.getSelectedVideo(track.id)?.id).toBe(selectedManually.id);
    expect(service.getSelectedVideo(track.id)?.title).toBe('Echo Song Live MV');
  });

  it('deduplicates concurrent stream resolves for the same MV', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1dedupe',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1dedupe',
      providerUrl: 'https://www.bilibili.com/video/BV1dedupe',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    let releaseResolve!: (value: ResolvedMvStreamVariant[]) => void;
    const pendingResolve = new Promise<ResolvedMvStreamVariant[]>((resolve) => {
      releaseResolve = resolve;
    });
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => pendingResolve),
    };
    const { service, track } = createHarness([provider]);
    const [persisted] = await service.searchNetworkCandidates(track.id);

    const first = service.resolveStreams(persisted.id);
    const second = service.resolveStreams(persisted.id);
    await Promise.resolve();
    expect(provider.resolve).toHaveBeenCalledTimes(1);

    releaseResolve([makeResolvedVariant()]);
    const [firstResolved, secondResolved] = await Promise.all([first, second]);

    expect(provider.resolve).toHaveBeenCalledTimes(1);
    expect(firstResolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(persisted.id)}/bilibili-qn-80`);
    expect(secondResolved.video.mediaUrl).toBe(firstResolved.video.mediaUrl);
  });

  it('keeps playable cached streams but surfaces a later Bilibili playurl block reason', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1blocked',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1blocked',
      providerUrl: 'https://www.bilibili.com/video/BV1blocked',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const resolve = vi
      .fn<MainMvOnlineProvider['resolve']>()
      .mockResolvedValueOnce([makeResolvedVariant()])
      .mockResolvedValueOnce([
        makeExternalVariant(candidate.providerUrl ?? undefined, {
          provider: 'bilibili',
          unavailableReason: 'bilibili-playurl-blocked',
          status: 412,
        }),
      ]);
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve,
    };
    const { service, track } = createHarness([provider]);
    const [persisted] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, persisted.id);

    const refreshed = await service.resolveStreams(selected.id);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(refreshed.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(persisted.id)}/bilibili-qn-80`);
    expect(refreshed.video.rawProviderJson).toMatchObject({
      unavailableReason: 'bilibili-playurl-blocked',
      status: 412,
    });
  });

  it('does not automatically apply external-only network MV candidates', async () => {
    const candidate: MvMatchCandidate = {
      id: 'youtube:external-only',
      provider: 'youtube',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.youtube.com/watch?v=external-only',
      providerUrl: 'https://www.youtube.com/watch?v=external-only',
      thumbnailUrl: 'https://i.example/external.jpg',
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.98,
      playableInApp: false,
      reasons: ['YouTube Data API'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'youtube',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => []),
    };
    const { service, track } = createHarness([provider]);

    await service.searchNetworkCandidates(track.id);

    expect(service.getSelectedVideo(track.id)).toBeNull();
    expect(service.getVideoCandidates(track.id)[0]).toMatchObject({
      provider: 'youtube',
      playableInApp: false,
      selected: false,
    });
  });

  it('prefers an in-app playable candidate over a higher-scoring external candidate when auto applying', async () => {
    const externalCandidate: MvMatchCandidate = {
      id: 'youtube:external-high-score',
      provider: 'youtube',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.youtube.com/watch?v=external-high-score',
      providerUrl: 'https://www.youtube.com/watch?v=external-high-score',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.99,
      playableInApp: false,
      reasons: ['YouTube Data API'],
    };
    const playableCandidate: MvMatchCandidate = {
      id: 'bilibili:BV1playable',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1playable',
      providerUrl: 'https://www.bilibili.com/video/BV1playable',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.72,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const bilibiliProvider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [playableCandidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const youtubeProvider: MainMvOnlineProvider = {
      id: 'youtube',
      search: vi.fn(async () => [externalCandidate]),
      resolve: vi.fn(async () => []),
    };
    const { service, track } = createHarness([bilibiliProvider, youtubeProvider]);

    await service.searchNetworkCandidates(track.id);

    expect(service.getSelectedVideo(track.id)).toMatchObject({
      provider: 'bilibili',
      sourceId: 'BV1playable',
      selected: true,
    });
  });

  it('skips auto candidates that only resolve to an external Bilibili link', async () => {
    const externalCandidate: MvMatchCandidate = {
      id: 'bilibili:BV1external',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Blu-ray ISO',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1external',
      providerUrl: 'https://www.bilibili.com/video/BV1external',
      thumbnailUrl: null,
      uploader: 'Archive Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.93,
      playableInApp: true,
      viewCount: 2000,
      reasons: ['Bilibili search'],
    };
    const playableCandidate: MvMatchCandidate = {
      ...externalCandidate,
      id: 'bilibili:BV1playable',
      title: 'Echo Song Music Video',
      url: 'https://www.bilibili.com/video/BV1playable',
      providerUrl: 'https://www.bilibili.com/video/BV1playable',
      score: 0.9,
      viewCount: 500,
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [externalCandidate, playableCandidate]),
      resolve: vi.fn(async (video) =>
        video.sourceId === 'BV1external' ? [makeExternalVariant(video.providerUrl ?? video.url ?? undefined)] : [makeResolvedVariant()],
      ),
    };
    const { service, track } = createHarness([provider]);

    await service.searchNetworkCandidates(track.id);

    expect(provider.resolve).toHaveBeenCalledTimes(3);
    expect(vi.mocked(provider.resolve).mock.calls.filter(([video]) => video.sourceId === 'BV1external')).toHaveLength(2);
    expect(service.getSelectedVideo(track.id)).toMatchObject({
      provider: 'bilibili',
      sourceId: 'BV1playable',
      selected: true,
      playableInApp: true,
      mediaUrl: expect.stringContaining('echo-mv://stream/'),
    });
    expect(service.getVideoCandidates(track.id).find((video) => video.sourceId === 'BV1external')).toMatchObject({
      selected: false,
      playableInApp: false,
    });
  });

  it('keeps a playable cached stream when a later refresh resolves only to an external link', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1preserve',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1preserve',
      providerUrl: 'https://www.bilibili.com/video/BV1preserve',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.95,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi
        .fn()
        .mockResolvedValueOnce([makeResolvedVariant({ rawProviderJson: { provider: 'bilibili', resolver: 'legacy', qn: 80, qualityRank: 3 } })])
        .mockResolvedValueOnce([makeExternalVariant('https://www.bilibili.com/video/BV1preserve')]),
    };
    const { service, track } = createHarness([provider]);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const firstMediaUrl = selected.mediaUrl;
    const refreshed = await service.resolveStreams(selected.id);

    expect(provider.resolve).toHaveBeenCalledTimes(2);
    expect(firstMediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`);
    expect(refreshed.video).toMatchObject({
      playableInApp: true,
      mediaUrl: firstMediaUrl,
      qualityLabel: '1080p',
    });
  });

  it('serves a stale cached stream to the MV protocol when refresh resolves only to an external link', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1stale',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1stale',
      providerUrl: 'https://www.bilibili.com/video/BV1stale',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.95,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi
        .fn()
        .mockResolvedValueOnce([
          makeResolvedVariant({
            id: 'bilibili-qn-80',
            expiresAt: '2000-01-01T00:00:00.000Z',
            url: 'https://cdn.example/stale-1080.mp4',
            rawProviderJson: { provider: 'bilibili', resolver: 'legacy', qn: 80, qualityRank: 3 },
          }),
        ])
        .mockResolvedValueOnce([makeExternalVariant('https://www.bilibili.com/video/BV1stale')]),
    };
    const { service, track } = createHarness([provider]);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const variant = await service.getStreamVariantForProtocol(selected.id, 'bilibili-qn-80');

    expect(provider.resolve).toHaveBeenCalledTimes(2);
    expect(variant).toMatchObject({
      url: 'https://cdn.example/stale-1080.mp4',
      mimeType: 'video/mp4',
    });
    expect(service.getSelectedVideo(track.id)).toMatchObject({
      playableInApp: true,
      mediaUrl: `echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`,
    });
  });

  it('does not let a manually selected external-only network candidate replace the current MV', async () => {
    const playableCandidate: MvMatchCandidate = {
      id: 'bilibili:BV1playable',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1playable',
      providerUrl: 'https://www.bilibili.com/video/BV1playable',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.95,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const externalCandidate: MvMatchCandidate = {
      ...playableCandidate,
      id: 'bilibili:BV1external',
      title: 'Echo Song External',
      url: 'https://www.bilibili.com/video/BV1external',
      providerUrl: 'https://www.bilibili.com/video/BV1external',
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [playableCandidate, externalCandidate]),
      resolve: vi.fn(async (video) =>
        video.sourceId === 'BV1external' ? [makeExternalVariant(video.providerUrl ?? video.url ?? undefined)] : [makeResolvedVariant()],
      ),
    };
    const { service, track } = createHarness([provider]);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };

    const candidates = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, candidates.find((candidate) => candidate.title === 'Echo Song MV')!.id);

    await expect(service.selectVideo(track.id, candidates.find((candidate) => candidate.title === 'Echo Song External')!.id)).rejects.toThrow(
      '此 MV 暂时无法在应用内播放',
    );

    expect(service.getSelectedVideo(track.id)).toMatchObject({
      id: selected.id,
      sourceId: 'BV1playable',
      playableInApp: true,
    });
  });

  it('does not automatically apply an MV candidate below 70 percent', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1low',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1low',
      providerUrl: 'https://www.bilibili.com/video/BV1low',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.69,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);

    const selected = await service.getSelectedOrAutoApplyVideo(track.id);

    expect(provider.search).toHaveBeenCalledOnce();
    expect(selected).toBeNull();
    expect(service.getSelectedVideo(track.id)).toBeNull();
    expect(service.getVideoCandidates(track.id)[0]).toMatchObject({
      provider: 'bilibili',
      score: 0.69,
      selected: false,
    });
  });

  it('does not search network MV candidates when MV is disabled', async () => {
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => []),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);

    service.setSettings({ enabled: false });

    await expect(service.searchNetworkCandidates(track.id)).resolves.toEqual([]);
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('persists the MV lyrics visibility setting', () => {
    const { service } = createHarness();

    expect(service.getSettings().hideLyrics).toBe(false);
    expect(service.setSettings({ hideLyrics: true }).hideLyrics).toBe(true);
    expect(appSettingsMock.current.mvHideLyrics).toBe(true);
  });

  it('does not reset MV rows when network candidate persistence hits a database error', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1repair',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1repair',
      providerUrl: 'https://www.bilibili.com/video/BV1repair',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.92,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { database, service, track } = createHarness([provider]);
    const selected = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1existing');
    const originalTransaction = database.transaction.bind(database);
    let failOnce = true;

    vi.spyOn(database, 'transaction').mockImplementation(((fn: () => unknown) => {
      if (failOnce) {
        failOnce = false;
        return (() => {
          throw makeSqliteCorruptError();
        }) as never;
      }

      return originalTransaction(fn as never) as never;
    }) as never);

    await expect(service.searchNetworkCandidates(track.id)).rejects.toThrow('MV database is temporarily unavailable');

    expect(provider.resolve).not.toHaveBeenCalled();
    expect(service.getSelectedVideo(track.id)).toMatchObject({ id: selected.id, provider: 'bilibili', selected: true });
    expect(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM track_videos').get()?.count).toBe(1);
  });

  it('keeps selected MV rows when only the stream cache table is corrupt', () => {
    const { database, service, track } = createHarness();
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1streamcache');
    const originalPrepare = database.prepare.bind(database);
    let failOnce = true;

    vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
      if (failOnce && sql.includes('FROM track_video_streams')) {
        failOnce = false;
        throw makeSqliteCorruptError();
      }

      return originalPrepare(sql) as never;
    }) as never);

    const selected = service.getSelectedVideo(track.id);

    expect(selected).toMatchObject({ id: video.id, provider: 'bilibili', selected: true });
    expect(service.getVideoCandidates(track.id)).toHaveLength(1);
  });

  it('resets corrupt MV stream cache and retries resolveStreams writes', async () => {
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => []),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { database, service, track } = createHarness([provider]);
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1retry');
    const originalTransaction = database.transaction.bind(database);
    let failOnce = true;

    vi.spyOn(database, 'transaction').mockImplementation(((fn: () => unknown) => {
      if (failOnce) {
        failOnce = false;
        return (() => {
          throw makeSqliteCorruptError();
        }) as never;
      }

      return originalTransaction(fn as never) as never;
    }) as never);

    const resolved = await service.resolveStreams(video.id);

    expect(resolved.variants).toHaveLength(1);
    expect(resolved.video).toMatchObject({ id: video.id, playableInApp: true });
    expect(resolved.video.mediaUrl).toContain('echo-mv://stream/');
  });

  it('falls back to auto quality when the saved MV quality id is stale', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1stalequality',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1stalequality',
      providerUrl: 'https://www.bilibili.com/video/BV1stalequality',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.95,
      playableInApp: true,
      reasons: ['test'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant({ id: 'bilibili-qn-80' })]),
    };
    const { database, service, track } = createHarness([provider]);
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    database.prepare('UPDATE track_videos SET selected_quality_id = ? WHERE id = ?').run('old-expired-quality', selected.id);

    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.playableInApp).toBe(true);
    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`);
    expect(resolved.video.qualityLabel).toBe('1080p');
    expect(resolved.video.selectedQualityId).toBe('auto');
  });

  it('refreshes cached Bilibili DASH streams that were previously stored as direct playable streams', async () => {
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => []),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://cdn.example/fresh-720.mp4',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-progressive-mp4-v1',
            source: 'durl',
            requestedQn: 127,
            qn: 64,
            qualityRank: 1,
          },
        }),
      ]),
    };
    const { database, service, track } = createHarness([provider]);
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1staledash');
    const timestamp = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO track_video_streams (
          id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
          mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'stream-stale-dash',
        video.id,
        'bilibili',
        'bilibili-qn-127',
        '8K',
        '4320p',
        7680,
        4320,
        null,
        'avc1.640033',
        'mp4',
        'video/mp4',
        'direct',
        'https://cdn.example/stale-8k-video-only.m4s',
        '{}',
        1,
        0,
        new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        JSON.stringify({
          provider: 'bilibili',
          resolver: 'bilibili-dash-video-v4',
          source: 'dash-video',
          requestedQn: 127,
          qn: 127,
          qualityRank: 8,
        }),
        timestamp,
        timestamp,
      );

    const resolved = await service.resolveStreams(video.id);

    expect(provider.resolve).toHaveBeenCalled();
    expect(resolved.video).toMatchObject({
      playableInApp: true,
      qualityLabel: '720p',
      width: 1280,
      height: 720,
      mediaUrl: `echo-mv://stream/${encodeURIComponent(video.id)}/bilibili-qn-64`,
    });
    expect(resolved.variants.map((variant) => variant.id)).toEqual(['bilibili-qn-64']);
  });

  it('refreshes old codec-collapsed Bilibili DASH cache even when a 720p fallback is playable', async () => {
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => []),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-dash-qn-127-av1',
          label: '8K',
          qualityTier: '4320p',
          width: 7680,
          height: 4320,
          codec: 'av01.0.01M.10.0.110.01.01.01.0',
          url: 'https://cdn.example/fresh-8k-av1.m4s',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-dash-video-v4',
            source: 'dash-video',
            requestedQn: 127,
            qn: 127,
            qualityRank: 8,
            mutedVideoOnly: true,
          },
        }),
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://cdn.example/fresh-720.mp4',
          rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl', qn: 64, qualityRank: 1 },
        }),
      ]),
    };
    const { database, service, track } = createHarness([provider]);
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1Gm41127gL');
    const timestamp = new Date().toISOString();
    const insertStream = database.prepare(
      `INSERT INTO track_video_streams (
        id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
        mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStream.run(
      'stream-old-8k-hevc',
      video.id,
      'bilibili',
      'bilibili-dash-qn-127',
      '8K',
      '4320p',
      7680,
      4320,
      null,
      'hev1.1.6.L180.90',
      'mp4',
      'video/mp4',
      'dash',
      'https://cdn.example/old-8k-hevc.m4s',
      '{}',
      0,
      0,
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      JSON.stringify({ provider: 'bilibili', resolver: 'bilibili-dash-video-v4', source: 'dash-video', requestedQn: 127, qn: 127, qualityRank: 8 }),
      timestamp,
      timestamp,
    );
    insertStream.run(
      'stream-old-720',
      video.id,
      'bilibili',
      'bilibili-qn-64',
      '720p',
      '720p',
      1280,
      720,
      null,
      'avc1.640028',
      'mp4',
      'video/mp4',
      'direct',
      'https://cdn.example/old-720.mp4',
      '{}',
      1,
      0,
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      JSON.stringify({ provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl', requestedQn: 127, qn: 64, qualityRank: 1 }),
      timestamp,
      timestamp,
    );

    const resolved = await service.resolveStreams(video.id);

    expect(provider.resolve).toHaveBeenCalled();
    expect(resolved.video).toMatchObject({
      playableInApp: true,
      qualityLabel: '8K',
      width: 7680,
      height: 4320,
      mediaUrl: `echo-mv://stream/${encodeURIComponent(video.id)}/bilibili-dash-qn-127-av1`,
    });
  });

  it('refreshes external-only stream cache when selecting a Bilibili search candidate', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1BD421J7w3',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'ツバサ',
      artist: '若山詩音',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1BD421J7w3',
      providerUrl: 'https://www.bilibili.com/video/BV1BD421J7w3',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 273,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://upos.example/tsubasa-720.mp4',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-progressive-mp4-v1',
            source: 'durl',
            requestedQn: 80,
            qn: 64,
            qualityRank: 1,
          },
        }),
      ]),
    };
    const { database, service, track } = createHarness([provider]);
    const [persisted] = await service.searchNetworkCandidates(track.id);
    const timestamp = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO track_video_streams (
          id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
          mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'stream-external-only',
        persisted.id,
        'bilibili',
        'bilibili:external',
        'Bilibili',
        'auto',
        null,
        null,
        null,
        null,
        null,
        null,
        'external',
        'https://www.bilibili.com/video/BV1BD421J7w3',
        '{}',
        0,
        0,
        null,
        null,
        timestamp,
        timestamp,
      );

    const selected = await service.selectVideo(track.id, persisted.id);

    expect(provider.resolve).toHaveBeenCalled();
    expect(selected).toMatchObject({
      playableInApp: true,
      mediaUrl: `echo-mv://stream/${encodeURIComponent(persisted.id)}/bilibili-qn-64`,
      qualityLabel: '720p',
      mimeType: 'video/mp4',
    });
  });

  it('retries a Bilibili search candidate once when the first selection resolve is external-only', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvAutoSearch: false };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1retry',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Retry MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1retry',
      providerUrl: 'https://www.bilibili.com/video/BV1retry',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const resolve = vi
      .fn<MainMvOnlineProvider['resolve']>()
      .mockResolvedValueOnce([makeExternalVariant(candidate.providerUrl ?? undefined)])
      .mockResolvedValueOnce([
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://upos.example/retry-720.mp4',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-progressive-mp4-v1',
            source: 'durl',
            requestedQn: 80,
            qn: 64,
            qualityRank: 1,
          },
        }),
      ]);
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve,
    };
    const { service, track } = createHarness([provider]);
    const [persisted] = await service.searchNetworkCandidates(track.id);

    const selected = await service.selectVideo(track.id, persisted.id);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(selected).toMatchObject({
      playableInApp: true,
      mediaUrl: `echo-mv://stream/${encodeURIComponent(persisted.id)}/bilibili-qn-64`,
      qualityLabel: '720p',
    });
  });

  it('auto-apply retries a Bilibili candidate once before giving up on external-only resolves', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1autoretry',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1autoretry',
      providerUrl: 'https://www.bilibili.com/video/BV1autoretry',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const resolve = vi
      .fn<MainMvOnlineProvider['resolve']>()
      .mockResolvedValueOnce([makeExternalVariant(candidate.providerUrl ?? undefined)])
      .mockResolvedValueOnce([
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://upos.example/auto-retry-720.mp4',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-progressive-mp4-v1',
            source: 'durl',
            requestedQn: 80,
            qn: 64,
            qualityRank: 1,
          },
        }),
      ]);
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve,
    };
    const { service, track } = createHarness([provider]);

    await service.searchNetworkCandidates(track.id);
    const selected = service.getSelectedVideo(track.id);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(selected).toMatchObject({
      sourceId: 'BV1autoretry',
      playableInApp: true,
      mediaUrl: expect.stringContaining('bilibili-qn-64'),
    });
  });

  it('does not expose stale Bilibili DASH cache snapshots as playable before refresh', () => {
    const { database, service, track } = createHarness();
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1staledash');
    const timestamp = new Date().toISOString();

    database
      .prepare(
        `UPDATE track_videos
         SET mime_type = ?, width = ?, height = ?, quality_label = ?, selected_quality_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run('video/mp4', 7680, 4320, '8K', 'auto', timestamp, video.id);
    database
      .prepare(
        `INSERT INTO track_video_streams (
          id, video_id, provider, variant_id, label, quality_tier, width, height, fps, codec, container,
          mime_type, protocol, url, headers_json, playable_in_app, requires_account, expires_at, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'stream-stale-dash',
        video.id,
        'bilibili',
        'bilibili-qn-127',
        '8K',
        '4320p',
        7680,
        4320,
        null,
        'avc1.640033',
        'mp4',
        'video/mp4',
        'direct',
        'https://cdn.example/stale-8k-video-only.m4s',
        '{}',
        1,
        0,
        new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        JSON.stringify({
          provider: 'bilibili',
          resolver: 'bilibili-dash-video-v4',
          source: 'dash-video',
          requestedQn: 127,
          qn: 127,
          qualityRank: 8,
        }),
        timestamp,
        timestamp,
      );

    expect(service.getSelectedVideo(track.id)).toMatchObject({
      playableInApp: false,
      mediaUrl: null,
      qualityLabel: null,
      mimeType: null,
      width: null,
      height: null,
    });
  });

  it('does not drop selected MV rows when resolveStreams cannot read video rows', async () => {
    const { database, service, track } = createHarness();
    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1preserve');
    const originalPrepare = database.prepare.bind(database);
    const prepareSpy = vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('FROM track_videos WHERE id')) {
        throw makeSqliteCorruptError();
      }

      return originalPrepare(sql) as never;
    }) as never);

    await expect(service.resolveStreams(video.id)).rejects.toThrow('MV database is temporarily unavailable');

    prepareSpy.mockRestore();
    expect(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM track_videos').get()?.count).toBe(1);
  });

  it('returns temporary playable MV streams without writing MV tables', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1temporary',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1temporary',
      providerUrl: 'https://www.bilibili.com/video/BV1temporary',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.96,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant({ url: 'https://cdn.example/temp.mp4' })]),
    };
    const { database, service, track } = createHarness([provider]);

    const video = await service.getTemporaryPlayableForSnapshot({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      durationSeconds: track.duration,
      mediaType: 'local',
      query: `${track.title} ${track.artist}`,
    });

    expect(video).toMatchObject({
      provider: 'bilibili',
      sourceType: 'stream',
      mediaUrl: expect.stringMatching(/^echo-mv:\/\/ephemeral\//u),
      playableInApp: true,
      temporary: true,
    });
    const token = video?.mediaUrl?.replace(/^echo-mv:\/\/ephemeral\//u, '') ?? '';
    expect(service.getTemporaryStreamVariantForProtocol(decodeURIComponent(token))).toMatchObject({
      url: 'https://cdn.example/temp.mp4',
      mimeType: 'video/mp4',
    });
    expect(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM track_videos').get()?.count).toBe(0);
    expect(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM track_video_streams').get()?.count).toBe(0);
  });

  it('uses the configured auto-apply threshold for network MV candidates', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1threshold',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1threshold',
      providerUrl: 'https://www.bilibili.com/video/BV1threshold',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.82,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);

    service.setSettings({ autoApplyThreshold: 0.85 });
    await service.searchNetworkCandidates(track.id);
    expect(service.getSelectedVideo(track.id)).toBeNull();

    service.setSettings({ autoApplyThreshold: 0.8 });
    await service.searchNetworkCandidates(track.id);
    expect(service.getSelectedVideo(track.id)).toMatchObject({
      provider: 'bilibili',
      score: 0.82,
      selected: true,
    });
  });

  it('auto applies the highest-view candidate with a direct title and artist query when enabled', async () => {
    const accurateCandidate: MvMatchCandidate = {
      id: 'bilibili:BV1accurate',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song Official MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1accurate',
      providerUrl: 'https://www.bilibili.com/video/BV1accurate',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.96,
      playableInApp: true,
      viewCount: 1200,
      reasons: ['Bilibili search'],
    };
    const popularCandidate: MvMatchCandidate = {
      ...accurateCandidate,
      id: 'bilibili:BV1popular',
      title: 'Echo Song Echo Artist Live',
      url: 'https://www.bilibili.com/video/BV1popular',
      providerUrl: 'https://www.bilibili.com/video/BV1popular',
      score: 0.42,
      viewCount: 250000,
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [accurateCandidate, popularCandidate]),
      resolve: vi.fn(async () => [makeResolvedVariant()]),
    };
    const { service, track } = createHarness([provider]);

    service.setSettings({ preferHighestViewCount: true });
    const candidates = await service.searchNetworkCandidates(track.id);

    expect(provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Echo Song', artist: 'Echo Artist' }),
      expect.objectContaining({ preferHighestViewCount: true }),
      'Echo Song Echo Artist',
    );
    expect(candidates[0]).toMatchObject({
      title: 'Echo Song Echo Artist Live',
      viewCount: 250000,
    });
    expect(service.getSelectedVideo(track.id)).toMatchObject({
      provider: 'bilibili',
      sourceId: 'BV1popular',
      score: 0.42,
      selected: true,
    });
  });

  it('returns echo-video mediaUrl only for playable local videos', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');

    const video = service.bindLocalVideo(track.id, videoPath);

    expect(video.mediaUrl).toBe(`echo-video://mv/${encodeURIComponent(video.id)}`);
    expect(video.playableInApp).toBe(true);
  });

  it('keeps non-browser-playable videos external only', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mkv');
    writeFileSync(videoPath, 'video');

    const video = service.bindLocalVideo(track.id, videoPath);

    expect(video.mediaUrl).toBeNull();
    expect(video.playableInApp).toBe(false);
  });

  it('handles missing selected files without crashing', () => {
    const { root, service, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mp4');
    writeFileSync(videoPath, 'video');
    service.bindLocalVideo(track.id, videoPath);
    rmSync(videoPath, { force: true });

    const selected = service.getSelectedVideo(track.id);

    expect(selected?.mediaUrl).toBeNull();
    expect(selected?.playableInApp).toBe(false);
  });

  it('openExternal calls shell.openPath for local videos', async () => {
    const { root, service, shellOpener, track } = createHarness();
    const videoPath = join(root, 'Echo Song.mkv');
    writeFileSync(videoPath, 'video');
    const video = service.bindLocalVideo(track.id, videoPath);

    await service.openVideoExternal(video.id);

    expect(shellOpener.openPath).toHaveBeenCalledWith(videoPath);
  });

  it('binds a custom Bilibili MV URL as the selected video', () => {
    const { service, track } = createHarness();

    const video = service.bindUrl(track.id, 'https://www.bilibili.com/video/BV1ECHO?p=1');

    expect(video).toMatchObject({
      provider: 'bilibili',
      sourceType: 'manual',
      sourceId: 'BV1ECHO',
      providerUrl: 'https://www.bilibili.com/video/BV1ECHO',
      selected: true,
    });
    expect(service.getSelectedVideo(track.id)?.id).toBe(video.id);
  });

  it('binds a raw Bilibili BV id as the selected video', () => {
    const { service, track } = createHarness();

    const video = service.bindUrl(track.id, 'BV1RAW');

    expect(video.provider).toBe('bilibili');
    expect(video.providerUrl).toBe('https://www.bilibili.com/video/BV1RAW');
    expect(video.selected).toBe(true);
  });

  it('binds a custom MV URL to a streaming track id without requiring a local library row', () => {
    const { service } = createHarness();
    const streamingTrackId = 'streaming:netease:1983779468';

    const video = service.bindUrl(streamingTrackId, 'https://www.bilibili.com/video/BV1STREAM');

    expect(video).toMatchObject({
      trackId: streamingTrackId,
      provider: 'bilibili',
      sourceType: 'manual',
      sourceId: 'BV1STREAM',
      providerUrl: 'https://www.bilibili.com/video/BV1STREAM',
      selected: true,
    });
    expect(service.getSelectedVideo(streamingTrackId)?.id).toBe(video.id);
  });

  it('binds a custom YouTube MV URL as an external video', async () => {
    const { service, shellOpener, track } = createHarness();

    const video = service.bindUrl(track.id, 'https://youtu.be/abc123');

    expect(video).toMatchObject({
      provider: 'youtube',
      sourceId: 'abc123',
      providerUrl: 'https://www.youtube.com/watch?v=abc123',
      selected: true,
      playableInApp: false,
    });

    await service.openVideoExternal(video.id);
    expect(shellOpener.openExternal).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc123');
  });

  it('searches, binds, resolves, and proxies a network MV candidate', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: 'https://i.example/echo.jpg',
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.7,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const variants: ResolvedMvStreamVariant[] = [
      {
        id: 'bilibili-qn-64',
        label: '720p',
        qualityTier: '720p',
        width: 1280,
        height: 720,
        fps: null,
        codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-720.mp4',
        headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
        rawProviderJson: null,
      },
      {
        id: 'bilibili-qn-80',
        label: '1080p',
        qualityTier: '1080p',
        width: 1920,
        height: 1080,
        fps: null,
        codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-1080.mp4',
        headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
        rawProviderJson: null,
      },
    ];
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => variants),
    };
    const { service, track } = createHarness([provider]);

    const candidates = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, candidates[0].id);
    const resolved = await service.resolveStreams(selected.id);

    expect(candidates[0]).toMatchObject({
      provider: 'bilibili',
      filePath: null,
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
    });
    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`);
    expect(resolved.video.qualityLabel).toBe('1080p');
    expect(resolved.variants).toHaveLength(2);

    const nextQuality = await service.setQuality(selected.id, 'bilibili-qn-64');
    expect(nextQuality.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-64`);
    expect(nextQuality.qualityLabel).toBe('720p');

    await expect(service.getStreamVariantForProtocol(selected.id, 'missing')).resolves.toBeNull();
    await expect(service.getStreamVariantForProtocol(selected.id, 'bilibili-qn-64')).resolves.toMatchObject({
      url: 'https://cdn.example/echo-720.mp4',
      headers: { Referer: 'https://www.bilibili.com/video/BV1echo' },
      mimeType: 'video/mp4',
    });
  });

  it('auto-selects Bilibili streams by qn rank before encoded height', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const variants: ResolvedMvStreamVariant[] = [
      {
        id: 'bilibili-qn-80',
        label: '1080p',
        qualityTier: '1080p',
        width: 1920,
        height: 1080,
        fps: null,
        codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-1080.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 116, qn: 80, qualityRank: 2 },
      },
      {
        id: 'bilibili-qn-116',
        label: '1080p 60fps',
        qualityTier: '1080p',
        width: 1920,
        height: 888,
        fps: 60,
        codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-1080-60.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 116, qn: 116, qualityRank: 4 },
      },
    ];
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => variants),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-116`);
    expect(resolved.video.qualityLabel).toBe('1080p 60fps');
    expect(resolved.video.height).toBe(888);
  });

  it('can select muted Bilibili DASH video-only streams above lower progressive MP4 fallbacks', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo8k',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song 8K MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo8k',
      providerUrl: 'https://www.bilibili.com/video/BV1echo8k',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-dash-qn-127-av1',
          label: '8K 60fps',
          qualityTier: '4320p',
          width: 7680,
          height: 4320,
          fps: 60,
          codec: 'av01.0.01M.10.0.110.01.01.01.0',
          protocol: 'direct',
          playableInApp: true,
          url: 'https://cdn.example/echo-8k-video-only.m4s',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-dash-video-v4',
            source: 'dash-video',
            qn: 127,
            qualityRank: 8,
            mutedVideoOnly: true,
          },
        }),
        makeResolvedVariant({
          id: 'bilibili-qn-64',
          label: '720p',
          qualityTier: '720p',
          width: 1280,
          height: 720,
          url: 'https://cdn.example/echo-720.mp4',
          rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl', qn: 64, qualityRank: 1 },
        }),
      ]),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-dash-qn-127-av1`);
    expect(resolved.video.qualityLabel).toBe('8K 60fps');
    await expect(service.getStreamVariantForProtocol(selected.id, 'bilibili-dash-qn-127-av1')).resolves.toMatchObject({
      url: 'https://cdn.example/echo-8k-video-only.m4s',
      mimeType: 'video/mp4',
    });
  });

  it('prefers progressive MP4 when a muted DASH video-only stream has the same Bilibili quality rank', async () => {
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo1080',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song 1080p MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo1080',
      providerUrl: 'https://www.bilibili.com/video/BV1echo1080',
      thumbnailUrl: null,
      uploader: 'Echo Channel',
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-dash-qn-80-avc',
          url: 'https://cdn.example/echo-1080-video-only.m4s',
          rawProviderJson: {
            provider: 'bilibili',
            resolver: 'bilibili-dash-video-v4',
            source: 'dash-video',
            qn: 80,
            qualityRank: 3,
            mutedVideoOnly: true,
          },
        }),
        makeResolvedVariant({
          id: 'bilibili-qn-80',
          url: 'https://cdn.example/echo-1080.mp4',
          rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl', qn: 80, qualityRank: 3 },
        }),
      ]),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`);
  });

  it('skips non-playable Bilibili HEVC variants and falls back to a playable AVC stream', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvMaxQuality: '2160p' };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => [
        makeResolvedVariant({
          id: 'bilibili-qn-120',
          label: '4K',
          qualityTier: '2160p',
          width: 3840,
          height: 2160,
          codec: 'hev1.1.6.L153.90',
          playableInApp: false,
          url: 'https://cdn.example/echo-4k-hevc.m4s',
          rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v4', qn: 120, qualityRank: 5 },
        }),
        makeResolvedVariant({
          id: 'bilibili-qn-80',
          label: '1080p',
          qualityTier: '1080p',
          width: 1920,
          height: 1080,
          codec: 'avc1.640032',
          playableInApp: true,
          url: 'https://cdn.example/echo-1080-avc.mp4',
          rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-progressive-mp4-v1', source: 'durl', qn: 80, qualityRank: 2 },
        }),
      ]),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);

    expect(selected.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-80`);
    expect(selected.qualityLabel).toBe('1080p');
    expect(selected.height).toBe(1080);
  });

  it('caps Bilibili auto quality at regular 4K when max quality is 2160p', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvMaxQuality: '2160p' };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const variants: ResolvedMvStreamVariant[] = [
      {
        id: 'bilibili-qn-126',
        label: 'Dolby Vision',
        qualityTier: '2160p',
        width: 3840,
        height: 2160,
        fps: null,
          codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-dolby.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 126, qn: 126, qualityRank: 7 },
      },
      {
        id: 'bilibili-qn-120',
        label: '4K',
        qualityTier: '2160p',
        width: 3840,
        height: 2160,
        fps: null,
          codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-4k.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 120, qn: 120, qualityRank: 5 },
      },
    ];
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => variants),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-120`);
    expect(resolved.video.qualityLabel).toBe('4K');
  });

  it('auto-selects 4K 120fps over regular 4K when both share the same Bilibili qn', async () => {
    appSettingsMock.current = { ...appSettingsMock.current, mvMaxQuality: '2160p', mvAllow60fps: true };
    const candidate: MvMatchCandidate = {
      id: 'bilibili:BV1echo',
      provider: 'bilibili',
      sourceType: 'search_candidate',
      title: 'Echo Song MV',
      artist: 'Echo Artist',
      filePath: null,
      url: 'https://www.bilibili.com/video/BV1echo',
      providerUrl: 'https://www.bilibili.com/video/BV1echo',
      thumbnailUrl: null,
      uploader: null,
      availableQualities: [],
      durationSeconds: 120,
      score: 0.9,
      playableInApp: true,
      reasons: ['Bilibili search'],
    };
    const variants: ResolvedMvStreamVariant[] = [
      {
        id: 'bilibili-qn-120',
        label: '4K 60fps',
        qualityTier: '2160p',
        width: 3840,
        height: 2160,
        fps: 60,
          codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-4k-60.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 120, qn: 120, qualityRank: 5 },
      },
      {
        id: 'bilibili-qn-120-120fps',
        label: '4K 120fps',
        qualityTier: '2160p',
        width: 3840,
        height: 2160,
        fps: 120,
          codec: 'avc1',
        container: 'mp4',
        mimeType: 'video/mp4',
        protocol: 'direct',
        playableInApp: true,
        requiresAccount: false,
        expiresAt: null,
        url: 'https://cdn.example/echo-4k-120.mp4',
        headers: {},
        rawProviderJson: { provider: 'bilibili', resolver: 'bilibili-dash-video-v3', requestedQn: 120, qn: 120, qualityRank: 5 },
      },
    ];
    const provider: MainMvOnlineProvider = {
      id: 'bilibili',
      search: vi.fn(async () => [candidate]),
      resolve: vi.fn(async () => variants),
    };
    const { service, track } = createHarness([provider]);

    const [resolvedCandidate] = await service.searchNetworkCandidates(track.id);
    const selected = await service.selectVideo(track.id, resolvedCandidate.id);
    const resolved = await service.resolveStreams(selected.id);

    expect(resolved.video.mediaUrl).toBe(`echo-mv://stream/${encodeURIComponent(selected.id)}/bilibili-qn-120-120fps`);
    expect(resolved.video.qualityLabel).toBe('4K 120fps');
    expect(resolved.video.fps).toBe(120);
  });
});
