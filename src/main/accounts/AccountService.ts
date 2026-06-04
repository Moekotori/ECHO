import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  type AccountCredentials,
  accountProviders,
  youtubeBrowsers,
  type AccountProvider,
  type AccountStatus,
  type YouTubeBrowser,
} from '../../shared/types/accounts';
import { sanitizeAccountData } from '../../shared/utils/sanitizeAccountData';
import type { AccountProviderBase, StoredAccountRecord } from './providers/AccountProviderBase';
import { BilibiliAccountProvider } from './providers/BilibiliAccountProvider';
import { KugouAccountProvider } from './providers/KugouAccountProvider';
import { NeteaseAccountProvider } from './providers/NeteaseAccountProvider';
import { OsuAccountProvider } from './providers/OsuAccountProvider';
import { QQMusicAccountProvider } from './providers/QQMusicAccountProvider';
import { SoundCloudAccountProvider } from './providers/SoundCloudAccountProvider';
import { SpotifyAccountProvider } from './providers/SpotifyAccountProvider';
import { TidalAccountProvider } from './providers/TidalAccountProvider';
import { YouTubeAccountProvider } from './providers/YouTubeAccountProvider';

type StoredAccounts = Partial<Record<AccountProvider, StoredAccountRecord>>;

const nowIso = (): string => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeStoredAccounts = (value: unknown): StoredAccounts | null => {
  if (!isRecord(value)) {
    return null;
  }

  return Object.fromEntries(accountProviders.map((provider) => [provider, normalizeStoredRecord(value[provider])])) as StoredAccounts;
};

export const isAccountProvider = (value: unknown): value is AccountProvider =>
  typeof value === 'string' && accountProviders.includes(value as AccountProvider);

export const isYouTubeBrowser = (value: unknown): value is YouTubeBrowser =>
  typeof value === 'string' && youtubeBrowsers.includes(value as YouTubeBrowser);

const normalizeStoredRecord = (value: unknown): StoredAccountRecord => {
  if (!isRecord(value)) {
    return {};
  }

    return {
      cookie: typeof value.cookie === 'string' ? value.cookie : undefined,
      browser: isYouTubeBrowser(value.browser) ? value.browser : undefined,
      accessToken: typeof value.accessToken === 'string' ? value.accessToken : undefined,
      refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : undefined,
      tokenType: typeof value.tokenType === 'string' ? value.tokenType : undefined,
      scope: typeof value.scope === 'string' ? value.scope : undefined,
      username: typeof value.username === 'string' ? value.username : null,
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    lastLoginAt: typeof value.lastLoginAt === 'string' ? value.lastLoginAt : null,
    lastCheckedAt: typeof value.lastCheckedAt === 'string' ? value.lastCheckedAt : null,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    error: typeof value.error === 'string' ? value.error : null,
  };
};

const hasRefreshableLoginRecord = (record: StoredAccountRecord | null | undefined): boolean =>
  typeof record?.cookie === 'string' && record.cookie.trim().length > 0
    ? true
    : Boolean(record?.browser && record.browser !== 'none') || Boolean(record?.refreshToken || record?.accessToken);

export class AccountService {
  private records: StoredAccounts | null = null;
  private readonly providers: Record<AccountProvider, AccountProviderBase>;

  constructor(private readonly storagePath = join(app.getPath('userData'), 'accounts.json')) {
    const youtube = new YouTubeAccountProvider();
    this.providers = {
      netease: new NeteaseAccountProvider(),
      qqmusic: new QQMusicAccountProvider(),
      kugou: new KugouAccountProvider(),
      bilibili: new BilibiliAccountProvider(),
      youtube,
      soundcloud: new SoundCloudAccountProvider(),
      spotify: new SpotifyAccountProvider(),
      tidal: new TidalAccountProvider(),
      osu: new OsuAccountProvider(),
    };
  }

  getStoragePath(): string {
    return this.storagePath;
  }

  getBackupStoragePath(): string {
    return `${this.storagePath}.bak`;
  }

  getStatuses(): AccountStatus[] {
    const records = this.readRecords();
    return accountProviders.map((provider) => this.providers[provider].toStatus(records[provider]));
  }

  getStatus(provider: AccountProvider): AccountStatus {
    this.requireProvider(provider);
    return this.providers[provider].toStatus(this.readRecords()[provider]);
  }

  getCredentials(provider: AccountProvider): AccountCredentials {
    this.requireProvider(provider);
    const record = this.readRecords()[provider];

    return {
      provider,
      cookie: record?.cookie,
      browser: record?.browser,
    };
  }

