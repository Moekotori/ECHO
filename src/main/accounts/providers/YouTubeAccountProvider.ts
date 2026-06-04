import type { AccountStatus, YouTubeBrowser } from '../../../shared/types/accounts';
import { AccountProviderBase, type StoredAccountRecord } from './AccountProviderBase';

export class YouTubeAccountProvider extends AccountProviderBase {
  constructor() {
    super('youtube');
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

  setBrowser(browser: YouTubeBrowser, record: StoredAccountRecord | null | undefined, now: string): StoredAccountRecord {
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
