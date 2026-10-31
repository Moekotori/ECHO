export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`response body exceeds ${maximumBytes} byte limit`);
    this.name = 'ResponseBodyTooLargeError';
  }
}

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('The operation was aborted', 'AbortError');

export const readResponseBodyLimited = async (
  response: Response,
  maximumBytes: number,
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError('maximumBytes must be a non-negative safe integer');
  }
  const contentLengthHeader = response.headers.get('content-length');
  const declaredLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseBodyTooLargeError(maximumBytes);
  }
  const signal = options.signal;
  if (signal?.aborted) {
    await response.body?.cancel().catch(() => undefined);
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
  if (!response.body) {
    if (declaredLength === 0 || response.status === 204 || response.status === 304) return new Uint8Array();
    throw new Error('response_body_missing');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const handleAbort = (): void => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseBodyTooLargeError(maximumBytes);
      }
      chunks.push(value);
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};
