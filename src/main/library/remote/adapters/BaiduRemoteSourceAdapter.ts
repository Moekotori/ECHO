import { basename, extname, posix } from 'node:path';
import { parseBuffer } from 'music-metadata';
import type {
  RemoteCoverResult,
  RemoteDirectoryItem,
  RemoteMetadataResult,
  RemoteScanItem,
  RemoteSourceProvider,
  RemoteStreamUrlResult,
  TestRemoteSourceResult,
} from '../../../../shared/types/remoteSources';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../../../shared/constants/audioExtensions';
import type {
  RemoteAdapterInput,
  RemoteBrowseInput,
  RemoteProxyRequest,
  RemoteReadCoverInput,
  RemoteReadMetadataInput,
  RemoteScanInput,
  RemoteSourceAdapter,
  RemoteStreamInput,
} from '../remoteTypes';
import {
  readBaiduAccessTokenFromSecret,
  readBaiduOAuthTokenSecret,
  refreshBaiduOAuthToken,
  shouldRefreshBaiduOAuthToken,
} from '../BaiduOAuth';
import {
  normalizeRemoteDirectoryPath,
  normalizeRemotePath,
  remoteUrlHashFor,
  stableKeyForBaidu,
} from '../remoteIdentity';

type BaiduAdapterOptions = {
  fileApiUrl?: string;
  multimediaApiUrl?: string;
};

type BaiduFileItem = {
  fs_id?: number | string;
  path?: string;
  server_filename?: string;
  isdir?: number;
  size?: number;
  server_mtime?: number;
  local_mtime?: number;
  md5?: string;
};

const audioExtensions = SCANNABLE_AUDIO_EXTENSIONS;
const metadataReadBytes = 1024 * 1024;
const coverReadBytes = 2 * 1024 * 1024;
const maxFallbackBytes = metadataReadBytes * 2;
const maxCoverFallbackBytes = coverReadBytes * 2;
const baiduUserAgent = 'pan.baidu.com';

const nowIso = (): string => new Date().toISOString();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const cleanText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const cleanNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const configText = (config: Record<string, unknown>, key: string): string | null => {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
};

const timeoutSignal = (timeoutMs: number, signal?: AbortSignal): AbortSignal => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  return controller.signal;
};

const inferTitle = (remotePath: string): string =>
  basename(remotePath, extname(remotePath)).replace(/[_-]+/gu, ' ').trim() || 'Untitled';

const modifiedAtFromSeconds = (value: unknown): string | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000).toISOString() : null;
};

const itemFsId = (item: BaiduFileItem): string | null => {
  const value = item.fs_id;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
};

const fsIdFromStableKey = (stableKey?: string | null): string | null => {
  if (!stableKey?.startsWith('baidu|')) {
    return null;
  }
  const [, , fsId] = stableKey.split('|');
  return fsId || null;
};

const fsIdFromSyntheticStableKey = (stableKey?: string | null): string | null => {
  const tail = stableKey?.split(':').at(-1) ?? null;
  return tail?.startsWith('fsid:') ? tail.slice('fsid:'.length) : null;
};

class BaiduApiError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly errno: number | null = null) {
    super(message);
    this.name = 'BaiduApiError';
  }
}

const normalizeApiPayload = async (response: Response): Promise<Record<string, unknown>> => {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BaiduApiError('百度网盘返回了不可解析的响应。', response.status);
  }
  const data = payload as Record<string, unknown>;
  const errno = data.errno ?? data.error_code;
  if (errno !== undefined && Number(errno) !== 0) {
    const message = cleanText(data.errmsg) ?? cleanText(data.error_msg) ?? cleanText(data.message) ?? `错误码 ${String(errno)}`;
    throw new BaiduApiError(`百度网盘请求失败：${message}`, response.status, Number.isFinite(Number(errno)) ? Number(errno) : null);
  }
  return data;
};

type QueuedRequest<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  queued: boolean;
  onAbort: () => void;
};

const baiduRequestLimiter = new class {
  private active = 0;
  private readonly queue: Array<QueuedRequest<unknown>> = [];
  private readonly maxConcurrent = 3;

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(this.abortError());
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedRequest<T> = {
        run: task,
        resolve,
        reject,
        signal,
        queued: true,
        onAbort: () => {
          if (!queued.queued) {
            return;
          }
          const index = this.queue.indexOf(queued as QueuedRequest<unknown>);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          queued.queued = false;
          reject(this.abortError());
        },
      };

      signal?.addEventListener('abort', queued.onAbort, { once: true });
      this.queue.push(queued as QueuedRequest<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift()!;
      request.queued = false;
      request.signal?.removeEventListener('abort', request.onAbort);
      if (request.signal?.aborted) {
        request.reject(this.abortError());
        continue;
      }

      this.active += 1;
      void request.run()
        .then(request.resolve)
        .catch(request.reject)
        .finally(() => {
          this.active -= 1;
          setImmediate(() => this.drain());
        });
    }
  }

  private abortError(): Error {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
  }
}();

