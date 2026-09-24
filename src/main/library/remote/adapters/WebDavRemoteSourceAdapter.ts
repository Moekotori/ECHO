import { basename, extname } from 'node:path';
import { parseBuffer } from 'music-metadata';
import { DOMParser } from '@xmldom/xmldom';
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
  stableKeyForWebDav,
} from '../remoteIdentity';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../../../shared/constants/audioExtensions';
import { fetchWithNetworkProxy } from '../../../network/networkFetch';

const audioExtensions = SCANNABLE_AUDIO_EXTENSIONS;
const metadataReadBytes = 256 * 1024;
const mp3MetadataReadBytes = 1024 * 1024;
const oggMetadataReadBytes = 64 * 1024;
const coverReadBytes = 2 * 1024 * 1024;
const maxRangeFallbackBytes = metadataReadBytes * 2;
const maxMp3RangeFallbackBytes = mp3MetadataReadBytes * 2;
const maxCoverRangeFallbackBytes = coverReadBytes * 2;
const propfindRetryCount = 2;
const oggExtensions = new Set(['.ogg', '.oga', '.opus']);
const webDavDirectoryCacheNamespace = 'webdav-directory-sync-v1';
const webDavPropertySelection = `
  <D:prop>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:getetag/>
    <D:getlastmodified/>
    <D:sync-token/>
  </D:prop>`;
const webDavPropfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">${webDavPropertySelection}</D:propfind>`;

const nowIso = (): string => new Date().toISOString();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const inferTitle = (remotePath: string): string => basename(remotePath, extname(remotePath)).replace(/[_-]+/g, ' ').trim() || 'Untitled';

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

const timeoutSignal = (timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); } };
};

const readBodyWithLimit = async (response: Response, limit: number): Promise<Uint8Array | null> => {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel('response body exceeds limit');
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
};

const friendlyFetchError = (error: unknown): string => {
  if (error instanceof Error && error.name === 'AbortError') {
    return '连接超时，请检查服务器地址、网络状态或 WebDAV 服务响应速度。';
  }

  return '连接失败，请检查 WebDAV 地址、网络、证书或代理设置。';
};

const friendlyHttpError = (status: number): string => {
  if (status === 401) {
    return '认证失败：用户名或密码不正确。';
  }
  if (status === 403) {
    return '服务器拒绝访问，请检查 WebDAV 权限。';
  }
  if (status === 404) {
    return 'WebDAV 路径不存在，请检查服务器 URL 或根目录。';
  }
  if (status === 429) {
    return '服务器正在限流，请稍后重试或降低扫描并发。';
  }
  if (status === 503) {
    return '服务器暂时不可用，请稍后重试。';
  }
  return `WebDAV 请求失败：服务器返回 HTTP ${status}。`;
};

const parseHttpDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
};

type ParsedWebDavResponse = {
  href: string;
  status: number | null;
  collection: boolean;
  sizeText: string | null;
  contentType: string | null;
  modifiedAt: string | null;
  etag: string | null;
  syncToken: string | null;
};

type ParsedWebDavMultiStatus = {
  responses: ParsedWebDavResponse[];
  syncToken: string | null;
};

const elementChildren = (node: Element): Element[] => {
  const output: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) {
      output.push(child as Element);
    }
  }
  return output;
};

const localNameIs = (element: Element, name: string): boolean =>
  (element.localName || element.nodeName.replace(/^.*:/u, '')).toLocaleLowerCase() === name.toLocaleLowerCase();

const directChild = (element: Element, name: string): Element | null =>
  elementChildren(element).find((child) => localNameIs(child, name)) ?? null;

const descendant = (element: Element | null, name: string): Element | null => {
  if (!element) {
    return null;
  }
  const all = element.getElementsByTagName('*');
  for (let index = 0; index < all.length; index += 1) {
    const candidate = all.item(index);
    if (candidate && localNameIs(candidate, name)) {
      return candidate;
    }
  }
  return null;
};

const elementText = (element: Element | null): string | null => cleanText(element?.textContent);

const statusCodeFrom = (value: string | null): number | null => {
  const match = value?.match(/\s(\d{3})(?:\s|$)/u);
  return match ? Number(match[1]) : null;
};

