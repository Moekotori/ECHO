import { parentPort } from 'node:worker_threads';
import type { LibraryScanWorkerRequest, LibraryScanWorkerResponse } from './LibraryScanWorkerProtocol';

let metadataReaderPromise: Promise<import('./TsMetadataReader').TsMetadataReader> | null = null;
let coverExtractorPromise: Promise<import('./TsCoverExtractor').TsCoverExtractor> | null = null;
let fileIdentityServicePromise: Promise<import('../FileIdentityService').FileIdentityService> | null = null;

const getMetadataReader = (): Promise<import('./TsMetadataReader').TsMetadataReader> => {
  metadataReaderPromise ??= import('./TsMetadataReader').then(({ TsMetadataReader }) => new TsMetadataReader());
  return metadataReaderPromise;
};

const getCoverExtractor = (): Promise<import('./TsCoverExtractor').TsCoverExtractor> => {
  coverExtractorPromise ??= import('./TsCoverExtractor').then(({ TsCoverExtractor }) => new TsCoverExtractor());
  return coverExtractorPromise;
};

const getFileIdentityService = (): Promise<import('../FileIdentityService').FileIdentityService> => {
  fileIdentityServicePromise ??= import('../FileIdentityService').then(({ FileIdentityService }) => new FileIdentityService());
  return fileIdentityServicePromise;
};

const runRequest = async (request: LibraryScanWorkerRequest): Promise<LibraryScanWorkerResponse> => {
  try {
    if (request.type === 'metadata:read') {
      const metadataReader = await getMetadataReader();
      return {
        requestId: request.requestId,
        ok: true,
        result: await metadataReader.read(request.filePath),
      };
    }

    if (request.type === 'cover:extract') {
      const coverExtractor = await getCoverExtractor();
      return {
        requestId: request.requestId,
        ok: true,
        result: await coverExtractor.extract(request.filePath, request.options),
      };
    }

    if (request.type === 'identity:observe') {
      const fileIdentityService = await getFileIdentityService();
      return {
        requestId: request.requestId,
        ok: true,
        result: fileIdentityService.observe(request.filePath),
      };
    }

    if (request.type === 'search:preload') {
      const { preloadSearchIndexRomanizer } = await import('../SearchIndexTokens');
      return {
        requestId: request.requestId,
        ok: true,
        result: await preloadSearchIndexRomanizer(),
      };
    }

    if (request.type === 'search:terms') {
      const { buildTrackSearchTermsAsync } = await import('../SearchIndexTokens');
      return {
        requestId: request.requestId,
        ok: true,
        result: await buildTrackSearchTermsAsync(request.fields),
      };
    }

    const coverExtractor = await getCoverExtractor();
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
