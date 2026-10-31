import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { opendir, stat } from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import type {
  RemoteCoverResult,
  RemoteDirectoryItem,
  RemoteMetadataResult,
  RemoteScanItem,
  RemoteSourceProvider,
  RemoteStreamUrlResult,
  TestRemoteSourceResult,
} from '../../../../shared/types/remoteSources';
import type {
  RemoteAdapterInput,
  RemoteBrowseInput,
  RemoteReadCoverInput,
  RemoteReadMetadataInput,
  RemoteScanInput,
  RemoteSourceAdapter,
  RemoteStreamInput,
} from '../remoteTypes';
import {
  normalizeRemoteDirectoryPath,
  normalizeRemotePath,
  remoteUrlHashFor,
  stableKeyForFileSystem,
} from '../remoteIdentity';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../../../shared/constants/audioExtensions';

type FileSystemProvider = Extract<RemoteSourceProvider, 'smb' | 'sshfs'>;

const audioExtensions = SCANNABLE_AUDIO_EXTENSIONS;

const nowIso = (): string => new Date().toISOString();
const cleanText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const cleanNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
};

const displayNameFor = (provider: FileSystemProvider): string => (provider === 'smb' ? 'NAS / SMB' : 'SSHFS');

const trimPathPart = (value: string): string => value.replace(/^[/\\]+|[/\\]+$/gu, '');

const inferTitle = (remotePath: string): string => basename(remotePath, extname(remotePath)).replace(/[_-]+/g, ' ').trim() || 'Untitled';

export class RemoteFileSystemAdapter implements RemoteSourceAdapter {
  private streamUrlResolver: ((input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>) | null = null;

  constructor(readonly provider: FileSystemProvider) {}

  setStreamUrlResolver(resolver: (input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>): void {
    this.streamUrlResolver = resolver;
  }

  async testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult> {
    const testedAt = nowIso();
    try {
      const root = this.resolveRoot(input.source);
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        return { ok: false, status: 'error', message: `${displayNameFor(this.provider)} 路径不是文件夹。`, testedAt };
      }

      return { ok: true, status: 'enabled', message: '连接成功。', testedAt };
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        message: error instanceof Error ? `${displayNameFor(this.provider)} 路径不可访问：${error.message}` : `${displayNameFor(this.provider)} 路径不可访问。`,
        testedAt,
      };
    }
  }

