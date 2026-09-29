import { describe, expect, it } from 'vitest';
import { readResponseBodyLimited, ResponseBodyTooLargeError } from './readResponseBodyLimited';

describe('readResponseBodyLimited', () => {
  it('reads a chunked response within the limit', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }));
    await expect(readResponseBodyLimited(response, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects a declared oversized body before buffering it', async () => {
    const response = new Response(new Uint8Array([1]), { headers: { 'content-length': '10' } });
    await expect(readResponseBodyLimited(response, 4)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });

  it('rejects a chunked body as soon as it crosses the limit', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
      },
    }));
    await expect(readResponseBodyLimited(response, 4)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });

  it('does not treat a missing body without content-length as a successful empty response', async () => {
    await expect(readResponseBodyLimited(new Response(null), 4)).rejects.toThrow('response_body_missing');
  });
});
