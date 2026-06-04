import type {
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingArtistRef,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylist,
  StreamingProviderDescriptor,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import { getAccountService } from '../../accounts/AccountService';
import { getTidalAuthService } from '../../accounts/TidalAuthService';
import { getAppSettings } from '../../app/appSettings';
import { fetchWithNetworkProxy } from '../../network/networkFetch';
import type { StreamingProvider } from '../StreamingProvider';
import { asRecord, text } from './chinaStreamingUtils';

const provider = 'tidal' as const;
const tidalApiBaseUrl = 'https://openapi.tidal.com/v2';
const tidalAuthUrl = 'https://auth.tidal.com/v1/oauth2/token';
const tidalSearchScope = 'search.read';
const tidalSearchPageSizeMax = 20;
const tokenRefreshSkewMs = 60_000;

type TidalCredentials = {
  clientId: string;
  clientSecret: string;
  countryCode: string;
};

type TidalTokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

type JsonApiResource = Record<string, unknown>;
type TidalSearchMediaType = 'track' | 'album' | 'artist' | 'playlist';

class TidalHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TidalHttpError';
  }
}

const credentialText = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const tidalCredentials = (): TidalCredentials | null => {
  const settings = getAppSettings();
  const settingsClientId = credentialText(settings.tidalClientId);
  const settingsClientSecret = credentialText(settings.tidalClientSecret);
  if (settingsClientId && settingsClientSecret) {
    return {
      clientId: settingsClientId,
      clientSecret: settingsClientSecret,
      countryCode: (credentialText(settings.tidalCountryCode) ?? 'US').toUpperCase(),
    };
  }

  const envClientId = credentialText(process.env.ECHO_TIDAL_CLIENT_ID, process.env.TIDAL_CLIENT_ID);
  const envClientSecret = credentialText(process.env.ECHO_TIDAL_CLIENT_SECRET, process.env.TIDAL_CLIENT_SECRET);
  if (!envClientId || !envClientSecret) {
    return null;
  }

  return {
    clientId: envClientId,
    clientSecret: envClientSecret,
    countryCode: (credentialText(process.env.ECHO_TIDAL_COUNTRY_CODE, process.env.TIDAL_COUNTRY_CODE) ?? 'US').toUpperCase(),
  };
};

const hasClientCredentials = (): boolean => Boolean(tidalCredentials());

const hasSearchScope = (scope: unknown): boolean =>
  typeof scope === 'string' && scope.split(/\s+/u).includes(tidalSearchScope);

const tidalAccountStatus = () => {
  try {
    return getAccountService().getStatus(provider);
  } catch {
    return null;
  }
};

const encodeBasicToken = (credentials: TidalCredentials): string =>
  Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, 'utf8').toString('base64');

const parseResponseDetail = async (response: Response): Promise<string | null> => {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string | { detail?: string; message?: string }; error_description?: string };
    if (typeof parsed.error === 'string') {
      return parsed.error_description ? `${parsed.error}: ${parsed.error_description}` : parsed.error;
    }
    if (typeof parsed.error === 'object' && parsed.error) {
      return parsed.error.message ?? parsed.error.detail ?? null;
    }
  } catch {
    return raw.trim().slice(0, 240);
  }

  return raw.trim().slice(0, 240);
};

const withTimeout = async (url: string, init: RequestInit, timeoutMs = 7000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithNetworkProxy(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const jsonApiKey = (resource: JsonApiResource): string | null => {
  const type = text(resource.type);
  const id = text(resource.id);
  return type && id ? `${type}:${id}` : null;
};

const dataResources = (value: unknown): JsonApiResource[] => {
  const data = asRecord(value).data;
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((resource) => text(resource.id) && text(resource.type));
  }
  const resource = asRecord(data);
  return text(resource.id) && text(resource.type) ? [resource] : [];
};

const includedResources = (value: unknown): JsonApiResource[] => {
  const included = asRecord(value).included;
  return Array.isArray(included)
    ? included.map(asRecord).filter((resource) => text(resource.id) && text(resource.type))
    : [];
};

const resourceIndex = (value: unknown): Map<string, JsonApiResource> => {
  const index = new Map<string, JsonApiResource>();
  for (const resource of [...dataResources(value), ...includedResources(value)]) {
    const key = jsonApiKey(resource);
    if (key && !index.has(key)) {
      index.set(key, resource);
    }
  }
  return index;
};

const relationshipRefs = (resource: JsonApiResource, name: string): JsonApiResource[] => {
  const relationship = asRecord(asRecord(resource.relationships)[name]);
  const data = relationship.data;
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((item) => text(item.id) && text(item.type));
  }
  const single = asRecord(data);
  return text(single.id) && text(single.type) ? [single] : [];
};

