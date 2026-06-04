import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isLikelyDefaultArtistAvatarImage } from './ArtistImageDefaultAvatar';

const svgImage = (body: string): Uint8Array => Buffer.from(body, 'utf8');

describe('artist default avatar detection', () => {
  it('detects QQ Music default artist avatar artwork', async () => {
    const image = sharp(svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#ecf6ee"/><circle cx="256" cy="178" r="76" fill="#fde6ce"/><rect x="80" y="286" width="352" height="226" rx="176" fill="#92e4bb"/><rect x="228" y="326" width="56" height="116" rx="10" fill="#ffffff"/><rect x="216" y="354" width="80" height="12" rx="6" fill="#ffffff"/><rect x="216" y="382" width="80" height="12" rx="6" fill="#ffffff"/></svg>',
    ));

    await expect(isLikelyDefaultArtistAvatarImage(image)).resolves.toBe(true);
  });

  it('detects NetEase singer silhouette default artist artwork', async () => {
    const data = new Uint8Array(16 * 16 * 3).fill(74);
    const setPixel = (x: number, y: number, color: readonly [number, number, number]): void => {
      const offset = (y * 16 + x) * 3;
      data.set(color, offset);
    };

    [
      [1, 1, [69, 69, 69]],
      [8, 1, [74, 74, 74]],
      [14, 1, [69, 69, 69]],
      [3, 4, [101, 101, 101]],
      [8, 4, [83, 83, 83]],
      [12, 4, [103, 103, 103]],
      [4, 8, [105, 105, 105]],
      [8, 8, [38, 38, 38]],
      [12, 8, [97, 97, 97]],
      [3, 12, [52, 52, 52]],
      [8, 12, [30, 30, 30]],
      [12, 12, [51, 51, 51]],
      [8, 14, [19, 19, 19]],
    ].forEach(([x, y, color]) => setPixel(x as number, y as number, color as [number, number, number]));

    const image = sharp(data, { raw: { width: 16, height: 16, channels: 3 } });

    await expect(isLikelyDefaultArtistAvatarImage(image)).resolves.toBe(true);
  });

  it('detects light generic person placeholder artwork', async () => {
    const image = sharp(svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#eeedf3"/><circle cx="256" cy="176" r="54" fill="none" stroke="#bdbbc4" stroke-width="24"/><path d="M145 380c0-72 54-122 111-122s111 50 111 122v34H145z" fill="none" stroke="#bdbbc4" stroke-width="24" stroke-linejoin="round"/></svg>',
    ));

    await expect(isLikelyDefaultArtistAvatarImage(image)).resolves.toBe(true);
  });

  it('does not reject ordinary artist artwork', async () => {
    const image = sharp(svgImage(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#28364f"/><circle cx="170" cy="210" r="112" fill="#ddc7b7"/><circle cx="340" cy="210" r="112" fill="#947c70"/><rect x="72" y="312" width="368" height="148" rx="26" fill="#151a24"/></svg>',
    ));

    await expect(isLikelyDefaultArtistAvatarImage(image)).resolves.toBe(false);
  });
});
