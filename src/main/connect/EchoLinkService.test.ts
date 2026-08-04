import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryAlbum, LibraryPage, LibraryTrack } from '../../shared/types/library';
import type { TrackLyrics } from '../../shared/types/lyrics';
import { EchoLinkService } from './EchoLinkService';

const makeAudioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'idle',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  sharedBackend: 'auto',
  activeDecodeBackendImpl: null,
  volume: 0.72,
  playbackRate: 1,
  playbackSpeedMode: 'speed',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...overrides,
});

const makeTrack = (patch: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  mediaType: 'local',
  path: 'song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 240,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...patch,
});

const makeAlbum = (patch: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id: 'album-1',
  mediaType: 'local',
  albumKey: 'album-key-1',
  title: 'Album',
  albumArtist: 'Artist',
  year: null,
  trackCount: 2,
  duration: 480,
  coverId: null,
  coverThumb: null,
  ...patch,
});

const makeLyrics = (patch: Partial<TrackLyrics> = {}): TrackLyrics => ({
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'local',
  kind: 'synced',
  title: 'Song A',
  artist: 'Artist',
  album: 'Album',
  durationSeconds: 240,
  lines: [{ timeMs: 1000, text: 'line one' }],
  plainText: null,
  syncedText: '[00:01.00]line one',
  offsetMs: 0,
  cachedAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
  ...patch,
});

class FakeAudioSession {
  status = makeAudioStatus();
  play = vi.fn(async () => {
    this.status = { ...this.status, state: 'playing' };
    return this.status;
  });
  pause = vi.fn(async () => {
    this.status = { ...this.status, state: 'paused' };
    return this.status;
  });
  stop = vi.fn(() => {
    this.status = { ...this.status, state: 'stopped', positionSeconds: 0 };
    return this.status;
  });
  seek = vi.fn(async (positionSeconds: number) => {
    this.status = { ...this.status, positionSeconds };
    return this.status;
  });
  setOutput = vi.fn(async ({ volume }: { volume?: number }) => {
    this.status = { ...this.status, volume: volume ?? this.status.volume };
    return this.status;
  });
  playLocalFile = vi.fn(async (request: { filePath: string; trackId?: string }) => {
    this.status = makeAudioStatus({
      state: 'playing',
      currentFilePath: request.filePath,
      currentTrackId: request.trackId ?? null,
      durationSeconds: 240,
    });
    return this.status;
  });
  getStatus = vi.fn(() => this.status);
}

class FakeLibraryService {
  constructor(private readonly tracks: LibraryTrack[], private readonly albums: LibraryAlbum[] = [makeAlbum()]) {}

  getTrack = vi.fn((trackId: string): LibraryTrack | null => this.tracks.find((track) => track.id === trackId) ?? null);

  getTracks = vi.fn((query = {}): LibraryPage<LibraryTrack> => {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Number(query.pageSize ?? 12));
    const search = typeof query.search === 'string' ? query.search.toLowerCase() : '';
    const filtered = search
      ? this.tracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(search))
      : this.tracks;
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + pageSize < filtered.length,
    };
  });

  getAlbums = vi.fn((query = {}): LibraryPage<LibraryAlbum> => {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Number(query.pageSize ?? 12));
    const search = typeof query.search === 'string' ? query.search.toLowerCase() : '';
    const filtered = search
      ? this.albums.filter((album) => `${album.title} ${album.albumArtist}`.toLowerCase().includes(search))
      : this.albums;
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + pageSize < filtered.length,
    };
  });

  getAlbum = vi.fn((albumId: string): LibraryAlbum | null => this.albums.find((album) => album.id === albumId) ?? null);

  getAlbumTracks = vi.fn((albumId: string, query = {}): LibraryPage<LibraryTrack> => {
    const album = this.getAlbum(albumId);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Number(query.pageSize ?? 12));
    const items = album ? this.tracks.filter((track) => track.album === album.title) : [];
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      total: items.length,
      page,
      pageSize,
      hasMore: offset + pageSize < items.length,
    };
  });

  resolveCoverAsset = vi.fn(() => null);
}

