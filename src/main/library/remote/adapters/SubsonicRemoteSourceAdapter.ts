import { createHash, randomBytes } from 'node:crypto';
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
import { remoteUrlHashFor, sha1Hex } from '../remoteIdentity';

type SubsonicResponse<T> = {
  'subsonic-response'?: {
    status?: string;
    error?: { code?: number; message?: string };
  } & T;
};

type SubsonicSong = {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  duration?: number;
  contentType?: string;
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  size?: number;
  created?: string;
  coverArt?: string;
  albumId?: string;
  parent?: string;
};

type SubsonicAlbum = {
  id?: string;
  name?: string;
  song?: SubsonicSong[];
};

type QueuedRequest<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  queued: boolean;
  onAbort: () => void;
};

const nowIso = (): string => new Date().toISOString();
const provider: RemoteSourceProvider = 'subsonic';
const defaultApiVersion = '1.16.1';
const defaultClientName = 'ECHO-Next';
const maxCoverBytes = 4 * 1024 * 1024;
const subsonicRequestLimiter = new class {
  private active = 0;
  private readonly queue: Array<QueuedRequest<unknown>> = [];
  private readonly maxConcurrent = 64;

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
const clampInt = (value: unknown, fallback: number, min = 1, max = 8): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
};
const clampCoverSize = (value: unknown, fallback = 512): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(80, Math.min(1024, Math.round(parsed))) : fallback;
};
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');
const virtualSongPath = (id: string): string => `subsonic:song:${id}`;
const virtualFolderPath = (id: string): string => `subsonic:folder:${id}`;

const parseSongId = (remotePath: string): string => {
  const normalized = remotePath.replace(/^\/+/u, '');
  const prefix = 'subsonic:song:';
  if (!normalized.startsWith(prefix)) {
    throw new Error('无效的 Subsonic 远程路径');
  }
  return normalized.slice(prefix.length);
};

const friendlyError = (error: unknown): string => {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Subsonic 连接超时，请检查服务器地址和网络。';
  }
  return error instanceof Error ? error.message : 'Subsonic 连接失败，请检查服务器地址、证书或网络。';
};

