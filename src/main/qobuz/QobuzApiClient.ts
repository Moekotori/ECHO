import { createHash } from 'node:crypto';
import type { QobuzBundleSecrets, QobuzFormatId, QobuzTrackFileUrl, QobuzTrackFileUrlRaw, QobuzTrackItem } from '../../shared/types/qobuz';
import { fetchWithNetworkProxy } from '../network/networkFetch';

const QOBUZ_API_BASE = 'https://www.qobuz.com/api.json/0.2/';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0';

export class QobuzApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly qobuzErrorCode?: string,
  ) {
    super(message);
    this.name = 'QobuzApiError';
  }
}

export class QobuzAuthError extends QobuzApiError {
  constructor(message: string, statusCode = 401) {
    super(message, statusCode);
    this.name = 'QobuzAuthError';
  }
}

export class InvalidAppSecretError extends QobuzApiError {
  constructor() {
    super('Invalid app secret', 400, 'InvalidAppSecretError');
    this.name = 'InvalidAppSecretError';
  }
}

export class InvalidAppIdError extends QobuzApiError {
  constructor() {
    super('Invalid app id', 400, 'InvalidAppIdError');
    this.name = 'InvalidAppIdError';
  }
}

export class NonStreamableError extends Error {
  constructor(message = 'This content is not streamable') {
    super(message);
    this.name = 'NonStreamableError';
  }
}

// ── Qobuz API client ──────────────────────────────────────────────

export class QobuzApiClient {
  private appId = '';
  private userAuthToken = '';
  private activeSecret = '';

  // ── credential setters ──────────────────────────────────────────

  setAppId(value: string): void {
    this.appId = value;
  }

  setUserAuthToken(value: string): void {
    this.userAuthToken = value;
  }

  setActiveSecret(value: string): void {
    this.activeSecret = value;
  }

  getAppId(): string {
    return this.appId;
  }

  getUserAuthToken(): string {
    return this.userAuthToken;
  }

  getActiveSecret(): string {
    return this.activeSecret;
  }

