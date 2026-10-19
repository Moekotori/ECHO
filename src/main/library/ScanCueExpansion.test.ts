import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { expandScanCueTracks } from './ScanCueExpansion';
import { readScanCueAsync } from './ScanCueReader';
import type { LibraryFolder, MetadataFields, StoredTrackCoverState } from './libraryTypes';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('skips content probes for unchanged FLAC and preserves sidecar source dependencies', async () => {
  await mkdir('misc', { recursive: true });
  root = await mkdtemp(resolve('misc/scan-cue-expansion-'));
  const audio = join(root, 'album.flac');
  const cue = join(root, 'album.cue');
  await writeFile(audio, 'audio');
  const audioInfo = await stat(audio);
  const folder = { id: 'folder', path: root } as LibraryFolder;
  const file = { path: audio, folderId: folder.id, sizeBytes: audioInfo.size, mtimeMs: Math.round(audioInfo.mtimeMs) };
  const readCue = vi.fn(readScanCueAsync);
  const state: StoredTrackCoverState = { id: 'track', sizeBytes: file.sizeBytes, mtimeMs: file.mtimeMs,
    coverId: null, coverSource: null, sourceHash: null, mimeType: null, thumbPath: null,
    albumPath: null, largePath: null, originalRef: null, cacheVersion: null,
    scanMetadata: { fields: {} as MetadataFields, fieldSources: { cueDiscoveryV1: 'technical' },
      metadataStatus: 'ok', embeddedMetadataStatus: 'present', embeddedCoverStatus: 'missing' } };
  const context = { readCue, loadStates: async () => new Map([[audio, state]]),
    isLocal: async () => true, comparePath: (path: string) => path.toLowerCase(),
    isInsideFolder: () => true, throwIfCancelled: () => {} };
  expect(await expandScanCueTracks([file], folder, context)).toEqual([file]);
  expect(readCue).not.toHaveBeenCalled();
  await writeFile(cue, 'FILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00');
  const cueInfo = await stat(cue);
  const cueFile = { path: cue, folderId: folder.id, sizeBytes: cueInfo.size, mtimeMs: Math.round(cueInfo.mtimeMs) };
  const expanded = await expandScanCueTracks([file, cueFile], folder, context);
  expect(expanded.map(track => track.path)).toEqual([`${cue}#cueTrack=1`, `${cue}#cueTrack=2`]);
  expect(expanded[0]).toMatchObject({ physicalAudioPath: audio, physicalSizeBytes: audioInfo.size,
    sizeBytes: cueInfo.size + audioInfo.size, mtimeMs: Math.max(file.mtimeMs, cueFile.mtimeMs) });
  expect(expanded[0].cueTrack).toMatchObject({ startSeconds: 0, endSeconds: 60 });
  await expect(expandScanCueTracks([file], folder, { ...context,
    throwIfCancelled: () => { throw new Error('cancelled'); } })).rejects.toThrow('cancelled');
});

it('defers a broken sidecar album while continuing other folders and reporting protection', async () => {
  await mkdir('misc', { recursive: true }); root = await mkdtemp(resolve('misc/scan-cue-isolation-'));
  const bad = join(root, 'bad'); const good = join(root, 'good');
  await mkdir(bad); await mkdir(good);
  const cue = join(bad, 'album.cue'); const badAudio = join(bad, 'album.flac'); const goodAudio = join(good, 'song.flac');
  await writeFile(cue, Buffer.alloc(3 * 1024 * 1024)); await writeFile(badAudio, 'audio'); await writeFile(goodAudio, 'audio');
  const files = await Promise.all([cue, badAudio, goodAudio].map(async path => {
    const info = await stat(path); return { path, folderId: 'folder', sizeBytes: info.size, mtimeMs: Math.round(info.mtimeMs) };
  }));
  const issue = vi.fn();
  const expanded = await expandScanCueTracks(files, { id: 'folder', path: root } as LibraryFolder, {
    readCue: readScanCueAsync, loadStates: async () => new Map(), isLocal: async () => true,
    comparePath: path => path.toLowerCase(), isInsideFolder: () => true, throwIfCancelled: () => {}, onFileIssue: issue,
  });
  expect(expanded.map(file => file.path)).toEqual([goodAudio]);
  expect(issue).toHaveBeenCalledWith(cue, 'source_limit');
});

it('resolves a WAV-named sidecar to its unique FLAC source in the async scoped reader', async () => {
  await mkdir('misc', { recursive: true }); root = await mkdtemp(resolve('misc/cue-rip-source-'));
  const audio = join(root, 'album.flac'); const cue = join(root, 'album.cue');
  await writeFile(audio, 'audio');
  await writeFile(cue, 'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00');
  const result = await readScanCueAsync(cue, false, { rootPath: root });
  expect(result.issue).toBeUndefined();
  expect(result.tracks.map(track => track.audioPath)).toEqual([audio, audio]);
  expect(result.tracks[0].cueTrack?.endSeconds).toBe(60);
  await writeFile(join(root, 'album.ape'), 'audio');
  expect((await readScanCueAsync(cue, false, { rootPath: root })).issue).toBe('source_unreadable');
});


it('does not modify the CUE or audio while resolving sources and keeps references scoped to the selected root', async () => {
  await mkdir('misc', { recursive: true }); root = await mkdtemp(resolve('misc/cue-read-only-'));
  const selected = join(root, 'selected'); await mkdir(selected);
  const audio = join(selected, 'album.flac'); const cue = join(selected, 'album.cue');
  await writeFile(audio, 'original-media');
  const text = 'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00';
  await writeFile(cue, text);
  const before = await stat(audio);
  expect((await readScanCueAsync(cue, false, { rootPath: selected })).tracks).toHaveLength(2);
  expect(await readFile(audio, 'utf8')).toBe('original-media');
  expect((await stat(audio)).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(cue, 'utf8')).toBe(text);
  await writeFile(join(root, 'outside.flac'), 'outside');
  await writeFile(cue, 'FILE "../outside.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00');
  expect(await readScanCueAsync(cue, false, { rootPath: selected })).toMatchObject({ tracks: [], issue: 'source_unreadable' });
});

it('reports an empty sidecar as a discovery failure so existing tracks can be protected', async () => {
  await mkdir('misc', { recursive: true }); root = await mkdtemp(resolve('misc/cue-empty-'));
  const cue = join(root, 'album.cue'); await writeFile(cue, '');
  expect(await readScanCueAsync(cue, false, { rootPath: root })).toEqual({ tracks: [], issue: 'source_unreadable' });
});
