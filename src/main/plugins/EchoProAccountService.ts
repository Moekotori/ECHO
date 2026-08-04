import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  EchoProAccountCredentials,
  EchoProAccountStatus,
  EchoProAccountStatusOptions,
  EchoProCloudLibrarySyncPayload,
  EchoProKeyRedeemResult,
  EchoProReleaseDevicesResult,
  EchoProSettingsCloudPullResult,
  EchoProSettingsCloudSaveResult,
  EchoProSettingsCloudStatus,
} from '../../shared/types/echoProAccount';
import { createEntitlementRecoveryError } from '../app/legacyEntitlementRecovery';
import { getEchoProMachineHwidHash } from './MachineIdentity';
import {
  connectDonatorUnlockFeatureId,
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
} from '../../shared/constants/featureUnlocks';

type StoredEchoProAccount = {
  sessionToken: string | null;
  status: EchoProAccountStatus;
};

type StoredEchoProAccountReadResult = {
  state: StoredEchoProAccount;
  rewrite: boolean;
};

type EchoProFeatureVerificationCache = {
  expiresAt: number;
  hwidHash: string;
};

type EchoProAccountRequest = {
  promise: Promise<EchoProAccountStatus>;
  sessionToken: string;
};

type AuthResponse = {
  sessionToken?: unknown;
  user?: unknown;
};

type SettingsCloudInput = {
  settings: Record<string, unknown>;
  librarySync: EchoProCloudLibrarySyncPayload;
  appVersion: string;
  deviceName: string | null;
};

const defaultAccountBaseUrl = 'https://echonext.moe/api/echo-pro';
const accountBaseUrlEnvNames = ['ECHO_PRO_ACCOUNT_URL', 'ECHO_PRO_API_URL'] as const;
const requestTimeoutMs = 6_000;
const statusCacheTtlMs = 2 * 60 * 60 * 1000;
const offlineGraceMs = 24 * 60 * 60 * 1000;
const maxVerificationCacheSeconds = 60 * 60;
const encryptedSessionTokenKey = 'encryptedSessionToken';
const safeStoragePrefix = 'safe:';
const plainFallbackPrefix = 'plain:';

const anonymousStatus = (lastError: string | null = null): EchoProAccountStatus => ({
  loggedIn: false,
  username: null,
  displayName: null,
  pro: false,
  status: 'anonymous',
  machineCount: 0,
  maxMachineCount: 2,
  checkedAt: null,
  lastError,
});

const nowIso = (): string => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const normalizeUserStatus = (value: unknown): EchoProAccountStatus['status'] => {
  if (value === 'active' || value === 'inactive' || value === 'disabled') {
    return value;
  }
  return 'active';
};

