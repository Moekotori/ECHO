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

  it('preserves an explicit INDEX 00 pregap without changing the playable INDEX 01 boundary', () => {
    const root = makeTempRoot();
    const cuePath = join(root, 'hidden-track.cue');
    const audioPath = join(root, 'hidden-track.flac');
    writeFileSync(audioPath, Buffer.from('audio'));
    writeFileSync(cuePath, [
      'FILE "hidden-track.flac" WAVE',
      '  TRACK 01 AUDIO',
      '    TITLE "Hidden Test"',
      '    INDEX 00 00:00:00',
      '    INDEX 01 00:42:00',
    ].join('\n'));

    expect(resolveCueTrack(createCueTrackPath(cuePath, 1))).toMatchObject({
      trackNumber: 1,
      pregapStartSeconds: 0,
      startSeconds: 42,
    });
  });
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('lossless rip CUE source resolution', () => {
  it('uses the only same-stem lossless file and preserves the CUE timeline', () => {
    const root = makeTempRoot();
    const audio = join(root, 'album.flac'); const cue = join(root, 'album.cue');
    writeFileSync(audio, 'fixture');
    writeFileSync(cue, 'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 02:34:00');
    const sheet = readCueSheet(cue);
    expect(sheet.tracks.map(track => track.audioPath)).toEqual([resolve(audio), resolve(audio)]);
    expect(sheet.tracks[0].endSeconds).toBe(154);
    expect(sheet.tracks[1].startSeconds).toBe(154);
    writeFileSync(join(root, 'album.ape'), 'fixture');
    expect(readCueSheet(cue).tracks).toEqual([]);
    const wave = join(root, 'album.wav'); writeFileSync(wave, 'fixture');
    expect(readCueSheet(cue).tracks.map(track => track.audioPath)).toEqual([resolve(wave), resolve(wave)]);
  });
});
