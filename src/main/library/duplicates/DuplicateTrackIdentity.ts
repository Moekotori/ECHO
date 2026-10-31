import type { DuplicateDecision, DuplicateIdentityResult, TrackLikeForDuplicate } from './DuplicateTrackTypes';

const LEADING_SOURCE_PATTERNS = [
  /^【\s*转载\s*】\s*/u,
  /^\[\s*转载\s*\]\s*/u,
  /^\(\s*转载\s*\)\s*/u,
  /^转载[\s:：-]*/u,
  /^搬运[\s:：-]*/u,
];

const EDGE_QUOTES_PATTERN = /^[\s"'“”‘’「」『』《》]+|[\s"'“”‘’「」『』《》]+$/gu;

const VERSION_MARKERS = [
  /\blive\b/u,
  /\bremix\b/u,
  /\bremaster\b/u,
  /\bremastered\b/u,
  /\bcover\b/u,
  /\binstrumental\b/u,
  /\bkaraoke\b/u,
  /\boff\s+vocal\b/u,
  /\btv\s+size\b/u,
  /\bshort\s+ver\b/u,
  /\blong\s+ver\b/u,
  /\bradio\s+edit\b/u,
  /\bextended\b/u,
  /\bacoustic\b/u,
  /\bdemo\b/u,
  /\bmono\b/u,
  /\bstereo\s+mix\b/u,
  /现场/u,
  /翻唱/u,
  /伴奏/u,
  /重制/u,
  /剪辑版/u,
  /完整版/u,
  /加长版/u,
  /纯音乐/u,
];

const normalizeText = (value: string): string => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');

export const normalizeDuplicateTitle = (title: string): string => {
  let normalized = normalizeText(title).replace(EDGE_QUOTES_PATTERN, '').trim();

  for (const pattern of LEADING_SOURCE_PATTERNS) {
    normalized = normalized.replace(pattern, '').trim();
  }

  return normalized.replace(/\s+/gu, ' ');
};

export const normalizeDuplicateArtist = (track: Pick<TrackLikeForDuplicate, 'artist' | 'albumArtist'>): string => {
  const artist = track.artist.trim() || track.albumArtist?.trim() || '';
  return normalizeText(artist);
};

const getVersionMarkerSignature = (title: string): string[] => {
  const normalized = normalizeText(title);
  return VERSION_MARKERS.map((marker, index) => (marker.test(normalized) ? String(index) : '')).filter(Boolean);
};

export const hasVersionMarkerConflict = (aTitle: string, bTitle: string): boolean => {
  const aMarkers = new Set(getVersionMarkerSignature(aTitle));
  const bMarkers = new Set(getVersionMarkerSignature(bTitle));

  for (const marker of aMarkers) {
    if (!bMarkers.has(marker)) {
      return true;
    }
  }

  for (const marker of bMarkers) {
    if (!aMarkers.has(marker)) {
      return true;
    }
  }

  return false;
};

const isValidDuration = (duration: number): boolean => Number.isFinite(duration) && duration > 0;

export const canStrictMergeTracks = (a: TrackLikeForDuplicate, b: TrackLikeForDuplicate): DuplicateDecision => {
  const reasons: string[] = [];
  const aTitle = normalizeDuplicateTitle(a.title);
  const bTitle = normalizeDuplicateTitle(b.title);
  const aArtist = normalizeDuplicateArtist(a);
  const bArtist = normalizeDuplicateArtist(b);

  if (aTitle !== bTitle) {
    reasons.push('title_mismatch');
  }

  if (aArtist !== bArtist) {
    reasons.push('artist_mismatch');
  }

  if (!isValidDuration(a.duration) || !isValidDuration(b.duration)) {
    reasons.push('invalid_duration');
  } else if (Math.abs(a.duration - b.duration) > 2) {
    reasons.push('duration_mismatch');
  }

  if (hasVersionMarkerConflict(a.title, b.title)) {
    reasons.push('version_marker_conflict');
  }

  if (reasons.length > 0) {
    return {
      duplicate: false,
      confidence: 0,
      reasons,
    };
  }

  return {
    duplicate: true,
    confidence: 1,
    reasons: ['strict_title_artist_duration_match'],
  };
};

export const createStrictDuplicateBucketKey = (track: TrackLikeForDuplicate): string | null => {
  const normalizedTitle = normalizeDuplicateTitle(track.title);
  const normalizedArtist = normalizeDuplicateArtist(track);

  if (!normalizedTitle || !normalizedArtist) {
    return null;
  }

  return `${normalizedTitle}\u0000${normalizedArtist}`;
};

export const createStrictDuplicateClusterKey = (
  track: TrackLikeForDuplicate,
  medianDurationSeconds: number,
): string => {
  const bucketKey = createStrictDuplicateBucketKey(track) ?? '\u0000';
  return `${bucketKey}\u0000${Math.round(medianDurationSeconds)}`;
};

export const createStrictDuplicateIdentity = (track: TrackLikeForDuplicate): DuplicateIdentityResult | null => {
  const key = createStrictDuplicateBucketKey(track);

  if (!key) {
    return null;
  }

  return {
    key,
    normalizedTitle: normalizeDuplicateTitle(track.title),
    normalizedArtist: normalizeDuplicateArtist(track),
    roundedDurationSeconds: Math.round(track.duration),
    confidence: isValidDuration(track.duration) ? 1 : 0,
    reasons: isValidDuration(track.duration) ? ['strict_identity_ready'] : ['invalid_duration'],
  };
};
