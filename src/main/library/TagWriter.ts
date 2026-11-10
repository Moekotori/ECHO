import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { EditableTrackTags } from './libraryTypes';

type EmbeddedCoverData = {
  data: Uint8Array;
  mimeType: string;
};

type FullTagWriteRequest = {
  filePath: string;
  kind?: 'full';
  tags: EditableTrackTags;
  coverData: EmbeddedCoverData | null;
};

type CoverArtWriteRequest = {
  filePath: string;
  kind: 'cover';
  coverData: EmbeddedCoverData;
};

type BpmWriteRequest = {
  filePath: string;
  kind: 'bpm';
  bpm: number;
};

type LyricsWriteRequest = {
  filePath: string;
  kind: 'lyrics';
  lyricsText: string;
};

type TagWriteRequest = FullTagWriteRequest | CoverArtWriteRequest | BpmWriteRequest | LyricsWriteRequest;

type TagWriteWorkerData = TagWriteRequest & {
  taglibWasmModuleUrl: string;
};

const require = createRequire(import.meta.url);
const taglibWasmModuleUrl = pathToFileURL(require.resolve('taglib-wasm')).href;

const workerSource = String.raw`
const { parentPort, workerData } = module['require']('node:worker_threads');

const id3v1Size = 128;
const hasId3v1Tag = (audio) => audio.length >= id3v1Size &&
  Buffer.from(audio.subarray(-id3v1Size, -id3v1Size + 3)).toString('latin1') === 'TAG';

(async () => {
  const { filePath, taglibWasmModuleUrl } = workerData;
  const [{ applyCoverArt, applyTagsToFile, TagLib }, fs] = await Promise.all([
    import(taglibWasmModuleUrl),
    import('node:fs/promises'),
  ]);

  if (workerData.kind === 'bpm') {
    await applyTagsToFile(filePath, {
      bpm: workerData.bpm,
    });
    parentPort.postMessage({ ok: true });
    return;
  }

  if (workerData.kind === 'lyrics') {
    const { constants } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const sourcePath = await fs.realpath(filePath);
    await fs.access(sourcePath, constants.W_OK);
    const original = await fs.stat(sourcePath, { bigint: true });
    const lyricsText = workerData.lyricsText;

    // The WASI writer does not persist the lyrics property. Edit and verify the
    // serialized tag in memory before replacing the source file.
    const taglib = await TagLib.initialize({ forceWasmType: 'emscripten' });
    const originalAudio = await fs.readFile(sourcePath);
    const file = await taglib.open(originalAudio);
    let updatedAudio;
    try {
      file.setProperty('LYRICS', lyricsText);
      if (!file.save()) {
        throw new Error('Could not save embedded lyrics');
      }
      updatedAudio = file.getFileBuffer();
      // TagLib may append an ID3v1 footer while saving MP3 lyrics to ID3v2.
      // Keep the original MPEG tail so gapless padding is interpreted as before.
      if (file.getFormat() === 'MP3' && !hasId3v1Tag(originalAudio) && hasId3v1Tag(updatedAudio) &&
          originalAudio.subarray(-id3v1Size).equals(updatedAudio.subarray(-2 * id3v1Size, -id3v1Size))) {
        updatedAudio = updatedAudio.subarray(0, -id3v1Size);
      }
    } finally {
      file.dispose();
    }
    const verifiedFile = await taglib.open(updatedAudio);
    try {
      if (verifiedFile.getProperty('LYRICS') !== lyricsText) {
        throw new Error('Could not verify embedded lyrics in the updated audio file');
      }
    } finally {
      verifiedFile.dispose();
    }

    const tempDirectory = await fs.mkdtemp(join(dirname(sourcePath), '.echo-lyrics-'));
    const tempPath = join(tempDirectory, 'audio.tmp');
    try {
      await fs.writeFile(tempPath, updatedAudio, { mode: Number(original.mode & 0o777n), flush: true });
      const current = await fs.stat(sourcePath, { bigint: true });
      if (current.ino !== original.ino || current.size !== original.size || current.ctimeNs !== original.ctimeNs) {
        throw new Error('Audio file changed while embedding lyrics');
      }
      await fs.rename(tempPath, sourcePath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      await fs.rmdir(tempDirectory).catch(() => undefined);
    }
    parentPort.postMessage({ ok: true });
    return;
  }

  if (workerData.kind === 'cover') {
    const updatedAudio = await applyCoverArt(filePath, new Uint8Array(workerData.coverData.data), workerData.coverData.mimeType);
    await fs.writeFile(filePath, Buffer.from(updatedAudio));
    parentPort.postMessage({ ok: true });
    return;
  }

  const { tags, coverData } = workerData;
  await applyTagsToFile(filePath, {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    albumArtist: tags.albumArtist,
    track: tags.trackNo ?? 0,
    discNumber: tags.discNo ?? 0,
    year: tags.year ?? 0,
    genre: tags.genre ?? '',
    bpm: tags.bpm ?? undefined,
    comment: tags.comment ?? undefined,
  });

  if (coverData) {
    const updatedAudio = await applyCoverArt(filePath, new Uint8Array(coverData.data), coverData.mimeType);
    await fs.writeFile(filePath, Buffer.from(updatedAudio));
  }

  parentPort.postMessage({ ok: true });
})().catch((error) => {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
});
`;