class FakeLyricsService {
  getLyricsForTrack = vi.fn(async (trackId: string): Promise<TrackLyrics | null> => (
    trackId === 'track-1' ? makeLyrics({ trackId }) : null
  ));
}

describe('EchoLinkService', () => {
  let tempRoot: string;
  let audioPath: string;
  let audioSession: FakeAudioSession;
  let libraryService: FakeLibraryService;
  let lyricsService: FakeLyricsService;
  let service: EchoLinkService;
  let dispatchPlaybackAction: ReturnType<typeof vi.fn<(action: 'nextTrack' | 'previousTrack') => void>>;
  let broadcastPlaybackQueueSession: ReturnType<typeof vi.fn<(session: unknown) => void>>;
  let mdnsStarts: unknown[];
  let now: number;

  const baseUrl = (): string => `http://127.0.0.1:${service.getServerStatus().port}`;
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${service.getServerStatus().token}`,
    'X-ECHO-Link-Version': '1',
  });

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'echo-link-'));
    audioPath = join(tempRoot, 'song.flac');
    writeFileSync(audioPath, Buffer.from('abcdef', 'utf8'));
    now = 1_780_000_000_000;
    audioSession = new FakeAudioSession();
    libraryService = new FakeLibraryService([
      makeTrack({ id: 'track-1', path: audioPath, title: 'Song A' }),
      makeTrack({ id: 'track-2', path: audioPath, title: 'Song B' }),
    ]);
    lyricsService = new FakeLyricsService();
    dispatchPlaybackAction = vi.fn();
    broadcastPlaybackQueueSession = vi.fn();
    mdnsStarts = [];
    service = new EchoLinkService({
      audioSession,
      libraryService,
      lyricsService,
      dispatchPlaybackAction,
      broadcastPlaybackQueueSession,
      getLanAddresses: () => ['127.0.0.1'],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement: unknown) => {
          mdnsStarts.push(advertisement);
        }),
        stop: vi.fn(async () => undefined),
      }),
      now: () => now,
      deviceId: 'pc-device-id',
      port: 0,
    });
    await service.setEnabled(true);
  });

  afterEach(async () => {
    await service.close();
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('rejects missing bearer auth on API endpoints', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, {
      headers: { 'X-ECHO-Link-Version': '1' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'unauthorized' });
  });

  it('returns Android status shape', async () => {
    audioSession.status = makeAudioStatus({
      state: 'playing',
      currentTrackId: 'track-1',
      currentFilePath: audioPath,
      positionSeconds: 42,
      durationSeconds: 240,
    });

    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      device: { id: 'pc-device-id', name: 'PC ECHO' },
      playback: {
        state: 'playing',
        positionMs: 42000,
        durationMs: 240000,
        volume: 0.72,
        outputMode: 'WASAPI Shared',
        track: {
          id: 'track-1',
          title: 'Song A',
          sourceLabel: 'Local Library',
          canPlayOnPhone: true,
        },
      },
    });
    expect(body.playback.track.artworkUrl).toContain('/echo-link/v1/artwork/');
    expect(body.playback.track.albumArtist).toBe('Artist');
  });

  it('prefers live audio metadata over the library preview for current playback', async () => {
    audioSession.status = makeAudioStatus({
      state: 'playing',
      currentTrackId: 'track-1',
      currentFilePath: audioPath,
      currentTrackTitle: 'Live Song',
      currentTrackArtist: 'Live Artist',
      currentTrackAlbum: 'Live Album',
      currentTrackAlbumArtist: 'Live Album Artist',
      currentTrackCoverUrl: 'https://example.test/live-cover.jpg',
      positionSeconds: 7,
      durationSeconds: 199,
    });

    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.playback).toMatchObject({
      positionMs: 7000,
      durationMs: 199000,
      track: {
        id: 'track-1',
        title: 'Live Song',
        artist: 'Live Artist',
        album: 'Live Album',
        albumArtist: 'Live Album Artist',
        artworkUrl: 'https://example.test/live-cover.jpg',
      },
    });
  });

  it('does not reuse stale library metadata when the audio file path has changed', async () => {
    const nextAudioPath = join(tempRoot, 'next-song.flac');
    writeFileSync(nextAudioPath, Buffer.from('ghijkl', 'utf8'));
    audioSession.status = makeAudioStatus({
      state: 'playing',
      currentTrackId: 'track-1',
      currentFilePath: nextAudioPath,
      durationSeconds: 88,
    });

    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.playback.track).toMatchObject({
      id: 'track-1',
      title: 'next-song.flac',
      artist: 'Unknown Artist',
      sourceLabel: 'Current Playback',
      artworkUrl: null,
      durationMs: 88000,
      canPlayOnPhone: true,
    });
  });

  it('serves the web control page through the Echo Link token URL', async () => {
    const status = service.getServerStatus();
    expect(status.webControlUrl).toContain('/echo-link/web?token=');

    const denied = await fetch(`${baseUrl()}/echo-link/web`);
    const response = await fetch(status.webControlUrl!);
    const body = await response.text();

    expect(denied.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('ECHO Web Control');
    expect(body).toContain('/echo-link/v1/library/albums');
    expect(body).toContain('/echo-link/v1/settings');
    expect(body).toContain('customBackground');
    expect(body).toContain("pageSize: '500'");
    expect(body).toContain("addEventListener('dblclick'");
    expect(body).toContain("addEventListener('pointerdown'");
    expect(body).toContain("addEventListener('wheel'");
    expect(body).toContain('requestAnimationFrame');
    expect(body).toContain('transition: none');
    expect(body).toContain('clearClickTimer');
    expect(body).toContain('handleAlbumTap');
    expect(body).toContain('albumFromPoint');
    expect(body).toContain('albumRequestId');
    expect(body).toContain('page <= 8');
    expect(body).toContain('pageSize = 500');
    expect(body).toContain("addEventListener('error'");
    expect(body).toContain('data-selected="true"');
    expect(body).toContain('data-busy="true"');
    expect(body).toContain('data-now="true"');
    expect(body).toContain("document.addEventListener('keydown'");
    expect(body).toContain("loading=\"lazy\"");
    expect(body).toContain('track-list');
    expect(body).toContain('track-row');
    expect(body).toContain('safeStartTrackId');
    expect(body).toContain('syncNowPlayingAlbum');
    expect(body).toContain('prefers-reduced-motion: reduce');
    expect(body).toContain('没有找到专辑');
    expect(body).toContain('}, 650)');
  });

  it('exposes custom web background settings for Album Sea', async () => {
    expect(service.getServerStatus().webBackground).toEqual({ type: 'none', url: '' });

    const nextStatus = service.setWebBackground({
      type: 'video',
      url: 'https://example.test/background.webm',
    });
    const response = await fetch(`${baseUrl()}/echo-link/v1/settings`, { headers: authHeaders() });
    const body = await response.json();

    expect(nextStatus.webBackground).toEqual({ type: 'video', url: 'https://example.test/background.webm' });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      webBackground: { type: 'video', url: 'https://example.test/background.webm' },
    });
    expect(() => service.setWebBackground({ type: 'image', url: 'ftp://example.test/bg.png' })).toThrow('background_url_must_be_http_or_data');
  });

  it('serves a local custom web background image through an internal URL', async () => {
    const imagePath = join(tempRoot, 'album-sea-bg.png');
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

    const nextStatus = service.setLocalWebBackgroundImage(imagePath);
    const settingsResponse = await fetch(`${baseUrl()}/echo-link/v1/settings`, { headers: authHeaders() });
    const settingsBody = await settingsResponse.json();
    const imageResponse = await fetch(`${baseUrl()}${nextStatus.webBackground.url}`);
    const imageBody = await imageResponse.arrayBuffer();

    expect(nextStatus.webBackground).toMatchObject({ type: 'image' });
    expect(nextStatus.webBackground.url).toMatch(/^\/echo-link\/v1\/background\/[A-Za-z0-9_-]+$/u);
    expect(settingsBody).toEqual({ webBackground: nextStatus.webBackground });
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get('content-type')).toContain('image/png');
    expect(imageBody.byteLength).toBe(6);

    service.setWebBackground(nextStatus.webBackground);
    await expect(fetch(`${baseUrl()}${nextStatus.webBackground.url}`)).resolves.toMatchObject({ status: 200 });
  });

  it('generates and rotates pairing tokens', () => {
    const before = service.getServerStatus();
    const rotated = service.rotateToken();

    expect(before.token).toEqual(expect.any(String));
    expect(rotated.token).toEqual(expect.any(String));
    expect(rotated.token).not.toBe(before.token);
    expect(rotated.pairingUri).toContain(`token=${encodeURIComponent(rotated.token)}`);
    expect(rotated.pairingUri).toContain('name=PC%20ECHO');
  });

  it('keeps library preview paged and cheap', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/library/tracks?page=1&pageSize=1&q=Song`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(libraryService.getTracks).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 1, search: 'Song' }));
    expect(body).toMatchObject({
      totalCount: 2,
      tracks: [expect.objectContaining({ id: 'track-1', durationMs: 240000 })],
    });
    expect(body.tracks).toHaveLength(1);
  });

  it('returns album wall previews and album tracks for web control', async () => {
    const albumsResponse = await fetch(`${baseUrl()}/echo-link/v1/library/albums?page=1&pageSize=12&sort=random`, {
      headers: authHeaders(),
    });
    const albumsBody = await albumsResponse.json();
    const tracksResponse = await fetch(`${baseUrl()}/echo-link/v1/library/albums/album-1/tracks?page=1&pageSize=200`, {
      headers: authHeaders(),
    });
    const tracksBody = await tracksResponse.json();

    expect(albumsResponse.status).toBe(200);
    expect(libraryService.getAlbums).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 12, sort: 'random' }));
    expect(albumsBody).toMatchObject({
      totalCount: 1,
      albums: [expect.objectContaining({ id: 'album-1', title: 'Album', trackCount: 2 })],
    });
    expect(tracksResponse.status).toBe(200);
    expect(libraryService.getAlbumTracks).toHaveBeenCalledWith('album-1', { page: 1, pageSize: 200 });
    expect(tracksBody).toMatchObject({
      album: expect.objectContaining({ id: 'album-1' }),
      tracks: [expect.objectContaining({ id: 'track-1' }), expect.objectContaining({ id: 'track-2' })],
    });
  });

  it('returns track lyrics for Android linked playback', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/library/tracks/track-1/lyrics`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lyricsService.getLyricsForTrack).toHaveBeenCalledWith('track-1');
    expect(body).toMatchObject({
      lyrics: '[00:01.00]line one',
      sourceLabel: 'PC ECHO',
      kind: 'synced',
    });
  });

  it('returns 404 when a track has no lyrics', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/library/tracks/track-2/lyrics`, {
      headers: authHeaders(),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'lyrics_not_found' });
  });

  it('dispatches playback commands through the audio session', async () => {
    const playResponse = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'playTrack', trackId: 'track-1', output: 'pc' }),
    });
    await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'seekTo', positionMs: 42000 }),
    });
    await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'setVolume', volume: 0.5 }),
    });

    expect(playResponse.status).toBe(200);
    expect(audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: audioPath, trackId: 'track-1' }));
    expect(audioSession.seek).toHaveBeenCalledWith(42);
    expect(audioSession.setOutput).toHaveBeenCalledWith({ volume: 0.5 });
  });

  it('broadcasts a desktop queue session when web playback starts', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'queueReplace', trackIds: ['track-1', 'track-2'], startTrackId: 'track-2', output: 'pc' }),
    });

    expect(response.status).toBe(200);
    expect(broadcastPlaybackQueueSession).toHaveBeenCalledWith(expect.objectContaining({
      currentTrackId: 'track-2',
      lastPlayedTrack: expect.objectContaining({ id: 'track-2' }),
      mode: expect.objectContaining({ isShuffleEnabled: false, repeatMode: 'off' }),
      resume: expect.objectContaining({ trackId: 'track-2', state: 'playing' }),
    }));
    const session = broadcastPlaybackQueueSession.mock.calls.at(-1)?.[0] as { items?: Array<{ track?: { id?: string } }> };
    expect(session.items?.map((item) => item.track?.id)).toEqual(['track-1', 'track-2']);
  });

  it('handles handoff with start position', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'handoff', trackId: 'track-2', positionMs: 42000, target: 'pc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-2', startSeconds: 42 }));
    expect(body.playback.queue).toMatchObject({
      currentTrackId: 'track-2',
      items: [expect.objectContaining({ id: 'track-2' })],
    });
  });

  it('handles queueReplace and advances within the ECHO Link queue', async () => {
    const response = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'queueReplace', trackIds: ['track-1', 'track-2'], startTrackId: 'track-1', output: 'pc' }),
    });
    const body = await response.json();
    await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'next' }),
    });

    expect(response.status).toBe(200);
    expect(body.playback.queue.items).toHaveLength(2);
    expect(audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-1' }));
    expect(audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-2' }));
    expect(dispatchPlaybackAction).not.toHaveBeenCalledWith('nextTrack');
  });

  it('syncs the ECHO Link queue pointer from the active audio status', async () => {
    await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'queueReplace', trackIds: ['track-1', 'track-2'], startTrackId: 'track-1', output: 'pc' }),
    });
    audioSession.status = makeAudioStatus({
      state: 'playing',
      currentTrackId: 'track-2',
      currentFilePath: audioPath,
      currentTrackTitle: 'Song B',
    });

    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.playback.track).toMatchObject({ id: 'track-2', title: 'Song B' });
    expect(body.playback.queue).toMatchObject({ currentTrackId: 'track-2' });
  });

  it('accepts large queueReplace bodies for big album playback', async () => {
    const largeTrackIds = Array.from({ length: 9000 }, () => 'track-1');
    const response = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'queueReplace', trackIds: largeTrackIds, startTrackId: 'track-1', output: 'pc' }),
    });

    expect(response.status).toBe(200);
    expect(audioSession.playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-1' }));
  });

  it('routes queue navigation commands through the existing playback action bus', async () => {
    const nextResponse = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'next' }),
    });
    const previousResponse = await fetch(`${baseUrl()}/echo-link/v1/playback/command`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'previous' }),
    });

    expect(nextResponse.status).toBe(200);
    expect(previousResponse.status).toBe(200);
    expect(dispatchPlaybackAction).toHaveBeenCalledWith('nextTrack');
    expect(dispatchPlaybackAction).toHaveBeenCalledWith('previousTrack');
  });

  it('creates temporary stream tokens with HTTP Range support', async () => {
    const streamResponse = await fetch(`${baseUrl()}/echo-link/v1/library/tracks/track-1/stream`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'phone' }),
    });
    const streamBody = await streamResponse.json();
    const rangeResponse = await fetch(streamBody.streamUrl, { headers: { Range: 'bytes=2-4' } });
    const rangeBody = await rangeResponse.text();

    expect(streamResponse.status).toBe(200);
    expect(streamBody.expiresAtEpochMs).toBe(now + 5 * 60 * 1000);
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(rangeResponse.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(rangeResponse.headers.get('content-type')).toContain('audio/flac');
    expect(rangeBody).toBe('cde');
  });

  it('expires temporary stream tokens', async () => {
    const stream = service.createStream('track-1', baseUrl());
    now += 5 * 60 * 1000 + 1;

    const response = await fetch(stream.streamUrl);

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain('media_token_expired_or_missing');
  });

  it('keeps manual server operation when mDNS advertising fails', async () => {
    await service.close();
    service = new EchoLinkService({
      audioSession,
      libraryService,
      lyricsService,
      dispatchPlaybackAction,
      getLanAddresses: () => ['127.0.0.1'],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async () => {
          throw new Error('mdns_failed');
        }),
        stop: vi.fn(async () => undefined),
      }),
      now: () => now,
      deviceId: 'pc-device-id',
      port: 0,
    });
    const status = await service.setEnabled(true);
    const response = await fetch(`${baseUrl()}/echo-link/v1/status`, { headers: authHeaders() });

    expect(status.running).toBe(true);
    expect(status.mdns).toMatchObject({ state: 'error' });
    expect(response.status).toBe(200);
  });

  it('starts mDNS advertisement without exposing the bearer token', async () => {
    expect(mdnsStarts).toHaveLength(1);
    expect(JSON.stringify(mdnsStarts[0])).toContain('pc-device-id');
    expect(JSON.stringify(mdnsStarts[0])).not.toContain(service.getServerStatus().token);
  });
});
