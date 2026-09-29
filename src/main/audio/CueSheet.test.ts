import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCueTrackPath, readCueSheet, resolveCueTrack } from './CueSheet';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-cue-sheet-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const uint32Le = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const writeFlacWithCueSheet = (filePath: string, cueSheet: string): void => {
  const vendor = Buffer.from('ECHO Next', 'utf8');
  const comment = Buffer.from(`CUESHEET=${cueSheet}`, 'utf8');
  const vorbisComment = Buffer.concat([
    uint32Le(vendor.length),
    vendor,
    uint32Le(1),
    uint32Le(comment.length),
    comment,
  ]);
  const blockHeader = Buffer.alloc(4);
  blockHeader[0] = 0x80 | 4;
  blockHeader.writeUIntBE(vorbisComment.length, 1, 3);

  writeFileSync(filePath, Buffer.concat([Buffer.from('fLaC', 'ascii'), blockHeader, vorbisComment, Buffer.from('audio')]));
};

describe('CueSheet embedded CUESHEET support', () => {
  it('reads FLAC Vorbis-comment CUESHEET tags as virtual cue tracks', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'album.flac');
    writeFlacWithCueSheet(
      audioPath,
      [
        'PERFORMER "Album Artist"',
        'TITLE "Album Title"',
        'FILE "ignored-name.wav" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "First Song"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Second Song"',
        '    PERFORMER "Second Artist"',
        '    INDEX 01 02:34:00',
      ].join('\n'),
    );

    const sheet = readCueSheet(audioPath);

    expect(sheet.tracks).toHaveLength(2);
    expect(sheet.tracks[0]).toMatchObject({
      source: 'embedded',
      cuePath: resolve(audioPath),
      audioPath: resolve(audioPath),
      title: 'First Song',
      performer: null,
      album: 'Album Title',
      albumArtist: 'Album Artist',
      startSeconds: 0,
      endSeconds: 154,
    });
    expect(resolveCueTrack(createCueTrackPath(audioPath, 2))).toMatchObject({
      source: 'embedded',
      title: 'Second Song',
      performer: 'Second Artist',
      audioPath: resolve(audioPath),
      startSeconds: 154,
    });
  });
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