export class SubsonicRemoteSourceAdapter implements RemoteSourceAdapter {
  readonly provider = provider;
  private streamUrlResolver: ((input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>) | null = null;

  setStreamUrlResolver(resolver: (input: RemoteStreamInput) => Promise<RemoteStreamUrlResult>): void {
    this.streamUrlResolver = resolver;
  }

  async testConnection(input: RemoteAdapterInput): Promise<TestRemoteSourceResult> {
    const testedAt = nowIso();
    try {
      await this.request(input, '/rest/ping.view');
      return { ok: true, status: 'enabled', message: '连接成功。', testedAt };
    } catch (error) {
      return { ok: false, status: 'error', message: friendlyError(error), testedAt };
    }
  }

  async browse(input: RemoteBrowseInput): Promise<RemoteDirectoryItem[]> {
    const response = await this.request<{ musicFolders?: { musicFolder?: Array<{ id?: string; name?: string }> } }>(input, '/rest/getMusicFolders.view');
    const folders = response.musicFolders?.musicFolder ?? [];
    return folders.map((folder) => {
      const id = cleanText(folder.id) ?? cleanText(folder.name) ?? 'default';
      return {
        sourceId: input.source.id,
        provider,
        path: virtualFolderPath(id),
        name: cleanText(folder.name) ?? id,
        kind: 'directory',
        sizeBytes: null,
        modifiedAt: null,
        etag: null,
        contentType: null,
        audio: false,
      };
    });
  }

  async *scan(input: RemoteScanInput): AsyncGenerator<RemoteScanItem> {
    const configuredFolderIds = Array.isArray(input.source.config.musicFolderIds)
      ? input.source.config.musicFolderIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [undefined];
    const concurrency = clampInt(input.source.config.scanConcurrency, 3, 1, 4);

    for (const folderId of configuredFolderIds.length ? configuredFolderIds : [undefined]) {
      let offset = 0;
      const size = 500;
      while (!input.signal?.aborted) {
        const params: Record<string, string> = {
          type: 'alphabeticalByName',
          size: String(size),
          offset: String(offset),
        };
        if (folderId) {
          params.musicFolderId = folderId;
        }
        const albumPage = await this.request<{ albumList2?: { album?: SubsonicAlbum[] } }>(input, '/rest/getAlbumList2.view', params);
        const albums = albumPage.albumList2?.album ?? [];
        for (let index = 0; index < albums.length && !input.signal?.aborted; index += concurrency) {
          const batch = albums.slice(index, index + concurrency);
          const details = await Promise.all(batch.map((album) => this.readAlbumDetail(input, album)));

          for (const detail of details) {
            const albumId = cleanText(detail?.id);
            for (const song of detail?.song ?? []) {
              if (input.signal?.aborted) {
                break;
              }

              const scanItem = this.songToScanItem(input.source.id, albumId ? { ...song, albumId: cleanText(song.albumId) ?? albumId } : song);
              if (scanItem) {
                input.onProgress?.(scanItem);
                yield scanItem;
              }
            }
          }
        }

        offset += size;
        if (albums.length < size) {
          break;
        }
      }
    }
  }

  async readMetadata(input: RemoteReadMetadataInput): Promise<RemoteMetadataResult> {
    if (input.item.metadata) {
      return input.item.metadata;
    }

    const id = parseSongId(input.item.path);
    const response = await this.request<{ song?: SubsonicSong }>(input, '/rest/getSong.view', { id });
    return this.songToMetadata(response.song ?? { id, title: input.item.name });
  }

  async readCover(input: RemoteReadCoverInput): Promise<RemoteCoverResult> {
    const id = input.item.metadata?.fieldSources.coverArt ?? parseSongId(input.item.path);
    const url = this.buildUrl(input, '/rest/getCoverArt.view', { id, size: String(clampCoverSize(input.size)) });
    const response = await this.fetch(input, url, 8000);
    if (response.status === 404) {
      return this.emptyCover('cover_not_found');
    }
    if (!response.ok) {
      return { ...this.emptyCover('cover_read_failed'), errors: [`Subsonic 封面请求失败：HTTP ${response.status}`] };
    }

    const mimeType = response.headers.get('content-type');
    if (mimeType && !mimeType.toLocaleLowerCase().startsWith('image/')) {
      return { ...this.emptyCover('cover_read_failed'), errors: ['Subsonic cover returned a non-image response.'] };
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maxCoverBytes) {
      return { ...this.emptyCover('cover_read_failed'), errors: ['Subsonic cover response is too large.'] };
    }

    return {
      status: 'ok',
      data,
      mimeType,
      fieldSources: { cover: 'subsonic' },
      warnings: [],
      errors: [],
    };
  }

  createProxyRequest(input: RemoteStreamInput): { url: string; headers: Record<string, string> } {
    const id = parseSongId(input.remotePath);
    return {
      url: this.buildUrl(input, '/rest/stream.view', { id }),
      headers: {},
    };
  }

  async createStreamUrl(input: RemoteStreamInput): Promise<RemoteStreamUrlResult> {
    if (!this.streamUrlResolver) {
      throw new Error('Remote stream proxy is not available');
    }
    return this.streamUrlResolver(input);
  }

  private async readAlbumDetail(input: RemoteScanInput, album: SubsonicAlbum): Promise<SubsonicAlbum | null> {
    const albumId = cleanText(album.id);
    if (!albumId) {
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const detail = await this.request<{ album?: SubsonicAlbum }>(input, '/rest/getAlbum.view', { id: albumId });
        return detail.album ? { ...detail.album, id: cleanText(detail.album.id) ?? albumId } : null;
      } catch (error) {
        if (input.signal?.aborted || attempt === 1) {
          input.onError?.(`subsonic:album:${albumId}`, error instanceof Error ? error : new Error(String(error)));
          return null;
        }

        await delay(250);
      }
    }

    return null;
  }

  private async request<T>(input: RemoteAdapterInput, path: string, params: Record<string, string> = {}): Promise<T> {
    const response = await this.fetch(input, this.buildUrl(input, path, params), 12000);
    if (!response.ok) {
      throw new Error(`Subsonic 请求失败：HTTP ${response.status}`);
    }

    const json = (await response.json()) as SubsonicResponse<T>;
    const envelope = json['subsonic-response'];
    if (!envelope) {
      throw new Error('Subsonic 返回了无效响应。');
    }
    if (envelope.status === 'failed') {
      throw new Error(envelope.error?.message ?? 'Subsonic 请求失败。');
    }
    return envelope as T;
  }

