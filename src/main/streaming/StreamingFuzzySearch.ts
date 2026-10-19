type SearchFieldGetter<T> = (item: T) => Array<string | null | undefined>;

type IndexedScore<T> = {
  item: T;
  index: number;
  score: number;
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const compactText = (value: string): string => value.replace(/\s+/gu, '');

const initialsFor = (value: string): string =>
  value
    .split(' ')
    .map((word) => word[0] ?? '')
    .join('');

const subsequenceScore = (needle: string, haystack: string): number | null => {
  if (!needle) {
    return 0;
  }

  let haystackIndex = 0;
  let firstMatch = -1;
  let gapPenalty = 0;

  for (const char of needle) {
    const foundAt = haystack.indexOf(char, haystackIndex);
    if (foundAt === -1) {
      return null;
    }

    if (firstMatch === -1) {
      firstMatch = foundAt;
    }
    gapPenalty += Math.max(0, foundAt - haystackIndex);
    haystackIndex = foundAt + 1;
  }

  return 18 + firstMatch * 0.35 + gapPenalty / Math.max(1, needle.length);
};

const distanceWithin = (left: string, right: string, limit: number): number | null => {
  if (Math.abs(left.length - right.length) > limit) {
    return null;
  }

  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let best = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const next = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      current[rightIndex] = next;
      best = Math.min(best, next);
    }

    if (best > limit) {
      return null;
    }
    previous = current;
  }

  const distance = previous[right.length];
  return distance <= limit ? distance : null;
};

const scoreTokenAgainstField = (token: string, field: string): number | null => {
  if (!token) {
    return 0;
  }

  const compact = compactText(field);
  const words = field.split(' ').filter(Boolean);
  const fieldInitials = initialsFor(field);

  if (field === token || compact === token) {
    return 0;
  }
  if (field.startsWith(token) || compact.startsWith(token)) {
    return 1;
  }

  const fieldIndex = field.indexOf(token);
  if (fieldIndex >= 0) {
    return 3 + fieldIndex * 0.05;
  }

  const compactIndex = compact.indexOf(token);
  if (compactIndex >= 0) {
    return 4 + compactIndex * 0.05;
  }

  if (fieldInitials.startsWith(token)) {
    return 5;
  }

  if (words.some((word) => word.startsWith(token))) {
    return 6;
  }

  const maxDistance = token.length >= 6 ? 2 : token.length >= 4 ? 1 : 0;
  if (maxDistance > 0) {
    const typoScore = words.reduce<number | null>((best, word) => {
      const candidates = [word, word.slice(0, token.length), compact.slice(0, token.length)];
      const distance = candidates.reduce<number | null>((candidateBest, candidate) => {
        const candidateDistance = distanceWithin(token, candidate, maxDistance);
        if (candidateDistance === null) {
          return candidateBest;
        }
        return candidateBest === null ? candidateDistance : Math.min(candidateBest, candidateDistance);
      }, null);
      if (distance === null) {
        return best;
      }
      const nextScore = 10 + distance * 2;
      return best === null ? nextScore : Math.min(best, nextScore);
    }, null);
    if (typoScore !== null) {
      return typoScore;
    }
  }

  const wordSubsequence = words.reduce<number | null>((best, word) => {
    const score = subsequenceScore(token, word);
    if (score === null) {
      return best;
    }
    return best === null ? score : Math.min(best, score);
  }, null);
  const compactSubsequence = subsequenceScore(token, compact);
  if (wordSubsequence !== null || compactSubsequence !== null) {
    return Math.min(wordSubsequence ?? Number.POSITIVE_INFINITY, compactSubsequence ?? Number.POSITIVE_INFINITY);
  }

  return null;
};

export const fuzzySearchScore = (query: string, fields: Array<string | null | undefined>): number | null => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedFields = fields.map((field) => normalizeSearchText(field ?? '')).filter(Boolean);
  if (normalizedFields.length === 0) {
    return null;
  }

  const combined = normalizedFields.join(' ');
  const compactQuery = compactText(normalizedQuery);
  const compactCombined = compactText(combined);
  const directIndex = combined.indexOf(normalizedQuery);
  if (directIndex >= 0) {
    return directIndex * 0.05;
  }
  const compactDirectIndex = compactCombined.indexOf(compactQuery);
  if (compactDirectIndex >= 0) {
    return 2 + compactDirectIndex * 0.05;
  }

  const queryInitials = normalizedFields.map(initialsFor).join('');
  if (queryInitials.startsWith(compactQuery)) {
    return 5;
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    const tokenScore = normalizedFields.reduce<number | null>((best, field) => {
      const fieldScore = scoreTokenAgainstField(token, field);
      if (fieldScore === null) {
        return best;
      }
      return best === null ? fieldScore : Math.min(best, fieldScore);
    }, null);

    if (tokenScore === null) {
      return null;
    }
    score += tokenScore;
  }

  return score + tokens.length;
};

export const rankByFuzzySearch = <T>(items: T[], query: string, getFields: SearchFieldGetter<T>): T[] => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return items;
  }

  return items
    .reduce<IndexedScore<T>[]>((matches, item, index) => {
      const score = fuzzySearchScore(normalizedQuery, getFields(item));
      if (score !== null) {
        matches.push({ item, index, score });
      }
      return matches;
    }, [])
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((match) => match.item);
};
