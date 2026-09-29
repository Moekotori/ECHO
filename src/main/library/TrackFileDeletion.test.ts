import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { createCueTrackPath } from '../audio/CueSheet';
import { deleteTrackPhysicalFiles, removeCueVirtualTrack } from './TrackFileDeletion';

const roots: string[] = [];
const makeRoot = (): string => {
  const root = join(tmpdir(), `echo-delete-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
};
const track = (id: string, path: string): LibraryTrack => ({ id, path } as LibraryTrack);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('TrackFileDeletion', () => {
  it('continues after a trash failure and removes only tracks whose physical files succeeded', async () => {
    const root = makeRoot();
    const paths = ['one.flac', 'two.flac', 'three.flac'].map((name) => join(root, name));
    paths.forEach((path) => writeFileSync(path, 'audio'));
    const tracks = paths.map((path, index) => track(String(index + 1), path));
    const trash = vi.fn(async (path: string) => {
      if (path === paths[1]) throw new Error('locked');
    });

    const result = await deleteTrackPhysicalFiles(tracks, tracks, trash);

    expect(trash).toHaveBeenCalledTimes(3);
    expect(result.removedTrackIds).toEqual(['1', '3']);
    expect(result.items.map((item) => item.status)).toEqual(['success', 'failed', 'success']);
  });

  it('deduplicates a shared CUE audio source', async () => {
    const root = makeRoot();
    const audio = join(root, 'album.flac');
    const cue = join(root, 'album.cue');
    writeFileSync(audio, 'audio');
    writeFileSync(cue, 'FILE "album.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 01 01:00:00\n');
    const tracks = [track('1', createCueTrackPath(cue, 1)), track('2', createCueTrackPath(cue, 2))];
    const trash = vi.fn(async () => undefined);

    const result = await deleteTrackPhysicalFiles(tracks, tracks, trash);

    expect(trash).toHaveBeenCalledOnce();
    expect(trash).toHaveBeenCalledWith(resolve(audio));
    expect(result.removedTrackIds).toEqual(['1', '2']);
    expect(result.items[0]).toMatchObject({ cueSharedSource: true, trackIds: ['1', '2'], status: 'success' });
  });

  it('does not delete a CUE source still referenced by an unselected virtual track', async () => {
    const root = makeRoot();
    const audio = join(root, 'album.flac');
    const cue = join(root, 'album.cue');
    writeFileSync(audio, 'audio');
    writeFileSync(cue, 'FILE "album.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 01 01:00:00\n');
    const selected = track('1', createCueTrackPath(cue, 1));
    const other = track('2', createCueTrackPath(cue, 2));
    const trash = vi.fn(async () => undefined);

    const result = await deleteTrackPhysicalFiles([selected], [selected, other], trash);

    expect(trash).not.toHaveBeenCalled();
    expect(result.removedTrackIds).toEqual([]);
    expect(result.items[0]).toMatchObject({ status: 'unprocessed', reason: 'cue-source-shared-with-unselected-tracks' });
  });

  it('removes one CUE virtual track while preserving its shared source', () => {
    const virtual = track('1', 'C:\\music\\album.cue#cueTrack=1');
    expect(removeCueVirtualTrack(virtual)).toMatchObject({
      removedTrackIds: ['1'],
      items: [{ physicalPath: null, status: 'success', reason: 'cue-virtual-track-removed-source-preserved' }],
    });
  });
});
