import { parentPort } from 'node:worker_threads';
import { buildTrackSearchTermsAsync, preloadSearchIndexRomanizer } from '../SearchIndexTokens';
import type { LibraryScanWorkerRequest, LibraryScanWorkerResponse } from './LibraryScanWorkerProtocol';

const runRequest = async (request: LibraryScanWorkerRequest): Promise<LibraryScanWorkerResponse> => {
  try {
    if (request.type === 'search:preload') {
      return {
        requestId: request.requestId,
        ok: true,
        result: await preloadSearchIndexRomanizer(),
      };
    }
    if (request.type === 'search:terms') {
      return {
        requestId: request.requestId,
        ok: true,
        result: await buildTrackSearchTermsAsync(request.fields),
      };
    }
    return {
      requestId: request.requestId,
      ok: false,
      message: `Unsupported search worker request: ${request.type}`,
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

parentPort?.on('message', (request: LibraryScanWorkerRequest) => {
  void runRequest(request).then((response) => {
    parentPort?.postMessage(response);
  });
});
