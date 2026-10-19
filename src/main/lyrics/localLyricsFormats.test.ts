import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeKrcFileBytes } from './extendedLyricsFormats';
import { parseImportedLyrics } from './importedLyrics';
import { deserializeLyricLines, parseSyncedLyrics, serializeLyricLines } from './lyricsParser';
import { readCustomLyricsFile } from '../../renderer/components/lyrics/readCustomLyricsFile';

const krcFixture = (text: string): Uint8Array<ArrayBuffer> => {
  const key = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
  const compressed = deflateSync(text);
  return new Uint8Array([...Buffer.from('krc1'), ...compressed.map((byte, index) => byte ^ key[index % key.length])]);
};

describe('local lyrics format migration', () => {
  it.each([
    ['srt', '1\n00:00:01,000 --> 00:00:02,500\nHello <b>world</b>', 'Hello world'],
    ['vtt', 'WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nHello world', 'Hello world'],
    ['ass', '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\k25}Hello{\\kf25}world', 'Helloworld'],
    ['ssa', '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.50,Hello world', 'Hello world'],
    ['trc', '[00:01.00]<250>Hello<250>world', 'Helloworld'],
    ['snc', '⑩00000100⑿Hello world', 'Hello world'],
    ['qrc', '[1000,500]Hello(1000,250)world(1250,250)', 'Helloworld'],
    ['yrc', '[1000,500](1000,250,0)Hello(1250,250,0)world', 'Helloworld'],
  ])('parses %s through the production import and cache paths', (extension, text, expected) => {
    const { syncedLines } = parseImportedLyrics(text, `song.${extension}`);
    expect(syncedLines[0]).toMatchObject({ timeMs: 1000, text: expected });
    expect(deserializeLyricLines(serializeLyricLines(syncedLines))).toEqual(syncedLines);
  });

  it('preserves LRCX translations and character timings', () => {
    const lines = parseSyncedLyrics('[00:01.00]Hello\n[00:01.00][tr:zh]你好\n[00:01.00][tt]<0,0><250,2><500>');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ text: 'Hello', translation: '你好', words: [
      { text: 'He', startMs: 1000, endMs: 1250 }, { text: 'llo', startMs: 1250, endMs: 1500 },
    ] });
  });

  it('decodes KRC in both file readers and bounds expanded output', async () => {
    const text = '[1000,500]<0,250,0>Hello<250,250,0>world';
    const bytes = krcFixture(text);
    expect(Buffer.from(decodeKrcFileBytes(bytes, 4096)!).toString()).toBe(text);
    const decoded = await readCustomLyricsFile(new File([bytes], 'song.krc'));
    expect(parseImportedLyrics(decoded, 'song.krc').syncedLines[0].words).toHaveLength(2);
    expect(decodeKrcFileBytes(krcFixture('x'.repeat(4096)), 32)).toBeNull();
  });

  it('rejects damaged timed imports without treating format controls as plain lyrics', () => {
    for (const extension of ['srt', 'vtt', 'ass', 'krc', 'qrc', 'lrcx']) {
      expect(() => parseImportedLyrics('broken format', `song.${extension}`)).toThrow();
    }
    expect(parseImportedLyrics('Plain lyrics', 'song.txt').plainLines[0].text).toBe('Plain lyrics');
    expect(parseImportedLyrics('Legacy plain LRC', 'song.lrc').plainLines[0].text).toBe('Legacy plain LRC');
  });
});
