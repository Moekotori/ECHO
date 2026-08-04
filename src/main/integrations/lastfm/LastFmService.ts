import type { AudioStatus } from '../../../shared/types/audio';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { LastFmAuthStartResult, LastFmStatus, LastFmTrackPayload } from '../../../shared/types/lastfm';
import type { LibraryTrack } from '../../../shared/types/library';
import { getAppSettings, setAppSettings } from '../../app/appSettings';
import { getAudioSession } from '../../audio/AudioSession';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { getLibraryService } from '../../library/LibraryService';
import { LastFmClient, type LastFmApiResult } from './LastFmClient';
import { buildLastFmTrackIdentity, buildLastFmTrackPayload, getLastFmScrobbleThresholdSec } from './LastFmTrackPayload';

type LastFmLogger = {
  info: (message: string, payload?: unknown) => void;
  warn: (message: string, payload?: unknown) => void;
};

type ActiveLastFmSession = {
  identity: string;
  payload: LastFmTrackPayload;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  lastPositionSeconds: number;
  playedSeconds: number;
  thresholdSeconds: number;
  nowPlayingSent: boolean;
  scrobbled: boolean;
  state: AudioStatus['state'];
};

type LastFmServiceOptions = {
  client?: LastFmServiceClient;
  logger?: LastFmLogger;
  now?: () => number;
  getSettings?: () => AppSettings;
  setSettings?: (patch: Partial<AppSettings>) => AppSettings;
  getTrack?: (trackId: string) => LibraryTrack | null;
};

type LastFmServiceClient = Pick<
  LastFmClient,
  | 'authenticateWithPassword'
  | 'clearSession'
  | 'completeWebAuth'
  | 'createWebAuthToken'
  | 'getAuthorizationUrl'
  | 'scrobble'
  | 'setSession'
  | 'updateNowPlaying'
>;

const requestBackoffMs = 30_000;
const nowPlayingDuplicateMs = 30_000;
const terminalStates = new Set<AudioStatus['state']>(['idle', 'stopped', 'ended', 'error']);
const isStreamingValue = (value: unknown): boolean => typeof value === 'string' && value.startsWith('streaming:');
const isStreamingStatus = (status: AudioStatus): boolean =>
  isStreamingValue(status.currentTrackId) || isStreamingValue(status.currentFilePath);

const defaultLogger = (): LastFmLogger => ({
  info: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.info('main', message, payload);
  },
  warn: (message: string, payload?: unknown): void => {
    getCrashReportService().getLogger()?.warn('main', message, payload);
    console.warn(message, payload ?? '');
  },
});

const sanitizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export class LastFmService {
  private readonly client: LastFmServiceClient;
  private readonly logger: LastFmLogger;
  private readonly now: () => number;
  private readonly getSettingsValue: () => AppSettings;
  private readonly setSettingsValue: (patch: Partial<AppSettings>) => AppSettings;
  private readonly getTrack: (trackId: string) => LibraryTrack | null;
  private activeSession: ActiveLastFmSession | null = null;
  private lastError: string | null = null;
  private lastNowPlayingAt: string | null = null;
  private lastScrobbleAt: string | null = null;
  private lastFailedRequestAt = 0;
  private lastNowPlayingIdentity: string | null = null;
  private lastNowPlayingIdentityAt = 0;

  constructor(options: LastFmServiceOptions = {}) {
    this.client = options.client ?? new LastFmClient();
    this.logger = options.logger ?? defaultLogger();
    this.now = options.now ?? Date.now;
    this.getSettingsValue = options.getSettings ?? getAppSettings;
    this.setSettingsValue = options.setSettings ?? setAppSettings;
    this.getTrack = options.getTrack ?? ((trackId) => getLibraryService().getTrack(trackId));
    this.syncClientSession();
  }

  initialize(): void {
    this.syncClientSession();
    this.updateFromAudioStatus(getAudioSession().getStatus());
  }

  async dispose(): Promise<void> {
    await this.finishActiveSession({ flush: true });
  }

  getStatus(): LastFmStatus {
    const settings = this.getSettingsValue();

    return {
      enabled: settings.lastFmEnabled,
      scrobbleEnabled: settings.lastFmScrobbleEnabled,
      nowPlayingEnabled: settings.lastFmNowPlayingEnabled,
      connected: Boolean(settings.lastFmSessionKey),
      authPending: Boolean(!settings.lastFmSessionKey && settings.lastFmAuthToken),
      username: settings.lastFmUsername,
      lastError: this.lastError,
      lastNowPlayingAt: this.lastNowPlayingAt,
      lastScrobbleAt: this.lastScrobbleAt,
      activeTrack: this.activeSession
        ? {
            artist: this.activeSession.payload.artist,
            title: this.activeSession.payload.title,
            album: this.activeSession.payload.album || null,
            playedSeconds: Math.round(this.activeSession.playedSeconds),
            thresholdSeconds: Math.round(this.activeSession.thresholdSeconds),
            scrobbled: this.activeSession.scrobbled,
          }
        : null,
    };
  }

  setEnabled(enabled: boolean): LastFmStatus {
    this.setSettingsValue({ lastFmEnabled: enabled });
    if (!enabled) {
      this.activeSession = null;
    }

    return this.getStatus();
  }

  setNowPlayingEnabled(enabled: boolean): LastFmStatus {
    this.setSettingsValue({ lastFmNowPlayingEnabled: enabled });
    return this.getStatus();
  }

  setScrobbleEnabled(enabled: boolean): LastFmStatus {
    this.setSettingsValue({ lastFmScrobbleEnabled: enabled });
    return this.getStatus();
  }

  async createAuthToken(): Promise<LastFmAuthStartResult> {
    try {
      const result = await this.client.createWebAuthToken();
      if (result.ok && result.token) {
        this.setSettingsValue({ lastFmAuthToken: result.token });
        this.logger.info('[Last.fm] auth token created');
      } else {
        this.lastError = result.error ?? 'Unable to start Last.fm authorization';
        this.logger.warn('[Last.fm] auth token creation failed', { error: this.lastError });
      }

      return result;
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] auth token creation failed', { error: this.lastError });
      return { ok: false, error: this.lastError };
    }
  }

  getAuthorizationUrl(token: string): string {
    return this.client.getAuthorizationUrl(token);
  }

  async completeAuth(token: string): Promise<LastFmStatus> {
    const authToken = token.trim() || this.getSettingsValue().lastFmAuthToken || '';

    try {
      const result = await this.client.completeWebAuth(authToken);
      if (result.ok && result.sessionKey) {
        this.setSettingsValue({
          lastFmEnabled: true,
          lastFmUsername: result.username ?? null,
          lastFmSessionKey: result.sessionKey,
          lastFmAuthToken: null,
        });
        this.lastError = null;
        this.logger.info('[Last.fm] auth completed', { username: result.username ?? null });
      } else {
        this.lastError = result.error ?? 'Last.fm authorization failed';
        if (result.errorCode === 14 || /token/i.test(this.lastError)) {
          this.setSettingsValue({ lastFmAuthToken: null });
        }
        this.logger.warn('[Last.fm] auth completion failed', { error: this.lastError, errorCode: result.errorCode });
      }
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] auth completion failed', { error: this.lastError });
    }

    this.syncClientSession();
    return this.getStatus();
  }

  async authenticateWithPassword(username: string, password: string): Promise<LastFmStatus> {
    try {
      const result = await this.client.authenticateWithPassword(username, password);
      if (result.ok && result.sessionKey) {
        this.setSettingsValue({
          lastFmEnabled: true,
          lastFmUsername: result.username ?? username.trim(),
          lastFmSessionKey: result.sessionKey,
          lastFmAuthToken: null,
        });
        this.lastError = null;
        this.logger.info('[Last.fm] password auth completed', { username: result.username ?? username.trim() });
      } else {
        this.lastError = result.error ?? 'Last.fm login failed';
        this.logger.warn('[Last.fm] password auth failed', { error: this.lastError, errorCode: result.errorCode });
      }
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] password auth failed', { error: this.lastError });
    }

    this.syncClientSession();
    return this.getStatus();
  }

  disconnect(): LastFmStatus {
    this.client.clearSession();
    this.activeSession = null;
    this.setSettingsValue({
      lastFmUsername: null,
      lastFmSessionKey: null,
      lastFmAuthToken: null,
    });
    this.lastError = null;
    this.logger.info('[Last.fm] disconnected');
    return this.getStatus();
  }

  updateFromAudioStatus(status: AudioStatus): void {
    try {
      this.updateElapsed(status);

      if (!this.activeSession && status.state !== 'playing') {
        return;
      }

      const identity = this.identityFromStatus(status);
      const shouldFinish = this.activeSession && (!identity || identity !== this.activeSession.identity || terminalStates.has(status.state));
      if (shouldFinish) {
        void this.finishActiveSession({ flush: status.state === 'stopped' || status.state === 'ended' || identity !== this.activeSession?.identity });
      }

      if (terminalStates.has(status.state) || !identity) {
        return;
      }

      if (!this.activeSession || this.activeSession.identity !== identity) {
        this.activeSession = this.createSession(status, identity);
        if (this.activeSession) {
          void this.sendNowPlayingIfNeeded();
        }
      }

      if (this.activeSession) {
        this.activeSession.state = status.state;
        this.activeSession.lastPositionSeconds = status.positionSeconds;
        this.activeSession.lastUpdatedAtMs = this.now();
        void this.scrobbleIfReady();
      }
    } catch (error) {
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] status update failed', { error: this.lastError });
    }
  }

  private createSession(status: AudioStatus, identity: string): ActiveLastFmSession | null {
    const payload = this.payloadFromStatus(status);
    if (!payload) {
      return null;
    }

    const now = this.now();
    return {
      identity,
      payload,
      startedAtMs: now,
      lastUpdatedAtMs: now,
      lastPositionSeconds: status.positionSeconds,
      playedSeconds: 0,
      thresholdSeconds: getLastFmScrobbleThresholdSec(payload.duration, this.getSettingsValue().lastFmMinScrobbleSeconds),
      nowPlayingSent: false,
      scrobbled: false,
      state: status.state,
    };
  }

  private updateElapsed(status: AudioStatus): void {
    if (!this.activeSession) {
      return;
    }

    const now = this.now();
    if (this.activeSession.state === 'playing') {
      const elapsedSeconds = Math.max(0, (now - this.activeSession.lastUpdatedAtMs) / 1000);
      this.activeSession.playedSeconds += Math.min(elapsedSeconds, 30);
    }

    this.activeSession.lastUpdatedAtMs = now;
    this.activeSession.lastPositionSeconds = status.positionSeconds;
  }

  private async sendNowPlayingIfNeeded(): Promise<void> {
    const session = this.activeSession;
    const settings = this.getSettingsValue();
    if (!session || session.nowPlayingSent || !settings.lastFmEnabled || !settings.lastFmNowPlayingEnabled || !settings.lastFmSessionKey) {
      return;
    }

    const now = this.now();
    if (session.identity === this.lastNowPlayingIdentity && now - this.lastNowPlayingIdentityAt < nowPlayingDuplicateMs) {
      session.nowPlayingSent = true;
      return;
    }

    if (!this.canSendRequest()) {
      return;
    }

    session.nowPlayingSent = true;
    try {
      const result = await this.client.updateNowPlaying(session.payload);
      this.handleApiResult(result, 'nowPlaying');
      if (result.ok) {
        this.lastNowPlayingAt = new Date(this.now()).toISOString();
        this.lastNowPlayingIdentity = session.identity;
        this.lastNowPlayingIdentityAt = this.now();
        this.logger.info('[Last.fm] now playing updated', { artist: session.payload.artist, title: session.payload.title });
      }
    } catch (error) {
      this.lastFailedRequestAt = this.now();
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] nowPlaying failed', { error: this.lastError });
    }
  }

  private async scrobbleIfReady(): Promise<void> {
    const session = this.activeSession;
    const settings = this.getSettingsValue();
    if (!session || session.scrobbled || !settings.lastFmEnabled || !settings.lastFmScrobbleEnabled || !settings.lastFmSessionKey) {
      return;
    }

    if (session.playedSeconds < session.thresholdSeconds || !this.canSendRequest()) {
      return;
    }

    await this.scrobbleSession(session);
  }

  private async finishActiveSession({ flush }: { flush: boolean }): Promise<void> {
    const session = this.activeSession;
    if (!session) {
      return;
    }

    this.activeSession = null;
    if (flush && !session.scrobbled && session.playedSeconds >= session.thresholdSeconds) {
      await this.scrobbleSession(session);
    }
  }

  private async scrobbleSession(session: ActiveLastFmSession): Promise<void> {
    const settings = this.getSettingsValue();
    session.scrobbled = true;
    if (!settings.lastFmEnabled || !settings.lastFmScrobbleEnabled || !settings.lastFmSessionKey || !this.canSendRequest()) {
      return;
    }

    try {
      const result = await this.client.scrobble({
        ...session.payload,
        timestamp: Math.max(1, Math.floor(session.startedAtMs / 1000)),
      });
      this.handleApiResult(result, 'scrobble');
      if (result.ok) {
        this.lastScrobbleAt = new Date(this.now()).toISOString();
        this.logger.info('[Last.fm] track scrobbled', { artist: session.payload.artist, title: session.payload.title });
      }
    } catch (error) {
      this.lastFailedRequestAt = this.now();
      this.lastError = sanitizeError(error);
      this.logger.warn('[Last.fm] scrobble failed', { error: this.lastError });
    }
  }

  private handleApiResult(result: LastFmApiResult, action: 'nowPlaying' | 'scrobble'): void {
    if (result.ok || result.skipped) {
      if (result.ok) {
        this.lastError = null;
      }
      return;
    }

    this.lastFailedRequestAt = this.now();
    this.lastError = result.error ?? 'Last.fm request failed';
    this.logger.warn(`[Last.fm] ${action} failed`, { error: this.lastError, errorCode: result.errorCode });

    if (result.errorCode === 9) {
      this.client.clearSession();
      this.setSettingsValue({ lastFmSessionKey: null, lastFmUsername: null });
      this.logger.warn('[Last.fm] invalid session; user must reconnect');
    }
  }

  private canSendRequest(): boolean {
    return !this.lastFailedRequestAt || this.now() - this.lastFailedRequestAt >= requestBackoffMs;
  }

  private identityFromStatus(status: AudioStatus): string {
    if (isStreamingStatus(status)) {
      return '';
    }

    return buildLastFmTrackIdentity(this.trackFromStatus(status), status);
  }

  private payloadFromStatus(status: AudioStatus): LastFmTrackPayload | null {
    if (isStreamingStatus(status)) {
      return null;
    }

    return buildLastFmTrackPayload(this.trackFromStatus(status), status);
  }

  private trackFromStatus(status: AudioStatus): LibraryTrack | null {
    if (!status.currentTrackId) {
      return null;
    }

    try {
      return this.getTrack(status.currentTrackId);
    } catch (error) {
      this.logger.warn('[Last.fm] failed to load track metadata', {
        trackId: status.currentTrackId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private syncClientSession(): void {
    const settings = this.getSettingsValue();
    this.client.setSession(settings.lastFmSessionKey, settings.lastFmUsername);
  }
}
