import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  type AccountCredentials,
  accountBrowsers,
  accountProviders,
  type AccountBrowser,
  type AccountProvider,
  type AccountStatus,
  type YouTubeBrowser,
} from '../../shared/types/accounts';
import { sanitizeAccountData } from '../../shared/utils/sanitizeAccountData';
import type { AccountProviderBase, StoredAccountRecord } from './providers/AccountProviderBase';
import { BilibiliAccountProvider } from './providers/BilibiliAccountProvider';
import { AccountSecretStore } from './AccountSecretStore';

const supportedAccountProviders = ['bilibili'] as const satisfies readonly AccountProvider[];

type StoredAccounts = Partial<Record<AccountProvider, StoredAccountRecord>>;

type StoredAccountReadResult = {
  records: StoredAccounts;
  rewrite: boolean;
  preservedSecrets: PreservedAccountSecrets;
};

const encryptedSecretKeys = {
  cookie: 'encryptedCookie',
  accessToken: 'encryptedAccessToken',
  refreshToken: 'encryptedRefreshToken',
} as const;

type AccountSecretName = keyof typeof encryptedSecretKeys;
type PreservedAccountSecrets = Partial<Record<AccountProvider, Partial<Record<AccountSecretName, string>>>>;

const nowIso = (): string => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeStoredAccounts = (value: unknown, secretStore: AccountSecretStore): StoredAccountReadResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  let rewrite = false;
  const preservedSecrets: PreservedAccountSecrets = {};
  const records = Object.fromEntries(accountProviders.map((provider) => {
    const normalized = normalizeStoredRecord(value[provider], secretStore);
    rewrite ||= normalized.rewrite;
    if (Object.keys(normalized.preservedSecrets).length > 0) {
      preservedSecrets[provider] = normalized.preservedSecrets;
    }
    return [provider, normalized.record];
  })) as StoredAccounts;
  return { records, rewrite, preservedSecrets };
};

export const isAccountProvider = (value: unknown): value is AccountProvider =>
  value === 'bilibili';

export const isYouTubeBrowser = (value: unknown): value is YouTubeBrowser =>
  isAccountBrowser(value);

export const isAccountBrowser = (value: unknown): value is AccountBrowser =>
  typeof value === 'string' && accountBrowsers.includes(value as AccountBrowser);

const normalizeStoredRecord = (
  value: unknown,
  secretStore: AccountSecretStore,
): { record: StoredAccountRecord; rewrite: boolean; preservedSecrets: Partial<Record<AccountSecretName, string>> } => {
  if (!isRecord(value)) {
    return { record: {}, rewrite: false, preservedSecrets: {} };
  }

  const cookie = secretStore.decrypt(value[encryptedSecretKeys.cookie] ?? value.cookie);
  const accessToken = secretStore.decrypt(value[encryptedSecretKeys.accessToken] ?? value.accessToken);
  const refreshToken = secretStore.decrypt(value[encryptedSecretKeys.refreshToken] ?? value.refreshToken);

  return {
    record: {
      cookie: cookie.value ?? undefined,
      browser: isAccountBrowser(value.browser) ? value.browser : undefined,
      accessToken: accessToken.value ?? undefined,
      refreshToken: refreshToken.value ?? undefined,
      tokenType: typeof value.tokenType === 'string' ? value.tokenType : undefined,
      scope: typeof value.scope === 'string' ? value.scope : undefined,
      username: typeof value.username === 'string' ? value.username : null,
      displayName: typeof value.displayName === 'string' ? value.displayName : null,
      avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
      lastLoginAt: typeof value.lastLoginAt === 'string' ? value.lastLoginAt : null,
      lastCheckedAt: typeof value.lastCheckedAt === 'string' ? value.lastCheckedAt : null,
      expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
      error: typeof value.error === 'string' ? value.error : null,
      authInvalid: value.authInvalid === true,
    },
    rewrite: cookie.rewrite || accessToken.rewrite || refreshToken.rewrite,
    preservedSecrets: {
      ...(cookie.preservedEnvelope ? { cookie: cookie.preservedEnvelope } : {}),
      ...(accessToken.preservedEnvelope ? { accessToken: accessToken.preservedEnvelope } : {}),
      ...(refreshToken.preservedEnvelope ? { refreshToken: refreshToken.preservedEnvelope } : {}),
    },
  };
};

const hasRefreshableLoginRecord = (record: StoredAccountRecord | null | undefined): boolean =>
  typeof record?.cookie === 'string' && record.cookie.trim().length > 0
    ? true
    : Boolean(record?.browser && record.browser !== 'none') || Boolean(record?.refreshToken || record?.accessToken);

const isCookieHeaderValueSafe = (cookie: string): boolean => {
  for (let index = 0; index < cookie.length;) {
    const codePoint = cookie.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    if (codePoint > 0xff || (codePoint < 0x20 && codePoint !== 0x09) || codePoint === 0x7f) {
      return false;
    }

    index += codePoint > 0xffff ? 2 : 1;
  }
  return true;
};

const assertCookieHeaderValueSafe = (cookie: string): void => {
  if (!isCookieHeaderValueSafe(cookie)) {
    throw new Error('cookie contains characters that cannot be sent as an HTTP header; paste only the raw Cookie value');
  }
};

export class AccountService {
  private records: StoredAccounts | null = null;
  private preservedSecrets: PreservedAccountSecrets = {};
  private readonly providers: Partial<Record<AccountProvider, AccountProviderBase>> = {
    bilibili: new BilibiliAccountProvider(),
  };

  constructor(
    private readonly storagePath = join(app.getPath('userData'), 'accounts.json'),
    private readonly secretStore = new AccountSecretStore(),
  ) {}

