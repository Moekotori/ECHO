import { basename } from 'node:path';
import type { LyricsQuery } from '../../shared/types/lyrics';
import { normalizeTextForSearch, normalizeTextForIdentity } from './lyricsTextNormalization';
import { extractLyricsVersionFlags, type LyricsVersionFlags } from './lyricsVersionFlags';

export type NormalizedLyricsQuery = {
  rawTitle: string;
  rawArtist: string;
  rawAlbum: string | null;
  durationSeconds: number | null;
  searchTitle: string;
  searchArtist: string;
  searchAlbum: string | null;
  identityTitle: string;
  identityArtist: string;
  identityAlbum: string | null;
  versionFlags: LyricsVersionFlags;
  coverIntent: boolean;
  hasReliableDuration: boolean;
  possibleOriginalTitle: string | null;
  possibleCoverTitle: string | null;
  searchVariants: Array<{
    title: string;
    artist: string;
    album: string | null;
    reason: string;
    priority: number;
  }>;
};

const maxSearchVariants = 8;
const bracketedFeaturePattern =
  /\s*[\(\[\uFF08\u3010]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]\uFF09\u3011]+[\)\]\uFF09\u3011]\s*/giu;
const trailingFeaturePattern = /\s+(?:feat\.?|ft\.?|featuring)\s+.+$/iu;
const artistFeaturePattern = /\s+(?:feat\.?|ft\.?|featuring|with)\s+/iu;
const leadingFeaturePattern = /^(?:feat\.?|ft\.?|featuring|with)\s+/iu;
const bracketedAliasPattern =
  /(?:\(([^()]{2,80})\)|\[([^[\]]{2,80})\]|\uFF08([^\uFF08\uFF09]{2,80})\uFF09|\u3010([^\u3010\u3011]{2,80})\u3011)/gu;

const cleanSearchValue = (value: string | null | undefined): string => normalizeTextForSearch(value);

const trimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length ? trimmed : null;
};

const hasCoverIntent = (query: LyricsQuery): boolean => {
  const text = [query.title, query.album, query.filePath ? basename(query.filePath) : null].filter(Boolean).join(' ');

  return (
    extractLyricsVersionFlags(text).cover ||
    /cover collection|カバーコレクション|翻唱合集/iu.test(text.normalize('NFKC'))
  );
};

const hasAnyVersionFlag = (value: string): boolean => Object.values(extractLyricsVersionFlags(value)).some(Boolean);

const cleanLooseTitle = (value: string): string => value
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const stripFeaturingFromTitle = (title: string): string | null => {
  const stripped = cleanLooseTitle(title.replace(bracketedFeaturePattern, ' ').replace(trailingFeaturePattern, ' '));
  return stripped && normalizeTextForIdentity(stripped) !== normalizeTextForIdentity(title) ? stripped : null;
};

const primaryFeaturedArtist = (artist: string): string | null => {
  const [primary] = artist.split(artistFeaturePattern);
  const trimmed = cleanLooseTitle(primary);
  return trimmed && normalizeTextForIdentity(trimmed) !== normalizeTextForIdentity(artist) ? trimmed : null;
};

const titleAliases = (title: string): string[] => {
  const aliases: string[] = [];
  const pushAlias = (value: string): void => {
    const alias = cleanLooseTitle(value);
    const identity = normalizeTextForIdentity(alias);
    if (
      identity.length < 2 ||
      identity === normalizeTextForIdentity(title) ||
      leadingFeaturePattern.test(alias) ||
      artistFeaturePattern.test(alias) ||
      hasAnyVersionFlag(alias) ||
      aliases.some((existing) => normalizeTextForIdentity(existing) === identity)
    ) {
      return;
    }

    aliases.push(alias);
  };

  for (const match of title.matchAll(bracketedAliasPattern)) {
    pushAlias(match.slice(1).find((value): value is string => Boolean(value)) ?? '');
  }

  for (const part of title.normalize('NFKC').split(/\s+(?:\/|\|)\s+/u)) {
    pushAlias(part);
  }

  return aliases.slice(0, 2);
};

