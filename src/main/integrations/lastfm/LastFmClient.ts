import { createHash } from 'node:crypto';
import type { LastFmAuthStartResult, LastFmTrackPayload } from '../../../shared/types/lastfm';

export const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_API_KEY = process.env.ECHO_LASTFM_API_KEY || 'c9badea6f4f4d280800653b9458d3dbd';
// TODO: Confirm whether ECHO-Next should use a new production Last.fm application secret before release.
export const LASTFM_API_SECRET = process.env.ECHO_LASTFM_API_SECRET || '0f6494a849ea09829817963350eab8e7';

type LastFmParams = Record<string, string | number | null | undefined>;

type LastFmApiResponse = Record<string, unknown> & {
  error?: number;
  message?: string;
};

export type LastFmApiResult = {
  ok: boolean;
  skipped?: boolean;
  errorCode?: number;
  error?: string;
  response?: LastFmApiResponse;
};

export type LastFmSessionResult = LastFmApiResult & {
  username?: string;
  sessionKey?: string;
};

type LastFmClientOptions = {
  apiKey?: string;
  apiSecret?: string;
  fetchImpl?: typeof fetch;
};

const timeoutMs = 8000;

const toErrorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export class LastFmClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;
  private sessionKey: string | null = null;
  private username: string | null = null;

  constructor(options: LastFmClientOptions = {}) {
    this.apiKey = options.apiKey ?? LASTFM_API_KEY;
    this.apiSecret = options.apiSecret ?? LASTFM_API_SECRET;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  sign(params: LastFmParams): string {
    const base = Object.keys(params)
      .filter((key) => key !== 'format' && params[key] !== null && params[key] !== undefined && params[key] !== '')
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${key}${params[key]}`)
      .join('');

    return createHash('md5').update(`${base}${this.apiSecret}`, 'utf8').digest('hex');
  }

  async authenticateWithPassword(username: string, password: string): Promise<LastFmSessionResult> {
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '');
    if (!normalizedUsername || !normalizedPassword) {
      return { ok: false, error: 'Please enter a Last.fm username and password' };
    }

    const params = {
      method: 'auth.getMobileSession',
      username: normalizedUsername,
      password: normalizedPassword,
      api_key: this.apiKey,
    };
    const data = await this.postSigned(params);
    return this.applySessionResponse(data, normalizedUsername);
  }

  async createWebAuthToken(): Promise<LastFmAuthStartResult> {
    const params = {
      method: 'auth.getToken',
      api_key: this.apiKey,
    };
    const data = await this.postSigned(params);

    if (typeof data.token === 'string' && data.token.trim()) {
      const token = data.token.trim();
      return {
        ok: true,
        token,
        url: this.getAuthorizationUrl(token),
      };
    }

    return {
      ok: false,
      error: this.errorMessageFromResponse(data) || 'Unable to start Last.fm authorization',
    };
  }

  getAuthorizationUrl(token: string): string {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      token: String(token || '').trim(),
    });

    return `https://www.last.fm/api/auth/?${params.toString()}`;
  }

  async completeWebAuth(token: string): Promise<LastFmSessionResult> {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      return { ok: false, error: 'Last.fm authorization has not been approved yet' };
    }

    const params = {
      method: 'auth.getSession',
      api_key: this.apiKey,
      token: normalizedToken,
    };
    const data = await this.postSigned(params);
    return this.applySessionResponse(data);
  }

  async updateNowPlaying(payload: LastFmTrackPayload): Promise<LastFmApiResult> {
    if (!this.sessionKey) {
      return { ok: false, skipped: true };
    }

    const params: LastFmParams = {
      method: 'track.updateNowPlaying',
      artist: payload.artist,
      track: payload.title,
      api_key: this.apiKey,
      sk: this.sessionKey,
    };

    if (payload.album) {
      params.album = payload.album;
    }

    if (payload.duration > 0) {
      params.duration = Math.round(payload.duration);
    }

    return this.postTrackUpdate(params);
  }

  async scrobble(payload: LastFmTrackPayload): Promise<LastFmApiResult> {
    if (!this.sessionKey) {
      return { ok: false, skipped: true };
    }

    const timestamp = payload.timestamp ?? Math.max(1, Math.floor(Date.now() / 1000));
    const params: LastFmParams = {
      method: 'track.scrobble',
      artist: payload.artist,
      track: payload.title,
      timestamp,
      api_key: this.apiKey,
      sk: this.sessionKey,
    };

    if (payload.album) {
      params.album = payload.album;
    }

    if (payload.duration > 0) {
      params.duration = Math.round(payload.duration);
    }

    return this.postTrackUpdate(params);
  }

  setSession(sessionKey: string | null, username: string | null): void {
    this.sessionKey = sessionKey || null;
    this.username = username || null;
  }

  clearSession(): void {
    this.sessionKey = null;
    this.username = null;
  }

  getSession(): { username: string | null; sessionKey: string | null } {
    return {
      username: this.username,
      sessionKey: this.sessionKey,
    };
  }

  private async postTrackUpdate(params: LastFmParams): Promise<LastFmApiResult> {
    const artist = String(params.artist || '').trim();
    const track = String(params.track || '').trim();
    if (!artist || !track) {
      return { ok: false, skipped: true };
    }

    try {
      const data = await this.postSigned(params);
      if (data.error) {
        return {
          ok: false,
          errorCode: data.error,
          error: this.errorMessageFromResponse(data) || 'Last.fm request failed',
          response: data,
        };
      }

      return { ok: true, response: data };
    } catch (error) {
      return { ok: false, error: toErrorText(error) };
    }
  }

  private async postSigned(params: LastFmParams): Promise<LastFmApiResponse> {
    return this.post({
      ...params,
      api_sig: this.sign(params),
    });
  }

  private async post(params: LastFmParams): Promise<LastFmApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = new URLSearchParams();

    for (const [key, value] of Object.entries({ ...params, format: 'json' })) {
      if (value !== null && value !== undefined && value !== '') {
        body.set(key, String(value));
      }
    }

    try {
      const response = await this.fetchImpl(LASTFM_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? (JSON.parse(text) as LastFmApiResponse) : {};

      if (!response.ok && !data.error) {
        return { error: response.status, message: response.statusText || 'Last.fm request failed' };
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private applySessionResponse(data: LastFmApiResponse, fallbackUsername: string | null = null): LastFmSessionResult {
    const session = data.session;
    if (session && typeof session === 'object') {
      const rawSession = session as Record<string, unknown>;
      const sessionKey = typeof rawSession.key === 'string' ? rawSession.key.trim() : '';
      if (sessionKey) {
        const username = typeof rawSession.name === 'string' && rawSession.name.trim() ? rawSession.name.trim() : fallbackUsername;
        this.setSession(sessionKey, username);
        return { ok: true, username: username ?? undefined, sessionKey };
      }
    }

    return {
      ok: false,
      errorCode: data.error,
      error: this.errorMessageFromResponse(data) || 'Last.fm authorization failed',
      response: data,
    };
  }

  private errorMessageFromResponse(data: LastFmApiResponse): string | null {
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }

    if (data.error === 10) {
      return 'Last.fm API key is invalid';
    }

    if (data.error === 14) {
      return 'Last.fm authorization has not been approved yet';
    }

    return null;
  }
}