const normalizeCheckedAt = (value: unknown): string | null => {
  const checkedAt = text(value);
  if (!checkedAt) {
    return null;
  }
  const timestamp = Date.parse(checkedAt);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const getStatusAgeMs = (status: EchoProAccountStatus): number => {
  if (!status.checkedAt) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(status.checkedAt);
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return Date.now() - timestamp;
};

const isStatusFresh = (status: EchoProAccountStatus, ttlMs = statusCacheTtlMs): boolean => {
  const age = getStatusAgeMs(status);
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
};

const normalizeAccountStatus = (value: unknown, lastError: string | null = null): EchoProAccountStatus => {
  if (!isRecord(value)) {
    return anonymousStatus(lastError);
  }

  const username = text(value.username);
  const status = normalizeUserStatus(value.status);
  return {
    loggedIn: username !== null && status !== 'disabled',
    username,
    displayName: text(value.displayName) ?? username,
    pro: value.pro === true,
    status,
    machineCount: typeof value.machineCount === 'number' && Number.isFinite(value.machineCount)
      ? Math.max(0, Math.round(value.machineCount))
      : 0,
    maxMachineCount: typeof value.maxMachineCount === 'number' && Number.isFinite(value.maxMachineCount)
      ? Math.max(1, Math.round(value.maxMachineCount))
      : 2,
    checkedAt: nowIso(),
    lastError,
  };
};

const normalizeStoredAccountStatus = (value: unknown): EchoProAccountStatus => {
  if (!isRecord(value)) {
    return anonymousStatus();
  }

  const username = text(value.username);
  const status = normalizeUserStatus(value.status);
  return {
    loggedIn: value.loggedIn === true && username !== null && status !== 'disabled',
    username,
    displayName: text(value.displayName) ?? username,
    pro: value.pro === true,
    status,
    machineCount: typeof value.machineCount === 'number' && Number.isFinite(value.machineCount)
      ? Math.max(0, Math.round(value.machineCount))
      : 0,
    maxMachineCount: typeof value.maxMachineCount === 'number' && Number.isFinite(value.maxMachineCount)
      ? Math.max(1, Math.round(value.maxMachineCount))
      : 2,
    checkedAt: normalizeCheckedAt(value.checkedAt),
    lastError: text(value.lastError),
  };
};

const normalizeSettingsCloudStatus = (value: unknown, lastError: string | null = null): EchoProSettingsCloudStatus => {
  const input = isRecord(value) ? value : {};
  const settings = isRecord(input.settings) ? input.settings : null;
  const librarySync = normalizeLibrarySync(input.librarySync);
  return {
    available: input.available === true || settings !== null,
    lastSavedAt: text(input.lastSavedAt),
    lastPulledAt: text(input.lastPulledAt),
    lastAppliedAt: null,
    appVersion: text(input.appVersion),
    deviceName: text(input.deviceName),
    settingsCount: typeof input.settingsCount === 'number' && Number.isFinite(input.settingsCount)
      ? Math.max(0, Math.round(input.settingsCount))
      : settings
        ? Object.keys(settings).length
        : 0,
    librarySyncPlaylistCount: typeof input.librarySyncPlaylistCount === 'number' && Number.isFinite(input.librarySyncPlaylistCount)
      ? Math.max(0, Math.round(input.librarySyncPlaylistCount))
      : librarySync?.streamingPlaylists.length ?? 0,
    librarySyncFavoriteTrackCount: typeof input.librarySyncFavoriteTrackCount === 'number' && Number.isFinite(input.librarySyncFavoriteTrackCount)
      ? Math.max(0, Math.round(input.librarySyncFavoriteTrackCount))
      : countLibrarySyncFavoriteTracks(librarySync),
    lastError,
  };
};

const countLibrarySyncFavoriteTracks = (librarySync: EchoProCloudLibrarySyncPayload | null): number => {
  if (!librarySync) {
    return 0;
  }
  const favorites = isRecord(librarySync.streamingFavorites) ? librarySync.streamingFavorites : null;
  const providers: Record<string, unknown> = isRecord(favorites?.providers) ? favorites.providers : {};
  const collections: unknown[] = Array.isArray(favorites?.collections) ? favorites.collections : [];
  const providerTracks = Object.values(providers).reduce<number>(
    (total, tracks) => total + (Array.isArray(tracks) ? tracks.length : 0),
    0,
  );
  const collectionTracks = collections.reduce<number>((total, collection) => (
    isRecord(collection) && Array.isArray(collection.tracks) ? total + collection.tracks.length : total
  ), 0);
  return providerTracks + collectionTracks;
};

const normalizeLibrarySync = (value: unknown): EchoProCloudLibrarySyncPayload | null => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.streamingPlaylists) || !isRecord(value.streamingFavorites)) {
    return null;
  }
  return value as EchoProCloudLibrarySyncPayload;
};

const normalizeSettingsCloudPullResult = (value: unknown, lastError: string | null = null): EchoProSettingsCloudPullResult => {
  const input = isRecord(value) ? value : {};
  const settings = isRecord(input.settings) ? input.settings : null;
  return {
    ...normalizeSettingsCloudStatus(input, lastError),
    settings,
    librarySync: normalizeLibrarySync(input.librarySync),
  };
};

const encryptSessionToken = (token: string | null): string | null => {
  if (!token) {
    return null;
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `${safeStoragePrefix}${safeStorage.encryptString(token).toString('base64')}`;
    }
  } catch {
    // Fall through to the tagged fallback so account state is still portable in dev/test shells.
  }

  return `${plainFallbackPrefix}${Buffer.from(token, 'utf8').toString('base64')}`;
};

const decryptSessionToken = (value: unknown): { token: string | null; rewrite: boolean } => {
  const stored = text(value);
  if (!stored) {
    return { token: null, rewrite: false };
  }

  if (stored.startsWith(safeStoragePrefix)) {
    try {
      return {
        token: text(safeStorage.decryptString(Buffer.from(stored.slice(safeStoragePrefix.length), 'base64'))),
        rewrite: false,
      };
    } catch {
      return { token: null, rewrite: true };
    }
  }

  if (stored.startsWith(plainFallbackPrefix)) {
    const token = text(Buffer.from(stored.slice(plainFallbackPrefix.length), 'base64').toString('utf8'));
    return {
      token,
      rewrite: token !== null && safeStorage.isEncryptionAvailable(),
    };
  }

  return { token: stored, rewrite: true };
};

