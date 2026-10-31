import type { AccountBrowser, AccountStatus } from '../../../shared/types/accounts';
import { AccountProviderBase } from './AccountProviderBase';
import type { StoredAccountRecord } from './AccountProviderBase';

export class SoundCloudAccountProvider extends AccountProviderBase {
  constructor() {
    super('soundcloud');
  }

  override toStatus(record: StoredAccountRecord | null | undefined): AccountStatus {
    const status = super.toStatus(record);
    const browser = record?.browser && record.browser !== 'none' ? record.browser : null;

    return {
      ...status,
      connected: status.connected || Boolean(browser),
      displayName: status.displayName ?? (browser ? `System browser: ${browser}` : null),
    };
  }

  setBrowser(browser: AccountBrowser, record: StoredAccountRecord | null | undefined, now: string): StoredAccountRecord {
    return {
      ...record,
      browser,
      lastLoginAt: browser === 'none' && !record?.cookie ? null : (record?.lastLoginAt ?? now),
      lastCheckedAt: now,
      error: null,
    };
  }

  override clear(): StoredAccountRecord {
    return {
      browser: 'none',
    };
  }
}