const tagWriteQueues = new Map<string, Promise<void>>();
let globalTagWriteQueue: Promise<void> = Promise.resolve();

export const hasPendingTagWrites = (): boolean => tagWriteQueues.size > 0;

export const writeEmbeddedTrackTags = async (request: FullTagWriteRequest): Promise<void> => {
  const previousWrite = tagWriteQueues.get(request.filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(() => enqueueGlobalTagWrite(request));
  const queuedWrite = nextWrite.finally(() => {
    if (tagWriteQueues.get(request.filePath) === queuedWrite) {
      tagWriteQueues.delete(request.filePath);
    }
  });

  tagWriteQueues.set(request.filePath, queuedWrite);
  void queuedWrite.catch(() => undefined);

  return nextWrite;
};

export const writeEmbeddedCoverArt = async (request: { filePath: string; coverData: EmbeddedCoverData }): Promise<void> => {
  const tagWriteRequest: CoverArtWriteRequest = {
    kind: 'cover',
    filePath: request.filePath,
    coverData: request.coverData,
  };
  const previousWrite = tagWriteQueues.get(request.filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(() => enqueueGlobalTagWrite(tagWriteRequest));
  const queuedWrite = nextWrite.finally(() => {
    if (tagWriteQueues.get(request.filePath) === queuedWrite) {
      tagWriteQueues.delete(request.filePath);
    }
  });

  tagWriteQueues.set(request.filePath, queuedWrite);
  void queuedWrite.catch(() => undefined);

  return nextWrite;
};

export const writeEmbeddedBpmTag = async (filePath: string, bpm: number): Promise<void> => {
  const roundedBpm = Math.round(bpm);
  if (!Number.isFinite(roundedBpm) || roundedBpm <= 0) {
    throw new Error('bpm must be a positive finite number');
  }

  const request: TagWriteRequest = {
    kind: 'bpm',
    filePath,
    bpm: roundedBpm,
  };
  const previousWrite = tagWriteQueues.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(() => enqueueGlobalTagWrite(request));
  const queuedWrite = nextWrite.finally(() => {
    if (tagWriteQueues.get(filePath) === queuedWrite) {
      tagWriteQueues.delete(filePath);
    }
  });

  tagWriteQueues.set(filePath, queuedWrite);
  void queuedWrite.catch(() => undefined);

  return nextWrite;
};

export const writeEmbeddedLyricsTag = async (filePath: string, lyricsText: string): Promise<void> => {
  const normalizedLyricsText = lyricsText.replace(/^\uFEFF/u, '').trim();
  if (!normalizedLyricsText) {
    throw new Error('lyricsText must be a non-empty string');
  }

  const request: TagWriteRequest = {
    kind: 'lyrics',
    filePath,
    lyricsText: normalizedLyricsText,
  };
  const previousWrite = tagWriteQueues.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(() => enqueueGlobalTagWrite(request));
  const queuedWrite = nextWrite.finally(() => {
    if (tagWriteQueues.get(filePath) === queuedWrite) {
      tagWriteQueues.delete(filePath);
    }
  });

  tagWriteQueues.set(filePath, queuedWrite);
  void queuedWrite.catch(() => undefined);

  return nextWrite;
};

const enqueueGlobalTagWrite = (request: TagWriteRequest): Promise<void> => {
  const nextWrite = globalTagWriteQueue.catch(() => undefined).then(() => runTagWriterWorker(request));
  globalTagWriteQueue = nextWrite;
  void globalTagWriteQueue.catch(() => undefined);
  return nextWrite;
};

const runTagWriterWorker = (request: TagWriteRequest): Promise<void> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        ...request,
        taglibWasmModuleUrl,
      } satisfies TagWriteWorkerData,
    });

    worker.once('message', (message: { ok: boolean; message?: string }) => {
      if (message.ok) {
        resolve();
      } else {
        reject(new Error(message.message ?? 'Unknown tag writer failure'));
      }
    });

    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Tag writer worker exited with code ${code}`));
      }
    });
  });
