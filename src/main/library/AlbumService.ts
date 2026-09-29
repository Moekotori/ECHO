import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

const normalizeKeyPart = (value: string): string => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export const normalizeAlbumTitleForLooseMerge = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

export type AlbumMergeStrategy = 'standard' | 'sameTitleAndCover';

export type AlbumKeyInput = {
  albumTitle: string;
  albumArtist: string;
  fallbackArtist: string;
  albumArtistSource?: string;
  year: number | null;
  filePath: string;
  trackId: string;
  coverId?: string | null;
  coverSourceHash?: string | null;
  mergeStrategy?: AlbumMergeStrategy;
};

const reliableAlbumArtistSources = new Set(['embedded', 'manual', 'network', 'sidecar']);
const discFolderNamePattern = /^(?:cd|disc|disk|vol(?:ume)?\.?|part)\s*[-_.#]?\s*(?:\d{1,3}|[ivxlcdm]{1,8})$/iu;

const albumFolderForPath = (filePath: string): string => {
  const folderPath = dirname(filePath);
  const folderName = basename(folderPath).trim();
  return discFolderNamePattern.test(folderName) ? dirname(folderPath) : folderPath;
};

export class AlbumService {
  makeAlbumKey(input: AlbumKeyInput): string {
    const normalizedLooseAlbum = normalizeAlbumTitleForLooseMerge(input.albumTitle);
    const normalizedAlbum = normalizeKeyPart(input.albumTitle);

    if (normalizedLooseAlbum.length === 0 || normalizedLooseAlbum === 'unknown album') {
      return `unknown:${input.trackId}`;
    }

    if (input.mergeStrategy === 'sameTitleAndCover') {
      return createAlbumKey('loose-title', normalizedLooseAlbum, '');
    }

    return this.makeStandardAlbumKey(input, normalizedAlbum);
  }

  private makeStandardAlbumKey(input: AlbumKeyInput, normalizedAlbum: string): string {
    const normalizedAlbumArtist = normalizeKeyPart(input.albumArtist || '');
    const hasReliableAlbumArtist =
      reliableAlbumArtistSources.has(input.albumArtistSource ?? '') &&
      normalizedAlbumArtist.length > 0 &&
      normalizedAlbumArtist !== 'unknown artist';
    const artistOrGrouping = hasReliableAlbumArtist ? normalizedAlbumArtist : `folder:${normalizeKeyPart(albumFolderForPath(input.filePath))}`;
    const yearPart = input.year ? String(input.year) : '';
    return createAlbumKey(artistOrGrouping, normalizedAlbum, yearPart);
  }
}

const createAlbumKey = (grouping: string, normalizedAlbum: string, yearPart: string): string =>
  createHash('sha1')
    .update(`${grouping}\u0000${normalizedAlbum}\u0000${yearPart}`)
    .digest('hex');