const normalizeStored = (value: unknown): StoredEchoProAccountReadResult => {
  if (!isRecord(value)) {
    return { state: { sessionToken: null, status: anonymousStatus() }, rewrite: false };
  }
  const encryptedToken = decryptSessionToken(value[encryptedSessionTokenKey]);
  const legacyToken = decryptSessionToken(value.sessionToken);
  const sessionToken = encryptedToken.token ?? legacyToken.token;
  return {
    state: {
      sessionToken,
      status: normalizeStoredAccountStatus(value.status),
    },
    rewrite: encryptedToken.rewrite || legacyToken.token !== null || legacyToken.rewrite,
  };
};

const normalizeCredentials = (credentials: EchoProAccountCredentials): EchoProAccountCredentials => {
  const username = credentials.username.trim();
  const password = credentials.password;
  if (!/^[a-zA-Z0-9_.@-]{3,40}$/u.test(username)) {
    throw new Error('ECHO Pro username must be 3-40 letters, numbers, dot, underscore, at, or dash.');
  }
  if (password.length < 8 || password.length > 200) {
    throw new Error('ECHO Pro password must be 8-200 characters.');
  }
  return { username, password };
};

const proAccountError = (message: string, scope: 'echo-pro-account' | 'echo-pro-cloud' = 'echo-pro-account'): Error =>
  createEntitlementRecoveryError(message, scope);

const tokenFingerprint = (token: string | null): string | null =>
  token ? createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16) : null;

export class EchoProAccountService {
  private state: StoredEchoProAccount;
  private featureVerificationCache = new Map<string, EchoProFeatureVerificationCache>();
  private featureVerificationRequests = new Map<string, EchoProAccountRequest>();
  private statusRefreshRequest: EchoProAccountRequest | null = null;

  constructor(private readonly storagePath = join(app.getPath('userData'), 'echo-pro-account.json')) {
    const stored = this.readState();
    this.state = stored.state;
    if (stored.rewrite) {
      this.writeState();
    }
  }

  getStatus(): EchoProAccountStatus {
    return this.state.status;
  }

  getSessionToken(): string | null {
    return this.state.sessionToken;
  }

  getSessionFingerprint(): string | null {
    return tokenFingerprint(this.state.sessionToken);
  }

  async refreshStatus(options: EchoProAccountStatusOptions = {}): Promise<EchoProAccountStatus> {
    if (!this.state.sessionToken) {
      this.statusRefreshRequest = null;
      this.state = { sessionToken: null, status: anonymousStatus() };
      this.writeState();
      return this.state.status;
    }
    if (options.force !== true && isStatusFresh(this.state.status)) {
      return this.state.status;
    }
    const sessionToken = this.state.sessionToken;
    if (this.statusRefreshRequest?.sessionToken === sessionToken) {
      return this.statusRefreshRequest.promise;
    }

    const request = (async (): Promise<EchoProAccountStatus> => {
      const response = await this.fetchJson('/auth/me', {
        method: 'GET',
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (this.state.sessionToken !== sessionToken) {
        return this.state.status;
      }
      this.state.status = normalizeAccountStatus(response.user);
      this.writeState();
      return this.state.status;
    })().catch((error: unknown) => {
      if (this.state.sessionToken !== sessionToken) {
        return this.state.status;
      }
      const message = error instanceof Error ? error.message : 'ECHO Pro account check failed.';
      const canUseGrace =
        this.state.status.loggedIn &&
        this.state.status.pro === true &&
        this.state.status.status !== 'disabled' &&
        isStatusFresh(this.state.status, offlineGraceMs);
      this.state.status = {
        ...this.state.status,
        checkedAt: canUseGrace ? this.state.status.checkedAt : nowIso(),
        lastError: message,
      };
      this.writeState();
      return this.state.status;
    });

    this.statusRefreshRequest = { sessionToken, promise: request };
    try {
      return await request;
    } finally {
      if (this.statusRefreshRequest?.promise === request) {
        this.statusRefreshRequest = null;
      }
    }
  }

  async verifyFeature(feature: string = 'echo-pro'): Promise<EchoProAccountStatus> {
    if (!this.state.sessionToken) {
      this.featureVerificationCache.clear();
      this.featureVerificationRequests.clear();
      this.state = { sessionToken: null, status: anonymousStatus() };
      this.writeState();
      throw proAccountError('ECHO Pro account login is required.');
    }

    const hwidHash = getEchoProMachineHwidHash();
    const cached = this.featureVerificationCache.get(feature);
    if (
      cached &&
      cached.hwidHash === hwidHash &&
      cached.expiresAt > Date.now() &&
      this.state.status.loggedIn &&
      this.state.status.pro === true &&
      this.state.status.status !== 'disabled'
    ) {
      return this.state.status;
    }
    const sessionToken = this.state.sessionToken;
    const inFlight = this.featureVerificationRequests.get(feature);
    if (inFlight?.sessionToken === sessionToken) {
      return inFlight.promise;
    }

    const request = (async (): Promise<EchoProAccountStatus> => {
      const response = await this.fetchJson('/verify', {
        method: 'POST',
        headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          appId: 'echo-next',
          featureId: connectDonatorUnlockFeatureId,
          pluginId: connectDonatorUnlockPluginId,
          requiredVersion: connectDonatorUnlockVersion,
          authMode: 'account',
          hwidHash,
          appVersion: app.getVersion(),
          requestedFeature: feature,
        }),
      });

      if (this.state.sessionToken !== sessionToken) {
        throw proAccountError('echo_pro_session_changed');
      }
      const status = normalizeAccountStatus(response.user);
      this.state.status = status;
      this.writeState();
      if (response.unlocked !== true || !status.loggedIn || status.pro !== true || status.status === 'disabled') {
        this.featureVerificationCache.delete(feature);
        throw proAccountError(text(response.reason) ?? 'echo_pro_required');
      }

      const cacheSeconds = typeof response.cacheSeconds === 'number' && Number.isFinite(response.cacheSeconds)
        ? Math.max(0, Math.min(maxVerificationCacheSeconds, Math.floor(response.cacheSeconds)))
        : 0;
      if (cacheSeconds > 0) {
        this.featureVerificationCache.set(feature, {
          expiresAt: Date.now() + (cacheSeconds * 1000),
          hwidHash,
        });
      } else {
        this.featureVerificationCache.delete(feature);
      }
      return this.state.status;
    })();

    this.featureVerificationRequests.set(feature, { sessionToken, promise: request });
    try {
      return await request;
    } finally {
      if (this.featureVerificationRequests.get(feature)?.promise === request) {
        this.featureVerificationRequests.delete(feature);
      }
    }
  }

