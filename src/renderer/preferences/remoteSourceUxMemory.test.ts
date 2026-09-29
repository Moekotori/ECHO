// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRemoteSourceUxMemory,
  rememberRemoteLocation,
  saveRemoteSourceUxMemory,
  toggleRemoteLocationPinned,
  toggleRemoteSourcePinned,
  type RemoteSourceUxMemory,
} from './remoteSourceUxMemory';

const emptyMemory = (): RemoteSourceUxMemory => ({ recentLocations: [], pinnedLocations: [], pinnedSourceIds: [] });

describe('remoteSourceUxMemory', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the newest visit for each source path', () => {
    const first = rememberRemoteLocation(emptyMemory(), { sourceId: 'source-1', path: '/Jazz', visitedAt: '2026-07-10T00:00:00.000Z' });
    const next = rememberRemoteLocation(first, { sourceId: 'source-1', path: '/Jazz', visitedAt: '2026-07-11T00:00:00.000Z' });
    expect(next.recentLocations).toEqual([{ sourceId: 'source-1', path: '/Jazz', visitedAt: '2026-07-11T00:00:00.000Z' }]);
  });

  it('toggles source and folder pins without duplicates', () => {
    const sourcePinned = toggleRemoteSourcePinned(emptyMemory(), 'source-1');
    const folderPinned = toggleRemoteLocationPinned(sourcePinned, { sourceId: 'source-1', path: '/Jazz', pinnedAt: '2026-07-11T00:00:00.000Z' });
    expect(folderPinned.pinnedSourceIds).toEqual(['source-1']);
    expect(folderPinned.pinnedLocations).toHaveLength(1);
    expect(toggleRemoteSourcePinned(folderPinned, 'source-1').pinnedSourceIds).toEqual([]);
    expect(toggleRemoteLocationPinned(folderPinned, { sourceId: 'source-1', path: '/Jazz' }).pinnedLocations).toEqual([]);
  });

  it('round-trips valid local memory', () => {
    const memory = toggleRemoteSourcePinned(
      rememberRemoteLocation(emptyMemory(), { sourceId: 'source-1', path: '/Jazz', visitedAt: '2026-07-11T00:00:00.000Z' }),
      'source-1',
    );
    saveRemoteSourceUxMemory(memory);
    expect(loadRemoteSourceUxMemory()).toEqual(memory);
  });
});