  async browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]> {
    const root = this.resolveRoot(input.source);
    const requestedPath = normalizeRemoteDirectoryPath(input.path ?? '/');
    const directoryPath = this.resolveItemPath(input.source, requestedPath);
    const directory = await opendir(directoryPath);
    const items: RemoteDirectoryItem[] = [];

    for await (const entry of directory) {
      const absolutePath = join(directoryPath, entry.name);
      const entryStat = await stat(absolutePath);
      const remotePath = this.remotePathFor(root, absolutePath, entry.isDirectory());
      const extension = extname(entry.name).toLocaleLowerCase();
      items.push({
        sourceId: input.source.id,
        provider: this.provider,
        path: remotePath,
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
        sizeBytes: entry.isFile() ? entryStat.size : null,
        modifiedAt: entryStat.mtime.toISOString(),
        etag: null,
        contentType: null,
        audio: entry.isFile() && audioExtensions.has(extension),
      });
    }

    return items.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  async *scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem> {
    const root = this.resolveRoot(input.source);
    const scanRoot = input.rootPath ? this.resolveItemPath(input.source, input.rootPath) : root;
    const concurrency = clampInt(input.source.config.scanConcurrency, 3, 1, 6);
    const pendingDirectories = [scanRoot];
    const readyFiles: RemoteScanItem[] = [];
    const inFlight = new Set<Promise<void>>();

    const startNext = (): void => {
      while (!input.signal?.aborted && pendingDirectories.length > 0 && inFlight.size < concurrency) {
        const current = pendingDirectories.shift()!;
        const task = this.scanDirectory(input, root, current, pendingDirectories, readyFiles)
          .catch((error: unknown) => {
            input.onError?.(this.remotePathFor(root, current, true), error instanceof Error ? error : new Error(String(error)));
          })
          .finally(() => {
            inFlight.delete(task);
          });
        inFlight.add(task);
      }
    };

    while (!input.signal?.aborted) {
      startNext();
      if (readyFiles.length > 0) {
        yield readyFiles.shift()!;
        continue;
      }
      if (inFlight.size === 0) {
        return;
      }
      await Promise.race(inFlight);
    }
  }

  async readMetadata(input: RemoteReadMetadataInput): Promise<RemoteMetadataResult> {
    const fallback = this.fallbackMetadata(input.item.path);
    try {
      const metadata = await parseFile(this.resolveItemPath(input.source, input.item.path), { duration: true, skipCovers: true });
      const common = metadata.common;
      const format = metadata.format;
      const artist = cleanText(common.artist) ?? fallback.artist;
      const albumArtist = cleanText(common.albumartist) ?? artist;
      const duration = cleanNumber(format.duration);

      return {
        status: duration ? 'ok' : 'partial',
        title: cleanText(common.title) ?? fallback.title,
        artist,
        album: cleanText(common.album) ?? fallback.album,
        albumArtist,
        trackNo: cleanNumber(common.track.no),
        discNo: cleanNumber(common.disk.no),
        year: cleanNumber(common.year),
        genre: Array.isArray(common.genre) ? cleanText(common.genre[0]) : null,
        duration,
        codec: cleanText(format.codec) ?? (extname(input.item.path).slice(1).toUpperCase() || null),
        sampleRate: cleanNumber(format.sampleRate),
        bitDepth: cleanNumber(format.bitsPerSample),
        bitrate: cleanNumber(format.bitrate),
        fieldSources: {
          title: common.title ? 'embedded' : 'filename_fallback',
          artist: common.artist ? 'embedded' : 'filename_fallback',
          album: common.album ? 'embedded' : 'filename_fallback',
          albumArtist: common.albumartist ? 'embedded' : common.artist ? 'artist_fallback' : 'filename_fallback',
          duration: duration ? 'technical' : 'unknown',
        },
        warnings: duration ? [] : ['duration_unavailable'],
        errors: [],
      };
    } catch (error) {
      return {
        ...fallback,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async readCover(input: RemoteReadCoverInput): Promise<RemoteCoverResult> {
    try {
      const metadata = await parseFile(this.resolveItemPath(input.source, input.item.path), { duration: false, skipCovers: false });
      const picture = metadata.common.picture?.[0];
      if (!picture?.data?.byteLength) {
        return this.emptyCover('cover_not_found');
      }

      return {
        status: 'ok',
        data: picture.data,
        mimeType: picture.format || null,
        fieldSources: { cover: 'embedded' },
        warnings: [],
        errors: [],
      };
    } catch (error) {
      return {
        ...this.emptyCover('cover_read_failed'),
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  createProxyRequest(input: RemoteStreamInput): { filePath: string } {
    return { filePath: this.resolveItemPath(input.source, input.remotePath) };
  }

  async createStreamUrl(input: RemoteStreamInput): Promise<RemoteStreamUrlResult> {
    if (!this.streamUrlResolver) {
      throw new Error('Remote stream proxy is not available');
    }
    return this.streamUrlResolver(input);
  }

  private async scanDirectory(
    input: RemoteScanInput,
    root: string,
    directoryPath: string,
    pendingDirectories: string[],
    readyFiles: RemoteScanItem[],
  ): Promise<void> {
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      if (input.signal?.aborted) {
        return;
      }

      const absolutePath = join(directoryPath, entry.name);
      const entryStat = await stat(absolutePath);
      const remotePath = this.remotePathFor(root, absolutePath, entry.isDirectory());
      const item: RemoteDirectoryItem = {
        sourceId: input.source.id,
        provider: this.provider,
        path: remotePath,
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
        sizeBytes: entry.isFile() ? entryStat.size : null,
        modifiedAt: entryStat.mtime.toISOString(),
        etag: null,
        contentType: null,
        audio: entry.isFile() && audioExtensions.has(extname(entry.name).toLocaleLowerCase()),
      };
      input.onProgress?.(item);

      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
      } else if (item.audio) {
        readyFiles.push({
          ...item,
          remoteUrlHash: remoteUrlHashFor(input.source.id, item.path),
          stableKey: stableKeyForFileSystem({
            provider: this.provider,
            sourceId: input.source.id,
            remotePath: item.path,
            sizeBytes: item.sizeBytes,
            modifiedAt: item.modifiedAt,
          }),
        });
      }
    }
  }

  private resolveRoot(source: RemoteAdapterInput['source']): string {
    const base = cleanText(source.baseUrl);
    if (!base) {
      throw new Error(`${displayNameFor(this.provider)} 路径不能为空`);
    }

    const rootPath = cleanText(source.config.rootPath);
    const basePath = resolve(base);
    if (!rootPath || rootPath === '/' || rootPath === '\\') {
      return basePath;
    }

    return isAbsolute(rootPath) ? resolve(rootPath) : resolve(basePath, trimPathPart(rootPath));
  }

  private resolveItemPath(source: RemoteAdapterInput['source'], remotePath: string): string {
    const root = this.resolveRoot(source);
    const parts = normalizeRemotePath(remotePath).split('/').filter(Boolean);
    const absolutePath = resolve(root, ...parts);
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('远程路径越界');
    }
    return absolutePath;
  }

  private remotePathFor(root: string, absolutePath: string, directory: boolean): string {
    const relativePath = relative(root, absolutePath).split(sep).join('/');
    const normalized = normalizeRemotePath(relativePath || '/');
    return directory ? normalizeRemoteDirectoryPath(normalized) : normalized;
  }

  private fallbackMetadata(remotePath: string): RemoteMetadataResult {
    return {
      status: 'partial',
      title: inferTitle(remotePath),
      artist: 'Unknown Artist',
      album: '',
      albumArtist: 'Unknown Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: null,
      codec: extname(remotePath).slice(1).toUpperCase() || null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      fieldSources: {
        title: 'filename_fallback',
        artist: 'filename_fallback',
        album: 'filename_fallback',
        albumArtist: 'filename_fallback',
      },
      warnings: ['metadata_fallback'],
      errors: [],
    };
  }

  private emptyCover(reason: string): RemoteCoverResult {
    return {
      status: reason === 'cover_not_found' ? 'not_found' : 'partial',
      data: null,
      mimeType: null,
      fieldSources: {},
      warnings: [reason],
      errors: [],
    };
  }
}
