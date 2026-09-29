import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseLocalAudioFileArguments, resolveLocalAudioFiles } from './localFileOpen';

const getTrackByPathMock = vi.fn();

vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => ({
    getTrackByPath: getTrackByPathMock,
  }),
}));

vi.mock('./windowManager', () => ({
  getMainWindow: () => null,
}));

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-local-open-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

describe('local file open helpers', () => {
  beforeEach(() => {
    getTrackByPathMock.mockReset();
  });

  it('parses argv as unique directly playable audio files only', () => {
    const root = makeTempRoot();
    const flac = join(root, 'song.flac');
    const wavPack = join(root, 'song.wv');
    const cue = join(root, 'song.cue');
    const sacdIso = join(root, 'album.iso');
    const jpg = join(root, 'cover.jpg');
    const folder = join(root, 'Album');
    mkdirSync(folder);
    writeFileSync(flac, 'not real audio');
    writeFileSync(wavPack, 'not real audio');
    writeFileSync(cue, 'FILE "song.flac" WAVE');
    writeFileSync(sacdIso, 'not audio for this phase');
    writeFileSync(jpg, 'image');

    expect(parseLocalAudioFileArguments(['--flag', flac, flac.toUpperCase(), wavPack, cue, sacdIso, jpg, folder, join(root, 'missing.mp3')])).toEqual([
      resolve(flac),
      resolve(wavPack),
      resolve(cue),
    ]);
  });

  it('reuses library tracks and creates temporary tracks for unknown files', async () => {
    const root = makeTempRoot();
    const libraryPath = join(root, 'library.flac');
    const temporaryPath = join(root, 'Temporary Song.opus');
    const unsupportedPath = join(root, 'cover.png');
    writeFileSync(libraryPath, 'not real audio');
    writeFileSync(temporaryPath, 'not real audio');
    writeFileSync(unsupportedPath, 'image');
    getTrackByPathMock.mockImplementation((path: string) =>
      path === resolve(libraryPath)
        ? {
            id: 'track-1',
            path,
            title: 'Library Song',
            artist: 'Artist',
            album: '',
            albumArtist: 'Artist',
            trackNo: null,
            discNo: null,
            year: null,
            genre: null,
            duration: 1,
            codec: 'FLAC',
            sampleRate: 44100,
            bitDepth: 16,
            bitrate: null,
            coverId: null,
            coverThumb: null,
            fieldSources: {},
          }
        : null,
    );

    const result = await resolveLocalAudioFiles([libraryPath, temporaryPath, unsupportedPath]);

    expect(result.rejected).toEqual([{ path: resolve(unsupportedPath), reason: 'unsupported' }]);
    expect(result.tracks[0]).toMatchObject({ id: 'track-1', title: 'Library Song' });
    expect(result.tracks[0]?.isTemporary).toBeUndefined();
    expect(result.tracks[1]).toMatchObject({
      id: expect.stringMatching(/^temporary-local:/),
      title: 'Temporary Song',
      isTemporary: true,
      path: resolve(temporaryPath),
    });
  });

  it('expands cue sheets into temporary cue track entries', async () => {
    const root = makeTempRoot();
    const flac = join(root, 'album.flac');
    const cue = join(root, 'album.cue');
    writeFileSync(flac, 'not real audio');
    writeFileSync(
      cue,
      [
        'PERFORMER "Album Artist"',
        'TITLE "Album Title"',
        'FILE "album.flac" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "First Song"',
        '    PERFORMER "First Artist"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Second Song"',
        '    INDEX 01 03:12:00',
      ].join('\n'),
    );

    const result = await resolveLocalAudioFiles([cue]);

    expect(result.rejected).toEqual([]);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({
      title: 'First Song',
      artist: 'First Artist',
      album: 'Album Title',
      path: `${resolve(cue)}#cueTrack=1`,
    });
    expect(result.tracks[1]).toMatchObject({
      title: 'Second Song',
      artist: 'Album Artist',
      trackNo: 2,
      path: `${resolve(cue)}#cueTrack=2`,
    });
  });

  it('expands embedded cue sheets from local audio files into temporary cue track entries', async () => {
    const root = makeTempRoot();
    const flac = join(root, 'album.flac');
    writeFlacWithCueSheet(
      flac,
      [
        'PERFORMER "Album Artist"',
        'TITLE "Album Title"',
        'FILE "ignored.wav" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "First Song"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Second Song"',
        '    INDEX 01 02:00:00',
      ].join('\n'),
    );

    const result = await resolveLocalAudioFiles([flac]);

    expect(result.rejected).toEqual([]);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({
      title: 'First Song',
      artist: 'Album Artist',
      path: `${resolve(flac)}#cueTrack=1`,
    });
    expect(result.tracks[1]).toMatchObject({
      title: 'Second Song',
      album: 'Album Title',
      trackNo: 2,
      path: `${resolve(flac)}#cueTrack=2`,
    });
  });
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