const relatedResources = (index: Map<string, JsonApiResource>, resource: JsonApiResource, name: string): JsonApiResource[] =>
  relationshipRefs(resource, name)
    .map((ref) => index.get(jsonApiKey(ref) ?? ''))
    .filter((item): item is JsonApiResource => Boolean(item));

const relationResourcesFromResponse = (value: unknown, name: string): JsonApiResource[] => {
  const root = dataResources(value)[0];
  const index = resourceIndex(value);
  return root ? relatedResources(index, root, name) : [];
};

const attributesOf = (resource: JsonApiResource): JsonApiResource => asRecord(resource.attributes);

const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const parseIsoDurationSeconds = (value: unknown): number | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/iu.exec(raw);
  if (!match) {
    return number(raw);
  }

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
};

const artworkUrlFrom = (resources: JsonApiResource[]): string | null => {
  const files = resources.flatMap((resource) => {
    const attributes = attributesOf(resource);
    const fileValues = Array.isArray(attributes.files) ? attributes.files.map(asRecord) : [];
    const links = Array.isArray(attributes.links) ? attributes.links.map(asRecord) : [];
    return [...fileValues, ...links];
  });

  const sorted = files
    .map((file) => ({
      href: firstText(file.href, file.url),
      width: number(file.width) ?? 0,
      height: number(file.height) ?? 0,
    }))
    .filter((file): file is { href: string; width: number; height: number } => Boolean(file.href))
    .sort((left, right) => (right.width * right.height) - (left.width * left.height));

  return sorted[0]?.href ?? null;
};

const artistRefsFrom = (resources: JsonApiResource[]): StreamingArtistRef[] =>
  resources
    .map((resource): StreamingArtistRef | null => {
      const providerArtistId = text(resource.id);
      const name = firstText(attributesOf(resource).name, attributesOf(resource).displayName);
      if (!providerArtistId || !name) {
        return null;
      }

      return {
        id: streamingStableKey(provider, `artist:${providerArtistId}`),
        provider,
        providerArtistId,
        name,
      };
    })
    .filter((artist): artist is StreamingArtistRef => Boolean(artist));

const albumShellFrom = (resource: JsonApiResource, index: Map<string, JsonApiResource>): StreamingAlbum | null => {
  const providerAlbumId = text(resource.id);
  const attributes = attributesOf(resource);
  const title = firstText(attributes.title, attributes.name);
  if (!providerAlbumId || !title) {
    return null;
  }

  const artists = artistRefsFrom(relatedResources(index, resource, 'artists'));
  const coverUrl = artworkUrlFrom(relatedResources(index, resource, 'coverArt'));
  const trackCount = number(attributes.numberOfItems) ?? number(attributes.numberOfTracks) ?? number(attributes.trackCount);

  return {
    id: streamingStableKey(provider, `album:${providerAlbumId}`),
    provider,
    providerAlbumId,
    title,
    artist: artists.map((item) => item.name).join(' / ') || 'Unknown Artist',
    artists,
    coverUrl,
    coverThumb: coverUrl,
    releaseDate: firstText(attributes.releaseDate, attributes.releaseDateTime, attributes.originalReleaseDate),
    trackCount,
  };
};

const artistFrom = (resource: JsonApiResource, index: Map<string, JsonApiResource>): StreamingArtist | null => {
  const providerArtistId = text(resource.id);
  const attributes = attributesOf(resource);
  const name = firstText(attributes.name, attributes.displayName);
  if (!providerArtistId || !name) {
    return null;
  }

  const imageUrl = artworkUrlFrom(relatedResources(index, resource, 'profileArt'));
  return {
    id: streamingStableKey(provider, `artist:${providerArtistId}`),
    provider,
    providerArtistId,
    name,
    avatarUrl: imageUrl,
    coverUrl: imageUrl,
  };
};

