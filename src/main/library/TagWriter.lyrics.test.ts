import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import { TagLib } from 'taglib-wasm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeEmbeddedLyricsTag } from './TagWriter';

// RIFF/WAVE, mono 16-bit PCM at 8 kHz, with a single silent sample.
const wav = Buffer.from(
  '524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000',
  'hex',
);

// Five silent MPEG-1 Layer III frames with no trailing ID3v1 tag.
const mp3Frame = Buffer.alloc(208);
Buffer.from([0xff, 0xfb, 0x50, 0xc4]).copy(mp3Frame);
const mp3 = Buffer.concat(Array.from({ length: 5 }, () => mp3Frame));

describe('embedded lyrics file writes', () => {
  let tempDirectory: string;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'echo-tag-lyrics-'));
  });

  afterEach(async () => {
    await rm(join(tempDirectory, 'test.wav'), { force: true });
    await rm(join(tempDirectory, 'test.mp3'), { force: true });
    await rmdir(tempDirectory);
  });

  it('replaces existing lyrics with multiline Unicode text and preserves the title', async () => {
    const filePath = join(tempDirectory, 'test.wav');
    const taglib = await TagLib.initialize({ forceWasmType: 'emscripten' });
    const taggedWav = await taglib.edit(wav, (file) => {
      file.setProperty('TITLE', 'Keep this title');
      file.setProperty('LYRICS', 'Previous lyrics');
    });
    await writeFile(filePath, taggedWav);
    expect((await parseFile(filePath)).common.lyrics?.[0]?.text).toBe('Previous lyrics');

    const lyrics = '[00:00.00]夜の歌\n[00:00.01]第二行';
    await writeEmbeddedLyricsTag(filePath, lyrics);

    const { common } = await parseFile(filePath);
    expect(common.title).toBe('Keep this title');
    expect(common.lyrics?.map(({ text }) => text)).toEqual([lyrics]);
  });

  it('keeps the original MPEG data at the end of an ID3v2-only MP3', async () => {
    const filePath = join(tempDirectory, 'test.mp3');
    const taglib = await TagLib.initialize({ forceWasmType: 'emscripten' });
    const tagged = await taglib.edit(mp3, (file) => file.setProperty('TITLE', 'Keep this title'));
    // Create a source with a title in ID3v2 and no duplicate ID3v1 footer.
    const footer = Buffer.from(tagged.subarray(-128, -125)).toString('latin1');
    await writeFile(filePath, footer === 'TAG' ? tagged.subarray(0, -128) : tagged);

    await writeEmbeddedLyricsTag(filePath, 'New lyrics');

    expect((await readFile(filePath)).subarray(-mp3.length)).toEqual(mp3);
    const { common } = await parseFile(filePath);
    expect(common.title).toBe('Keep this title');
    expect(common.lyrics?.[0]?.text).toBe('New lyrics');
  });

  it('preserves the source when it cannot write an audio tag', async () => {
    const filePath = join(tempDirectory, 'test.wav');
    const invalidAudio = Buffer.from('Invalid audio');
    await writeFile(filePath, invalidAudio);

    await expect(writeEmbeddedLyricsTag(filePath, 'Lyrics')).rejects.toThrow();
    expect(await readFile(filePath)).toEqual(invalidAudio);
  });
});
