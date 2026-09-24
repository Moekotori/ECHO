import type {
  ContinuousPlayMode,
  ContinuousPlayPreference,
  ContinuousPlayReason,
  ContinuousPlayRecommendation,
  LibraryTrack,
} from './libraryTypes';

export type ContinuousPlayCandidate = {
  track: LibraryTrack;
  createdAt: string | null;
  playCount: number;
  completedCount: number;
  playedSeconds: number;
  lastPlayedAt: string | null;
  nightPlayCount: number;
  isLiked: boolean;
};

type ScoredCandidate = ContinuousPlayRecommendation & {
  artistKey: string;
  albumKey: string;
  genreKey: string;
};

const losslessCodecs = new Set(['ALAC', 'APE', 'DSD', 'DSF', 'DFF', 'FLAC', 'PCM', 'WAV', 'WAVE', 'AIFF']);
const dayMs = 24 * 60 * 60 * 1000;

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const normalizedKey = (value: string | null | undefined): string => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase();

const daysSince = (value: string | null, nowMs: number): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, (nowMs - timestamp) / dayMs) : null;
};

const stableJitter = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
};

const completionRate = (candidate: ContinuousPlayCandidate): number =>
  candidate.playCount > 0 ? clamp(candidate.completedCount / candidate.playCount, 0, 1) : 0;

const preferenceWeight = (
  candidate: ContinuousPlayCandidate,
  preferences: readonly ContinuousPlayPreference[],
): number => {
  const values = {
    artist: normalizedKey(candidate.track.artist || candidate.track.albumArtist),
    album: normalizedKey(candidate.track.album),
    genre: normalizedKey(candidate.track.genre),
  };

  return preferences.reduce((weight, preference) => {
    const preferenceKey = normalizedKey(preference.value);
    if (!preferenceKey || values[preference.kind] !== preferenceKey) {
      return weight;
    }
    return weight * clamp(Number(preference.weight) || 1, 0.1, 1);
  }, 1);
};

const addReason = (reasons: ContinuousPlayReason[], reason: ContinuousPlayReason): void => {
  if (reasons.length >= 2 || reasons.some((item) => item.code === reason.code)) {
    return;
  }
  reasons.push(reason);
};

const modeScore = (
  mode: ContinuousPlayMode,
  candidate: ContinuousPlayCandidate,
  seed: LibraryTrack | null,
  nowMs: number,
  reasons: ContinuousPlayReason[],
): number => {
  const track = candidate.track;
  const playedAgoDays = daysSince(candidate.lastPlayedAt, nowMs);
  const addedAgoDays = daysSince(candidate.createdAt, nowMs);
  let score = 0;

  if (mode === 'similar') {
    if (seed && normalizedKey(track.artist) === normalizedKey(seed.artist)) {
      score += 48;
      addReason(reasons, { code: 'same-artist' });
    }
    if (seed?.album && normalizedKey(track.album) === normalizedKey(seed.album)) {
      score += 36;
      addReason(reasons, { code: 'same-album' });
    }
    if (seed?.genre && normalizedKey(track.genre) === normalizedKey(seed.genre)) {
      score += 26;
      addReason(reasons, { code: 'same-genre', value: track.genre });
    }
    if (seed?.bpm && track.bpm) {
      const distance = Math.abs(seed.bpm - track.bpm);
      if (distance <= 18) {
        score += Math.max(0, 26 - distance * 1.2);
        addReason(reasons, { code: 'similar-bpm', value: Math.round(track.bpm) });
      }
    }
    if (!seed) {
      score += candidate.isLiked ? 35 : candidate.playCount * 2;
    }
  }

  if (mode === 'deep-cuts') {
    score += candidate.isLiked ? 78 : -18;
    score += candidate.playCount === 0 ? 32 : Math.max(0, 30 - candidate.playCount * 7);
    score += playedAgoDays === null ? 24 : Math.min(34, playedAgoDays / 4);
    if (candidate.isLiked) {
      addReason(reasons, { code: 'liked' });
    }
    addReason(reasons, candidate.playCount === 0
      ? { code: 'unheard' }
      : { code: 'rarely-played', value: candidate.playCount });
  }

  if (mode === 'recently-added') {
    const freshness = addedAgoDays === null ? 0 : Math.max(0, 100 - addedAgoDays * 1.4);
    score += freshness + (candidate.playCount === 0 ? 28 : 0);
    if (addedAgoDays !== null && addedAgoDays <= 90) {
      addReason(reasons, { code: 'recently-added', value: Math.max(0, Math.round(addedAgoDays)) });
    }
    if (candidate.playCount === 0) {
      addReason(reasons, { code: 'unheard' });
    }
  }

  if (mode === 'night') {
    score += Math.min(84, candidate.nightPlayCount * 16);
    score += track.bpm ? Math.max(0, 20 - Math.abs(track.bpm - 92) * 0.3) : 0;
    if (candidate.nightPlayCount > 0) {
      addReason(reasons, { code: 'night-favorite', value: candidate.nightPlayCount });
    }
    if (track.bpm) {
      addReason(reasons, { code: 'similar-bpm', value: Math.round(track.bpm) });
    }
  }

  if (mode === 'headphone-test') {
    const codec = (track.codec ?? '').trim().toUpperCase();
    const highResolution = (track.sampleRate ?? 0) >= 88_200 || (track.bitDepth ?? 0) >= 24;
    const lossless = losslessCodecs.has(codec);
    score += highResolution ? 72 : 0;
    score += lossless ? 38 : 0;
    score += Math.min(18, Math.max(0, ((track.bitrate ?? 0) - 900_000) / 100_000));
    if (highResolution) {
      addReason(reasons, {
        code: 'high-resolution',
        value: `${track.bitDepth ?? 16}-bit / ${Math.round((track.sampleRate ?? 44_100) / 100) / 10} kHz`,
      });
    }
    if (lossless) {
      addReason(reasons, { code: 'lossless', value: codec || null });
    }
  }

  return score;
};

