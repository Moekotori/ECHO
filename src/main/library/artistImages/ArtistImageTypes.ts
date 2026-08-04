import type { ArtistImageCacheEntry } from '../../../shared/types/library';

export const ARTIST_IMAGE_CACHE_SOURCE_VERSION = 'artist-image-cache-v5';
export const ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX = `${ARTIST_IMAGE_CACHE_SOURCE_VERSION}:`;

export const artistImageCacheSourceHash = (sourceHash: string): string =>
  sourceHash.startsWith(ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX)
    ? sourceHash
    : `${ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX}${sourceHash}`;

export const isCurrentArtistImageCacheSourceHash = (sourceHash: string | null | undefined): boolean =>
  typeof sourceHash === 'string'
    && (sourceHash === ARTIST_IMAGE_CACHE_SOURCE_VERSION || sourceHash.startsWith(ARTIST_IMAGE_CACHE_SOURCE_HASH_PREFIX));

export type ArtistImageLookupInput = {
  artistId?: string;
  artistKey?: string;
  artistName?: string;
  id?: string;
  name?: string;
};

export type ArtistImageCandidate = {
  provider: string;
  providerArtistId: string | null;
  artistName: string;
  imageUrl: string;
  confidence: number;
  quality?: number;
  sourceUrl?: string | null;
  sourceRef?: string | null;
};

export type ArtistImageProvider = {
  name: string;
  minRequestIntervalMs?: number;
  searchArtistImage: (input: { artistName: string; artistKey: string }) => Promise<ArtistImageCandidate[]>;
};

export type ArtistImageUpdatedPayload = {
  artistId: string | null;
  artistKey: string;
  status: ArtistImageCacheEntry['status'];
};
