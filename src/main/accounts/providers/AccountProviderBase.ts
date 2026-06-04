import type { AccountProvider, AccountStatus, YouTubeBrowser } from '../../../shared/types/accounts';

export type StoredAccountRecord = {
  cookie?: string;
  browser?: YouTubeBrowser;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  lastLoginAt?: string | null;
  lastCheckedAt?: string | null;
  expiresAt?: string | null;
  error?: string | null;
};

export abstract class AccountProviderBase {
  constructor(readonly provider: AccountProvider) {}

  toStatus(record: StoredAccountRecord | null | undefined): AccountStatus {
    const connected = this.isConnected(record);

    return {
      provider: this.provider,
      connected,
      username: record?.username ?? null,
      displayName: record?.displayName ?? null,
      avatarUrl: record?.avatarUrl ?? null,
      lastLoginAt: record?.lastLoginAt ?? null,
      lastCheckedAt: record?.lastCheckedAt ?? null,
      expiresAt: record?.expiresAt ?? null,
      error: record?.error ?? null,
    };
  }

  saveCookie(cookie: string, record: StoredAccountRecord | null | undefined, now: string): StoredAccountRecord {
    return {
      ...record,
      cookie,
      lastLoginAt: now,
      lastCheckedAt: now,
      error: null,
    };
  }

  clear(): StoredAccountRecord {
    return {};
  }

  async check(record: StoredAccountRecord | null | undefined, now: string): Promise<StoredAccountRecord> {
    return {
      ...record,
      lastCheckedAt: now,
      error: null,
    };
  }

  protected isConnected(record: StoredAccountRecord | null | undefined): boolean {
    return typeof record?.cookie === 'string' && record.cookie.trim().length > 0;
  }
}