  saveCookie(provider: AccountProvider, cookie: string): AccountStatus {
    this.requireProvider(provider);
    if (typeof cookie !== 'string') {
      throw new Error('cookie must be a string');
    }

    const trimmedCookie = cookie.trim();
    if (!trimmedCookie) {
      throw new Error('cookie must be a non-empty string');
    }

    const records = this.readRecords();
    records[provider] = this.providers[provider].saveCookie(trimmedCookie, records[provider], nowIso());
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  clearAccount(provider: AccountProvider): AccountStatus {
    this.requireProvider(provider);
    const records = this.readRecords();
    records[provider] = this.providers[provider].clear();
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  async checkAccount(provider: AccountProvider): Promise<AccountStatus> {
    this.requireProvider(provider);
    const records = this.readRecords();
    records[provider] = await this.providers[provider].check(records[provider], nowIso());
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  async checkAllAccounts(): Promise<AccountStatus[]> {
    await Promise.all(accountProviders.map((provider) => this.checkAccount(provider)));
    return this.getStatuses();
  }

  saveSpotifyTokens(input: {
    accessToken: string;
    refreshToken?: string | null;
    tokenType?: string | null;
    scope?: string | null;
    expiresAt?: string | null;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): AccountStatus {
    const records = this.readRecords();
    const current = records.spotify;
    records.spotify = {
      ...current,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? current?.refreshToken,
      tokenType: input.tokenType ?? current?.tokenType ?? 'Bearer',
      scope: input.scope ?? current?.scope,
      expiresAt: input.expiresAt ?? current?.expiresAt ?? null,
      username: input.username ?? current?.username ?? null,
      displayName: input.displayName ?? current?.displayName ?? input.username ?? null,
      avatarUrl: input.avatarUrl ?? current?.avatarUrl ?? null,
      lastLoginAt: current?.lastLoginAt ?? nowIso(),
      lastCheckedAt: nowIso(),
      error: null,
    };
    this.writeRecords(records);
    return this.getStatus('spotify');
  }

  updateSpotifyCheckStatus(patch: Pick<StoredAccountRecord, 'displayName' | 'username' | 'avatarUrl' | 'error'>): AccountStatus {
    const records = this.readRecords();
    records.spotify = {
      ...records.spotify,
      ...patch,
      lastCheckedAt: nowIso(),
    };
    this.writeRecords(records);
    return this.getStatus('spotify');
  }

  getSpotifyTokenRecord(): StoredAccountRecord | null {
    return this.readRecords().spotify ?? null;
  }

  saveTidalTokens(input: {
    accessToken: string;
    refreshToken?: string | null;
    tokenType?: string | null;
    scope?: string | null;
    expiresAt?: string | null;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): AccountStatus {
    const records = this.readRecords();
    const current = records.tidal;
    records.tidal = {
      ...current,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? current?.refreshToken,
      tokenType: input.tokenType ?? current?.tokenType ?? 'Bearer',
      scope: input.scope ?? current?.scope,
      expiresAt: input.expiresAt ?? current?.expiresAt ?? null,
      username: input.username ?? current?.username ?? null,
      displayName: input.displayName ?? current?.displayName ?? input.username ?? null,
      avatarUrl: input.avatarUrl ?? current?.avatarUrl ?? null,
      lastLoginAt: current?.lastLoginAt ?? nowIso(),
      lastCheckedAt: nowIso(),
      error: null,
    };
    this.writeRecords(records);
    return this.getStatus('tidal');
  }

  updateTidalCheckStatus(patch: Pick<StoredAccountRecord, 'displayName' | 'username' | 'avatarUrl' | 'error'>): AccountStatus {
    const records = this.readRecords();
    records.tidal = {
      ...records.tidal,
      ...patch,
      lastCheckedAt: nowIso(),
    };
    this.writeRecords(records);
    return this.getStatus('tidal');
  }

  getTidalTokenRecord(): StoredAccountRecord | null {
    return this.readRecords().tidal ?? null;
  }

  async checkPreviouslyLoggedInAccounts(): Promise<AccountStatus[]> {
    const records = this.readRecords();
    const providersToCheck = accountProviders.filter((provider) => hasRefreshableLoginRecord(records[provider]));

    await Promise.all(providersToCheck.map((provider) => this.checkAccount(provider)));
    return this.getStatuses();
  }

  setYouTubeBrowser(browser: YouTubeBrowser): AccountStatus {
    if (!isYouTubeBrowser(browser)) {
      throw new Error('browser must be edge, chrome, firefox, or none');
    }

    const records = this.readRecords();
    const provider = this.providers.youtube;
    if (!(provider instanceof YouTubeAccountProvider)) {
      throw new Error('YouTube provider is not available');
    }
    records.youtube = provider.setBrowser(browser, records.youtube, nowIso());
    this.writeRecords(records);
    return this.getStatus('youtube');
  }

  getSanitizedRecords(): unknown {
    return sanitizeAccountData(this.readRecords());
  }

  private requireProvider(provider: AccountProvider): void {
    if (!isAccountProvider(provider)) {
      throw new Error('provider must be a supported account provider');
    }
  }

  private readRecords(): StoredAccounts {
    if (this.records) {
      return this.records;
    }

    const primaryRecords = this.readRecordsFromPath(this.storagePath);
    if (primaryRecords) {
      this.records = primaryRecords;
      return this.records;
    }

    const backupRecords = this.readRecordsFromPath(this.getBackupStoragePath());
    if (backupRecords) {
      this.records = backupRecords;
      this.writeRecords(backupRecords);
      return this.records;
    }

    if (!existsSync(this.storagePath)) {
      this.records = {};
      return this.records;
    }

    this.records = {};
    return this.records;
  }

  private readRecordsFromPath(filePath: string): StoredAccounts | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      return normalizeStoredAccounts(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
    } catch {
      return null;
    }
  }

  private writeRecords(records: StoredAccounts): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const tmpPath = `${this.storagePath}.tmp`;
    if (existsSync(this.storagePath)) {
      this.copyPrimaryToBackup();
    }
    writeFileSync(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, this.storagePath);
    this.copyPrimaryToBackup();
    this.records = records;
  }

  private copyPrimaryToBackup(): void {
    try {
      copyFileSync(this.storagePath, this.getBackupStoragePath());
    } catch {
      // The primary atomic write remains the source of truth if backup creation fails.
    }
  }
}

let accountService: AccountService | null = null;

export const getAccountService = (): AccountService => {
  accountService ??= new AccountService();
  return accountService;
};

export const resetAccountServiceForTests = (): void => {
  accountService = null;
};