const pushVariant = (
  variants: NormalizedLyricsQuery['searchVariants'],
  next: NormalizedLyricsQuery['searchVariants'][number],
): void => {
  if (variants.length >= maxSearchVariants) {
    return;
  }

  if (!next.title.trim()) {
    return;
  }

  const identity = `${normalizeTextForIdentity(next.title)}|${normalizeTextForIdentity(next.artist)}|${normalizeTextForIdentity(next.album)}`;
  if (variants.some((variant) => `${normalizeTextForIdentity(variant.title)}|${normalizeTextForIdentity(variant.artist)}|${normalizeTextForIdentity(variant.album)}` === identity)) {
    return;
  }

  variants.push(next);
};

export const buildNormalizedLyricsQuery = (query: LyricsQuery): NormalizedLyricsQuery => {
  const rawTitle = query.title.trim();
  const rawArtist = query.artist.trim();
  const rawAlbum = trimOrNull(query.album);
  const fileName = query.filePath ? basename(query.filePath) : null;
  const durationSeconds = Number.isFinite(Number(query.durationSeconds)) && Number(query.durationSeconds) > 0
    ? Number(query.durationSeconds)
    : null;
  const searchTitle = cleanSearchValue(rawTitle);
  const searchArtist = cleanSearchValue(rawArtist);
  const searchAlbum = rawAlbum ? cleanSearchValue(rawAlbum) : null;
  const identityTitle = normalizeTextForIdentity(rawTitle);
  const identityArtist = normalizeTextForIdentity(rawArtist);
  const identityAlbum = rawAlbum ? normalizeTextForIdentity(rawAlbum) : null;
  const versionFlags = extractLyricsVersionFlags(rawTitle, rawAlbum, rawArtist, fileName);
  const coverIntent = hasCoverIntent(query);
  const variants: NormalizedLyricsQuery['searchVariants'] = [];
  const featuredTitle = stripFeaturingFromTitle(rawTitle);
  const primaryArtist = primaryFeaturedArtist(rawArtist);

  pushVariant(variants, {
    title: rawTitle,
    artist: rawArtist,
    album: rawAlbum,
    reason: 'raw_identity',
    priority: 100,
  });
  pushVariant(variants, {
    title: searchTitle || rawTitle,
    artist: searchArtist || rawArtist,
    album: searchAlbum,
    reason: 'search_normalized',
    priority: 80,
  });

  if (featuredTitle) {
    pushVariant(variants, {
      title: featuredTitle,
      artist: rawArtist,
      album: rawAlbum,
      reason: 'title_without_feature',
      priority: 78,
    });
  }

  if (primaryArtist) {
    pushVariant(variants, {
      title: featuredTitle ?? rawTitle,
      artist: primaryArtist,
      album: rawAlbum,
      reason: 'primary_featured_artist',
      priority: 74,
    });
  }

  if (coverIntent) {
    pushVariant(variants, {
      title: searchTitle || rawTitle,
      artist: rawArtist,
      album: searchAlbum,
      reason: 'cover_intent_original_artist_unknown',
      priority: 70,
    });
  }

  for (const alias of titleAliases(rawTitle)) {
    pushVariant(variants, {
      title: alias,
      artist: rawArtist,
      album: rawAlbum,
      reason: 'title_alias',
      priority: 62,
    });
  }

  if (durationSeconds !== null && durationSeconds > 20) {
    pushVariant(variants, {
      title: featuredTitle ?? (searchTitle || rawTitle),
      artist: '',
      album: searchAlbum,
      reason: 'title_only_fallback',
      priority: 40,
    });
  }

  return {
    rawTitle,
    rawArtist,
    rawAlbum,
    durationSeconds,
    searchTitle,
    searchArtist,
    searchAlbum,
    identityTitle,
    identityArtist,
    identityAlbum,
    versionFlags,
    coverIntent,
    hasReliableDuration: durationSeconds !== null && durationSeconds > 20,
    possibleOriginalTitle: coverIntent ? searchTitle || null : null,
    possibleCoverTitle: coverIntent ? rawTitle || null : null,
    searchVariants: variants,
  };
};