  async login(credentials: EchoProAccountCredentials): Promise<EchoProAccountStatus> {
    return this.authenticate('/auth/login', credentials);
  }

  async register(credentials: EchoProAccountCredentials): Promise<EchoProAccountStatus> {
    return this.authenticate('/auth/register', credentials);
  }

  async logout(): Promise<EchoProAccountStatus> {
    const token = this.state.sessionToken;
    this.featureVerificationCache.clear();
    this.featureVerificationRequests.clear();
    this.statusRefreshRequest = null;
    this.state = { sessionToken: null, status: anonymousStatus() };
    this.writeState();
    if (token) {
      try {
        await this.fetchJson('/auth/logout', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {
        // Local logout must not be blocked by a network failure.
      }
    }
    return this.state.status;
  }

  async redeemKey(key: string): Promise<EchoProKeyRedeemResult> {
    if (!this.state.sessionToken || !this.state.status.loggedIn) {
      throw proAccountError('ECHO Pro account login is required before redeeming a key.');
    }
    const normalizedKey = key.trim();
    if (normalizedKey.length < 12 || normalizedKey.length > 80) {
      throw new Error('ECHO Pro key format is invalid.');
    }
    const response = await this.fetchJson('/keys/redeem', {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ key: normalizedKey, hwidHash: getEchoProMachineHwidHash() }),
    });
    const status = normalizeAccountStatus(response.user);
    this.state.status = status;
    this.writeState();
    return {
      ok: response.ok === true,
      redeemedAt: text(response.redeemedAt) ?? nowIso(),
      status,
    };
  }

