import { createHash } from 'node:crypto';

const slashPattern = /\/+/g;

export const sha1Hex = (value: string | Buffer): string => createHash('sha1').update(value).digest('hex');

export const normalizeRemotePath = (value: string): string => {
  const decoded = safeDecodeURIComponent(value.replace(/\\/g, '/'));
  const normalized = decoded.replace(slashPattern, '/').trim();

  if (!normalized || normalized === '/') {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

export const normalizeRemoteDirectoryPath = (value: string): string => {
  const normalized = normalizeRemotePath(value);
  return normalized === '/' || normalized.endsWith('/') ? normalized : `${normalized}/`;
};

export const remoteTrackIdFor = (sourceId: string, stableKey: string): string => `remote:${sourceId}:${sha1Hex(stableKey).slice(0, 32)}`;

export const remoteUrlHashFor = (sourceId: string, remotePath: string): string =>
  sha1Hex(`${sourceId}:${normalizeRemotePath(remotePath)}`);

export const stableKeyForWebDav = (input: {
  sourceId: string;
  remotePath: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  etag?: string | null;
}): string =>
  sha1Hex(
    [
      'webdav',
      input.sourceId,
      normalizeRemotePath(input.remotePath).toLocaleLowerCase(),
      String(input.sizeBytes ?? ''),
      input.etag ?? input.modifiedAt ?? '',
    ].join('|'),
  );

export const stableKeyForBaidu = (input: {
  sourceId: string;
  fsId: string;
  remotePath: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
}): string =>
  [
    'baidu',
    input.sourceId,
    input.fsId,
    normalizeRemotePath(input.remotePath).toLocaleLowerCase(),
    String(input.sizeBytes ?? ''),
    input.modifiedAt ?? '',
  ].join('|');

export const stableKeyForFileSystem = (input: {
  provider: 'smb' | 'sshfs';
  sourceId: string;
  remotePath: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
}): string =>
  sha1Hex(
    [
      input.provider,
      input.sourceId,
      normalizeRemotePath(input.remotePath).toLocaleLowerCase(),
      String(input.sizeBytes ?? ''),
      input.modifiedAt ?? '',
    ].join('|'),
  );

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
