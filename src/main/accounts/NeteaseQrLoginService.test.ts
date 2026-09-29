import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './AccountService';
import { NeteaseQrLoginService, setNeteaseQrLoginWebHostForTests } from './NeteaseQrLoginService';

const tempDirs: string[] = [];

const createService = (): { accountService: AccountService; qrService: NeteaseQrLoginService } => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-netease-qr-'));
  tempDirs.push(dir);
  const accountService = new AccountService(join(dir, 'accounts.json'));
  return {
    accountService,
    qrService: new NeteaseQrLoginService(accountService),
  };
};

afterEach(() => {
  setNeteaseQrLoginWebHostForTests(undefined);
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('NeteaseQrLoginService', () => {
  it('creates a NetEase web QR login session without exposing cookies', async () => {
    const dispose = vi.fn();
    setNeteaseQrLoginWebHostForTests({
      start: vi.fn(async (id) => ({
        id,
        qrDataUrl: 'data:image/png;base64,official-web-qr',
        expiresAtMs: Date.now() + 60_000,
        collectCookieHeader: vi.fn(async () => null),
        readState: vi.fn(async () => ({ state: 'waiting' as const, message: 'waiting' })),
        dispose,
      })),
    });
    const { qrService } = createService();

    await expect(qrService.startLogin()).resolves.toMatchObject({
      qrUrl: 'data:image/png;base64,official-web-qr',
      state: 'waiting',
    });
    expect(dispose).not.toHaveBeenCalled();
  });

  it('reports scanned QR state without saving account state yet', async () => {
    const readState = vi.fn(async () => ({ state: 'scanned' as const, message: 'scanned' }));
    setNeteaseQrLoginWebHostForTests({
      start: vi.fn(async (id) => ({
        id,
        qrDataUrl: 'data:image/png;base64,official-web-qr',
        expiresAtMs: Date.now() + 60_000,
        collectCookieHeader: vi.fn(async () => null),
        readState,
        dispose: vi.fn(),
      })),
    });
    const { accountService, qrService } = createService();
    const started = await qrService.startLogin();

    await expect(qrService.pollLogin(started.key)).resolves.toEqual({
      state: 'scanned',
      saved: false,
      message: 'scanned',
      code: null,
    });
    expect(readState).toHaveBeenCalledTimes(1);
    expect(accountService.getStatus('netease').connected).toBe(false);
  });

  it('saves NetEase web cookies after QR login is confirmed', async () => {
    const dispose = vi.fn();
    setNeteaseQrLoginWebHostForTests({
      start: vi.fn(async (id) => ({
        id,
        qrDataUrl: 'data:image/png;base64,official-web-qr',
        expiresAtMs: Date.now() + 60_000,
        collectCookieHeader: vi.fn(async () => 'MUSIC_U=secret; __csrf=csrf-secret'),
        readState: vi.fn(async () => ({ state: 'waiting' as const, message: 'waiting' })),
        dispose,
      })),
    });
    const { accountService, qrService } = createService();
    const started = await qrService.startLogin();

    const result = await qrService.pollLogin(started.key);

    expect(result).toMatchObject({
      state: 'confirmed',
      saved: true,
      code: null,
      status: { provider: 'netease', connected: true },
    });
    expect(accountService.getCredentials('netease').cookie).toBe('MUSIC_U=secret; __csrf=csrf-secret');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('saves cookies after the NetEase web poll confirms QR login', async () => {
    const dispose = vi.fn();
    const collectCookieHeader = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('MUSIC_U=confirmed-secret; __csrf=csrf-secret');
    setNeteaseQrLoginWebHostForTests({
      start: vi.fn(async (id) => ({
        id,
        qrDataUrl: 'data:image/png;base64,official-web-qr',
        expiresAtMs: Date.now() + 60_000,
        collectCookieHeader,
        readState: vi.fn(async () => ({ state: 'confirmed' as const, message: 'confirmed' })),
        dispose,
      })),
    });
    const { accountService, qrService } = createService();
    const started = await qrService.startLogin();

    const result = await qrService.pollLogin(started.key);

    expect(result).toMatchObject({
      state: 'confirmed',
      saved: true,
      message: 'confirmed',
      status: { provider: 'netease', connected: true },
    });
    expect(accountService.getCredentials('netease').cookie).toBe('MUSIC_U=confirmed-secret; __csrf=csrf-secret');
    expect(collectCookieHeader).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
