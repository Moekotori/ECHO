import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LibraryAlbum, LibraryTrack } from '../../shared/types/library';

export const likedTracksChangedEvent = 'liked:tracks-changed';
export const likedAlbumsChangedEvent = 'liked:albums-changed';
export const likedChangedEvent = 'liked:changed';

const stableIdsKey = (ids: string[]): string => Array.from(new Set(ids.filter(Boolean))).sort().join('\0');

const dispatchLikedEvents = (kind: 'track' | 'album'): void => {
  window.dispatchEvent(new Event(kind === 'track' ? likedTracksChangedEvent : likedAlbumsChangedEvent));
  window.dispatchEvent(new Event(likedChangedEvent));
};

export const useLikedTrackIds = (trackIds: string[]): Record<string, boolean> => {
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const requestIdRef = useRef(0);
  const idsKey = useMemo(() => stableIdsKey(trackIds), [trackIds]);

  const refresh = useCallback(async (): Promise<void> => {
    const ids = idsKey ? idsKey.split('\0') : [];
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (ids.length === 0 || !window.echo?.library?.getLikedTrackIds) {
      setLikedMap({});
      return;
    }

    try {
      const result = await window.echo.library.getLikedTrackIds(ids);
      if (requestIdRef.current === requestId) {
        setLikedMap(result);
      }
    } catch {
      if (requestIdRef.current === requestId) {
        setLikedMap(Object.fromEntries(ids.map((id) => [id, false])));
      }
    }
  }, [idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener(likedTracksChangedEvent, refresh);
    return () => window.removeEventListener(likedTracksChangedEvent, refresh);
  }, [refresh]);

  return likedMap;
};

export const useLikedAlbumIds = (albumIds: string[]): Record<string, boolean> => {
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const requestIdRef = useRef(0);
  const idsKey = useMemo(() => stableIdsKey(albumIds), [albumIds]);

  const refresh = useCallback(async (): Promise<void> => {
    const ids = idsKey ? idsKey.split('\0') : [];
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (ids.length === 0 || !window.echo?.library?.getLikedAlbumIds) {
      setLikedMap({});
      return;
    }

    try {
      const result = await window.echo.library.getLikedAlbumIds(ids);
      if (requestIdRef.current === requestId) {
        setLikedMap(result);
      }
    } catch {
      if (requestIdRef.current === requestId) {
        setLikedMap(Object.fromEntries(ids.map((id) => [id, false])));
      }
    }
  }, [idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener(likedAlbumsChangedEvent, refresh);
    return () => window.removeEventListener(likedAlbumsChangedEvent, refresh);
  }, [refresh]);

  return likedMap;
};

export const useToggleTrackLiked = (
  setLikedMap?: Dispatch<SetStateAction<Record<string, boolean>>>,
): ((track: LibraryTrack) => Promise<boolean>) =>
  useCallback(
    async (track: LibraryTrack): Promise<boolean> => {
      const library = window.echo?.library;
      if (!library) {
        throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to like tracks.');
      }

      setLikedMap?.((current) => ({ ...current, [track.id]: !current[track.id] }));

      try {
        const result = await library.toggleTrackLiked(track.id);
        setLikedMap?.((current) => ({ ...current, [track.id]: result.liked }));
        dispatchLikedEvents('track');
        return result.liked;
      } catch (error) {
        setLikedMap?.((current) => ({ ...current, [track.id]: !current[track.id] }));
        throw error;
      }
    },
    [setLikedMap],
  );

export const useToggleAlbumLiked = (
  setLikedMap?: Dispatch<SetStateAction<Record<string, boolean>>>,
): ((album: LibraryAlbum) => Promise<boolean>) =>
  useCallback(
    async (album: LibraryAlbum): Promise<boolean> => {
      const library = window.echo?.library;
      if (!library) {
        throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to like albums.');
      }

      setLikedMap?.((current) => ({ ...current, [album.id]: !current[album.id] }));

      try {
        const result = await library.toggleAlbumLiked(album.id);
        setLikedMap?.((current) => ({ ...current, [album.id]: result.liked }));
        dispatchLikedEvents('album');
        return result.liked;
      } catch (error) {
        setLikedMap?.((current) => ({ ...current, [album.id]: !current[album.id] }));
        throw error;
      }
    },
    [setLikedMap],
  );