  private fetch(input: RemoteAdapterInput, url: string, timeoutMs: number): Promise<Response> {
    return subsonicRequestLimiter.run(() =>
      fetch(url, {
        signal: timeoutSignal(timeoutMs, input.signal),
      }), input.signal);
  }

  private buildUrl(input: Pick<RemoteAdapterInput, 'source'>, path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${baseUrlFor(input.source.baseUrl)}${path}`);
    const username = input.source.username ?? '';
    const secret = input.source.secret ?? '';
    const apiVersion = cleanText(input.source.config.apiVersion) ?? defaultApiVersion;
    const clientName = cleanText(input.source.config.clientName) ?? defaultClientName;
    url.searchParams.set('u', username);
    url.searchParams.set('v', apiVersion);
    url.searchParams.set('c', clientName);
    url.searchParams.set('f', 'json');

    if (input.source.config.authMode === 'password') {
      url.searchParams.set('p', secret);
    } else {
      const salt = randomBytes(6).toString('hex');
      url.searchParams.set('s', salt);
      url.searchParams.set('t', md5(`${secret}${salt}`));
    }

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private songToScanItem(sourceId: string, song: SubsonicSong): RemoteScanItem | null {
    const id = cleanText(song.id);
    if (!id) {
      return null;
    }
    const path = virtualSongPath(id);
    const metadata = this.songToMetadata(song);
    return {
      sourceId,
      provider,
      path,
      name: metadata.title,
      kind: 'file',
      sizeBytes: cleanNumber(song.size),
      modifiedAt: cleanText(song.created),
      etag: sha1Hex(JSON.stringify({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        albumArtist: song.albumArtist,
        duration: song.duration,
        bitDepth: song.bitDepth,
        samplingRate: song.samplingRate,
        size: song.size,
        coverArt: song.coverArt,
        albumId: song.albumId,
        parent: song.parent,
      })),
      contentType: cleanText(song.contentType),
      audio: true,
      remoteUrlHash: remoteUrlHashFor(sourceId, path),
      stableKey: id,
      metadata,
    };
  }

  private songToMetadata(song: SubsonicSong): RemoteMetadataResult {
    const artist = cleanText(song.artist) ?? 'Unknown Artist';
    const albumArtist = cleanText(song.albumArtist) ?? artist;
    const duration = cleanNumber(song.duration);
    const albumId = cleanText(song.albumId) ?? cleanText(song.parent);
    return {
      status: duration ? 'ok' : 'partial',
      title: cleanText(song.title) ?? cleanText(song.id) ?? 'Untitled',
      artist,
      album: cleanText(song.album) ?? '',
      albumArtist,
      trackNo: cleanNumber(song.track),
      discNo: cleanNumber(song.discNumber),
      year: cleanNumber(song.year),
      genre: cleanText(song.genre),
      duration,
      codec: cleanText(song.suffix) ?? cleanText(song.contentType),
      sampleRate: cleanNumber(song.samplingRate),
      bitDepth: cleanNumber(song.bitDepth),
      bitrate: cleanNumber(song.bitRate) ? Number(song.bitRate) * 1000 : null,
      fieldSources: {
        title: 'subsonic',
        artist: artist === 'Unknown Artist' ? 'filename_fallback' : 'subsonic',
        album: song.album ? 'subsonic' : 'missing',
        albumArtist: albumArtist === 'Unknown Artist' ? 'filename_fallback' : 'subsonic',
        duration: duration ? 'subsonic' : 'unknown',
        sampleRate: cleanNumber(song.samplingRate) ? 'subsonic' : 'unknown',
        bitDepth: cleanNumber(song.bitDepth) ? 'subsonic' : 'unknown',
        bitrate: cleanNumber(song.bitRate) ? 'subsonic' : 'unknown',
        ...(albumId ? { albumId } : {}),
        ...(song.coverArt ? { coverArt: song.coverArt } : {}),
      },
      warnings: duration ? [] : ['duration_unavailable'],
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
