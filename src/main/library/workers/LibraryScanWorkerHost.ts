import { parentPort } from 'node:worker_threads';
import { FileIdentityService } from '../FileIdentityService';
import { TsCoverExtractor } from './TsCoverExtractor';
import { TsMetadataReader } from './TsMetadataReader';
import type { LibraryScanWorkerRequest, LibraryScanWorkerResponse } from './LibraryScanWorkerProtocol';

const metadataReader = new TsMetadataReader();
const coverExtractor = new TsCoverExtractor();
const fileIdentityService = new FileIdentityService();

const runRequest = async (request: LibraryScanWorkerRequest): Promise<LibraryScanWorkerResponse> => {
  try {
    if (request.type === 'metadata:read') {
      return {
        requestId: request.requestId,
        ok: true,
        result: await metadataReader.read(request.filePath),
      };
    }

    if (request.type === 'cover:extract') {
      return {
        requestId: request.requestId,
        ok: true,
        result: await coverExtractor.extract(request.filePath, request.options),
      };
    }

    if (request.type === 'identity:observe') {
      return {
        requestId: request.requestId,
        ok: true,
        result: fileIdentityService.observe(request.filePath),
      };
    }

    return {
      requestId: request.requestId,
      ok: true,
      result: await coverExtractor.repairCachedCover(request.options),
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
