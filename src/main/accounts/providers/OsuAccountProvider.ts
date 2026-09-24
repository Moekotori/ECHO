import { AccountProviderBase } from './AccountProviderBase';
import type { StoredAccountRecord } from './AccountProviderBase';
import { fetchOsuAccountProfile } from '../../downloads/OsuAccountLibraryService';

export class OsuAccountProvider extends AccountProviderBase {
  constructor() {
    super('osu');
  }

  override async check(record: StoredAccountRecord | null | undefined, now: string): Promise<StoredAccountRecord> {
    const cookie = record?.cookie?.trim();
    if (!cookie) {
      return {
        ...record,
        lastCheckedAt: now,
        error: 'osu! login is required.',
        authInvalid: true,
      };
    }

    try {
      const profile = await fetchOsuAccountProfile(cookie);
      return {
        ...record,
        username: String(profile.userId),
        displayName: profile.username,
        avatarUrl: profile.avatarUrl,
        lastCheckedAt: now,
        error: null,
        authInvalid: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check osu! login.';
      const authInvalid = message === 'osu_account_login_expired';
      return {
        ...record,
        ...(authInvalid ? { username: null, displayName: null, avatarUrl: null } : {}),
        lastCheckedAt: now,
        error: authInvalid ? 'osu! login is invalid or expired. Please sign in again.' : message,
        authInvalid,
      };
    }
  }

  protected override isConnected(record: StoredAccountRecord | null | undefined): boolean {
    return super.isConnected(record) && record?.authInvalid !== true;
  }
}
