import { AccountProviderBase } from './AccountProviderBase';
import type { StoredAccountRecord } from './AccountProviderBase';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ECHO-Next/1.0 Safari/537.36';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class BilibiliAccountProvider extends AccountProviderBase {
  constructor() {
    super('bilibili');
  }

  override async check(record: StoredAccountRecord | null | undefined, now: string): Promise<StoredAccountRecord> {
    const cookie = record?.cookie?.trim();
    if (!cookie) {
      return {
        ...record,
        lastCheckedAt: now,
        error: 'Bilibili Cookie is empty.',
      };
    }

    try {
      const response = await fetchWithNetworkProxy('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          Cookie: cookie,
          Referer: 'https://www.bilibili.com/',
          'User-Agent': userAgent,
        },
      });
      const payload = (await response.json()) as unknown;
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const code = isRecord(payload) ? number(payload.code) : null;
      const isLogin = data?.isLogin === true;

      if (code !== 0 || !isLogin) {
        return {
          ...record,
          username: null,
          displayName: null,
          avatarUrl: null,
          lastCheckedAt: now,
          error: 'Bilibili login is invalid or expired. Please sign in again.',
        };
      }

      return {
        ...record,
        username: text(data.uname) ?? text(data.mid),
        displayName: text(data.uname),
        avatarUrl: text(data.face),
        lastCheckedAt: now,
        error: null,
      };
    } catch (error) {
      return {
        ...record,
        lastCheckedAt: now,
        error: error instanceof Error ? error.message : 'Failed to check Bilibili login.',
      };
    }
  }

  protected override isConnected(record: StoredAccountRecord | null | undefined): boolean {
    return super.isConnected(record) && !record?.error;
  }
}
