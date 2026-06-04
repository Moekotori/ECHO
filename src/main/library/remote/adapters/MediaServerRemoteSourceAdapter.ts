import { createHash } from 'node:crypto';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
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
import { remoteUrlHashFor } from '../remoteIdentity';

type MediaServerProvider = Extract<RemoteSourceProvider, 'jellyfin' | 'emby'>;

type AuthContext = {
  headers: Record<string, string>;
  userId: string | null;
};

type AuthCacheEntry = {
  auth: AuthContext;
  expiresAt: number;
};

type QueuedRequest<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  queued: boolean;
  onAbort: () => void;
};

type MediaServerItem = {
  Id?: string;
  Name?: string;
  Type?: string;
  CollectionType?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  Artists?: string[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  Genres?: string[];
  Container?: string;
  Size?: number;
  Bitrate?: number;
  DateCreated?: string;
  DateModified?: string;
  Etag?: string;
  ImageTags?: Record<string, string>;
  MediaSources?: Array<{
    Container?: string;
    Size?: number;
    Bitrate?: number;
    MediaStreams?: Array<{
      Type?: string;
      Codec?: string;
      SampleRate?: number;
      BitDepth?: number;
      BitRate?: number;
    }>;
  }>;
};

const nowIso = (): string => new Date().toISOString();
const authCacheTtlMs = 30 * 60 * 1000;
const mediaServerRequestLimiter = new class {
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
const cleanText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const cleanNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const sha1 = (value: unknown): string => createHash('sha1').update(JSON.stringify(value ?? {})).digest('hex');

const timeoutSignal = (timeoutMs: number, signal?: AbortSignal): AbortSignal => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  return controller.signal;
};

const baseUrlFor = (value: string | null): string => {
  if (!value) {
    throw new Error('服务器 URL 不能为空');
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const normalizeVirtualPath = (remotePath: string | null | undefined): string =>
  (remotePath ?? '').trim().replace(/^\/+/u, '').replace(/\/+$/u, '');

const lastVirtualPathSegment = (remotePath: string | null | undefined): string =>
  normalizeVirtualPath(remotePath).split('/').filter(Boolean).at(-1) ?? '';

const decodeVirtualId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseItemId = (provider: MediaServerProvider, remotePath: string): string => {
  const normalized = lastVirtualPathSegment(remotePath);
  const prefix = `${provider}:item:`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`无效的 ${provider} 远程路径`);
  }
  return decodeVirtualId(normalized.slice(prefix.length));
};

const parseBrowseParentId = (provider: MediaServerProvider, remotePath: string | null | undefined): string | null => {
  const normalized = lastVirtualPathSegment(remotePath);
  for (const kind of ['library', 'folder'] as const) {
    const prefix = `${provider}:${kind}:`;
    if (normalized.startsWith(prefix)) {
      return decodeVirtualId(normalized.slice(prefix.length));
    }
  }

  return null;
};

const virtualPathWithParent = (parentPath: string, childPath: string): string => {
  const normalizedParent = normalizeVirtualPath(parentPath);
  return normalizedParent ? `${normalizedParent}/${childPath}` : childPath;
};

const virtualItemPath = (provider: MediaServerProvider, id: string): string => `${provider}:item:${encodeURIComponent(id)}`;
const virtualLibraryPath = (provider: MediaServerProvider, id: string): string => `${provider}:library:${encodeURIComponent(id)}`;
const virtualFolderPath = (provider: MediaServerProvider, id: string): string => `${provider}:folder:${encodeURIComponent(id)}`;

const friendlyStatus = (provider: MediaServerProvider, status: number): string => {
  if (status === 401) {
    return `${provider === 'jellyfin' ? 'Jellyfin' : 'Emby'} 认证失败，请检查用户名、密码或 API Key。`;
  }
  if (status === 403) {
    return `${provider === 'jellyfin' ? 'Jellyfin' : 'Emby'} 拒绝访问，请检查账号权限。`;
  }
  return `${provider === 'jellyfin' ? 'Jellyfin' : 'Emby'} 请求失败：HTTP ${status}`;
};

const friendlyError = (provider: MediaServerProvider, error: unknown): string => {
  if (error instanceof Error && error.name === 'AbortError') {
    return `${provider === 'jellyfin' ? 'Jellyfin' : 'Emby'} 连接超时，请检查服务器地址和网络。`;
  }
  return `${provider === 'jellyfin' ? 'Jellyfin' : 'Emby'} 连接失败，请检查服务器地址、证书或网络。`;
};

const jsonOrError = async <T>(response: Response, provider: MediaServerProvider): Promise<T> => {
  if (!response.ok) {
    throw new Error(friendlyStatus(provider, response.status));
  }
  return (await response.json()) as T;
};

export class MediaServerRemoteSourceAdapter implements RemoteSourceAdapter {
  private streamUrlResolver: ((input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>) | null = null;
  private readonly authCache = new Map<string, AuthCacheEntry>();
  private readonly pendingAuth = new Map<string, Promise<AuthContext>>();

  constructor(readonly provider: MediaServerProvider) {}

  setStreamUrlResolver(resolver: (input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>): void {
    this.streamUrlResolver = resolver;
  }

  async testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult> {
    const testedAt = nowIso();
    try {
      const auth = await this.authenticate(input);
      const response = await this.fetch(input, `${baseUrlFor(input.source.baseUrl)}/System/Info`, {
        headers: auth.headers,
      }, 8000);
      if (!response.ok) {
        return { ok: false, status: 'error', message: friendlyStatus(this.provider, response.status), testedAt };
      }
      return { ok: true, status: 'enabled', message: '连接成功。', testedAt };
    } catch (error) {
      return { ok: false, status: 'error', message: error instanceof Error ? error.message : friendlyError(this.provider, error), testedAt };
    }
  }

  async browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]> {
    const auth = await this.authenticate(input);
    const parentId = parseBrowseParentId(this.provider, input.path);
    if (parentId) {
      const items: MediaServerItem[] = [];
      let startIndex = 0;
      const limit = 500;
      while (!input.signal?.aborted) {
        const page = await this.fetchChildItems(input, auth, parentId, startIndex, limit);
        items.push(...(page.Items ?? []));
        startIndex += limit;
        if (startIndex >= Number(page.TotalRecordCount ?? 0) || (page.Items ?? []).length === 0) {
          break;
        }
      }

      return items
        .map((item) => this.itemToDirectoryItem(input.source.id, item, normalizeVirtualPath(input.path)))
        .filter((item): item is RemoteDirectoryItem => Boolean(item));
    }

    const libraries = await this.fetchLibraries(input, auth);
    return libraries.map((library) => ({
      sourceId: input.source.id,
      provider: this.provider,
      path: virtualLibraryPath(this.provider, String(library.Id)),
      name: cleanText(library.Name) ?? 'Music',
      kind: 'directory',
      sizeBytes: null,
      modifiedAt: null,
      etag: cleanText(library.Etag),
      contentType: null,
      audio: false,
    }));
  }

  async *scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem> {
    const auth = await this.authenticate(input);
    const configuredLibraryIds = Array.isArray(input.source.config.libraryIds)
      ? input.source.config.libraryIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const libraries = configuredLibraryIds.length > 0
      ? configuredLibraryIds.map((id) => ({ Id: id, Name: id } satisfies MediaServerItem))
      : await this.fetchLibraries(input, auth);

    for (const library of libraries) {
      const libraryId = cleanText(library.Id);
      if (!libraryId) {
        continue;
      }

      let startIndex = 0;
      const limit = 200;
      while (!input.signal?.aborted) {
        const page = await this.fetchItems(input, auth, libraryId, startIndex, limit);
        for (const item of page.Items ?? []) {
          const scanItem = this.itemToScanItem(input.source.id, item);
          if (scanItem) {
            input.onProgress?.(scanItem);
            yield scanItem;
          }
        }

        startIndex += limit;
        if (startIndex >= Number(page.TotalRecordCount ?? 0) || (page.Items ?? []).length === 0) {
          break;
        }

        await yieldToMainLoop();
      }
    }
  }

  async readMetadata(input: RemoteReadMetadataInput): Promise<RemoteMetadataResult> {
    if (input.item.metadata) {
      return input.item.metadata;
    }

    const auth = await this.authenticate(input);
    const itemId = parseItemId(this.provider, input.item.path);
    const item = await this.fetchItem(input, auth, itemId);
    return this.itemToMetadata(item);
  }

  async readCover(input: RemoteReadCoverInput): Promise<RemoteCoverResult> {
    const itemId = parseItemId(this.provider, input.item.path);
    const auth = await this.authenticate(input);
    const response = await this.fetch(input, `${baseUrlFor(input.source.baseUrl)}/Items/${encodeURIComponent(itemId)}/Images/Primary?maxWidth=512&quality=80`, {
      headers: auth.headers,
    }, 8000);

    if (response.status === 404) {
      return this.emptyCover('cover_not_found');
    }
    if (!response.ok) {
      return { ...this.emptyCover('cover_read_failed'), errors: [friendlyStatus(this.provider, response.status)] };
    }

    return {
      status: 'ok',
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type'),
      fieldSources: { cover: this.provider },
      warnings: [],
      errors: [],
    };
  }

  async createProxyRequest(input: RemoteStreamInput): Promise<{ url: string; headers: Record<string, string> }> {
    const itemId = parseItemId(this.provider, input.remotePath);
    const path = `/Audio/${encodeURIComponent(itemId)}/stream`;
    const url = new URL(`${baseUrlFor(input.source.baseUrl)}${path}`);
    url.searchParams.set('static', 'true');
    const auth = await this.authenticate(input);
    const headers: Record<string, string> = auth.headers;
    return { url: url.toString(), headers };
  }

  async createStreamUrl(input: RemoteStreamInput): Promise<RemoteStreamUrlResult> {
    if (!this.streamUrlResolver) {
      throw new Error('Remote stream proxy is not available');
    }
    return this.streamUrlResolver(input);
  }

  private async authenticate(input: RemoteAdapterInput): Promise<AuthContext> {
    const cacheKey = this.authCacheKey(input);
    const cached = this.authCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return this.cloneAuth(cached.auth);
    }

    const pending = this.pendingAuth.get(cacheKey);
    if (pending) {
      return this.cloneAuth(await pending);
    }

    const promise = this.authenticateFresh(input)
      .then((auth) => {
        this.authCache.set(cacheKey, { auth: this.cloneAuth(auth), expiresAt: Date.now() + authCacheTtlMs });
        return auth;
      })
      .finally(() => {
        this.pendingAuth.delete(cacheKey);
      });
    this.pendingAuth.set(cacheKey, promise);
    return this.cloneAuth(await promise);
  }

  private async authenticateFresh(input: RemoteAdapterInput): Promise<AuthContext> {
    if ((input.source.authType === 'apiKey' || input.source.authType === 'token') && input.source.secret) {
      return { headers: this.createTokenHeaders(input), userId: cleanText(input.source.config.userId) };
    }

    if (!input.source.username || !input.source.secret) {
      return { headers: this.createBaseAuthorizationHeaders(), userId: cleanText(input.source.config.userId) };
    }

    const response = await this.fetch(input, `${baseUrlFor(input.source.baseUrl)}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        ...this.createBaseAuthorizationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Username: input.source.username,
        Pw: input.source.secret,
      }),
    }, 8000);
    const json = await jsonOrError<{ AccessToken?: string; User?: { Id?: string } }>(response, this.provider);
    const token = cleanText(json.AccessToken);
    return {
      headers: token ? { ...this.createBaseAuthorizationHeaders(token), 'X-Emby-Token': token } : this.createBaseAuthorizationHeaders(),
      userId: cleanText(json.User?.Id),
    };
  }

  private createTokenHeaders(input: Pick<RemoteAdapterInput, 'source'>): Record<string, string> {
    if (!input.source.secret) {
      return this.createBaseAuthorizationHeaders();
    }
    return {
      ...this.createBaseAuthorizationHeaders(input.source.secret),
      'X-Emby-Token': input.source.secret,
    };
  }

  private createBaseAuthorizationHeaders(token?: string): Record<string, string> {
    const value = [
      'MediaBrowser Client="ECHO Next"',
      'Device="ECHO Next"',
      'DeviceId="echo-next"',
      'Version="1.0.1"',
      token ? `Token="${token}"` : null,
    ].filter(Boolean).join(', ');
    return { 'X-Emby-Authorization': value };
  }

  private fetch(input: RemoteAdapterInput, url: string | URL, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
    return mediaServerRequestLimiter.run(() =>
      fetch(url, {
        ...options,
        signal: timeoutSignal(timeoutMs, input.signal),
      }), input.signal);
  }

  private authCacheKey(input: RemoteAdapterInput): string {
    return sha1({
      provider: this.provider,
      sourceId: input.source.id,
      baseUrl: baseUrlFor(input.source.baseUrl),
      username: input.source.username,
      authType: input.source.authType,
      secret: input.source.secret,
      userId: input.source.config.userId,
    });
  }

  private cloneAuth(auth: AuthContext): AuthContext {
    return {
      headers: { ...auth.headers },
      userId: auth.userId,
    };
  }

  private async fetchLibraries(input: RemoteAdapterInput, auth: AuthContext): Promise<MediaServerItem[]> {
    const userPath = auth.userId ? `/Users/${encodeURIComponent(auth.userId)}/Views` : '/Items';
    const url = new URL(`${baseUrlFor(input.source.baseUrl)}${userPath}`);
    const json = await jsonOrError<{ Items?: MediaServerItem[] }>(
      await this.fetch(input, url, { headers: auth.headers }, 8000),
      this.provider,
    );
    return (json.Items ?? []).filter((item) => item.CollectionType === 'music' || item.Type === 'CollectionFolder' || item.Type === 'Folder');
  }

  private async fetchItems(
    input: RemoteAdapterInput,
    auth: AuthContext,
    parentId: string,
    startIndex: number,
    limit: number,
  ): Promise<{ Items?: MediaServerItem[]; TotalRecordCount?: number }> {
    const basePath = auth.userId ? `/Users/${encodeURIComponent(auth.userId)}/Items` : '/Items';
    const url = new URL(`${baseUrlFor(input.source.baseUrl)}${basePath}`);
    url.searchParams.set('ParentId', parentId);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('IncludeItemTypes', 'Audio');
    url.searchParams.set('Fields', 'MediaSources,Genres,DateCreated,DateModified,ProviderIds,Path,ProductionYear,RunTimeTicks,IndexNumber,ParentIndexNumber,AlbumArtist,Artists,Album,AlbumId,Bitrate,MediaStreams,ImageTags');
    url.searchParams.set('StartIndex', String(startIndex));
    url.searchParams.set('Limit', String(limit));

    return jsonOrError<{ Items?: MediaServerItem[]; TotalRecordCount?: number }>(
      await this.fetch(input, url, { headers: auth.headers }, 12000),
      this.provider,
    );
  }

  private async fetchChildItems(
    input: RemoteAdapterInput,
    auth: AuthContext,
    parentId: string,
    startIndex: number,
    limit: number,
  ): Promise<{ Items?: MediaServerItem[]; TotalRecordCount?: number }> {
    const basePath = auth.userId ? `/Users/${encodeURIComponent(auth.userId)}/Items` : '/Items';
    const url = new URL(`${baseUrlFor(input.source.baseUrl)}${basePath}`);
    url.searchParams.set('ParentId', parentId);
    url.searchParams.set('Recursive', 'false');
    url.searchParams.set('IncludeItemTypes', 'Audio,Folder,CollectionFolder');
    url.searchParams.set('Fields', 'MediaSources,DateCreated,DateModified,Path,RunTimeTicks,ImageTags');
    url.searchParams.set('StartIndex', String(startIndex));
    url.searchParams.set('Limit', String(limit));

    return jsonOrError<{ Items?: MediaServerItem[]; TotalRecordCount?: number }>(
      await this.fetch(input, url, { headers: auth.headers }, 12000),
      this.provider,
    );
  }

  private async fetchItem(input: RemoteAdapterInput, auth: AuthContext, itemId: string): Promise<MediaServerItem> {
    const basePath = auth.userId ? `/Users/${encodeURIComponent(auth.userId)}/Items/${encodeURIComponent(itemId)}` : `/Items/${encodeURIComponent(itemId)}`;
    return jsonOrError<MediaServerItem>(
      await this.fetch(input, `${baseUrlFor(input.source.baseUrl)}${basePath}`, { headers: auth.headers }, 8000),
      this.provider,
    );
  }

  private itemToDirectoryItem(sourceId: string, item: MediaServerItem, parentPath: string): RemoteDirectoryItem | null {
    const itemId = cleanText(item.Id);
    if (!itemId) {
      return null;
    }

    const itemType = cleanText(item.Type)?.toLowerCase();
    const isAudio = itemType === 'audio';
    const isDirectory = itemType === 'folder' || itemType === 'collectionfolder';
    if (!isAudio && !isDirectory) {
      return null;
    }

    const path = virtualPathWithParent(parentPath, isAudio ? virtualItemPath(this.provider, itemId) : virtualFolderPath(this.provider, itemId));
    return {
      sourceId,
      provider: this.provider,
      path,
      name: cleanText(item.Name) ?? itemId,
      kind: isAudio ? 'file' : 'directory',
      sizeBytes: this.sizeFor(item),
      modifiedAt: cleanText(item.DateModified) ?? cleanText(item.DateCreated),
      etag: cleanText(item.Etag) ?? sha1({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        runtime: item.RunTimeTicks,
        image: item.ImageTags?.Primary,
        size: this.sizeFor(item),
      }),
      contentType: isAudio ? 'audio/*' : null,
      audio: isAudio,
    };
  }

  private itemToScanItem(sourceId: string, item: MediaServerItem): RemoteScanItem | null {
    const itemId = cleanText(item.Id);
    if (!itemId) {
      return null;
    }
    const path = virtualItemPath(this.provider, itemId);
    const metadata = this.itemToMetadata(item);
    return {
      sourceId,
      provider: this.provider,
      path,
      name: metadata.title,
      kind: 'file',
      sizeBytes: this.sizeFor(item),
      modifiedAt: cleanText(item.DateModified) ?? cleanText(item.DateCreated),
      etag: cleanText(item.Etag) ?? sha1({
        id: item.Id,
        name: item.Name,
        album: item.Album,
        albumId: item.AlbumId,
        albumArtist: item.AlbumArtist,
        artists: item.Artists,
        runtime: item.RunTimeTicks,
        image: item.ImageTags?.Primary,
        size: this.sizeFor(item),
      }),
      contentType: null,
      audio: true,
      remoteUrlHash: remoteUrlHashFor(sourceId, path),
      stableKey: itemId,
      metadata,
    };
  }

  private itemToMetadata(item: MediaServerItem): RemoteMetadataResult {
    const audioStream = item.MediaSources?.[0]?.MediaStreams?.find((stream) => stream.Type === 'Audio');
    const artist = cleanText(item.Artists?.[0]) ?? 'Unknown Artist';
    const albumArtist = cleanText(item.AlbumArtist) ?? artist;
    const albumId = cleanText(item.AlbumId);
    const duration = cleanNumber(item.RunTimeTicks) ? Number(item.RunTimeTicks) / 10_000_000 : null;
    const title = cleanText(item.Name) ?? cleanText(item.Id) ?? 'Untitled';

    return {
      status: duration ? 'ok' : 'partial',
      title,
      artist,
      album: cleanText(item.Album) ?? '',
      albumArtist,
      trackNo: cleanNumber(item.IndexNumber),
      discNo: cleanNumber(item.ParentIndexNumber),
      year: cleanNumber(item.ProductionYear),
      genre: cleanText(item.Genres?.[0]),
      duration,
      codec: cleanText(audioStream?.Codec) ?? cleanText(item.MediaSources?.[0]?.Container) ?? cleanText(item.Container),
      sampleRate: cleanNumber(audioStream?.SampleRate),
      bitDepth: cleanNumber(audioStream?.BitDepth),
      bitrate: cleanNumber(audioStream?.BitRate) ?? cleanNumber(item.Bitrate) ?? cleanNumber(item.MediaSources?.[0]?.Bitrate),
      fieldSources: {
        title: this.provider,
        artist: artist === 'Unknown Artist' ? 'filename_fallback' : this.provider,
        album: item.Album ? this.provider : 'missing',
        albumArtist: albumArtist === 'Unknown Artist' ? 'filename_fallback' : this.provider,
        duration: duration ? this.provider : 'unknown',
        ...(albumId ? { albumId } : {}),
        ...(item.ImageTags?.Primary ? { coverArt: item.ImageTags.Primary } : {}),
      },
      warnings: duration ? [] : ['duration_unavailable'],
      errors: [],
    };
  }

  private sizeFor(item: MediaServerItem): number | null {
    return cleanNumber(item.Size) ?? cleanNumber(item.MediaSources?.[0]?.Size);
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

export class JellyfinRemoteSourceAdapter extends MediaServerRemoteSourceAdapter {
  constructor() {
    super('jellyfin');
  }
}

export class EmbyRemoteSourceAdapter extends MediaServerRemoteSourceAdapter {
  constructor() {
    super('emby');
  }
}
