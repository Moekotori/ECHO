import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './AccountService';

const tempDirs: string[] = [];

const createService = (): { service: AccountService; storagePath: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-accounts-'));
  tempDirs.push(dir);
  const storagePath = join(dir, 'accounts.json');
  return {
    service: new AccountService(storagePath),
    storagePath,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('AccountService', () => {
  it('returns disconnected initial statuses for all providers', () => {
    const { service } = createService();

    expect(service.getStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'netease', connected: false }),
        expect.objectContaining({ provider: 'qqmusic', connected: false }),
        expect.objectContaining({ provider: 'kugou', connected: false }),
        expect.objectContaining({ provider: 'bilibili', connected: false }),
        expect.objectContaining({ provider: 'youtube', connected: false }),
        expect.objectContaining({ provider: 'soundcloud', connected: false }),
        expect.objectContaining({ provider: 'osu', connected: false }),
      ]),
    );
  });

  it('saves cookies, returns connected status, and does not expose cookies in statuses', () => {
    const { service, storagePath } = createService();

    const status = service.saveCookie('netease', 'MUSIC_U=secret; csrf=hidden');

    expect(status).toEqual(expect.objectContaining({ provider: 'netease', connected: true }));
    expect(JSON.stringify(service.getStatuses())).not.toContain('MUSIC_U');
    expect(readFileSync(storagePath, 'utf8')).toContain('MUSIC_U=secret');
    expect(readFileSync(`${storagePath}.bak`, 'utf8')).toContain('MUSIC_U=secret');
  });

  it('clears a provider cookie', () => {
    const { service, storagePath } = createService();
    service.saveCookie('qqmusic', 'uin=secret');

    const status = service.clearAccount('qqmusic');

    expect(status.connected).toBe(false);
    expect(readFileSync(storagePath, 'utf8')).not.toContain('uin=secret');
    expect(readFileSync(`${storagePath}.bak`, 'utf8')).not.toContain('uin=secret');
  });

  it('keeps KuGou cookie accounts connected and derives display identity from cookies', async () => {
    const { service } = createService();
    service.saveCookie('kugou', 'KugooID=42; UserName=Moe; dfid=DFID123');

    const status = await service.checkAccount('kugou');

    expect(status).toMatchObject({
      provider: 'kugou',
      connected: true,
      username: '42',
      displayName: 'Moe',
      error: null,
    });
  });

  it('keeps account state after service restart', () => {
    const { service, storagePath } = createService();
    service.saveCookie('netease', 'MUSIC_U=secret');

    const restarted = new AccountService(storagePath);

    expect(restarted.getStatus('netease')).toEqual(expect.objectContaining({ provider: 'netease', connected: true }));
  });

  it('persists YouTube browser auth state', () => {
    const { service } = createService();

    const status = service.setYouTubeBrowser('edge');

    expect(status).toEqual(expect.objectContaining({ provider: 'youtube', connected: true }));
    expect(status.displayName).toContain('edge');
  });

  it('checks only accounts with saved login state for startup refreshes', async () => {
    const { service } = createService();
    service.saveCookie('netease', 'MUSIC_U=secret');
    service.setYouTubeBrowser('edge');

    const statuses = await service.checkPreviouslyLoggedInAccounts();

    expect(statuses.find((status) => status.provider === 'netease')?.lastCheckedAt).toBeTruthy();
    expect(statuses.find((status) => status.provider === 'youtube')?.lastCheckedAt).toBeTruthy();
    expect(statuses.find((status) => status.provider === 'qqmusic')?.lastCheckedAt).toBeNull();
    expect(statuses.find((status) => status.provider === 'bilibili')?.lastCheckedAt).toBeNull();
    expect(statuses.find((status) => status.provider === 'soundcloud')?.lastCheckedAt).toBeNull();
    expect(statuses.find((status) => status.provider === 'osu')?.lastCheckedAt).toBeNull();
  });

  it('falls back to empty statuses when accounts.json is damaged', () => {
    const { service, storagePath } = createService();
    writeFileSync(storagePath, '{broken json', 'utf8');

    expect(service.getStatus('netease')).toEqual(expect.objectContaining({ provider: 'netease', connected: false }));
  });

  it('restores account state from backup when accounts.json is damaged', () => {
    const { service, storagePath } = createService();
    service.saveCookie('netease', 'MUSIC_U=secret');
    expect(existsSync(`${storagePath}.bak`)).toBe(true);
    writeFileSync(storagePath, '{broken json', 'utf8');

    const restored = new AccountService(storagePath);

    expect(restored.getStatus('netease')).toEqual(expect.objectContaining({ provider: 'netease', connected: true }));
    expect(readFileSync(storagePath, 'utf8')).toContain('MUSIC_U=secret');
  });

  it('sanitizes account records for diagnostics', () => {
    const { service } = createService();
    service.saveCookie('bilibili', 'SESSDATA=secret; bili_jct=csrf-secret');

    const safe = JSON.stringify(service.getSanitizedRecords());

    expect(safe).not.toContain('SESSDATA=secret');
    expect(safe).not.toContain('csrf-secret');
    expect(safe).toContain('[redacted]');
  });

  it('checks Bilibili cookies against the real login status API', async () => {
    const { service } = createService();
    service.saveCookie('bilibili', 'SESSDATA=expired; DedeUserID=1; bili_jct=csrf');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: -101, data: { isLogin: false } }), { headers: { 'Content-Type': 'application/json' } })),
    );

    const status = await service.checkAccount('bilibili');

    expect(status.connected).toBe(false);
    expect(status.error).toContain('invalid or expired');
  });

  it('keeps Bilibili connected after a successful login check', async () => {
    const { service } = createService();
    service.saveCookie('bilibili', 'SESSDATA=valid; DedeUserID=1; bili_jct=csrf');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 0, data: { isLogin: true, uname: 'Moe', face: 'https://i.example/avatar.jpg', mid: 1 } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const status = await service.checkAccount('bilibili');

    expect(status).toMatchObject({
      provider: 'bilibili',
      connected: true,
      displayName: 'Moe',
      error: null,
    });
  });

  it('marks QQ Music cookies disconnected when the login-status API rejects them', async () => {
    const { service } = createService();
    service.saveCookie('qqmusic', 'uin=2331103944; qqmusic_key=expired; qm_keyst=expired');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, req_0: { code: 1000 } }), { headers: { 'Content-Type': 'application/json' } })),
    );

    const status = await service.checkAccount('qqmusic');

    expect(status.connected).toBe(false);
    expect(status.error).toContain('QQ 音乐登录凭证已过期');
  });

  it('keeps QQ Music connected after a successful login-status check', async () => {
    const { service } = createService();
    service.saveCookie('qqmusic', 'uin=2331103944; qqmusic_key=valid; qm_keyst=valid');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 0, req_0: { code: 0, data: { userInfo: { uin: '2331103944', nick: 'Moe' } } } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const status = await service.checkAccount('qqmusic');

    expect(status).toMatchObject({
      provider: 'qqmusic',
      connected: true,
      username: '2331103944',
      displayName: 'Moe',
      error: null,
    });
  });
});
