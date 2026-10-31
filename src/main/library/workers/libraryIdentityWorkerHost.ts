import { parentPort } from 'node:worker_threads';
import { FileIdentityService } from '../FileIdentityService';
import type { LibraryScanWorkerRequest, LibraryScanWorkerResponse } from './LibraryScanWorkerProtocol';

const fileIdentityService = new FileIdentityService();

const runRequest = (request: LibraryScanWorkerRequest): LibraryScanWorkerResponse => {
  try {
    if (request.type !== 'identity:observe') {
      return {
        requestId: request.requestId,
        ok: false,
        message: `Unsupported identity worker request: ${request.type}`,
      };
    }
    return {
      requestId: request.requestId,
      ok: true,
      result: fileIdentityService.observe(request.filePath),
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
  parentPort?.postMessage(runRequest(request));
});
