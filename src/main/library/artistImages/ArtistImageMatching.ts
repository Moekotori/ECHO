export const ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE = 0.82;

export const artistImageKeyForName = (name: string): string => name.normalize('NFKC').toLocaleLowerCase();

export const normalizeArtistImageName = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const stripDiacritics = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC');

const compactArtistName = (value: string): string => value.replace(/[^\p{Letter}\p{Number}]+/gu, '');

const capRiskyShortNameScore = (input: string, score: number): number => {
  const compact = compactArtistName(input);
  const length = Array.from(compact).length;

  if (length <= 1) {
    return Math.min(score, 0.7);
  }

  if (/^\d+$/u.test(compact) || length <= 2) {
    return Math.min(score, 0.78);
  }

  return score;
};

export const artistImageConfidence = (inputName: string, candidateName: string): number => {
  const input = normalizeArtistImageName(inputName);
  const candidate = normalizeArtistImageName(candidateName);

  if (!input || !candidate) {
    return 0;
  }

  let score = 0;

  if (input === candidate) {
    score = 0.96;
  } else if (stripDiacritics(input) === stripDiacritics(candidate)) {
    score = 0.93;
  } else if (compactArtistName(input) === compactArtistName(candidate)) {
    score = 0.9;
  } else if (Array.from(input).length >= 3 && (candidate.includes(input) || input.includes(candidate))) {
    score = 0.74;
  }

  return capRiskyShortNameScore(input, score);
};
