import type { FileIdentityObservation } from '../FileIdentityService';
import type { CoverCacheRepairOptions, CoverExtractOptions, CoverResult, MetadataResult } from '../libraryTypes';

export type LibraryScanWorkerRequest =
  | {
      requestId: number;
      type: 'metadata:read';
      filePath: string;
    }
  | {
      requestId: number;
      type: 'cover:extract';
      filePath: string;
      options: CoverExtractOptions;
    }
  | {
      requestId: number;
      type: 'cover:repair';
      options: CoverCacheRepairOptions;
    }
  | {
      requestId: number;
      type: 'identity:observe';
      filePath: string;
    };

export type LibraryScanWorkerResult = MetadataResult | CoverResult | FileIdentityObservation;

export type LibraryScanWorkerResponse =
  | {
      requestId: number;
      ok: true;
      result: LibraryScanWorkerResult;
    }
  | {
      requestId: number;
      ok: false;
      message: string;
    };

export type LibraryScanWorkerRequestForType<Type extends LibraryScanWorkerRequest['type']> = Extract<
  LibraryScanWorkerRequest,
  { type: Type }
>;

export type LibraryScanWorkerResultForType<Type extends LibraryScanWorkerRequest['type']> =
  Type extends 'metadata:read' ? MetadataResult : Type extends 'identity:observe' ? FileIdentityObservation : CoverResult;
