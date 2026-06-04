import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { MetadataResult } from '../libraryTypes';
import { TsCoverExtractor, defaultCoverSourceHash } from './TsCoverExtractor';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-cover-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const coverPng = async (background: string): Promise<Buffer> =>
  sharp({
    create: {
      width: 48,
      height: 36,
      channels: 3,
      background,
    },
  })
    .png()
    .toBuffer();

const gradientCoverPng = async (width = 1200, height = 900): Promise<Buffer> => {
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
    }
  }

  return sharp(pixels, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png()
    .toBuffer();
};

const hashBytes = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const metadataWithCover = (data?: Uint8Array): MetadataResult => ({
  fields: {
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: 1,
    codec: 'FLAC',
    sampleRate: 44100,
    bitDepth: 16,
    bitrate: 1000,
  },
  fieldSources: {},
  embeddedCover: data
    ? {
        data,
        mimeType: 'image/png',
      }
    : undefined,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: data ? 'present' : 'missing',
  warnings: [],
  errors: [],
  status: 'ok',
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // sharp may release Windows file handles just after metadata reads finish.
    }
  }
});

describe('TsCoverExtractor', () => {
  it('uses embedded cover before folder cover', async () => {
    const root = makeTempRoot();
    const musicRoot = join(root, 'music');
    const cacheRoot = join(root, 'cover-cache');
    mkdirSync(musicRoot, { recursive: true });
    const filePath = join(musicRoot, 'song.flac');
    const embedded = await coverPng('#ff0033');
    const folderCover = await coverPng('#0033ff');
    writeFileSync(filePath, 'fake audio');
    writeFileSync(join(musicRoot, 'cover.png'), folderCover);

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(embedded),
    });

    expect(result.source).toBe('embedded');
    expect(result.sourceHash).toBe(hashBytes(embedded));
  });

  it('uses folder cover when embedded cover is missing', async () => {
    const root = makeTempRoot();
    const musicRoot = join(root, 'music');
    const cacheRoot = join(root, 'cover-cache');
    mkdirSync(musicRoot, { recursive: true });
    const filePath = join(musicRoot, 'song.flac');
    const folderCover = await coverPng('#00aa55');
    writeFileSync(filePath, 'fake audio');
    writeFileSync(join(musicRoot, 'folder.png'), folderCover);

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(),
    });

    expect(result.source).toBe('folder');
    expect(result.sourceHash).toBe(hashBytes(folderCover));
  });

  it('finds common case-insensitive sidecar cover names for WAV folders', async () => {
    const root = makeTempRoot();
    const musicRoot = join(root, 'music');
    const cacheRoot = join(root, 'cover-cache');
    mkdirSync(musicRoot, { recursive: true });
    const filePath = join(musicRoot, 'song.wav');
    const folderCover = await coverPng('#55aaee');
    writeFileSync(filePath, 'fake audio');
    writeFileSync(join(musicRoot, 'AlbumArtSmall.JPG'), folderCover);

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(),
    });

    expect(result.source).toBe('folder');
    expect(result.sourceHash).toBe(hashBytes(folderCover));
  });

  it('uses same-name sidecar artwork after standard cover names', async () => {
    const root = makeTempRoot();
    const musicRoot = join(root, 'music');
    const cacheRoot = join(root, 'cover-cache');
    mkdirSync(musicRoot, { recursive: true });
    const filePath = join(musicRoot, 'song.wav');
    const sameNameCover = await coverPng('#aa55ee');
    writeFileSync(filePath, 'fake audio');
    writeFileSync(join(musicRoot, 'song.png'), sameNameCover);

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(),
    });

    expect(result.source).toBe('folder');
    expect(result.sourceHash).toBe(hashBytes(sameNameCover));
  });

  it('skips oversized embedded covers before sharp processes them', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'cover-cache');
    const filePath = join(root, 'song.flac');
    writeFileSync(filePath, 'fake audio');

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(Buffer.alloc(21 * 1024 * 1024)),
    });

    expect(result.source).toBe('default');
    expect(result.sourceHash).toBe(defaultCoverSourceHash);
    expect(result.warnings.join(' ')).toContain('embedded cover skipped');
  });

  it('uses a shared default SVG cache when no cover exists', async () => {
    const root = makeTempRoot();
    const musicRoot = join(root, 'music');
    const cacheRoot = join(root, 'cover-cache');
    mkdirSync(musicRoot, { recursive: true });
    const firstPath = join(musicRoot, 'first.flac');
    const secondPath = join(musicRoot, 'second.flac');
    writeFileSync(firstPath, 'fake audio');
    writeFileSync(secondPath, 'fake audio');
    const extractor = new TsCoverExtractor();

    const first = await extractor.extract(firstPath, { cacheRoot, metadata: metadataWithCover() });
    const second = await extractor.extract(secondPath, { cacheRoot, metadata: metadataWithCover() });

    expect(first.source).toBe('default');
    expect(first.sourceHash).toBe(defaultCoverSourceHash);
    expect(second.sourceHash).toBe(defaultCoverSourceHash);
    expect(second.thumbPath).toBe(first.thumbPath);
    expect(existsSync(first.thumbPath)).toBe(true);
  });

  it('generates real thumb, album, and large derivatives', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'cover-cache');
    const filePath = join(root, 'song.flac');
    const source = await gradientCoverPng();
    writeFileSync(filePath, 'fake audio');

    const result = await new TsCoverExtractor().extract(filePath, {
      cacheRoot,
      metadata: metadataWithCover(source),
    });
    const [thumb, album, large] = await Promise.all([
      sharp(result.thumbPath).metadata(),
      sharp(result.albumPath).metadata(),
      sharp(result.largePath).metadata(),
    ]);

    expect(thumb).toMatchObject({ format: 'webp', width: 96, height: 96 });
    expect(album).toMatchObject({ format: 'webp', width: 320, height: 320 });
    expect(large.format).toBe('webp');
    expect(Math.max(large.width ?? 0, large.height ?? 0)).toBeLessThanOrEqual(768);
    expect(new Set([result.thumbPath, result.albumPath, result.largePath]).size).toBe(3);
    expect(readFileSync(result.thumbPath).equals(source)).toBe(false);
    expect(readFileSync(result.albumPath).equals(source)).toBe(false);
    expect(readFileSync(result.largePath).equals(source)).toBe(false);
    expect(statSync(result.thumbPath).size).toBeLessThan(statSync(result.largePath).size);
    expect(statSync(result.albumPath).size).toBeLessThan(statSync(result.largePath).size);
    expect(statSync(result.thumbPath).size).toBeLessThan(statSync(result.originalRef).size);
  });

  it('reuses a complete current cache without rewriting derivatives', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'cover-cache');
    const filePath = join(root, 'song.flac');
    const source = await coverPng('#66aaff');
    const extractor = new TsCoverExtractor();
    writeFileSync(filePath, 'fake audio');

    const first = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });
    const mtimes = {
      thumb: statSync(first.thumbPath).mtimeMs,
      album: statSync(first.albumPath).mtimeMs,
      large: statSync(first.largePath).mtimeMs,
    };
    const second = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });

    expect(second.thumbPath).toBe(first.thumbPath);
    expect(dirname(second.thumbPath)).toBe(dirname(first.thumbPath));
    expect(statSync(first.thumbPath).mtimeMs).toBe(mtimes.thumb);
    expect(statSync(first.albumPath).mtimeMs).toBe(mtimes.album);
    expect(statSync(first.largePath).mtimeMs).toBe(mtimes.large);
  });

  it('rebuilds derivatives when cache metadata version or source hash is stale', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'cover-cache');
    const filePath = join(root, 'song.flac');
    const source = await gradientCoverPng(800, 600);
    const extractor = new TsCoverExtractor();
    writeFileSync(filePath, 'fake audio');

    const first = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });
    writeFileSync(first.thumbPath, 'not an image');
    writeFileSync(join(dirname(first.thumbPath), 'meta.json'), JSON.stringify({ version: -1, sourceHash: 'stale' }));

    const rebuilt = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });
    const thumb = await sharp(rebuilt.thumbPath).metadata();

    expect(rebuilt.thumbPath).toBe(first.thumbPath);
    expect(thumb).toMatchObject({ format: 'webp', width: 96, height: 96 });
  });

  it('repairs only a missing derivative from the existing cache', async () => {
    const root = makeTempRoot();
    const cacheRoot = join(root, 'cover-cache');
    const filePath = join(root, 'song.flac');
    const source = await coverPng('#8844ff');
    const extractor = new TsCoverExtractor();
    writeFileSync(filePath, 'fake audio');

    const first = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });
    const thumbMtime = statSync(first.thumbPath).mtimeMs;
    const largeMtime = statSync(first.largePath).mtimeMs;
    unlinkSync(first.albumPath);
    const repaired = await extractor.extract(filePath, { cacheRoot, metadata: metadataWithCover(source) });

    expect(existsSync(repaired.albumPath)).toBe(true);
    expect(statSync(repaired.thumbPath).mtimeMs).toBe(thumbMtime);
    expect(statSync(repaired.largePath).mtimeMs).toBe(largeMtime);
  });
});
