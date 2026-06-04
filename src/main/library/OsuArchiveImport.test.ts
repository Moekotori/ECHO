import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importOsuArchiveAsMp3 } from './OsuArchiveImport';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-osu-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const writeArchive = (root: string, entries: Record<string, Uint8Array | string>): string => {
  const archivePath = join(root, 'beatmap.osz');
  const encodedEntries = Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, typeof data === 'string' ? new TextEncoder().encode(data) : data]),
  );
  writeFileSync(archivePath, Buffer.from(zipSync(encodedEntries)));
  return archivePath;
};

const makeSpawn = (onRun?: (args: string[]) => void) =>
  vi.fn((_command: string, args: string[]) => {
    const proc = new EventEmitter() as EventEmitter & { stderr: PassThrough };
    proc.stderr = new PassThrough();
    queueMicrotask(() => {
      onRun?.(args);
      writeFileSync(args[args.length - 1], Buffer.from([9, 8, 7, 6]));
      proc.emit('exit', 0, null);
    });
    return proc;
  });

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('OsuArchiveImport', () => {
  it('extracts an mp3 beatmap audio file with unicode tags and the mapped background cover', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'unicode.osu':
        '[General]\nAudioFilename: audio/main.mp3\n\n[Metadata]\nTitle: ASCII Title\nTitleUnicode: 曲名\nArtist: ASCII Artist\nArtistUnicode: アーティスト\nCreator: Mapper\nVersion: Hard\nBeatmapSetID: 2492872\n\n[Events]\n0,0,"images/bg image.png",0,0\n',
      'audio/main.mp3': new Uint8Array([1, 2, 3]),
      'images/bg image.png': new Uint8Array([255, 216, 1, 2]),
    });
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await importOsuArchiveAsMp3({
      archivePath,
      outputDirectory: root,
      dependencies: { writeEmbeddedTrackTags },
    });

    expect(result.outputPath).toMatch(/アーティスト - 曲名\.mp3$/u);
    expect([...readFileSync(result.outputPath)]).toEqual([1, 2, 3]);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: result.outputPath,
        coverData: {
          data: new Uint8Array([255, 216, 1, 2]),
          mimeType: 'image/png',
        },
        tags: expect.objectContaining({
          title: '曲名',
          artist: 'アーティスト',
          album: 'osu! beatmapset 2492872',
          albumArtist: 'アーティスト',
        }),
      }),
    );
  });

  it('prefers the quoted beatmap background over larger archive images', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'song.osu': '[General]\nAudioFilename: audio.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\n\n[Events]\n0,0,"cover folder/bg image.jpg",0,0\n',
      'audio.mp3': new Uint8Array([1]),
      'cover folder/bg image.jpg': new Uint8Array([7, 8]),
      'storyboard/huge.png': new Uint8Array([1, 2, 3, 4, 5, 6]),
    });
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    await importOsuArchiveAsMp3({
      archivePath,
      outputDirectory: root,
      dependencies: { writeEmbeddedTrackTags },
    });

    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(
      expect.objectContaining({
        coverData: {
          data: new Uint8Array([7, 8]),
          mimeType: 'image/jpeg',
        },
      }),
    );
  });

  it('falls back to the largest image when the beatmap event has no usable cover', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'song.osu': '[General]\nAudioFilename: audio.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\n',
      'audio.mp3': new Uint8Array([1]),
      'small.jpg': new Uint8Array([1, 2]),
      'large.webp': new Uint8Array([1, 2, 3, 4]),
    });
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    await importOsuArchiveAsMp3({
      archivePath,
      outputDirectory: root,
      dependencies: { writeEmbeddedTrackTags },
    });

    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(
      expect.objectContaining({
        coverData: {
          data: new Uint8Array([1, 2, 3, 4]),
          mimeType: 'image/webp',
        },
      }),
    );
  });

  it('converts non-mp3 beatmap audio to mp3 with ffmpeg', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'song.osu': '[General]\nAudioFilename: audio.ogg\n\n[Metadata]\nTitle: Song\nArtist: Artist\n',
      'audio.ogg': new Uint8Array([4, 5, 6]),
    });
    let ffmpegArgs: string[] = [];
    const spawn = makeSpawn((args) => {
      ffmpegArgs = args;
    });

    const result = await importOsuArchiveAsMp3({
      archivePath,
      outputDirectory: root,
      dependencies: {
        ffmpegToolchain: {
          path: 'ffmpeg-test',
          source: 'system',
          version: 'test',
          healthy: true,
          soxrAvailable: false,
          aresampleAvailable: true,
          buildConfiguration: null,
          manifestVersion: null,
          error: null,
        },
        spawn: spawn as never,
        writeEmbeddedTrackTags: vi.fn(async () => undefined),
      },
    });

    expect(result.outputPath).toMatch(/Artist - Song\.mp3$/u);
    expect([...readFileSync(result.outputPath)]).toEqual([9, 8, 7, 6]);
    expect(spawn).toHaveBeenCalledWith('ffmpeg-test', expect.arrayContaining(['-codec:a', 'libmp3lame', '-q:a', '0']), expect.any(Object));
    expect(ffmpegArgs[ffmpegArgs.length - 1]).toBe(result.outputPath);
  });

  it('fails clearly when an archive has no supported audio file', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'song.osu': '[Metadata]\nTitle: Song\nArtist: Artist\n',
      'bg.jpg': new Uint8Array([1, 2, 3]),
    });

    await expect(importOsuArchiveAsMp3({ archivePath, outputDirectory: root })).rejects.toThrow(
      'osu! archive does not contain a supported audio file',
    );
  });

  it('fails non-mp3 imports when ffmpeg is unavailable', async () => {
    const root = makeTempRoot();
    const archivePath = writeArchive(root, {
      'song.osu': '[General]\nAudioFilename: audio.ogg\n\n[Metadata]\nTitle: Song\nArtist: Artist\n',
      'audio.ogg': new Uint8Array([4, 5, 6]),
    });

    await expect(
      importOsuArchiveAsMp3({
        archivePath,
        outputDirectory: root,
        dependencies: {
          ffmpegToolchain: {
            path: 'ffmpeg-test',
            source: 'system',
            version: null,
            healthy: false,
            soxrAvailable: false,
            aresampleAvailable: false,
            buildConfiguration: null,
            manifestVersion: null,
            error: 'missing',
          },
        },
      }),
    ).rejects.toThrow('ffmpeg is not available for osu! audio conversion');
    expect(existsSync(join(root, 'Artist - Song.mp3'))).toBe(false);
  });
});