const trackFrom = (
  resource: JsonApiResource,
  index: Map<string, JsonApiResource>,
  fallbackAlbum?: StreamingAlbum | null,
): StreamingTrack | null => {
  const providerTrackId = text(resource.id);
  const attributes = attributesOf(resource);
  const title = firstText(attributes.title, attributes.name);
  if (!providerTrackId || !title) {
    return null;
  }

  const artists = artistRefsFrom(relatedResources(index, resource, 'artists'));
  const albumResource = relatedResources(index, resource, 'albums')[0] ?? relatedResources(index, resource, 'album')[0] ?? null;
  const album = albumResource ? albumShellFrom(albumResource, index) : fallbackAlbum ?? null;
  const coverUrl = album?.coverUrl ?? artworkUrlFrom(relatedResources(index, resource, 'coverArt'));
  const artistName = artists.map((item) => item.name).join(' / ') || album?.artist || 'Unknown Artist';

  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist: artistName,
    artists,
    album: album?.title ?? 'Unknown Album',
    albumId: album?.providerAlbumId ?? null,
    albumArtist: album?.artist ?? null,
    duration: parseIsoDurationSeconds(attributes.duration),
    coverUrl,
    coverThumb: coverUrl,
    qualities: ['standard'],
    explicit: attributes.explicit === true || attributes.explicitContent === true,
    playable: false,
    unavailableReason: 'TIDAL metadata only. Use the official TIDAL player for playback.',
    lyricsStatus: 'missing',
    mvStatus: 'missing',
  };
};

const playlistFrom = (resource: JsonApiResource, index: Map<string, JsonApiResource>): StreamingPlaylist | null => {
  const providerPlaylistId = text(resource.id);
  const attributes = attributesOf(resource);
  const title = firstText(attributes.title, attributes.name);
  if (!providerPlaylistId || !title) {
    return null;
  }

  const coverUrl = artworkUrlFrom(relatedResources(index, resource, 'coverArt'));
  return {
    id: streamingStableKey(provider, `playlist:${providerPlaylistId}`),
    provider,
    providerPlaylistId,
    title,
    description: text(attributes.description),
    creator: null,
    coverUrl,
    coverThumb: coverUrl,
    trackCount: number(attributes.numberOfItems) ?? number(attributes.trackCount),
  };
};

const hasNextPage = (value: unknown): boolean => Boolean(text(asRecord(asRecord(value).links).next));

const resourceIds = (value: unknown, type: string, limit: number): string[] =>
  Array.from(new Set(dataResources(value)
    .filter((resource) => text(resource.type) === type)
    .map((resource) => text(resource.id))
    .filter((id): id is string => Boolean(id))))
    .slice(0, limit);

const isTidalSearchMediaType = (type: string): type is TidalSearchMediaType =>
  type === 'track' || type === 'album' || type === 'artist' || type === 'playlist';

