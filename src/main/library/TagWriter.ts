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

(async () => {
  const { filePath, taglibWasmModuleUrl } = workerData;
  const [{ applyCoverArt, applyTagsToFile }, fs] = await Promise.all([
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
    await applyTagsToFile(filePath, {
      lyrics: workerData.lyricsText,
    });
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