export const rankContinuousPlayCandidates = (
  candidates: readonly ContinuousPlayCandidate[],
  options: {
    mode: ContinuousPlayMode;
    seed: LibraryTrack | null;
    preferences?: readonly ContinuousPlayPreference[];
    limit: number;
    nowMs?: number;
  },
): ContinuousPlayRecommendation[] => {
  const nowMs = options.nowMs ?? Date.now();
  const preferences = options.preferences ?? [];
  const seedTrackId = options.seed?.id ?? null;
  const scored: ScoredCandidate[] = candidates
    .filter((candidate) => candidate.track.unavailable !== true && candidate.track.id !== seedTrackId)
    .map((candidate) => {
      const reasons: ContinuousPlayReason[] = [];
      const rate = completionRate(candidate);
      const skippedRate = candidate.playCount > 0 ? 1 - rate : 0;
      const playedAgoDays = daysSince(candidate.lastPlayedAt, nowMs);
      let score = modeScore(options.mode, candidate, options.seed, nowMs, reasons);

      score += candidate.isLiked ? 14 : 0;
      score += rate * 22;
      score -= skippedRate * Math.min(34, candidate.playCount * 6);
      score += playedAgoDays === null ? 8 : Math.min(18, playedAgoDays / 12);
      score += stableJitter(candidate.track.id) * 3;

      if (reasons.length < 2 && candidate.isLiked) {
        addReason(reasons, { code: 'liked' });
      }
      if (reasons.length < 2 && rate >= 0.7 && candidate.playCount >= 2) {
        addReason(reasons, { code: 'high-completion', value: Math.round(rate * 100) });
      }
      if (reasons.length < 2 && playedAgoDays !== null && playedAgoDays >= 21) {
        addReason(reasons, { code: 'not-heard-recently', value: Math.round(playedAgoDays) });
      }
      if (reasons.length === 0) {
        addReason(reasons, candidate.playCount === 0 ? { code: 'unheard' } : { code: 'rarely-played', value: candidate.playCount });
      }

      score *= preferenceWeight(candidate, preferences);
      return {
        track: candidate.track,
        score: Math.round(score * 100) / 100,
        reasons,
        artistKey: normalizedKey(candidate.track.artist || candidate.track.albumArtist),
        albumKey: normalizedKey(candidate.track.album),
        genreKey: normalizedKey(candidate.track.genre),
      };
    })
    .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title));

  const target = Math.max(1, Math.min(20, Math.floor(options.limit)));
  const selected: ScoredCandidate[] = [];
  const overflow: ScoredCandidate[] = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();

  for (const candidate of scored) {
    const artistCount = candidate.artistKey ? artistCounts.get(candidate.artistKey) ?? 0 : 0;
    const albumCount = candidate.albumKey ? albumCounts.get(candidate.albumKey) ?? 0 : 0;
    if ((candidate.artistKey && artistCount >= 1) || (candidate.albumKey && albumCount >= 1)) {
      overflow.push(candidate);
      continue;
    }
    selected.push(candidate);
    if (candidate.artistKey) {
      artistCounts.set(candidate.artistKey, artistCount + 1);
    }
    if (candidate.albumKey) {
      albumCounts.set(candidate.albumKey, albumCount + 1);
    }
    if (selected.length >= target) {
      break;
    }
  }

  for (const candidate of overflow) {
    if (selected.length >= target) {
      break;
    }
    selected.push(candidate);
  }

  return selected.slice(0, target).map(({ artistKey: _artistKey, albumKey: _albumKey, genreKey: _genreKey, ...item }) => item);
};
