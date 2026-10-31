export type LyricsRomanizationWorkerRequest = {
  requestId: number;
  type: 'romanize';
  texts: string[];
};

export type LyricsRomanizationResult = {
  text: string;
  romanization: string | null;
};

export type LyricsRomanizationWorkerResponse =
  | {
      requestId: number;
      ok: true;
      results: LyricsRomanizationResult[];
    }
  | {
      requestId: number;
      ok: false;
      message: string;
    };

const isRequestId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

export const getLyricsRomanizationRequestId = (value: unknown): number | null => {
  if (!value || typeof value !== 'object' || !('requestId' in value)) {
    return null;
  }

  const requestId = (value as { requestId?: unknown }).requestId;
  return isRequestId(requestId) ? requestId : null;
};

export const isLyricsRomanizationWorkerRequest = (
  value: unknown,
): value is LyricsRomanizationWorkerRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const request = value as Partial<LyricsRomanizationWorkerRequest>;
  return (
    isRequestId(request.requestId) &&
    request.type === 'romanize' &&
    Array.isArray(request.texts) &&
    request.texts.every((text) => typeof text === 'string')
  );
};

export const isLyricsRomanizationWorkerResponse = (
  value: unknown,
): value is LyricsRomanizationWorkerResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  if (!isRequestId(response.requestId) || typeof response.ok !== 'boolean') {
    return false;
  }

  if (!response.ok) {
    return typeof response.message === 'string';
  }

  return (
    Array.isArray(response.results) &&
    response.results.every(
      (result) =>
        Boolean(result) &&
        typeof result === 'object' &&
        typeof (result as Record<string, unknown>).text === 'string' &&
        (typeof (result as Record<string, unknown>).romanization === 'string' ||
          (result as Record<string, unknown>).romanization === null),
    )
  );
};
