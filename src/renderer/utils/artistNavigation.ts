import type { LibraryArtist, LibraryTrack } from '../../shared/types/library';
import type { DetailReturnTarget } from './albumNavigation';

export const artistDetailNavigationEvent = 'app:navigate:artist-detail';

export type ArtistDetailNavigationRequest = {
  artist: LibraryArtist;
  returnTo?: DetailReturnTarget;
};

let pendingArtistDetail: ArtistDetailNavigationRequest | null = null;

const normalizeArtistName = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();
const numericArtistSlashPlaceholder = '__ECHO_NUMERIC_ARTIST_SLASH__';
const protectNumericArtistSlashes = (value: string): string =>
  value.replace(/(\p{Number})\s*\/\s*(?=\p{Number})/gu, `$1${numericArtistSlashPlaceholder}`);
const restoreNumericArtistSlashes = (value: string): string => value.replaceAll(numericArtistSlashPlaceholder, '/');

const splitArtistNames = (value: string): string[] =>
  protectNumericArtistSlashes(value)
    .split(/\s*(?:\/|、|,|，|;|；|&|＆|\+| feat\.? | ft\.? )\s*/iu)
    .map((name) => restoreNumericArtistSlashes(name).trim())
    .filter(Boolean);

const uniqueNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(name);
  }

  return result;
};

export const requestArtistDetailNavigation = (artist: LibraryArtist, options: { returnTo?: DetailReturnTarget } = {}): void => {
  const request = { artist, returnTo: options.returnTo };
  pendingArtistDetail = request;
  window.dispatchEvent(new CustomEvent<ArtistDetailNavigationRequest>(artistDetailNavigationEvent, { detail: request }));
};

export const consumePendingArtistDetailNavigation = (): ArtistDetailNavigationRequest | null => {
  const request = pendingArtistDetail;
  pendingArtistDetail = null;
  return request;
};

export const openArtistDetailByName = async (artistName: string, options: { returnTo?: DetailReturnTarget } = {}): Promise<LibraryArtist | null> => {
  const library = window.echo?.library;
  const trimmedName = artistName.trim();

  if (!trimmedName) {
    return null;
  }

  if (!library?.getArtists) {
    throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to locate this artist.');
  }

  const candidates = uniqueNames([trimmedName, ...splitArtistNames(trimmedName)]);

  for (const candidate of candidates) {
    const result = await library.getArtists({ page: 1, pageSize: 50, search: candidate, sort: 'default' });
    const normalizedCandidate = normalizeArtistName(candidate);
    const exact = result.items.find((artist) => normalizeArtistName(artist.name) === normalizedCandidate);
    const artist = exact ?? (result.items.length === 1 ? result.items[0] : null);

    if (artist) {
      requestArtistDetailNavigation(artist, options);
      return artist;
    }
  }

  return null;
};

export const openArtistDetailForTrack = (track: LibraryTrack, options: { returnTo?: DetailReturnTarget } = {}): Promise<LibraryArtist | null> =>
  openArtistDetailByName(track.artist, options);