  // ── private helpers ─────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json;charset=UTF-8',
    };
    if (this.appId) h['X-App-Id'] = this.appId;
    if (this.userAuthToken) h['X-User-Auth-Token'] = this.userAuthToken;
    return h;
  }

  private async apiCall<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = new URL(endpoint, QOBUZ_API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetchWithNetworkProxy(url.toString(), {
      method: 'GET',
      headers: this.headers(),
    });

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok) {
      this.handleError(response.status, body);
    }

    return body as T;
  }

  private handleError(status: number, body: Record<string, unknown> | null): never {
    const code = typeof body?.code === 'string' ? body.code : undefined;
    const message = typeof body?.message === 'string' ? body.message : undefined;

    if (status === 400) {
      if (code === 'InvalidAppSecretError') throw new InvalidAppSecretError();
      if (code === 'InvalidAppIdError') throw new InvalidAppIdError();
      if (message?.includes('Invalid email') === true) throw new QobuzAuthError('邮箱或密码错误', 400);
    }
    if (status === 401) throw new QobuzAuthError('认证已过期，请重新登录', 401);
    if (status === 403) throw new QobuzAuthError('账户无权访问此内容', 403);
    if (status === 429) throw new QobuzApiError('请求过于频繁，请稍后重试', 429);

    throw new QobuzApiError(message ?? `Qobuz API error (HTTP ${status})`, status, code);
  }

  // ── request signing ─────────────────────────────────────────────

  /**
   * Sign an API request with MD5 hash.
   * Required for: track/getFileUrl, favorite/getUserFavorites
   */
  signRequest(endpointName: string, params: Record<string, string | number>, unixTs: number): string {
    let raw = endpointName;
    for (const [key, value] of Object.entries(params)) {
      raw += `${key}${value}`;
    }
    raw += `${unixTs}${this.activeSecret}`;
    return createHash('md5').update(raw).digest('hex');
  }

  // ── auth endpoints ──────────────────────────────────────────────

  async loginWithToken(token: string): Promise<{ user_auth_token: string; user: Record<string, unknown> }> {
    return this.apiCall('user/login', {
      user_auth_token: token,
      app_id: this.appId,
    });
  }

  async loginWithPassword(email: string, passwordMd5: string): Promise<{ user_auth_token: string; user: Record<string, unknown> }> {
    return this.apiCall('user/login', {
      email,
      password: passwordMd5,
      app_id: this.appId,
    });
  }

  // ── search endpoints ────────────────────────────────────────────

  async searchTracks(query: string, limit = 50): Promise<Record<string, unknown>> {
    return this.apiCall('track/search', { query, limit });
  }

  async searchAlbums(query: string, limit = 50): Promise<Record<string, unknown>> {
    return this.apiCall('album/search', { query, limit });
  }

  async searchArtists(query: string, limit = 10): Promise<Record<string, unknown>> {
    return this.apiCall('artist/search', { query, limit });
  }

  async searchPlaylists(query: string, limit = 50): Promise<Record<string, unknown>> {
    return this.apiCall('playlist/search', { query, limit });
  }

  // ── detail endpoints ────────────────────────────────────────────

  async getTrack(trackId: string): Promise<Record<string, unknown>> {
    return this.apiCall('track/get', { track_id: trackId });
  }

  async getAlbum(albumId: string, offset = 0): Promise<Record<string, unknown>> {
    return this.apiCall('album/get', { album_id: albumId, offset });
  }

  async getArtist(artistId: string, limit = 500, offset = 0): Promise<Record<string, unknown>> {
    return this.apiCall('artist/get', {
      artist_id: artistId,
      extra: 'albums',
      limit,
      offset,
      app_id: this.appId,
    });
  }

  async getPlaylist(playlistId: string, limit = 500, offset = 0): Promise<Record<string, unknown>> {
    return this.apiCall('playlist/get', {
      playlist_id: playlistId,
      extra: 'tracks',
      limit,
      offset,
    });
  }

  // ── signed endpoints ────────────────────────────────────────────

  /**
   * Get a signed streaming/download URL for a track.
   * This is the core method that requires MD5 request signing.
   */
  async getTrackFileUrl(trackId: string, formatId: QobuzFormatId): Promise<QobuzTrackFileUrl> {
    const unixTs = Math.floor(Date.now() / 1000);
    const sig = this.signRequest('trackgetFileUrl', {
      format_id: formatId,
      intent: 'stream',
      track_id: trackId,
    }, unixTs);

    const raw = await this.apiCall<QobuzTrackFileUrlRaw>('track/getFileUrl', {
      track_id: trackId,
      format_id: formatId,
      intent: 'stream',
      request_ts: unixTs,
      request_sig: sig,
    });
    // Map snake_case API response to camelCase
    return {
      url: raw.url,
      trackId: raw.track_id,
      duration: raw.duration,
      formatId: raw.format_id,
      mimeType: raw.mime_type,
      bitDepth: raw.bit_depth ?? null,
      sampleRate: raw.sampling_rate ?? null,
      restrictions: raw.restrictions,
    };
  }

  async getUserFavorites(limit = 500, offset = 0): Promise<Record<string, unknown>> {
    const unixTs = Math.floor(Date.now() / 1000);
    const sig = this.signRequest('favoritegetUserFavorites', {}, unixTs);

    return this.apiCall('favorite/getUserFavorites', {
      type: 'tracks',
      limit,
      offset,
      app_id: this.appId,
      user_auth_token: this.userAuthToken,
      request_ts: unixTs,
      request_sig: sig,
    });
  }

  // ── user playlist endpoints ─────────────────────────────────────

  async getUserPlaylists(limit = 500): Promise<Record<string, unknown>> {
    return this.apiCall('playlist/getUserPlaylists', { limit });
  }

  // ── test endpoint (used during secret validation) ───────────────

  /**
   * Test if a given secret is valid by attempting to get a file URL
   * for a well-known track. Used by QobuzAuthService during setup.
   */
  async testSecret(secret: string): Promise<boolean> {
    const previousSecret = this.activeSecret;
    this.activeSecret = secret;
    try {
      await this.getTrackFileUrl('5966783', 5);
      return true;
    } catch {
      this.activeSecret = previousSecret;
      return false;
    }
  }

  // ── static: bundle fetching (no auth needed) ────────────────────

  /**
   * Fetch the Qobuz web login page. No authentication needed.
   * Returns the raw HTML text for bundle URL extraction.
   */
  static async fetchLoginPage(): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchWithNetworkProxy('https://play.qobuz.com/login', {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new QobuzApiError(`Failed to fetch Qobuz login page (HTTP ${response.status})`, response.status);
      }
      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch the Qobuz JS bundle at a given path.
   * Used by QobuzBundleExtractor for app_id / secret extraction.
   */
  static async fetchBundle(bundlePath: string): Promise<string> {
    const url = `https://play.qobuz.com${bundlePath}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchWithNetworkProxy(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new QobuzApiError(`Failed to fetch bundle (HTTP ${response.status})`, response.status);
      }
      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