const parseWebDavMultiStatus = (xml: string): ParsedWebDavMultiStatus => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (!root || !localNameIs(root, 'multistatus')) {
    throw new Error('WebDAV returned an invalid multistatus response.');
  }

  const responses: ParsedWebDavResponse[] = [];
  for (const responseElement of elementChildren(root).filter((element) => localNameIs(element, 'response'))) {
    const href = elementText(directChild(responseElement, 'href'));
    if (!href) {
      continue;
    }
    const responseStatus = statusCodeFrom(elementText(directChild(responseElement, 'status')));
    const propstats = elementChildren(responseElement).filter((element) => localNameIs(element, 'propstat'));
    const successfulPropstat = propstats.find((propstat) => {
        const status = statusCodeFrom(elementText(directChild(propstat, 'status')));
        return status !== null && status >= 200 && status < 300;
      }) ?? propstats.find((propstat) => !directChild(propstat, 'status')) ?? null;
    const prop = successfulPropstat ? directChild(successfulPropstat, 'prop') : null;
    const resourceType = descendant(prop, 'resourcetype');

    responses.push({
      href,
      status: responseStatus ?? statusCodeFrom(elementText(directChild(successfulPropstat ?? responseElement, 'status'))),
      collection: Boolean(descendant(resourceType, 'collection')),
      sizeText: elementText(descendant(prop, 'getcontentlength')),
      contentType: elementText(descendant(prop, 'getcontenttype')),
      modifiedAt: elementText(descendant(prop, 'getlastmodified')),
      etag: elementText(descendant(prop, 'getetag')),
      syncToken: elementText(descendant(prop, 'sync-token')),
    });
  }

  return {
    responses,
    syncToken: elementText(directChild(root, 'sync-token')),
  };
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const trimBasePath = (href: string, baseUrl: string): string => {
  const decodedHref = safeDecode(href);
  const base = new URL(baseUrl);
  const basePath = safeDecode(base.pathname).replace(/\/+$/u, '');
  const hrefPath = decodedHref.startsWith('http://') || decodedHref.startsWith('https://') ? safeDecode(new URL(decodedHref).pathname) : decodedHref;
  const withoutBase = basePath && hrefPath.startsWith(basePath) ? hrefPath.slice(basePath.length) : hrefPath;
  return normalizeRemotePath(withoutBase || '/');
};

const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

const bufferIncludesAscii = (data: Uint8Array, value: string): boolean => Buffer.from(data).includes(Buffer.from(value, 'ascii'));

type RangeChunkSet = {
  head: Uint8Array;
  tail: Uint8Array | null;
};

type OggDurationInfo = {
  duration: number;
  sampleRate: number;
  codec: string;
};

type QueuedRequest<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  queued: boolean;
  onAbort: () => void;
};