  getStoragePath(): string {
    return this.storagePath;
  }

  getBackupStoragePath(): string {
    return `${this.storagePath}.bak`;
  }

  reloadFromDisk(): void {
    this.records = null;
    this.preservedSecrets = {};
    this.readRecords();
  }

  getStatuses(): AccountStatus[] {
    const records = this.readRecords();
    return supportedAccountProviders.map((provider) => this.providerFor(provider).toStatus(records[provider]));
  }

  getStatus(provider: AccountProvider): AccountStatus {
    this.requireProvider(provider);
    return this.providerFor(provider).toStatus(this.readRecords()[provider]);
  }

  getCredentials(provider: AccountProvider): AccountCredentials {
    this.requireProvider(provider);
    const record = this.readRecords()[provider];

    return {
      provider,
      cookie: record?.cookie && isCookieHeaderValueSafe(record.cookie) ? record.cookie : undefined,
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
    assertCookieHeaderValueSafe(trimmedCookie);

    const records = this.readRecords();
    records[provider] = this.providerFor(provider).saveCookie(trimmedCookie, records[provider], nowIso());
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  clearAccount(provider: AccountProvider): AccountStatus {
    this.requireProvider(provider);
    const records = this.readRecords();
    delete this.preservedSecrets[provider];
    records[provider] = this.providerFor(provider).clear();
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  async checkAccount(provider: AccountProvider): Promise<AccountStatus> {
    const records = this.readRecords();
    records[provider] = await this.providerFor(provider).check(records[provider], nowIso());
    this.writeRecords(records);
    return this.getStatus(provider);
  }

  async checkAllAccounts(): Promise<AccountStatus[]> {
    await Promise.all(supportedAccountProviders.map((provider) => this.checkAccount(provider)));
    return this.getStatuses();
  }

  async checkPreviouslyLoggedInAccounts(): Promise<AccountStatus[]> {
    const records = this.readRecords();
    const providersToCheck = supportedAccountProviders.filter((provider) => hasRefreshableLoginRecord(records[provider]));

    await Promise.all(providersToCheck.map((provider) => this.checkAccount(provider)));
    return this.getStatuses();
  }

  getSanitizedRecords(): unknown {
    return sanitizeAccountData(this.readRecords());
  }

  private requireProvider(provider: AccountProvider): void {
    if (!isAccountProvider(provider)) {
      throw new Error('provider must be a supported account provider');
    }
  }

  private providerFor(provider: AccountProvider): AccountProviderBase {
    this.requireProvider(provider);
    const accountProvider = this.providers[provider];
    if (!accountProvider) {
      throw new Error('provider must be a supported account provider');
    }
    return accountProvider;
  }

  private readRecords(): StoredAccounts {
    if (this.records) {
      return this.records;
    }

    const primaryResult = this.readRecordsFromPath(this.storagePath);
    if (primaryResult) {
      this.records = primaryResult.records;
      this.preservedSecrets = primaryResult.preservedSecrets;
      if (primaryResult.rewrite) {
        // Do not copy a legacy plaintext primary file into the backup before migration.
        this.writeRecords(this.records, false);
      }
      return this.records;
    }

    const backupResult = this.readRecordsFromPath(this.getBackupStoragePath());
    if (backupResult) {
      this.records = backupResult.records;
      this.preservedSecrets = backupResult.preservedSecrets;
      this.writeRecords(backupResult.records);
      return this.records;
    }

    if (!existsSync(this.storagePath)) {
      this.records = {};
      return this.records;
    }

    this.records = {};
    return this.records;
  }

  private readRecordsFromPath(filePath: string): StoredAccountReadResult | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      return normalizeStoredAccounts(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, this.secretStore);
    } catch {
      return null;
    }
  }

  private writeRecords(records: StoredAccounts, preserveCurrentBackup = true): void {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const tmpPath = `${this.storagePath}.tmp`;
    if (preserveCurrentBackup && existsSync(this.storagePath)) {
      this.copyPrimaryToBackup();
    }
    writeFileSync(tmpPath, `${JSON.stringify(this.serializeRecords(records), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, this.storagePath);
    this.restrictFilePermissions(this.storagePath);
    this.copyPrimaryToBackup();
    this.records = records;
  }

  private serializeRecords(records: StoredAccounts): Record<string, unknown> {
    return Object.fromEntries(accountProviders.map((provider) => {
      const record = records[provider];
      if (!record) {
        return [provider, {}];
      }
      const { cookie, accessToken, refreshToken, ...safeFields } = record;
      const persistedCookie = cookie ? this.secretStore.encrypt(cookie) : this.preservedSecrets[provider]?.cookie;
      const persistedAccessToken = accessToken ? this.secretStore.encrypt(accessToken) : this.preservedSecrets[provider]?.accessToken;
      const persistedRefreshToken = refreshToken ? this.secretStore.encrypt(refreshToken) : this.preservedSecrets[provider]?.refreshToken;
      return [provider, {
        ...safeFields,
        ...(persistedCookie ? { [encryptedSecretKeys.cookie]: persistedCookie } : {}),
        ...(persistedAccessToken ? { [encryptedSecretKeys.accessToken]: persistedAccessToken } : {}),
        ...(persistedRefreshToken ? { [encryptedSecretKeys.refreshToken]: persistedRefreshToken } : {}),
      }];
    }));
  }

  private copyPrimaryToBackup(): void {
    try {
      copyFileSync(this.storagePath, this.getBackupStoragePath());
      this.restrictFilePermissions(this.getBackupStoragePath());
    } catch {
      // The primary atomic write remains the source of truth if backup creation fails.
    }
  }

  private restrictFilePermissions(filePath: string): void {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows ACLs are managed by the user profile; chmod is best-effort there.
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
