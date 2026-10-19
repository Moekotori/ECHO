import { AccountProviderBase } from './AccountProviderBase';
import type { StoredAccountRecord } from './AccountProviderBase';

const cookieValue = (cookie: string | undefined, ...names: string[]): string | null => {
  if (!cookie) {
    return null;
  }

  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'iu'));
    if (!match) {
      continue;
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return null;
};

const kugouIdentityFromCookie = (cookie: string | undefined): Pick<StoredAccountRecord, 'username' | 'displayName'> => {
  const username = cookieValue(cookie, 'KugooID', 'KugouID', 'userid', 'kg_uid', 'KuGoo');
  const displayName = cookieValue(cookie, 'UserName', 'NickName', 'nickname', 'kg_nickname') ?? username;
  return {
    username: username ?? null,
    displayName: displayName ?? null,
  };
};

export class KugouAccountProvider extends AccountProviderBase {
  constructor() {
    super('kugou');
  }

  override saveCookie(cookie: string, record: StoredAccountRecord | null | undefined, now: string): StoredAccountRecord {
    return {
      ...super.saveCookie(cookie, record, now),
      ...kugouIdentityFromCookie(cookie),
    };
  }

  override async check(record: StoredAccountRecord | null | undefined, now: string): Promise<StoredAccountRecord> {
    const cookie = record?.cookie?.trim();
    if (!cookie) {
      return {
        ...record,
        username: null,
        displayName: null,
        avatarUrl: null,
        lastCheckedAt: now,
        error: 'KuGou Music cookie is empty. Please sign in again.',
      };
    }

    return {
      ...record,
      ...kugouIdentityFromCookie(cookie),
      lastCheckedAt: now,
      error: null,
    };
  }

  protected override isConnected(record: StoredAccountRecord | null | undefined): boolean {
    return super.isConnected(record) && !record?.error;
  }
}
