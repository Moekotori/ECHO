import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { LibraryAlbum, LibraryTrack } from '../../shared/types/library';
import type { CueTrack } from '../audio/CueSheet';
import { buildAlbumSplitBackupDir, buildAlbumSplitFfmpegArgs, buildAlbumSplitFileName, buildAlbumSplitOutputDir, sanitizeAlbumSplitFileName } from './AlbumSplitCommand';
import { AlbumSplitService } from './AlbumSplitService';
import type { AlbumSplitRequest } from '../../shared/types/albumSplit';

const album: LibraryAlbum = {
  id: 'album-1',
  albumKey: 'album-1',
  title: 'Live at Budokan',
  albumArtist: 'The Band',
  year: 1999,
  trackCount: 3,
  duration: 900,
  coverId: 'cover-1',
  coverThumb: null,
};

const cuePath = join('music', 'live', 'album.cue');
const audioPath = join('music', 'live', 'album.flac');
const coverPath = join('covers', 'cover-1.jpg');
const outputDir = buildAlbumSplitOutputDir(audioPath, album.title);
const backupDir = buildAlbumSplitBackupDir(audioPath, album.title);
const sourceBytes = 1024 * 1024 * 400;

const track = (id: string, trackNo: number, title: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  path: `${cuePath}#cueTrack=${trackNo}`,
  title,
  artist: 'The Band',
  album: album.title,
  albumArtist: album.albumArtist,
  trackNo,
  discNo: null,
  year: 1999,
  genre: 'Rock',
  duration: 300,
  codec: 'flac',
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: 900_000,
  coverId: 'cover-1',
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const cueTrack = (trackNumber: number, startSeconds: number, endSeconds: number | null): CueTrack => ({
  cuePath,
  audioPath,
  source: 'sidecar',
  trackNumber,
  title: null,
  performer: null,
  album: album.title,
  albumArtist: album.albumArtist,
  startSeconds,
  endSeconds,
});

const cueByPath: Record<string, CueTrack> = {
  [`${cuePath}#cueTrack=1`]: cueTrack(1, 0, 300),
  [`${cuePath}#cueTrack=2`]: cueTrack(2, 300, 600),
  [`${cuePath}#cueTrack=3`]: cueTrack(3, 600, null),
};

const request = (overrides: Partial<AlbumSplitRequest> = {}): AlbumSplitRequest => ({
  albumId: 'album-1',
  outputDir: '',
  format: 'flac',
  fileNamePattern: 'track-title',
  embedCover: true,
  importAfter: true,
  overwrite: false,
  backupConfirmed: true,
  ...overrides,
});

type FakeChild = EventEmitter & { stderr: EventEmitter & { setEncoding: () => void }; kill: () => void };

const createFakeSpawn = (exitCode = 0) => {
  const calls: Array<{ command: string; args: string[]; child: FakeChild }> = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stderr: Object.assign(new EventEmitter(), { setEncoding: () => undefined }),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      }),
    }) as FakeChild;
    calls.push({ command, args, child });
    if (exitCode !== -1) {
      queueMicrotask(() => child.emit('exit', exitCode, null));
    }
    return child;
  });
  return { spawn, calls };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const createService = (options: {
  tracks?: LibraryTrack[];
  spawn?: ReturnType<typeof createFakeSpawn>['spawn'];
  ffmpegHealthy?: boolean;
  existing?: Set<string>;
  sizes?: Map<string, number>;
  copyFile?: (from: string, to: string) => Promise<void>;
} = {}) => {
  const importAudioFiles = vi.fn().mockResolvedValue({ importedCount: 3, skippedCount: 0, failedCount: 0, trackIds: [], tracks: [] });
  const ensureDir = vi.fn();
  const copyFile: Mock<(from: string, to: string) => Promise<void>> = vi.fn(options.copyFile ?? (async () => undefined));
  const service = new AlbumSplitService({
    getAlbum: () => album,
    getAllAlbumTracks: () => options.tracks ?? [track('t1', 1, 'Opening'), track('t2', 2, 'Middle / Song'), track('t3', 3, 'Encore')],
    resolveCoverAsset: () => ({ filePath: coverPath, mimeType: 'image/jpeg' }),
    importAudioFiles,
    resolveCueTrack: (path) => cueByPath[path] ?? null,
    resolveFfmpeg: () => ({ healthy: options.ffmpegHealthy ?? true, path: 'ffmpeg', error: options.ffmpegHealthy === false ? 'missing' : null }),
    spawn: (options.spawn ?? createFakeSpawn().spawn) as never,
    fileExists: (path) => path === audioPath || path === coverPath || (options.existing?.has(path) ?? false),
    fileSize: (path) => options.sizes?.get(path) ?? sourceBytes,
    ensureDir,
    copyFile,
    now: () => new Date('2026-09-03T12:00:00.000Z'),
  });
  return { service, importAudioFiles, ensureDir, copyFile };
};