export class BaiduRemoteSourceAdapter implements RemoteSourceAdapter {
  readonly provider: RemoteSourceProvider = 'baidu';
  private readonly fileApiUrl: string;
  private readonly multimediaApiUrl: string;
  private streamUrlResolver: ((input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>) | null = null;
  private tokenRefreshHandler: ((sourceId: string, tokenSecret: string) => Promise<void> | void) | null = null;
  private readonly tokenRefreshes = new Map<string, Promise<string>>();

  constructor(options: BaiduAdapterOptions = {}) {
    this.fileApiUrl = options.fileApiUrl ?? 'https://pan.baidu.com/rest/2.0/xpan/file';
    this.multimediaApiUrl = options.multimediaApiUrl ?? 'https://pan.baidu.com/rest/2.0/xpan/multimedia';
  }

  setStreamUrlResolver(resolver: (input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>): void {
    this.streamUrlResolver = resolver;
  }

  setTokenRefreshHandler(handler: (sourceId: string, tokenSecret: string) => Promise<void> | void): void {
    this.tokenRefreshHandler = handler;
  }

  async testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult> {
    const testedAt = nowIso();
    try {
      await this.listDirectory(input, this.rootPathFor(input), 0, 1);
      return { ok: true, status: 'enabled', message: '百度网盘连接成功。', testedAt };
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        message: error instanceof Error ? error.message : '百度网盘连接失败。',
        testedAt,
      };
    }
  }

  async browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]> {
    const requestedPath = normalizeRemoteDirectoryPath(input.path ?? this.rootPathFor(input));
    const items = await this.listAll(input, requestedPath);
    return items
      .map((item) => this.mapItem(input.source.id, item))
      .filter((item): item is RemoteDirectoryItem => Boolean(item));
  }

