import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LibraryFileDeleteItemResult, LibraryFileDeleteResult, LibraryTrack } from '../../shared/types/library';
import { isCueTrackPath, resolveCueTrack } from '../audio/CueSheet';

type ResolvedTrack = {
  track: LibraryTrack;
  physicalPath: string | null;
  cueSharedSource: boolean;
};

const physicalPathKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;

const resolveTrack = (track: LibraryTrack): ResolvedTrack => {
  if (!isCueTrackPath(track.path)) {
    return { track, physicalPath: resolve(track.path), cueSharedSource: false };
  }

  try {
    return { track, physicalPath: resolveCueTrack(track.path)?.audioPath ?? null, cueSharedSource: true };
  } catch {
    return { track, physicalPath: null, cueSharedSource: true };
  }
};

export const removeCueVirtualTrack = (track: LibraryTrack): LibraryFileDeleteResult => ({
  items: [{
    physicalPath: null,
    trackIds: [track.id],
    status: 'success',
    cueSharedSource: true,
    reason: 'cue-virtual-track-removed-source-preserved',
  }],
  removedTrackIds: [track.id],
});

export const deleteTrackPhysicalFiles = async (
  selectedTracks: LibraryTrack[],
  allLibraryTracks: LibraryTrack[],
  trashItem: (path: string) => Promise<void>,
): Promise<LibraryFileDeleteResult> => {
  const selected = selectedTracks.map(resolveTrack);
  const selectedIds = new Set(selectedTracks.map((track) => track.id));
  const allResolved = allLibraryTracks.map(resolveTrack);
  const groups = new Map<string, ResolvedTrack[]>();
  const items: LibraryFileDeleteItemResult[] = [];

  for (const item of selected) {
    if (!item.physicalPath) {
      items.push({
        physicalPath: null,
        trackIds: [item.track.id],
        status: 'unprocessed',
        cueSharedSource: item.cueSharedSource,
        reason: 'physical-source-unresolved',
      });
      continue;
    }
    const key = physicalPathKey(item.physicalPath);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  for (const group of groups.values()) {
    const physicalPath = group[0]!.physicalPath!;
    const trackIds = group.map((item) => item.track.id);
    const cueSharedSource = group.some((item) => item.cueSharedSource);
    const hasUnselectedCueReference = cueSharedSource && allResolved.some((item) =>
      item.cueSharedSource
      && item.physicalPath !== null
      && physicalPathKey(item.physicalPath) === physicalPathKey(physicalPath)
      && !selectedIds.has(item.track.id));

    if (hasUnselectedCueReference) {
      items.push({ physicalPath, trackIds, status: 'unprocessed', cueSharedSource, reason: 'cue-source-shared-with-unselected-tracks' });
      continue;
    }

    if (!existsSync(physicalPath)) {
      items.push({ physicalPath, trackIds, status: 'success', cueSharedSource, sourceMissing: true });
      continue;
    }

    try {
      await trashItem(physicalPath);
      items.push({ physicalPath, trackIds, status: 'success', cueSharedSource });
    } catch (error) {
      items.push({
        physicalPath,
        trackIds,
        status: 'failed',
        cueSharedSource,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    items,
    removedTrackIds: items.filter((item) => item.status === 'success').flatMap((item) => item.trackIds),
  };
};