describe('AlbumSplitCommand', () => {
  it('sanitizes file names and pads track numbers to the album width', () => {
    expect(sanitizeAlbumSplitFileName('AC/DC: Live?')).toBe('AC-DC- Live-');
    expect(buildAlbumSplitFileName('track-title', 'flac', { trackNumber: 3, discNumber: null, title: 'Encore', artist: 'The Band' }, { trackTotal: 12 })).toBe('03 - Encore.flac');
    expect(buildAlbumSplitFileName('track-title', 'mp3', { trackNumber: 7, discNumber: null, title: 'Seven', artist: '' }, { trackTotal: 120 })).toBe('007 - Seven.mp3');
    expect(buildAlbumSplitFileName('track-artist-title', 'flac', { trackNumber: 1, discNumber: 2, title: 'A', artist: 'B' }, { multiDisc: true, trackTotal: 9 })).toBe('2-01 - B - A.flac');
    expect(buildAlbumSplitFileName('artist-title', 'ogg', { trackNumber: 1, discNumber: null, title: 'A', artist: 'B' })).toBe('B - A.ogg');
    expect(buildAlbumSplitFileName('title', 'wav', { trackNumber: 1, discNumber: null, title: '   ', artist: 'B' })).toBe('Track 1.wav');
  });

  it('builds a seeking, metadata-scrubbed ffmpeg command with an attached cover for flac', () => {
    const args = buildAlbumSplitFfmpegArgs({
      inputPath: audioPath,
      outputPath: join(outputDir, '02 - Middle.flac'),
      format: 'flac',
      startSeconds: 300,
      durationSeconds: 300,
      metadata: { title: 'Middle', artist: 'The Band', album: album.title, albumArtist: album.albumArtist, trackNumber: 2, trackTotal: 3, discNumber: null, year: 1999, genre: 'Rock' },
      cover: { path: coverPath, mimeType: 'image/jpeg' },
    });

    expect(args.slice(0, 8)).toEqual(['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-y', '-ss', '300.000']);
    expect(args).toContain('-map_metadata');
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1');
    expect(args).toEqual(expect.arrayContaining(['-metadata', 'title=Middle', '-metadata', 'track=2/3', '-codec:a', 'flac', '-disposition:v:0', 'attached_pic']));
    expect(args.at(-1)).toBe(join(outputDir, '02 - Middle.flac'));
  });

  it('drops the cover for wav and omits -t for the last track', () => {
    const args = buildAlbumSplitFfmpegArgs({
      inputPath: audioPath,
      outputPath: join(outputDir, '03 - Encore.wav'),
      format: 'wav',
      startSeconds: 600,
      durationSeconds: null,
      metadata: { title: 'Encore', artist: 'The Band', album: album.title, albumArtist: album.albumArtist, trackNumber: 3, trackTotal: 3, discNumber: null, year: null, genre: null },
      cover: { path: coverPath, mimeType: 'image/webp' },
    });

    expect(args).not.toContain('-t');
    expect(args).not.toContain('attached_pic');
    expect(args).toEqual(expect.arrayContaining(['-codec:a', 'pcm_s16le']));
  });
});

