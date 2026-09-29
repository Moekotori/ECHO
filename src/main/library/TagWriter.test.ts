import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMockState = vi.hoisted(() => ({
  workers: [] as Array<{
    source: string;
    options: { eval?: boolean; workerData?: unknown };
    instance: EventEmitter;
  }>,
  autoComplete: true,
}));

vi.mock('node:worker_threads', () => ({
  Worker: class MockWorker extends EventEmitter {
    constructor(source: string, options: { eval?: boolean; workerData?: unknown }) {
      super();
      workerMockState.workers.push({ source, options, instance: this });
      if (workerMockState.autoComplete) {
        queueMicrotask(() => {
          this.emit('message', { ok: true });
          this.emit('exit', 0);
        });
      }
    }
  },
}));

const flushQueuedWrites = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

describe('writeEmbeddedTrackTags', () => {
  beforeEach(() => {
    workerMockState.workers.length = 0;
    workerMockState.autoComplete = true;
  });

  it('runs embedded tag writes in a worker', async () => {
    const { writeEmbeddedTrackTags } = await import('./TagWriter');

    await writeEmbeddedTrackTags({
      filePath: 'D:/Music/song.wav',
      tags: {
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album Artist',
        trackNo: 1,
        discNo: 1,
        year: 2026,
        genre: 'Pop',
      },
      coverData: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    });

    expect(workerMockState.workers).toHaveLength(1);
    expect(workerMockState.workers[0].options.eval).toBe(true);
    expect(workerMockState.workers[0].options.workerData).toMatchObject({
      filePath: 'D:/Music/song.wav',
      taglibWasmModuleUrl: expect.stringMatching(/^file:\/\//),
      tags: {
        title: 'Title',
        albumArtist: 'Album Artist',
      },
      coverData: {
        mimeType: 'image/png',
      },
    });
    expect(workerMockState.workers[0].source).toContain('applyTagsToFile');
    expect(workerMockState.workers[0].source).toContain('applyCoverArt');
    expect(workerMockState.workers[0].source).toContain('import(taglibWasmModuleUrl)');
    expect(workerMockState.workers[0].source).not.toContain("import('taglib-wasm')");
  });

  it('writes BPM-only tag updates through the same worker queue', async () => {
    const { writeEmbeddedBpmTag } = await import('./TagWriter');

    await writeEmbeddedBpmTag('D:/Music/song.wav', 127.6);

    expect(workerMockState.workers).toHaveLength(1);
    expect(workerMockState.workers[0].options.workerData).toMatchObject({
      kind: 'bpm',
      filePath: 'D:/Music/song.wav',
      bpm: 128,
      taglibWasmModuleUrl: expect.stringMatching(/^file:\/\//),
    });
    expect(workerMockState.workers[0].source).toContain("workerData.kind === 'bpm'");
    expect(workerMockState.workers[0].source).toContain('applyTagsToFile');
  });

  it('writes lyrics-only tag updates through the same worker queue', async () => {
    const { writeEmbeddedLyricsTag } = await import('./TagWriter');

    await writeEmbeddedLyricsTag('D:/Music/song.wav', '[00:01.00]Line');

    expect(workerMockState.workers).toHaveLength(1);
    expect(workerMockState.workers[0].options.workerData).toMatchObject({
      kind: 'lyrics',
      filePath: 'D:/Music/song.wav',
      lyricsText: '[00:01.00]Line',
      taglibWasmModuleUrl: expect.stringMatching(/^file:\/\//),
    });
    expect(workerMockState.workers[0].source).toContain("workerData.kind === 'lyrics'");
    expect(workerMockState.workers[0].source).toContain('lyrics: workerData.lyricsText');
  });

  it('writes cover-only updates without rewriting other tags', async () => {
    const { writeEmbeddedCoverArt } = await import('./TagWriter');

    await writeEmbeddedCoverArt({
      filePath: 'D:/Music/song.wav',
      coverData: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' },
    });

    expect(workerMockState.workers).toHaveLength(1);
    expect(workerMockState.workers[0].options.workerData).toMatchObject({
      kind: 'cover',
      filePath: 'D:/Music/song.wav',
      coverData: {
        mimeType: 'image/jpeg',
      },
      taglibWasmModuleUrl: expect.stringMatching(/^file:\/\//),
    });
    expect(workerMockState.workers[0].source).toContain("workerData.kind === 'cover'");
    expect(workerMockState.workers[0].source).toContain('applyCoverArt');
    expect(workerMockState.workers[0].source).toContain('fs.writeFile');
  });

  it('serializes embedded tag writes globally', async () => {
    workerMockState.autoComplete = false;
    const { writeEmbeddedTrackTags } = await import('./TagWriter');

    const firstWrite = writeEmbeddedTrackTags({
      filePath: 'D:/Music/song-1.wav',
      tags: {
        title: 'One',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album Artist',
        trackNo: 1,
        discNo: 1,
        year: 2026,
        genre: 'Pop',
      },
      coverData: null,
    });
    const secondWrite = writeEmbeddedTrackTags({
      filePath: 'D:/Music/song-2.wav',
      tags: {
        title: 'Two',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album Artist',
        trackNo: 2,
        discNo: 1,
        year: 2026,
        genre: 'Pop',
      },
      coverData: null,
    });

    await flushQueuedWrites();

    expect(workerMockState.workers).toHaveLength(1);

    workerMockState.workers[0].instance.emit('message', { ok: true });
    workerMockState.workers[0].instance.emit('exit', 0);
    await firstWrite;
    await flushQueuedWrites();

    expect(workerMockState.workers).toHaveLength(2);

    workerMockState.workers[1].instance.emit('message', { ok: true });
    workerMockState.workers[1].instance.emit('exit', 0);
    await secondWrite;
  });
});
