import type { LyricsParseLimits } from '../../shared/lyrics/localLyricsFormats';

export type EmbeddedSecondaryTracks = {
  translations: string[];
  romanizations: string[];
};

const krcLanguagePattern = /\[language:([^\]]*)\]/u;

const maxTrackTextChars = (limits: LyricsParseLimits): number =>
  Math.max(limits.maxLineTextChars, limits.maxTrackTextChars ?? 1_000_000);

const decodeBoundedBase64Utf8 = (
  value: string,
  limits: LyricsParseLimits,
): string | null => {
  const compact = value.trim();
  const maxChars = maxTrackTextChars(limits);
  if (
    compact.length === 0 ||
    compact.length > Math.ceil((maxChars * 4) / 3) + 8 ||
    !/^[A-Za-z0-9+/_-]*={0,2}$/u.test(compact)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(compact, 'base64');
    if (decoded.length > maxChars * 4) {
      return null;
    }
    const text = decoded.toString('utf8');
    return text.length <= maxChars ? text : null;
  } catch {
    return null;
  }
};

const readEmbeddedLanguageTrack = (
  value: unknown,
  type: 0 | 1,
  limits: LyricsParseLimits,
): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }

  const track = content.find((item) =>
    Boolean(item && typeof item === 'object' && !Array.isArray(item) && Number((item as { type?: unknown }).type) === type),
  ) as { lyricContent?: unknown } | undefined;
  if (!Array.isArray(track?.lyricContent)) {
    return [];
  }

  const lines: string[] = [];
  for (const entry of track.lyricContent.slice(0, limits.maxLines)) {
    const text = (Array.isArray(entry) ? entry.join('') : String(entry ?? '')).replace(/\s+/gu, ' ').trim();
    lines.push(text.length <= limits.maxLineTextChars ? text : '');
  }
  return lines;
};

export const parseKrcEmbeddedSecondaryTracks = (
  value: string,
  limits: LyricsParseLimits,
): EmbeddedSecondaryTracks => {
  const encoded = value.match(krcLanguagePattern)?.[1];
  if (!encoded) {
    return { translations: [], romanizations: [] };
  }

  const decoded = decodeBoundedBase64Utf8(encoded, limits);
  if (!decoded) {
    return { translations: [], romanizations: [] };
  }

  try {
    const parsed = JSON.parse(decoded) as unknown;
    return {
      romanizations: readEmbeddedLanguageTrack(parsed, 0, limits),
      translations: readEmbeddedLanguageTrack(parsed, 1, limits),
    };
  } catch {
    return { translations: [], romanizations: [] };
  }
};