const webDavRequestLimiter = new class {
  private active = 0;
  private readonly queue: Array<QueuedRequest<unknown>> = [];
  private readonly maxConcurrent = 32;

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

export class WebDavRemoteSourceAdapter implements RemoteSourceAdapter {
  readonly provider: RemoteSourceProvider = 'webdav';
  private streamUrlResolver: ((input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>) | null = null;

  setStreamUrlResolver(resolver: (input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>): void {
    this.streamUrlResolver = resolver;
  }

  async testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult> {
    const testedAt = nowIso();

    try {
      const response = await this.propfindWithRetry(input, this.rootPathFor(input), 0);

      if (!response.ok && response.status !== 207) {
        await response.body?.cancel();
        return { ok: false, status: 'error', message: friendlyHttpError(response.status), testedAt };
      }

      await response.body?.cancel();
      return { ok: true, status: 'enabled', message: '连接成功。', testedAt };
    } catch (error) {
      return { ok: false, status: 'error', message: friendlyFetchError(error), testedAt };
    }
  }

  async browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]> {
    const requestedPath = normalizeRemoteDirectoryPath(input.path ?? this.rootPathFor(input));
    const response = await this.propfindWithRetry(input, requestedPath, 1);

    if (!response.ok && response.status !== 207) {
      throw new Error(friendlyHttpError(response.status));
    }

    const parsed = parseWebDavMultiStatus(await response.text());
    return parsed.responses
      .map((entry) => this.mapResponse(input.source.id, entry, input.source.baseUrl ?? ''))
      .filter((item): item is RemoteDirectoryItem => Boolean(item))
      .filter((item) => normalizeRemoteDirectoryPath(item.path) !== requestedPath);
  }

  async *scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem> {
    const rootPath = normalizeRemoteDirectoryPath(input.rootPath ?? this.rootPathFor(input));
    const concurrency = clampInt(input.source.config.scanConcurrency, 3, 1, 4);
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
      const extension = extname(input.item.path).toLocaleLowerCase();
      const chunks = await this.fetchMetadataChunks(
        input,
        this.metadataReadBytesFor(extension),
        extension === '.mp3' ? maxMp3RangeFallbackBytes : maxRangeFallbackBytes,
        { fetchTailAfterHead: extension === '.mp3' || oggExtensions.has(extension) },
      );
      if (!chunks) {
        return fallback;
      }

      const oggDuration = oggExtensions.has(extension) ? this.readOggDuration(chunks) : null;
      const parseCandidates =
        extension === '.flac'
          ? [chunks.head]
          : extension === '.m4a' || extension === '.mp4'
            ? bufferIncludesAscii(chunks.head, 'moov') || !chunks.tail
              ? [chunks.head]
              : [chunks.head, concatChunks([chunks.head, chunks.tail])]
            : extension === '.mp3'
              ? chunks.tail
                ? [chunks.head, concatChunks([chunks.head, chunks.tail])]
                : [chunks.head]
              : chunks.tail
                ? [chunks.head, concatChunks([chunks.head, chunks.tail])]
                : [chunks.head];

      let lastError: unknown = null;
      for (const candidate of parseCandidates) {
        try {
          const parsed = this.applyDurationFallbacks(
            await this.parseMetadataBuffer(candidate, input, fallback),
            input,
            extension,
            oggDuration,
          );
          if (parsed.duration || parsed.title !== fallback.title || parsed.artist !== fallback.artist) {
            return parsed;
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (extension === '.mp3') {
        const parsed = await this.parseMetadataBuffer(parseCandidates.at(-1) ?? chunks.head, input, fallback).catch(() => fallback);
        const withEstimate = this.applyDurationFallbacks(parsed, input, extension, null);
        if (withEstimate.duration) {
          return withEstimate;
        }
      }

      if (oggDuration) {
        return this.applyOggDuration(fallback, oggDuration);
      }

      return {
        ...fallback,
        errors: lastError instanceof Error ? [lastError.message] : lastError ? [String(lastError)] : [],
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
      const chunks = await this.fetchMetadataChunks(input, coverReadBytes, maxCoverRangeFallbackBytes);
      if (!chunks) {
        return this.emptyCoverResult('metadata_range_unavailable');
      }

      const buffers = chunks.tail ? [chunks.head, concatChunks([chunks.head, chunks.tail])] : [chunks.head];
      let lastError: unknown = null;
      for (const buffer of buffers) {
        try {
          const metadata = await parseBuffer(buffer, { path: input.item.path, size: input.item.sizeBytes ?? undefined }, { duration: false, skipCovers: false });
          const picture = metadata.common.picture?.[0];
          if (picture?.data?.byteLength) {
            return {
              status: 'ok',
              data: picture.data,
              mimeType: picture.format || null,
              fieldSources: { cover: 'embedded' },
              warnings: [],
              errors: [],
            };
          }
        } catch (error) {
          lastError = error;
        }
      }

      return lastError
        ? {
            ...this.emptyCoverResult('cover_read_failed'),
            errors: [lastError instanceof Error ? lastError.message : String(lastError)],
          }
        : this.emptyCoverResult('cover_not_found');
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

  createProxyRequest(input: RemoteStreamInput): { url: string; headers: Record<string, string> } {
    const baseUrl = input.source.baseUrl;
    if (!baseUrl) {
      throw new Error('WebDAV URL is required');
    }

    return {
      url: this.createBackendUrl(baseUrl, input.remotePath),
      headers: this.createAuthHeaders(input),
    };
  }

  createBackendUrl(sourceBaseUrl: string, remotePath: string): string {
    const base = sourceBaseUrl.endsWith('/') ? sourceBaseUrl : `${sourceBaseUrl}/`;
    const path = normalizeRemotePath(remotePath)
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/');
    return new URL(path, base).toString();
  }

  createAuthHeaders(input: Pick<RemoteAdapterInput, 'source'>): Record<string, string> {
    const headers: Record<string, string> = {};

    if (input.source.authType === 'basic' && input.source.username) {
      headers.Authorization = `Basic ${Buffer.from(`${input.source.username}:${input.source.secret ?? ''}`, 'utf8').toString('base64')}`;
    } else if ((input.source.authType === 'token' || input.source.authType === 'apiKey') && input.source.secret) {
      headers.Authorization = `Bearer ${input.source.secret}`;
    }

    return headers;
  }

  private async scanDirectory(input: RemoteScanInput, path: string, pendingDirectories: string[], readyFiles: RemoteScanItem[]): Promise<void> {
    const children = await this.browseForScan(input, path);

    for (const item of children) {
      input.onProgress?.(item);

      if (item.kind === 'directory') {
        pendingDirectories.push(normalizeRemoteDirectoryPath(item.path));
        continue;
      }

      if (!item.audio) {
        continue;
      }

      readyFiles.push({
        ...item,
        remoteUrlHash: remoteUrlHashFor(input.source.id, item.path),
        stableKey: stableKeyForWebDav({
          sourceId: input.source.id,
          remotePath: item.path,
          sizeBytes: item.sizeBytes,
          modifiedAt: item.modifiedAt,
          etag: item.etag,
        }),
      });
    }
  }

  private async browseForScan(input: RemoteScanInput, path: string): Promise<RemoteDirectoryItem[]> {
    const requestedPath = normalizeRemoteDirectoryPath(path);
    const cached = input.scanCache?.get(webDavDirectoryCacheNamespace, requestedPath) ?? null;
    const cachedItems = this.parseCachedDirectoryItems(cached?.payload);
    if (cached && cachedItems && cached.fingerprint) {
      const incremental = await this.reportDirectoryChanges(input, requestedPath, cached.fingerprint, cachedItems);
      if (incremental) {
        return incremental;
      }
    }

    const response = await this.propfindWithRetry(input, requestedPath, 1);
    if (!response.ok && response.status !== 207) {
      await response.body?.cancel();
      throw new Error(friendlyHttpError(response.status));
    }
    const parsed = parseWebDavMultiStatus(await response.text());
    const items = parsed.responses
      .map((entry) => this.mapResponse(input.source.id, entry, input.source.baseUrl ?? ''))
      .filter((item): item is RemoteDirectoryItem => Boolean(item))
      .filter((item) => normalizeRemoteDirectoryPath(item.path) !== requestedPath);
    const directoryResponse = parsed.responses.find((entry) =>
      normalizeRemoteDirectoryPath(trimBasePath(entry.href, input.source.baseUrl ?? '')) === requestedPath,
    );
    const syncToken = parsed.syncToken ?? directoryResponse?.syncToken ?? null;
    if (syncToken) {
      input.scanCache?.set(webDavDirectoryCacheNamespace, requestedPath, syncToken, JSON.stringify(items));
    }
    return items;
  }

  private async reportDirectoryChanges(
    input: RemoteScanInput,
    requestedPath: string,
    syncToken: string,
    cachedItems: RemoteDirectoryItem[],
  ): Promise<RemoteDirectoryItem[] | null> {
    const baseUrl = input.source.baseUrl;
    if (!baseUrl) {
      return null;
    }
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>${this.escapeXml(syncToken)}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  ${webDavPropertySelection}
</D:sync-collection>`;
    const response = await this.fetch(input, this.createBackendUrl(baseUrl, requestedPath), {
      method: 'REPORT',
      headers: {
        ...this.createAuthHeaders(input),
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    }, 8000);
    if (response.status !== 207) {
      await response.body?.cancel();
      return null;
    }

    const parsed = parseWebDavMultiStatus(await response.text());
    const nextToken = parsed.syncToken;
    if (!nextToken) {
      return null;
    }
    const itemsByPath = new Map(cachedItems.map((item) => [item.path, item]));
    for (const change of parsed.responses) {
      const remotePath = trimBasePath(change.href, baseUrl);
      const normalizedPath = change.collection ? normalizeRemoteDirectoryPath(remotePath) : normalizeRemotePath(remotePath);
      if (normalizeRemoteDirectoryPath(normalizedPath) === requestedPath) {
        continue;
      }
      if (change.status === 404) {
        itemsByPath.delete(normalizedPath);
        itemsByPath.delete(normalizeRemoteDirectoryPath(normalizedPath));
        continue;
      }
      const item = this.mapResponse(input.source.id, change, baseUrl);
      if (item) {
        itemsByPath.set(item.path, item);
      }
    }
    const items = Array.from(itemsByPath.values());
    input.scanCache?.set(webDavDirectoryCacheNamespace, requestedPath, nextToken, JSON.stringify(items));
    return items;
  }

  private parseCachedDirectoryItems(payload: string | undefined): RemoteDirectoryItem[] | null {
    if (!payload) {
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is RemoteDirectoryItem => Boolean(item && typeof item === 'object')) : null;
    } catch {
      return null;
    }
  }

  private escapeXml(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
  }

  private async propfindWithRetry(input: RemoteAdapterInput, remotePath: string, depth: 0 | 1): Promise<Response> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= propfindRetryCount; attempt += 1) {
      try {
        const response = await this.propfind(input, remotePath, depth);
        if ((response.status === 429 || response.status === 503) && attempt < propfindRetryCount) {
          await response.body?.cancel();
          await delay(250 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (input.signal?.aborted || attempt >= propfindRetryCount) {
          throw error;
        }
        await delay(250 * (attempt + 1));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async propfind(input: RemoteAdapterInput, remotePath: string, depth: 0 | 1): Promise<Response> {
    const baseUrl = input.source.baseUrl;
    if (!baseUrl) {
      throw new Error('WebDAV URL is required');
    }

    return this.fetch(input, this.createBackendUrl(baseUrl, remotePath), {
      method: 'PROPFIND',
      headers: {
        ...this.createAuthHeaders(input),
        Depth: String(depth),
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: webDavPropfindBody,
    }, 8000);
  }

  private rootPathFor(input: RemoteAdapterInput): string {
    return normalizeRemoteDirectoryPath(configText(input.source.config, 'rootPath') ?? '/');
  }

  private mapResponse(sourceId: string, entry: ParsedWebDavResponse, baseUrl: string): RemoteDirectoryItem | null {
    const kind = entry.collection ? 'directory' : 'file';
    const path = kind === 'directory' ? normalizeRemoteDirectoryPath(trimBasePath(entry.href, baseUrl)) : normalizeRemotePath(trimBasePath(entry.href, baseUrl));
    const name = basename(path.replace(/\/$/u, '')) || '/';
    const sizeText = entry.sizeText;
    const sizeBytes = sizeText && Number.isFinite(Number(sizeText)) ? Number(sizeText) : null;
    const contentType = entry.contentType;
    const extension = extname(path).toLocaleLowerCase();

    return {
      sourceId,
      provider: 'webdav',
      path,
      name,
      kind,
      sizeBytes,
      modifiedAt: parseHttpDate(entry.modifiedAt),
      etag: entry.etag?.replace(/^"|"$/g, '') ?? null,
      contentType,
      audio: kind === 'file' && audioExtensions.has(extension),
    };
  }

  private async fetchMetadataChunks(
    input: RemoteReadMetadataInput,
    readBytes = metadataReadBytes,
    maxFallbackBytes = maxRangeFallbackBytes,
    options: { fetchTailAfterHead?: boolean } = {},
  ): Promise<RangeChunkSet | null> {
    const baseUrl = input.source.baseUrl;
    if (!baseUrl) {
      return null;
    }

    const size = input.item.sizeBytes ?? 0;
    const url = this.createBackendUrl(baseUrl, input.item.path);
    const head = await this.fetchRange(url, input, `bytes=0-${readBytes - 1}`, maxFallbackBytes);
    if (!head) {
      return null;
    }

    const needsTail = size > readBytes * (options.fetchTailAfterHead ? 1 : 2);
    const tail = needsTail ? await this.fetchRange(url, input, `bytes=${Math.max(0, size - readBytes)}-${size - 1}`, maxFallbackBytes) : null;

    return { head, tail };
  }

  private async fetchRange(url: string, input: RemoteAdapterInput, range: string, maxFallbackBytes = maxRangeFallbackBytes): Promise<Uint8Array | null> {
    const response = await this.fetch(input, url, {
      headers: {
        ...this.createAuthHeaders(input),
        Range: range,
      },
    }, 8000);

    if (!response.ok && response.status !== 206) {
      await response.body?.cancel();
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (response.status === 200 && contentLength > maxFallbackBytes) {
      await response.body?.cancel();
      return null;
    }

    return readBodyWithLimit(response, maxFallbackBytes);
  }

  private fetch(input: RemoteAdapterInput, url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    return webDavRequestLimiter.run(async () => {
      const deadline = timeoutSignal(timeoutMs, input.signal);
      try {
        return await fetchWithNetworkProxy(url, { ...options, signal: deadline.signal });
      } finally {
        deadline.dispose();
      }
    }, input.signal);
  }

  private async parseMetadataBuffer(buffer: Uint8Array, input: RemoteReadMetadataInput, fallback: RemoteMetadataResult): Promise<RemoteMetadataResult> {
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
  }

  private metadataReadBytesFor(extension: string): number {
    if (extension === '.mp3') {
      return mp3MetadataReadBytes;
    }
    if (oggExtensions.has(extension)) {
      return oggMetadataReadBytes;
    }
    return metadataReadBytes;
  }

  private applyDurationFallbacks(
    metadata: RemoteMetadataResult,
    input: RemoteReadMetadataInput,
    extension: string,
    oggDuration: OggDurationInfo | null,
  ): RemoteMetadataResult {
    if (oggDuration && (!metadata.duration || Math.abs(metadata.duration - oggDuration.duration) > 2)) {
      return this.applyOggDuration(metadata, oggDuration);
    }

    if (extension === '.mp3') {
      const estimatedDuration = this.estimateDurationFromBitrate(input.item.sizeBytes, metadata.bitrate);
      const likelyPartialParse =
        Boolean(input.item.sizeBytes && input.item.sizeBytes > mp3MetadataReadBytes) &&
        Boolean(metadata.duration && estimatedDuration && Math.abs(estimatedDuration - metadata.duration) > 2);
      if (estimatedDuration && (!metadata.duration || likelyPartialParse)) {
        return {
          ...metadata,
          status: metadata.status === 'ok' ? 'ok' : 'partial',
          duration: estimatedDuration,
          fieldSources: { ...metadata.fieldSources, duration: 'bitrate_estimate' },
          warnings: Array.from(new Set([...metadata.warnings.filter((warning) => warning !== 'duration_unavailable'), 'duration_estimated'])),
        };
      }
    }

    return metadata;
  }

  private applyOggDuration(metadata: RemoteMetadataResult, oggDuration: OggDurationInfo): RemoteMetadataResult {
    return {
      ...metadata,
      status: metadata.status === 'ok' ? 'ok' : 'partial',
      duration: oggDuration.duration,
      codec: metadata.codec ?? oggDuration.codec,
      sampleRate: metadata.sampleRate ?? oggDuration.sampleRate,
      fieldSources: {
        ...metadata.fieldSources,
        duration: 'ogg_granule',
        sampleRate: metadata.sampleRate ? metadata.fieldSources.sampleRate ?? 'technical' : 'ogg_granule',
      },
      warnings: metadata.warnings.filter((warning) => warning !== 'duration_unavailable'),
    };
  }

  private readOggDuration(chunks: RangeChunkSet): OggDurationInfo | null {
    const head = Buffer.from(chunks.head);
    const tail = Buffer.from(chunks.tail ?? chunks.head);
    const opusHead = head.indexOf('OpusHead', 0, 'ascii');
    if (opusHead >= 0 && opusHead + 12 <= head.length) {
      const preSkip = head.readUInt16LE(opusHead + 10);
      const lastGranule = this.readLastOggGranule(tail);
      if (lastGranule !== null && lastGranule > preSkip) {
        return {
          duration: (lastGranule - preSkip) / 48000,
          sampleRate: 48000,
          codec: 'Opus',
        };
      }
    }

    const vorbisHead = head.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]));
    if (vorbisHead >= 0 && vorbisHead + 16 <= head.length) {
      const sampleRate = head.readUInt32LE(vorbisHead + 12);
      const lastGranule = this.readLastOggGranule(tail);
      if (sampleRate > 0 && lastGranule !== null && lastGranule > 0) {
        return {
          duration: lastGranule / sampleRate,
          sampleRate,
          codec: 'Vorbis',
        };
      }
    }

    return null;
  }

  private readLastOggGranule(buffer: Buffer): number | null {
    let position = 0;
    let lastGranule: bigint | null = null;

    while (position >= 0 && position + 14 <= buffer.length) {
      const pageStart = buffer.indexOf('OggS', position, 'ascii');
      if (pageStart < 0 || pageStart + 14 > buffer.length) {
        break;
      }

      const granule = buffer.readBigUInt64LE(pageStart + 6);
      if (granule !== 0xffff_ffff_ffff_ffffn) {
        lastGranule = granule;
      }
      position = pageStart + 4;
    }

    if (lastGranule === null || lastGranule > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    return Number(lastGranule);
  }

  private estimateDurationFromBitrate(sizeBytes: number | null, bitrate: number | null): number | null {
    if (!sizeBytes || !bitrate || bitrate <= 0) {
      return null;
    }

    const duration = (sizeBytes * 8) / bitrate;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
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