export class TidalStreamingProvider implements StreamingProvider {
  readonly name = provider;
  private tokenCache: TidalTokenCache | null = null;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = tidalAccountStatus();
    const configured = Boolean(status?.connected) || hasClientCredentials();
    return {
      displayName: 'TIDAL',
      enabled: configured,
      supportsSearch: configured,
      supportsPlayback: false,
      supportsDownload: false,
      supportsLyrics: false,
      supportsMv: false,
      requiresAccount: true,
      accountConnected: Boolean(status?.connected) || configured,
      accountDisplayName: status?.displayName ?? (configured ? 'Custom developer credentials' : null),
      accountUsername: status?.username ?? null,
      accountAvatarUrl: status?.avatarUrl ?? null,
      status: configured ? (status?.connected && status.error ? 'error' : 'ready') : 'needs_account',
      statusMessage: configured
        ? 'TIDAL catalog metadata is available with OAuth. Playback stays on the official TIDAL player.'
        : 'Sign in to TIDAL from Settings > Integrations to enable catalog metadata.',
    };
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(tidalSearchPageSizeMax, Math.max(1, Math.floor(request.pageSize ?? tidalSearchPageSizeMax)));
    const mediaTypes: TidalSearchMediaType[] = request.mediaTypes?.length
      ? request.mediaTypes.filter(isTidalSearchMediaType)
      : ['track'];
    return this.searchRelationships(request.query, mediaTypes, page, pageSize);
  }

  private async searchRelationships(
    query: string,
    mediaTypes: Array<'track' | 'album' | 'artist' | 'playlist'>,
    page: number,
    pageSize: number,
  ): Promise<StreamingSearchResult> {
    const tracks = mediaTypes.includes('track')
      ? await this.searchTracksByRelationship(query, pageSize)
      : [];
    const albums = mediaTypes.includes('album')
      ? await this.searchAlbumsByRelationship(query, pageSize)
      : [];
    const artists = mediaTypes.includes('artist')
      ? await this.searchArtistsByRelationship(query, pageSize)
      : [];
    const playlists = mediaTypes.includes('playlist')
      ? await this.searchPlaylistsByRelationship(query, pageSize)
      : [];

    return {
      provider,
      query,
      page,
      pageSize,
      total: null,
      hasMore: false,
      tracks,
      albums,
      artists,
      playlists,
      mvs: [],
    };
  }

  private async searchTracksByRelationship(query: string, pageSize: number): Promise<StreamingTrack[]> {
    const relation = await this.apiJson(
      `/searchResults/${encodeURIComponent(query)}/relationships/tracks?include=tracks&explicitFilter=include`,
    );
    const ids = resourceIds(relation, 'tracks', pageSize);
    if (!ids.length) {
      return [];
    }

    const data = await this.apiJson(
      `/tracks?filter[id]=${encodeURIComponent(ids.join(','))}&include=artists,albums,coverArt`,
    );
    const index = resourceIndex(data);
    return dataResources(data)
      .map((item) => trackFrom(item, index))
      .filter((item): item is StreamingTrack => Boolean(item));
  }

  private async searchAlbumsByRelationship(query: string, pageSize: number): Promise<StreamingAlbum[]> {
    const relation = await this.apiJson(
      `/searchResults/${encodeURIComponent(query)}/relationships/albums?include=albums&explicitFilter=include`,
    );
    const ids = resourceIds(relation, 'albums', pageSize);
    if (!ids.length) {
      return [];
    }

    const data = await this.apiJson(
      `/albums?filter[id]=${encodeURIComponent(ids.join(','))}&include=artists,coverArt`,
    );
    const index = resourceIndex(data);
    return dataResources(data)
      .map((item) => albumShellFrom(item, index))
      .filter((item): item is StreamingAlbum => Boolean(item));
  }

  private async searchArtistsByRelationship(query: string, pageSize: number): Promise<StreamingArtist[]> {
    const relation = await this.apiJson(
      `/searchResults/${encodeURIComponent(query)}/relationships/artists?include=artists&explicitFilter=include`,
    );
    const ids = resourceIds(relation, 'artists', pageSize);
    if (!ids.length) {
      return [];
    }

    const data = await this.apiJson(
      `/artists?filter[id]=${encodeURIComponent(ids.join(','))}&include=profileArt`,
    );
    const index = resourceIndex(data);
    return dataResources(data)
      .map((item) => artistFrom(item, index))
      .filter((item): item is StreamingArtist => Boolean(item));
  }

  private async searchPlaylistsByRelationship(query: string, pageSize: number): Promise<StreamingPlaylist[]> {
    const relation = await this.apiJson(
      `/searchResults/${encodeURIComponent(query)}/relationships/playlists?include=playlists&explicitFilter=include`,
    );
    const ids = resourceIds(relation, 'playlists', pageSize);
    if (!ids.length) {
      return [];
    }

    const data = await this.apiJson(
      `/playlists?filter[id]=${encodeURIComponent(ids.join(','))}&include=coverArt`,
    );
    const index = resourceIndex(data);
    return dataResources(data)
      .map((item) => playlistFrom(item, index))
      .filter((item): item is StreamingPlaylist => Boolean(item));
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const data = await this.apiJson(
      `/tracks/${encodeURIComponent(input.providerTrackId)}?include=artists,albums,coverArt`,
    );
    const index = resourceIndex(data);
    const track = trackFrom(dataResources(data)[0] ?? {}, index);
    if (!track) {
      throw new Error('TIDAL track metadata is unavailable.');
    }
    return track;
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    const data = await this.apiJson(
      `/albums/${encodeURIComponent(input.providerAlbumId)}?include=artists,coverArt,items`,
    );
    const index = resourceIndex(data);
    const album = albumShellFrom(dataResources(data)[0] ?? {}, index);
    if (!album) {
      throw new Error('TIDAL album metadata is unavailable.');
    }

    const tracks = relatedResources(index, dataResources(data)[0] ?? {}, 'items')
      .map((item) => trackFrom(item, index, album))
      .filter((item): item is StreamingTrack => Boolean(item));

    return {
      ...album,
      tracks,
    };
  }

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    const data = await this.apiJson(
      `/artists/${encodeURIComponent(input.providerArtistId)}?include=profileArt,tracks,albums`,
    );
    const index = resourceIndex(data);
    const resource = dataResources(data)[0] ?? {};
    const artist = artistFrom(resource, index);
    if (!artist) {
      throw new Error('TIDAL artist metadata is unavailable.');
    }

    const topTracks = relatedResources(index, resource, 'tracks')
      .map((item) => trackFrom(item, index))
      .filter((item): item is StreamingTrack => Boolean(item));
    const albums = relatedResources(index, resource, 'albums')
      .map((item) => albumShellFrom(item, index))
      .filter((item): item is StreamingAlbum => Boolean(item));

    return {
      ...artist,
      topTracks,
      albums,
    };
  }

  async resolvePlayback(_request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    void _request;
    throw new Error('TIDAL is metadata-only in ECHO. Full playback must use the official TIDAL player or embed.');
  }

  private async apiJson(path: string): Promise<unknown> {
    const { token, countryCode } = await this.getAccessToken();
    const separator = path.includes('?') ? '&' : '?';
    const url = `${tidalApiBaseUrl}${path}${separator}countryCode=${encodeURIComponent(countryCode)}`;
    const response = await withTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'ECHO-Next/0.1',
      },
    });

    if (!response.ok) {
      const detail = await parseResponseDetail(response);
      if (response.status === 401) {
        throw new TidalHttpError('TIDAL API credentials are invalid or expired.', response.status);
      }
      if (response.status === 403) {
        throw new TidalHttpError('TIDAL API access is denied for this app or region.', response.status);
      }
      if (response.status === 404) {
        throw new TidalHttpError('TIDAL content was not found or is unavailable.', response.status);
      }
      throw new TidalHttpError(`TIDAL request failed: ${response.status}${detail ? ` (${detail})` : ''}`, response.status);
    }

    return response.json();
  }

  private async getAccessToken(): Promise<{ token: string; countryCode: string }> {
    const accountStatus = tidalAccountStatus();
    if (accountStatus?.connected) {
      const accountService = getAccountService();
      const record = accountService.getTidalTokenRecord();
      if (!hasSearchScope(record?.scope)) {
        throw new Error('TIDAL login is missing the search.read scope. Clear TIDAL login, save scopes in TIDAL Dashboard, then sign in again.');
      }

      const authService = getTidalAuthService();
      const token = await authService.getAccessToken();
      const refreshedRecord = accountService.getTidalTokenRecord();
      if (!hasSearchScope(refreshedRecord?.scope)) {
        throw new Error('TIDAL login is missing the search.read scope. Clear TIDAL login, save scopes in TIDAL Dashboard, then sign in again.');
      }

      return {
        token,
        countryCode: authService.getCountryCode(),
      };
    }

    const credentials = tidalCredentials();
    if (!credentials) {
      throw new Error('TIDAL catalog search requires TIDAL OAuth sign-in from Settings > Integrations.');
    }

    if (this.tokenCache && this.tokenCache.expiresAtMs - tokenRefreshSkewMs > Date.now()) {
      return {
        token: this.tokenCache.accessToken,
        countryCode: credentials.countryCode,
      };
    }

    const response = await withTimeout(tidalAuthUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${encodeBasicToken(credentials)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ECHO-Next/0.1',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: tidalSearchScope }).toString(),
    });

    if (!response.ok) {
      const detail = await parseResponseDetail(response);
      throw new Error(`TIDAL login failed: ${response.status}${detail ? ` (${detail})` : ''}`);
    }

    const data = asRecord(await response.json());
    const accessToken = text(data.access_token);
    if (!accessToken) {
      throw new Error('TIDAL login did not return an access token.');
    }
    if (!hasSearchScope(data.scope)) {
      throw new Error('TIDAL catalog search requires the search.read scope. Enable Search API access for this app in TIDAL Developer Dashboard, then save credentials and try again.');
    }

    const expiresInSeconds = number(data.expires_in) ?? 3600;
    this.tokenCache = {
      accessToken,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
    };

    return {
      token: accessToken,
      countryCode: credentials.countryCode,
    };
  }
}
