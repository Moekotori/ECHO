import type {
  RemoteDirectoryItem,
  RemoteCoverResult,
  RemoteLibraryTrack,
  RemoteMetadataResult,
  RemoteScanItem,
  RemoteSource,
  RemoteSourceProvider,
  RemoteStreamUrlResult,
  TestRemoteSourceResult,
} from '../../../shared/types/remoteSources';

export type RemoteSourceSecret = RemoteSource & {
  secret: string | null;
};

export type RemoteAdapterInput = {
  source: RemoteSourceSecret;
  signal?: AbortSignal;
};

export type RemoteBrowseInput = RemoteAdapterInput & {
  path?: string | null;
};

export type RemoteReadMetadataInput = RemoteAdapterInput & {
  item: RemoteScanItem;
};

export type RemoteReadCoverInput = RemoteAdapterInput & {
  item: RemoteScanItem;
  size?: number;
};

export type RemoteStreamInput = RemoteAdapterInput & {
  remotePath: string;
  stableKey?: string | null;
  expiresInSeconds?: number;
};

export type RemoteProxyRequest = {
  url?: string;
  filePath?: string;
  headers?: Record<string, string>;
};

export type RemoteScanInput = RemoteAdapterInput & {
  rootPath?: string | null;
  onProgress?: (item: RemoteDirectoryItem) => void;
  onError?: (path: string, error: Error) => void;
};

export type RemoteTrackWrite = Omit<RemoteLibraryTrack, 'coverThumb' | 'createdAt' | 'updatedAt'> & {
  remoteUrlHash: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface RemoteSourceAdapter {
  provider: RemoteSourceProvider;
  testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult>;
  browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]>;
  scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem>;
  readMetadata(input: RemoteReadMetadataInput): Promise<RemoteMetadataResult>;
  readCover?(input: RemoteReadCoverInput): Promise<RemoteCoverResult>;
  createProxyRequest?(input: RemoteStreamInput): Promise<RemoteProxyRequest> | RemoteProxyRequest;
  createStreamUrl(input: RemoteStreamInput): Promise<RemoteStreamUrlResult>;
}