  async *scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem> {
    const rootPath = normalizeRemoteDirectoryPath(input.rootPath ?? this.rootPathFor(input));
    const concurrency = clampInt(input.source.config.scanConcurrency, 2, 1, 3);
    const pendingDirectories = [rootPath];
    const readyFiles: RemoteScanItem[] = [];
    const inFlight = new Set<Promise<void>>();

    const startNext = (): void => {
      while (!input.signal?.aborted && pendingDirectories.length > 0 && inFlight.size < concurrency) {
        const current = pendingDirectories.shift()!;
        const task = this.scanDirectory(input, current, pendingDirectories, readyFiles)
          .catch((error: unknown) => {
            input.onError?.(current, error instanceof Error ? error : new Error(String(error)));
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
      const buffer = await this.fetchRange(input, `bytes=0-${metadataReadBytes - 1}`, maxFallbackBytes);
      if (!buffer) {
        return fallback;
      }

      const metadata = await parseBuffer(buffer, { path: input.item.path, size: input.item.sizeBytes ?? undefined }, { duration: true, skipCovers: true });
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
        codec: cleanText(format.codec) ?? fallback.codec,
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
      const buffer = await this.fetchRange(input, `bytes=0-${coverReadBytes - 1}`, maxCoverFallbackBytes);
      if (!buffer) {
        return this.emptyCoverResult('metadata_range_unavailable');
      }

      const metadata = await parseBuffer(buffer, { path: input.item.path, size: input.item.sizeBytes ?? undefined }, { duration: false, skipCovers: false });
      const picture = metadata.common.picture?.[0];
      if (!picture?.data?.byteLength) {
        return this.emptyCoverResult('cover_not_found');
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
        ...this.emptyCoverResult('cover_read_failed'),
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async createStreamUrl(input: RemoteStreamInput): Promise<RemoteStreamUrlResult> {
    if (!this.streamUrlResolver) {
      throw new Error('Remote stream proxy is not available');
    }

    return this.streamUrlResolver(input);
  }

  async createProxyRequest(input: RemoteStreamInput): Promise<RemoteProxyRequest> {
    const token = await this.tokenFor(input);
    const fsId = fsIdFromStableKey(input.stableKey) ?? fsIdFromSyntheticStableKey(input.stableKey) ?? await this.resolveFsIdForPath(input, input.remotePath);
    const dlink = await this.getDownloadLink(input, fsId);
    const url = new URL(dlink);
    if (!url.searchParams.has('access_token')) {
      url.searchParams.set('access_token', token);
    }

    return {
      url: url.toString(),
      headers: {
        'User-Agent': baiduUserAgent,
      },
    };
  }

  private async scanDirectory(input: RemoteScanInput, path: string, pendingDirectories: string[], readyFiles: RemoteScanItem[]): Promise<void> {
    const children = await this.browse({ ...input, path });

    for (const item of children) {
      input.onProgress?.(item);

      if (item.kind === 'directory') {
        pendingDirectories.push(normalizeRemoteDirectoryPath(item.path));
        continue;
      }

      if (!item.audio) {
        continue;
      }

      const fsId = item.etag?.startsWith('fsid:') ? item.etag.slice('fsid:'.length) : item.path;
      readyFiles.push({
        ...item,
        remoteUrlHash: remoteUrlHashFor(input.source.id, item.path),
        stableKey: stableKeyForBaidu({
          sourceId: input.source.id,
          fsId,
          remotePath: item.path,
          sizeBytes: item.sizeBytes,
          modifiedAt: item.modifiedAt,
        }),
      });
    }
  }

  private async listAll(input: RemoteAdapterInput, dir: string): Promise<BaiduFileItem[]> {
    const limit = clampInt(input.source.config.pageSize, 1000, 1, 1000);
    const output: BaiduFileItem[] = [];
    let start = 0;

    for (;;) {
      const page = await this.listDirectory(input, dir, start, limit);
      output.push(...page);
      if (page.length < limit) {
        return output;
      }
      start += limit;
      await delay(120);
    }
  }

  private async listDirectory(input: RemoteAdapterInput, dir: string, start: number, limit: number): Promise<BaiduFileItem[]> {
    const payload = await this.apiGet(input, this.fileApiUrl, {
      method: 'list',
      dir: normalizeRemoteDirectoryPath(dir),
      order: 'name',
      desc: '0',
      start: String(start),
      limit: String(limit),
    });
    const list = payload.list;
    return Array.isArray(list) ? list.filter((item): item is BaiduFileItem => Boolean(item) && typeof item === 'object') : [];
  }

  private async getDownloadLink(input: RemoteAdapterInput, fsId: string): Promise<string> {
    const payload = await this.apiGet(input, this.multimediaApiUrl, {
      method: 'filemetas',
      fsids: JSON.stringify([Number.isFinite(Number(fsId)) ? Number(fsId) : fsId]),
      dlink: '1',
      thumb: '0',
      extra: '0',
    });
    const list = payload.list;
    const first = Array.isArray(list) && list[0] && typeof list[0] === 'object' ? list[0] as Record<string, unknown> : null;
    const dlink = cleanText(first?.dlink);
    if (!dlink) {
      throw new Error('百度网盘没有返回可播放下载链接。');
    }
    return dlink;
  }

  private async resolveFsIdForPath(input: RemoteAdapterInput, remotePath: string): Promise<string> {
    const normalized = normalizeRemotePath(remotePath);
    const parent = normalizeRemoteDirectoryPath(posix.dirname(normalized));
    const name = basename(normalized);
    const children = await this.listAll(input, parent);
    const match = children.find((item) => normalizeRemotePath(item.path ?? '') === normalized || item.server_filename === name);
    const fsId = match ? itemFsId(match) : null;
    if (!fsId) {
      throw new Error('无法定位百度网盘文件 ID，请刷新目录或重新同步。');
    }
    return fsId;
  }

  private async fetchRange(input: RemoteReadMetadataInput | RemoteReadCoverInput, range: string, maxFallback: number): Promise<Uint8Array | null> {
    const proxyRequest = await this.createProxyRequest({
      source: input.source,
      remotePath: input.item.path,
      stableKey: input.item.stableKey,
    });
    if (!proxyRequest.url) {
      return null;
    }

    const response = await this.fetch(input, proxyRequest.url, {
      headers: {
        ...(proxyRequest.headers ?? {}),
        Range: range,
      },
    }, 10000);

    if (!response.ok && response.status !== 206) {
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (response.status === 200 && contentLength > maxFallback) {
      return null;
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  private async apiGet(input: RemoteAdapterInput, endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    try {
      return await this.apiGetOnce(input, endpoint, params);
    } catch (error) {
      const tokenSecret = readBaiduOAuthTokenSecret(input.source.secret);
      if (!this.isAuthExpiredError(error) || !tokenSecret?.refreshToken) {
        throw error;
      }

      await this.refreshToken(input, tokenSecret, false);
      return this.apiGetOnce(input, endpoint, params);
    }
  }

  private async apiGetOnce(input: RemoteAdapterInput, endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(endpoint);
    url.searchParams.set('access_token', await this.tokenFor(input));
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetch(input, url.toString(), {
      headers: {
        'User-Agent': baiduUserAgent,
      },
    }, 10000);
    if (!response.ok) {
      throw new BaiduApiError(`百度网盘请求失败：HTTP ${response.status}`, response.status);
    }
    return normalizeApiPayload(response);
  }

  private fetch(input: RemoteAdapterInput, url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    return baiduRequestLimiter.run(() =>
      fetch(url, {
        ...options,
        signal: timeoutSignal(timeoutMs, input.signal),
      }), input.signal);
  }

  private mapItem(sourceId: string, item: BaiduFileItem): RemoteDirectoryItem | null {
    const pathValue = cleanText(item.path);
    const fsId = itemFsId(item);
    if (!pathValue || !fsId) {
      return null;
    }

    const kind = item.isdir === 1 ? 'directory' : 'file';
    const path = kind === 'directory' ? normalizeRemoteDirectoryPath(pathValue) : normalizeRemotePath(pathValue);
    const extension = extname(path).toLocaleLowerCase();

    return {
      sourceId,
      provider: 'baidu',
      path,
      name: cleanText(item.server_filename) ?? (basename(path.replace(/\/$/u, '')) || '/'),
      kind,
      sizeBytes: kind === 'file' && Number.isFinite(Number(item.size)) ? Number(item.size) : null,
      modifiedAt: modifiedAtFromSeconds(item.server_mtime ?? item.local_mtime),
      etag: `fsid:${fsId}`,
      contentType: null,
      audio: kind === 'file' && audioExtensions.has(extension),
    };
  }

  private rootPathFor(input: RemoteAdapterInput): string {
    return normalizeRemoteDirectoryPath(configText(input.source.config, 'rootPath') ?? '/');
  }

  private async tokenFor(input: RemoteAdapterInput): Promise<string> {
    const tokenSecret = readBaiduOAuthTokenSecret(input.source.secret);
    if (tokenSecret) {
      if (!shouldRefreshBaiduOAuthToken(tokenSecret)) {
        return tokenSecret.accessToken;
      }

      const refreshKey = input.source.id;
      const refresh = this.tokenRefreshes.get(refreshKey) ?? this.refreshToken(input, tokenSecret, true);
      this.tokenRefreshes.set(refreshKey, refresh);
      try {
        return await refresh;
      } finally {
        if (this.tokenRefreshes.get(refreshKey) === refresh) {
          this.tokenRefreshes.delete(refreshKey);
        }
      }
    }

    const token = readBaiduAccessTokenFromSecret(input.source.secret);
    if (!token) {
      throw new Error('百度网盘需要 access token。');
    }
    return token;
  }

  private async refreshToken(
    input: RemoteAdapterInput,
    tokenSecret: NonNullable<ReturnType<typeof readBaiduOAuthTokenSecret>>,
    allowCurrentIfRefreshFails: boolean,
  ): Promise<string> {
    try {
      const refreshed = await refreshBaiduOAuthToken(tokenSecret);
      input.source.secret = refreshed.tokenSecret;
      await this.tokenRefreshHandler?.(input.source.id, refreshed.tokenSecret);
      return refreshed.accessToken;
    } catch (error) {
      const expiresAtMs = Date.parse(tokenSecret.expiresAt ?? '');
      if (allowCurrentIfRefreshFails && Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
        return tokenSecret.accessToken;
      }
      throw error;
    }
  }

  private isAuthExpiredError(error: unknown): boolean {
    if (error instanceof BaiduApiError && (error.status === 401 || error.status === 403 || error.errno === 110 || error.errno === 111)) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /(?:access[_\s-]*token|token).*(?:expired|invalid|unauthorized|forbidden)|expired[_\s-]*token|invalid[_\s-]*token|HTTP\s+40[13]/iu.test(message);
  }

  private emptyCoverResult(reason: string): RemoteCoverResult {
    return {
      status: reason === 'cover_not_found' ? 'not_found' : 'partial',
      data: null,
      mimeType: null,
      fieldSources: {},
      warnings: [reason],
      errors: [],
    };
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
}
