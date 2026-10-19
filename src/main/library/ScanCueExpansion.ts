import { dirname, extname, resolve } from 'node:path';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import type { ScanCueFileIssue } from './ScanCueFileIssue';
import { createCueTrackPath } from '../audio/CueSheet';
import { isEmbeddedCueSource, type ScanCueReader } from './ScanCueReader';
import type { LibraryFolder, ScannedAudioFile, StoredTrackCoverState } from './libraryTypes';

type CueExpansionContext = {
  readCue: ScanCueReader;
  loadStates: (files: ScannedAudioFile[]) => Promise<Map<string, StoredTrackCoverState>>;
  isLocal: (path: string) => Promise<boolean>;
  comparePath: (path: string) => string;
  isInsideFolder: (path: string) => boolean;
  isEligibleSource?: (path: string) => boolean;
  throwIfCancelled: () => void;
  onFileIssue?: (path: string, issue: ScanCueFileIssue) => void;
  onExcludedSource?: (cuePath: string) => void;
};

/** Discovery composes small Core replies; unchanged physical FLAC tracks need no content probe. */
export async function expandScanCueTracks(
  files: ScannedAudioFile[], folder: LibraryFolder, context: CueExpansionContext,
): Promise<ScannedAudioFile[]> {
  const deferredSidecarDirectories = new Set<string>();
  const deferred = (path: string): boolean => deferredSidecarDirectories.has(context.comparePath(dirname(resolve(path))));
  const readOptions = { rootPath: folder.path };
  const sidecarTracks = new Map<string, ScannedAudioFile[]>();
  const suppressedAudioPaths = new Set<string>();
  for (const file of files) {
    if (extname(file.path).toLowerCase() !== '.cue' || deferred(file.path)) continue;
    context.throwIfCancelled();
    if (!await context.isLocal(file.path)) continue;
    const cue = await context.readCue(file.path, false, readOptions);
    context.throwIfCancelled();
    if (cue.issue) {
      // Unknown sidecar membership must not turn virtual tracks into missing tracks or add
      // duplicate whole-album files. Defer this album directory, continue other directories.
      deferredSidecarDirectories.add(context.comparePath(dirname(resolve(file.path))));
      context.onFileIssue?.(file.path, cue.issue);
      continue;
    }
    const tracks = cue.tracks.filter(track => context.isInsideFolder(track.audioPath));
    if (tracks.length <= 1) continue;
    const eligibleTracks = tracks.filter(track => {
      if (context.isEligibleSource?.(track.audioPath) ?? true) return true;
      context.onExcludedSource?.(file.path);
      return false;
    });
    sidecarTracks.set(resolve(file.path), eligibleTracks.map(track => ({
      path: createCueTrackPath(file.path, track.trackNumber), folderId: folder.id,
      physicalAudioPath: track.audioPath, physicalSizeBytes: track.sizeBytes, physicalMtimeMs: track.mtimeMs,
      ...(track.cueTrack ? { cueTrack: track.cueTrack } : {}),
      sizeBytes: file.sizeBytes + track.sizeBytes,
      mtimeMs: Math.max(file.mtimeMs, track.mtimeMs),
    })));
    for (const track of tracks) suppressedAudioPaths.add(context.comparePath(resolve(track.audioPath)));
    await yieldToMainLoop();
  }

  const expanded: ScannedAudioFile[] = [];
  for (let offset = 0; offset < files.length; offset += 400) {
    context.throwIfCancelled();
    const batch = files.slice(offset, offset + 400);
    const candidates = batch.filter(file => !deferred(file.path) && isEmbeddedCueSource(file.path)
      && !suppressedAudioPaths.has(context.comparePath(resolve(file.path))));
    const states = candidates.length ? await context.loadStates(candidates) : new Map<string, StoredTrackCoverState>();
    const byPath = new Map(Array.from(states, ([path, state]) => [context.comparePath(resolve(path)), state]));
    const reusable = (file: ScannedAudioFile): boolean => {
      const state = byPath.get(context.comparePath(resolve(file.path)));
      return !!state && state.sizeBytes === file.sizeBytes && state.mtimeMs === file.mtimeMs
        && state.scanMetadata?.fieldSources.cueDiscoveryV1 === 'technical';
    };
    for (let blockOffset = 0; blockOffset < batch.length; blockOffset += 16) {
      const block = batch.slice(blockOffset, blockOffset + 16);
      const localProbes: ScannedAudioFile[] = [];
      for (const file of block) {
        context.throwIfCancelled();
        if (!deferred(file.path) && isEmbeddedCueSource(file.path) && !reusable(file)
          && !suppressedAudioPaths.has(context.comparePath(resolve(file.path))) && await context.isLocal(file.path))
          localProbes.push(file);
      }
      let results;
      if (context.readCue.readBatch) results = await context.readCue.readBatch(
        localProbes.map(file => ({ filePath: file.path, embedded: true })), readOptions);
      else {
        results = [];
        for (const file of localProbes) results.push(await context.readCue(file.path, true, readOptions));
      }
      context.throwIfCancelled();
      const cueResults = new Map(localProbes.map((file, index) => [file.path, results[index]]));
      for (const file of block) {
        context.throwIfCancelled();
        const path = resolve(file.path);
        if (deferred(path)) continue;
        const sidecar = sidecarTracks.get(path);
        if (sidecar) { for (const track of sidecar) expanded.push(track); continue; }
        if (extname(path).toLowerCase() === '.cue' || suppressedAudioPaths.has(context.comparePath(path))) continue;
        const cue = cueResults.get(file.path);
        if (!cue) { expanded.push(file); continue; }
        if (cue.issue) { context.onFileIssue?.(file.path, cue.issue); continue; }
        if (cue.tracks.length <= 1) expanded.push({ ...file, cueDiscoveryComplete: true });
        else for (const track of cue.tracks) expanded.push({ ...file,
          path: createCueTrackPath(path, track.trackNumber), physicalAudioPath: path,
          ...(track.cueTrack ? { cueTrack: track.cueTrack } : {}) });
      }
      await yieldToMainLoop();
    }
  }
  return expanded;
}