  async releaseAllDevices(password: string): Promise<EchoProReleaseDevicesResult> {
    if (!this.state.sessionToken || !this.state.status.loggedIn) {
      throw proAccountError('ECHO Pro account login is required before releasing devices.');
    }
    if (password.length < 8 || password.length > 200) {
      throw new Error('Current ECHO Pro password is required before releasing devices.');
    }
    const response = await this.fetchJson('/devices/release-all', {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ password, hwidHash: getEchoProMachineHwidHash() }),
    });
    const status = normalizeAccountStatus(response.user);
    this.state.status = status;
    this.writeState();
    return {
      ok: response.ok === true,
      releasedAt: text(response.releasedAt) ?? nowIso(),
      releasedCount: typeof response.releasedCount === 'number' && Number.isFinite(response.releasedCount)
        ? Math.max(0, Math.round(response.releasedCount))
        : 0,
      status,
    };
  }

  async getSettingsCloudStatus(): Promise<EchoProSettingsCloudStatus> {
    if (this.getInactiveProSessionReason()) {
      return normalizeSettingsCloudStatus({});
    }
    try {
      const response = await this.fetchJson('/settings/cloud', {
        method: 'GET',
        headers: this.authHeaders(),
      });
      return normalizeSettingsCloudStatus(response);
    } catch (error) {
      return { ...normalizeSettingsCloudStatus({}), lastError: error instanceof Error ? error.message : String(error) };
    }
  }

  async saveSettingsCloud(input: SettingsCloudInput): Promise<EchoProSettingsCloudSaveResult> {
    this.requireActiveProSession();
    const response = await this.fetchJson('/settings/cloud', {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const status = normalizeSettingsCloudStatus(response);
    return {
      ...status,
      savedAt: status.lastSavedAt ?? nowIso(),
    };
  }

  async pullSettingsCloud(): Promise<EchoProSettingsCloudPullResult> {
    this.requireActiveProSession();
    const response = await this.fetchJson('/settings/cloud', {
      method: 'GET',
      headers: this.authHeaders(),
    });
    return normalizeSettingsCloudPullResult(response);
  }

  private async authenticate(path: string, credentials: EchoProAccountCredentials): Promise<EchoProAccountStatus> {
    const normalized = normalizeCredentials(credentials);
    const response = await this.fetchJson(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...normalized, hwidHash: getEchoProMachineHwidHash() }),
    }) as AuthResponse;
    const sessionToken = text(response.sessionToken);
    if (!sessionToken) {
      throw proAccountError('ECHO Pro server did not return a session token.');
    }
    this.featureVerificationRequests.clear();
    this.statusRefreshRequest = null;
    this.state = {
      sessionToken,
      status: normalizeAccountStatus(response.user),
    };
    this.writeState();
    return this.state.status;
  }

  private authHeaders(): Record<string, string> {
    return this.state.sessionToken ? { authorization: `Bearer ${this.state.sessionToken}` } : {};
  }

  private requireActiveProSession(): void {
    const inactiveReason = this.getInactiveProSessionReason();
    if (inactiveReason) {
      throw proAccountError(inactiveReason, 'echo-pro-cloud');
    }
  }

  private getInactiveProSessionReason(): string | null {
    if (!this.state.sessionToken || !this.state.status.loggedIn) {
      return 'ECHO Pro account login is required.';
    }
    if (this.state.status.pro !== true) {
      return 'ECHO Pro is required for cloud settings sync.';
    }
    return null;
  }

  private async fetchJson(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw proAccountError('ECHO Pro account endpoint is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(this.buildRequestUrl(baseUrl, path), {
        ...init,
        headers: {
          accept: 'application/json',
          'user-agent': `ECHO-NEXT/${app.getVersion()}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const parsed = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) {
        const error = isRecord(parsed) ? text(parsed.error) : null;
        const fallbackCode = path === '/auth/register' && response.status === 405
          ? 'echo_pro_register_unavailable'
          : `echo_pro_http_${response.status}`;
        throw new Error(error ?? fallbackCode);
      }
      return isRecord(parsed) ? parsed : {};
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestUrl(baseUrl: string, path: string): string {
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/u, '');
    const requestPath = path.replace(/^\/+/u, '');
    base.pathname = `${basePath}/${requestPath}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private getBaseUrl(): string | null {
    for (const envName of accountBaseUrlEnvNames) {
      const endpoint = this.normalizeBaseUrl(process.env[envName]);
      if (endpoint) {
        return endpoint;
      }
    }
    return this.normalizeBaseUrl(defaultAccountBaseUrl);
  }

  private normalizeBaseUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const url = new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`);
      const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  private readState(): StoredEchoProAccountReadResult {
    if (!existsSync(this.storagePath)) {
      return { state: { sessionToken: null, status: anonymousStatus() }, rewrite: false };
    }

    try {
      return normalizeStored(JSON.parse(readFileSync(this.storagePath, 'utf8')) as unknown);
    } catch {
      return {
        state: { sessionToken: null, status: anonymousStatus('Local account session file is damaged.') },
        rewrite: false,
      };
    }
  }

  private writeState(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const persisted = {
      [encryptedSessionTokenKey]: encryptSessionToken(this.state.sessionToken),
      sessionToken: null,
      status: this.state.status,
    };
    writeFileSync(this.storagePath, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

let defaultEchoProAccountService: EchoProAccountService | null = null;

export const getEchoProAccountService = (): EchoProAccountService => {
  defaultEchoProAccountService ??= new EchoProAccountService();
  return defaultEchoProAccountService;
};

export const resetDefaultEchoProAccountService = (): void => {
  defaultEchoProAccountService = null;
};
