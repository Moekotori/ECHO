import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeOsuFolderEmbeddedTags } from './OsuFolderImport';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-osu-folder-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('OsuFolderImport', () => {
  it('writes osu metadata and background cover to matching mp3 files only', async () => {
    const root = makeTempRoot();
    const setDir = join(root, '123 Artist - Song');
    mkdirSync(join(setDir, 'audio'), { recursive: true });
    mkdirSync(join(setDir, 'images'), { recursive: true });
    const audioPath = join(setDir, 'audio', 'song.mp3');
    const wavEffectPath = join(setDir, 'hitnormal.wav');
    const coverPath = join(setDir, 'images', 'bg.png');
    writeFileSync(audioPath, Buffer.from([1, 2, 3]));
    writeFileSync(wavEffectPath, Buffer.from([4, 5, 6]));
    writeFileSync(coverPath, Buffer.from([9, 8, 7]));
    writeFileSync(
      join(setDir, 'hard.osu'),
      '[General]\nAudioFilename: audio/song.mp3\n\n[Metadata]\nTitle: ASCII Title\nTitleUnicode: 曲名\nArtist: ASCII Artist\nArtistUnicode: アーティスト\nCreator: Mapper\nVersion: Hard\nBeatmapID: 5318008\nBeatmapSetID: 2492872\n\n[Events]\n0,0,"images/bg.png",0,0\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 1,
      matchedAudioFiles: 1,
      matchedAudioPaths: [audioPath],
      taggedFiles: 1,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).toHaveBeenCalledTimes(1);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith({
      filePath: audioPath,
      coverData: {
        data: new Uint8Array([9, 8, 7]),
        mimeType: 'image/png',
      },
      tags: expect.objectContaining({
        title: '曲名',
        artist: 'アーティスト',
        album: '',
        albumArtist: '',
        comment: 'beatmap id: 5318008',
      }),
    });
    expect(writeEmbeddedTrackTags).not.toHaveBeenCalledWith(expect.objectContaining({ filePath: wavEffectPath }));
  });

  it('writes BPM tags from osu timing points when tagging an extracted beatmap folder', async () => {
    const root = makeTempRoot();
    const setDir = join(root, '123 Artist - Song');
    mkdirSync(setDir, { recursive: true });
    const audioPath = join(setDir, 'song.mp3');
    writeFileSync(audioPath, Buffer.from([1, 2, 3]));
    writeFileSync(
      join(setDir, 'hard.osu'),
      '[General]\nAudioFilename: song.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\nBeatmapID: 5318008\nBeatmapSetID: 2492872\n\n[TimingPoints]\n1200,428.571428571,4,1,0,100,1,0\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 1,
      matchedAudioFiles: 1,
      matchedAudioPaths: [audioPath],
      taggedFiles: 1,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(expect.objectContaining({
      filePath: audioPath,
      tags: expect.objectContaining({
        bpm: 140,
      }),
    }));
  });

  it('ignores wav audio filenames and paths outside the beatmap folder', async () => {
    const root = makeTempRoot();
    const setDir = join(root, '456 Artist - Other Song');
    mkdirSync(setDir, { recursive: true });
    const outsideAudioPath = join(dirname(setDir), 'outside.mp3');
    writeFileSync(join(setDir, 'hitnormal.wav'), Buffer.from([1, 2, 3]));
    writeFileSync(outsideAudioPath, Buffer.from([4, 5, 6]));
    writeFileSync(
      join(setDir, 'wav.osu'),
      '[General]\nAudioFilename: hitnormal.wav\n\n[Metadata]\nTitle: Sound Effect\nArtist: Mapper\nBeatmapID: 11\nBeatmapSetID: 22\n',
      'utf8',
    );
    writeFileSync(
      join(setDir, 'outside.osu'),
      '[General]\nAudioFilename: ../outside.mp3\n\n[Metadata]\nTitle: Outside\nArtist: Mapper\nBeatmapID: 33\nBeatmapSetID: 44\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 2,
      matchedAudioFiles: 0,
      taggedFiles: 0,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).not.toHaveBeenCalled();
  });

  it('imports only one difficulty from each beatmap folder', async () => {
    const root = makeTempRoot();
    const setDir = join(root, '321 Artist - Multi Difficulty');
    mkdirSync(setDir, { recursive: true });
    const audioPath = join(setDir, 'song.mp3');
    writeFileSync(audioPath, Buffer.from([1, 2, 3]));
    writeFileSync(
      join(setDir, 'easy.osu'),
      '[General]\nAudioFilename: song.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\nBeatmapID: 100\nBeatmapSetID: 200\n',
      'utf8',
    );
    writeFileSync(
      join(setDir, 'hard.osu'),
      '[General]\nAudioFilename: song.mp3\n\n[Metadata]\nTitle: Song\nArtist: Artist\nBeatmapID: 101\nBeatmapSetID: 200\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 1,
      matchedAudioFiles: 1,
      matchedAudioPaths: [audioPath],
      taggedFiles: 1,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).toHaveBeenCalledTimes(1);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(expect.objectContaining({
      filePath: audioPath,
      tags: expect.objectContaining({
        comment: 'beatmap id: 100',
      }),
    }));
  });

  it('ignores osu rate-variant audio files', async () => {
    const root = makeTempRoot();
    const setDir = join(root, '789 Artist - Rate Variant');
    mkdirSync(setDir, { recursive: true });
    const rateVariantPath = join(setDir, 'song 1.2x.mp3');
    writeFileSync(rateVariantPath, Buffer.from([1, 2, 3]));
    writeFileSync(
      join(setDir, 'rate.osu'),
      '[General]\nAudioFilename: song 1.2x.mp3\n\n[Metadata]\nTitle: Rate Variant\nArtist: Mapper\nBeatmapID: 55\nBeatmapSetID: 66\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 1,
      matchedAudioFiles: 0,
      matchedAudioPaths: [],
      taggedFiles: 0,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).not.toHaveBeenCalled();
  });

  it('deduplicates repeated beatmapsets across beatmap folders', async () => {
    const root = makeTempRoot();
    const firstSetDir = join(root, '111 Artist - Repeated Song');
    const secondSetDir = join(root, '222 Artist - Repeated Song');
    mkdirSync(firstSetDir, { recursive: true });
    mkdirSync(secondSetDir, { recursive: true });
    const firstAudioPath = join(firstSetDir, 'song.mp3');
    const secondAudioPath = join(secondSetDir, 'song.mp3');
    writeFileSync(firstAudioPath, Buffer.from([1, 2, 3]));
    writeFileSync(secondAudioPath, Buffer.from([4, 5, 6]));
    writeFileSync(
      join(firstSetDir, 'first.osu'),
      '[General]\nAudioFilename: song.mp3\n\n[Metadata]\nTitle: Repeated Song\nArtist: Artist\nBeatmapID: 1000\nBeatmapSetID: 777\n',
      'utf8',
    );
    writeFileSync(
      join(secondSetDir, 'second.osu'),
      '[General]\nAudioFilename: song.mp3\n\n[Metadata]\nTitle: Repeated Song\nArtist: Artist\nBeatmapID: 1001\nBeatmapSetID: 777\n',
      'utf8',
    );
    const writeEmbeddedTrackTags = vi.fn(async () => undefined);

    const result = await writeOsuFolderEmbeddedTags(root, { writeEmbeddedTrackTags });

    expect(result).toMatchObject({
      metadataFiles: 2,
      matchedAudioFiles: 1,
      matchedAudioPaths: [firstAudioPath],
      taggedFiles: 1,
      failedTagWrites: 0,
    });
    expect(writeEmbeddedTrackTags).toHaveBeenCalledTimes(1);
    expect(writeEmbeddedTrackTags).toHaveBeenCalledWith(expect.objectContaining({ filePath: firstAudioPath }));
  });
});