describe('AlbumSplitService', () => {
  it('plans one output per cue track and reports skipped non-cue tracks', () => {
    const { service } = createService({
      tracks: [track('t1', 1, 'Opening'), track('t2', 2, 'Middle'), track('single', 4, 'Bonus', { path: join('music', 'live', 'bonus.flac') })],
      existing: new Set([cuePath]),
    });

    const plan = service.plan('album-1', { format: 'mp3', fileNamePattern: 'track-artist-title' });

    expect(plan.tracks.map((entry) => entry.fileName)).toEqual(['01 - The Band - Opening.mp3', '02 - The Band - Middle.mp3']);
    expect(plan.tracks[0]).toMatchObject({ sourcePath: audioPath, startSeconds: 0, durationSeconds: 300 });
    expect(plan.skippedTracks).toEqual([{ trackId: 'single', title: 'Bonus', reason: 'not-cue' }]);
    expect(plan.sourceFiles).toEqual([{ path: audioPath, sizeBytes: sourceBytes, codec: 'flac' }]);
    expect(plan.backupFiles.map((file) => file.path)).toEqual([audioPath, cuePath]);
    expect(plan.suggestedOutputDir).toBe(outputDir);
    expect(plan.suggestedBackupDir).toBe(backupDir);
    expect(plan.ffmpegAvailable).toBe(true);
  });

  it('refuses to write anything until the backup is confirmed', () => {
    const { service, copyFile } = createService();
    expect(() => service.start(request({ backupConfirmed: false }))).toThrow(/备份/);
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('copies the image before encoding and imports the new files', async () => {
    const fake = createFakeSpawn(0);
    const { service, importAudioFiles, ensureDir, copyFile } = createService({ spawn: fake.spawn });

    const started = service.start(request());
    expect(['queued', 'backing-up', 'running']).toContain(started.status);

    await waitFor(() => service.getStatus(started.id)?.status === 'completed');
    const done = service.getStatus(started.id)!;

    expect(copyFile).toHaveBeenCalledWith(audioPath, join(backupDir, 'album.flac'));
    expect(copyFile.mock.invocationCallOrder[0]).toBeLessThan(fake.spawn.mock.invocationCallOrder[0]);
    expect(ensureDir).toHaveBeenCalledWith(backupDir);
    expect(ensureDir).toHaveBeenCalledWith(outputDir);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1].args).toEqual(expect.arrayContaining(['-ss', '300.000', '-metadata', 'title=Middle / Song']));
    expect(fake.calls[1].args.at(-1)).toBe(join(outputDir, '02 - Middle - Song.flac'));
    expect(done.backupCompleted).toBe(1);
    expect(done.completed).toBe(3);
    expect(importAudioFiles).toHaveBeenCalledWith([
      join(outputDir, '01 - Opening.flac'),
      join(outputDir, '02 - Middle - Song.flac'),
      join(outputDir, '03 - Encore.flac'),
    ]);
    expect(done.importedCount).toBe(3);
  });

  it('stops before ffmpeg when the backup copy fails', async () => {
    const fake = createFakeSpawn(0);
    const { service } = createService({
      spawn: fake.spawn,
      copyFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });

    const started = service.start(request({ importAfter: false }));
    await waitFor(() => service.getStatus(started.id)?.status === 'failed');

    expect(fake.calls).toHaveLength(0);
    expect(service.getStatus(started.id)?.error).toMatch(/disk full/);
  });

  it('stops before ffmpeg when an existing backup has different contents', async () => {
    const fake = createFakeSpawn(0);
    const backupPath = join(backupDir, 'album.flac');
    const { service, copyFile } = createService({
      spawn: fake.spawn,
      existing: new Set([backupPath]),
      sizes: new Map([[backupPath, 12]]),
    });

    const started = service.start(request({ importAfter: false }));
    await waitFor(() => service.getStatus(started.id)?.status === 'failed');

    expect(copyFile).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    expect(service.getStatus(started.id)?.error).toMatch(/不同内容/);
  });

  it('skips an identical backup copy and skips existing outputs unless overwrite is requested', async () => {
    const fake = createFakeSpawn(0);
    const backupPath = join(backupDir, 'album.flac');
    const existingOutput = join(outputDir, '01 - Opening.flac');
    const { service, copyFile } = createService({
      spawn: fake.spawn,
      existing: new Set([backupPath, existingOutput]),
    });

    const started = service.start(request({ embedCover: false, importAfter: false }));
    await waitFor(() => service.getStatus(started.id)?.status === 'completed');
    const done = service.getStatus(started.id)!;

    expect(copyFile).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(2);
    expect(done.outputs[0]).toMatchObject({ status: 'skipped' });
    expect(done.backupCompleted).toBe(1);
    expect(done.completed).toBe(2);
  });

  it('records ffmpeg failures per track and does not import when nothing succeeded', async () => {
    const fake = createFakeSpawn(1);
    const { service, importAudioFiles } = createService({ spawn: fake.spawn });

    const started = service.start(request({ outputDir: join('out'), format: 'mp3', fileNamePattern: 'title', embedCover: false, overwrite: true }));
    await waitFor(() => service.getStatus(started.id)?.status === 'failed');
    const done = service.getStatus(started.id)!;

    expect(done.failed).toBe(3);
    expect(done.outputs[0].error).toMatch(/FFmpeg exit 1/u);
    expect(importAudioFiles).not.toHaveBeenCalled();
  });

  it('cancels a running job by killing ffmpeg and keeps finished files', async () => {
    const fake = createFakeSpawn(-1);
    const { service } = createService({ spawn: fake.spawn });

    const started = service.start(request({ outputDir: join('out'), embedCover: false, importAfter: false, overwrite: true }));
    await waitFor(() => fake.calls.length === 1);
    fake.calls[0].child.emit('exit', 0, null);
    await waitFor(() => fake.calls.length === 2);

    service.cancel(started.id);
    await waitFor(() => service.getStatus(started.id)?.status === 'cancelled');
    const done = service.getStatus(started.id)!;

    expect(fake.calls[1].child.kill).toHaveBeenCalled();
    expect(done.completed).toBe(1);
    expect(done.outputs.map((output) => output.status)).toEqual(['done', 'pending', 'pending']);
  });

  it('refuses to start without ffmpeg or when nothing is splittable', () => {
    expect(() => createService({ ffmpegHealthy: false }).service.start(request())).toThrow(/FFmpeg/u);
    expect(() => createService({ tracks: [track('single', 1, 'Solo', { path: join('music', 'solo.flac') })] }).service.start(request()))
      .toThrow(/CUE/u);
  });
});
