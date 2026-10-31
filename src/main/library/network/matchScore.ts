export type MatchScoreInput = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  duration?: number | null;
  trackNo?: number | null;
  year?: number | null;
  filename?: string | null;
  folder?: string | null;
};

const normalize = (value: string | null | undefined): string =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const dice = (left: string, right: string): number => {
  const a = normalize(left);
  const b = normalize(right);

  if (!a && !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const grams = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      matches += 1;
      grams.set(gram, count - 1);
    }
  }

  return (2 * matches) / (a.length + b.length - 2);
};

const bestTextScore = (candidate: string | null | undefined, ...locals: Array<string | null | undefined>): number =>
  Math.max(0, ...locals.map((local) => dice(candidate ?? '', local ?? '')));

const isUnknownArtist = (value: string | null | undefined): boolean => {
  const normalized = normalize(value);
  return !normalized || normalized === 'unknown artist' || normalized === 'unknown';
};

export const matchScore = (local: MatchScoreInput, candidate: MatchScoreInput): number => {
  const title = bestTextScore(candidate.title, local.title, local.filename);
  const localArtistUnknown = isUnknownArtist(local.artist) && isUnknownArtist(local.albumArtist);
  const artist = localArtistUnknown ? 0.75 : bestTextScore(candidate.artist, local.artist, local.albumArtist);
  const album = bestTextScore(candidate.album, local.album, local.folder);
  const albumArtist = bestTextScore(candidate.albumArtist, local.albumArtist, local.artist);
  const localDuration = Number(local.duration ?? 0);
  const candidateDuration = Number(candidate.duration ?? 0);
  const durationDelta = localDuration > 0 && candidateDuration > 0 ? Math.abs(localDuration - candidateDuration) : null;
  const duration =
    durationDelta === null ? 0.5 : durationDelta <= 2 ? 1 : durationDelta <= 5 ? 0.85 : durationDelta <= 10 ? 0.55 : 0.1;
  const trackNo = local.trackNo && candidate.trackNo ? (local.trackNo === candidate.trackNo ? 1 : 0.25) : 0.5;
  const year = local.year && candidate.year ? (local.year === candidate.year ? 1 : Math.abs(local.year - candidate.year) <= 1 ? 0.7 : 0.25) : 0.5;

  if (title < 0.55 || (!localArtistUnknown && artist < 0.5)) {
    return Math.min(0.74, 0.45 * title + 0.35 * artist + 0.2 * album);
  }

  let score = title * 0.34 + artist * 0.28 + album * 0.14 + albumArtist * 0.08 + duration * 0.11 + trackNo * 0.03 + year * 0.02;

  if (durationDelta !== null && durationDelta > 10) {
    score = Math.min(score, 0.72);
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
};

export const NETWORK_AUTO_APPLY_THRESHOLD = 0.92;
export const NETWORK_VISIBLE_CANDIDATE_THRESHOLD = 0.75;
