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

const cookieValue = (cookie: string, ...names: string[]): string | null => {
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'iu'));
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return null;
};

const uinFromCookie = (cookie: string): string => {
  const value = cookieValue(cookie, 'uin', 'qqmusic_uin', 'p_uin', 'pt2gguin', 'loginUin', 'wxuin');
  const match = value?.match(/o?(\d+)/iu);
  return match?.[1] ?? '0';
};

const qqGtkFromCookie = (cookie: string): number => {
  const skey = cookieValue(cookie, 'qqmusic_key', 'qm_keyst', 'music_key', 'p_skey', 'skey') ?? '';
  let hash = 5381;
  for (const char of skey) {
    hash += (hash << 5) + char.charCodeAt(0);
  }

  return hash & 0x7fffffff;
};

export class QQMusicAccountProvider extends AccountProviderBase {
  constructor() {
    super('qqmusic');
  }

  override async check(record: StoredAccountRecord | null | undefined, now: string): Promise<StoredAccountRecord> {
    const cookie = record?.cookie?.trim();
    if (!cookie) {
      return {
        ...record,
        lastCheckedAt: now,
        error: 'QQ 音乐 Cookie 为空，请重新登录 QQ 音乐。',
      };
    }

    const uin = uinFromCookie(cookie);
    const key = cookieValue(cookie, 'qqmusic_key', 'qm_keyst', 'music_key');
    if (uin === '0' || !key) {
      return {
        ...record,
        username: null,
        displayName: null,
        avatarUrl: null,
        lastCheckedAt: now,
        error: 'QQ 音乐登录凭证不完整，请重新登录 QQ 音乐。',
      };
    }

    try {
      const body = {
        comm: {
          uin,
          format: 'json',
          ct: 24,
          cv: 4_747_474,
          platform: 'yqq.json',
          chid: '0',
          g_tk: qqGtkFromCookie(cookie),
          g_tk_new_20200303: qqGtkFromCookie(cookie),
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          notice: 0,
          needNewCode: 1,
        },
        req_0: {
          module: 'music.UserInfo.userInfoServer',
          method: 'GetLoginUserInfo',
          param: {},
        },
      };
      const response = await fetchWithNetworkProxy('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'Content-Type': 'application/json',
          Cookie: cookie,
          Referer: 'https://y.qq.com/',
          Origin: 'https://y.qq.com',
          'User-Agent': userAgent,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as unknown;
      const request = isRecord(payload) ? asRequest(payload.req_0) : null;
      const data = request && isRecord(request.data) ? request.data : {};
      const code = request ? number(request.code) ?? number(data.code) : null;

      if (!response.ok || code !== 0) {
        return {
          ...record,
          username: null,
          displayName: null,
          avatarUrl: null,
          lastCheckedAt: now,
          error: 'QQ 音乐登录凭证已过期，请重新登录 QQ 音乐后再播放会员歌曲。',
        };
      }

      const user = isRecord(data.userInfo) ? data.userInfo : data;
      return {
        ...record,
        username: text(user.uin) ?? uin,
        displayName: text(user.nick) ?? text(user.nickname) ?? text(user.name) ?? record?.displayName ?? null,
        avatarUrl: text(user.headurl) ?? text(user.avatar) ?? record?.avatarUrl ?? null,
        lastCheckedAt: now,
        error: null,
      };
    } catch (error) {
      return {
        ...record,
        lastCheckedAt: now,
        error: error instanceof Error ? error.message : 'QQ 音乐登录状态检查失败。',
      };
    }
  }

  protected override isConnected(record: StoredAccountRecord | null | undefined): boolean {
    return super.isConnected(record) && !record?.error;
  }
}

const asRequest = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);
