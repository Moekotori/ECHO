import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { SongCardRenderer } from './SongCardRenderer';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-song-card-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const makeCover = async (): Promise<Buffer> => {
  const size = 600;
  const pixels = Buffer.alloc(size * size * 3);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      pixels[offset] = x < size / 2 ? 235 : 32;
      pixels[offset + 1] = y < size / 2 ? 48 : 198;
      pixels[offset + 2] = x > y ? 64 : 226;
    }
  }

  return sharp(pixels, {
    raw: {
      width: size,
      height: size,
      channels: 3,
    },
  })
    .png()
    .toBuffer();
};

const track = {
  title: '星灯',
  artist: 'Suara',
  album: 'Music',
  coverId: 'cover-1',
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('SongCardRenderer', () => {
  it('renders a 1920x1080 png card from album art', async () => {
    const root = makeTempRoot();
    const coverPath = join(root, 'cover.png');
    writeFileSync(coverPath, await makeCover());

    const result = await new SongCardRenderer().render({
      track,
      coverPath,
      coverMimeType: 'image/png',
    });
    const metadata = await sharp(result.pngBuffer).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(result.suggestedFileName).toBe('星灯 - Suara.png');
  });

  it('uses the same cover image for foreground and nonblank background treatment', async () => {
    const root = makeTempRoot();
    const coverPath = join(root, 'cover.png');
    writeFileSync(coverPath, await makeCover());

    const result = await new SongCardRenderer().render({
      track,
      coverPath,
      coverMimeType: 'image/png',
    });
    const image = sharp(result.pngBuffer).ensureAlpha();
    const foregroundSample = (await image.clone().extract({ left: 220, top: 300, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3);
    const backgroundSample = (await image.clone().extract({ left: 1500, top: 160, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3);
    const cornerAlpha = (await image.clone().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())[3];

    expect(Math.max(...foregroundSample)).toBeGreaterThan(80);
    expect(Math.max(...backgroundSample)).toBeGreaterThan(10);
    expect(Buffer.compare(foregroundSample, backgroundSample)).not.toBe(0);
    expect(cornerAlpha).toBe(0);
  });

  it('renders visible song metadata over the background', async () => {
    const root = makeTempRoot();
    const coverPath = join(root, 'cover.png');
    writeFileSync(coverPath, await makeCover());

    const result = await new SongCardRenderer().render({
      track,
      coverPath,
      coverMimeType: 'image/png',
    });
    const textRegion = await sharp(result.pngBuffer)
      .extract({ left: 840, top: 230, width: 760, height: 470 })
      .removeAlpha()
      .raw()
      .toBuffer();
    let brightPixels = 0;

    for (let index = 0; index < textRegion.length; index += 3) {
      if (textRegion[index] > 160 && textRegion[index + 1] > 105 && textRegion[index + 2] > 150) {
        brightPixels += 1;
      }
    }

    expect(brightPixels).toBeGreaterThan(1_000);
  });

  it('renders a valid card with long metadata and no cover asset', async () => {
    const result = await new SongCardRenderer().render({
      track: {
        title: 'これはとても長いタイトルで、歌曲カードの右側に表示しても崩れない必要があります',
        artist: '非常に長いアーティスト名 / Very Long Artist Name',
        album: 'Extremely Long Album Name That Should Be Fitted Into The Song Card Surface',
        coverId: null,
      },
      coverPath: null,
      coverMimeType: null,
    });
    const metadata = await sharp(result.pngBuffer).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(result.pngBuffer.length).toBeGreaterThan(50_000);
  });
});
