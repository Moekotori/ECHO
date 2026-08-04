import { describe, expect, it } from 'vitest';
import { formatUserFacingError, getRawErrorMessage } from './userFacingError';

describe('userFacingError', () => {
  it('reads messages from common error shapes', () => {
    expect(getRawErrorMessage(new Error('broken'))).toBe('broken');
    expect(getRawErrorMessage('plain')).toBe('plain');
    expect(getRawErrorMessage(null)).toBe('');
  });

  it('hides remote IPC errors behind a friendly desktop bridge message', () => {
    const message = formatUserFacingError(
      new Error("Error invoking remote method 'downloads:create-job': Error: spawn yt-dlp ENOENT"),
      { context: 'downloads' },
    );

    expect(message).toContain('桌面桥接暂不可用');
    expect(message).not.toContain('remote method');
    expect(message).not.toContain('spawn');
  });

  it('explains database corruption without leaking SQLite internals', () => {
    const message = formatUserFacingError(new Error('SQLITE_CORRUPT: database disk image is malformed'), {
      context: 'library',
    });

    expect(message).toContain('曲库数据库可能已损坏');
    expect(message).not.toContain('SQLITE_CORRUPT');
  });

  it('explains file permission and network failures', () => {
    expect(formatUserFacingError(new Error('EPERM: operation not permitted'), { context: 'folders' })).toContain('没有权限');
    expect(formatUserFacingError(new Error('fetch failed: ECONNRESET'), { context: 'streaming' })).toContain('网络连接暂时失败');
  });

  it('uses the contextual fallback for unknown technical errors', () => {
    const message = formatUserFacingError(new Error('TypeError: Cannot read properties of undefined'), {
      context: 'plugins',
      fallback: '插件失败',
    });

    expect(message).toBe('插件失败');
  });

  it('hides entitlement failure details behind a generic authorization message', () => {
    const message = formatUserFacingError(
      new Error("Error invoking remote method 'connect:connect': Error: echo_pro_license_machine-mismatch hwid=abc requiredVersion=v1"),
      { context: 'settings' },
    );
    const onlineCheckMessage = formatUserFacingError(
      new Error("Error invoking remote method 'plugins:enable': Error: echo_pro_license_online_check_required token expired after 12s"),
      { context: 'plugins' },
    );
    const packageSealMessage = formatUserFacingError(
      new Error('echo_pro_package_signature_invalid hash mismatch'),
      { context: 'plugins' },
    );

    expect(message).toBe('需要授权。请登录或激活 ECHO Pro 后再试。');
    expect(message).not.toContain('machine');
    expect(message).not.toContain('hwid');
    expect(message).not.toContain('requiredVersion');
    expect(onlineCheckMessage).toBe(message);
    expect(packageSealMessage).toBe(message);
    expect(onlineCheckMessage).not.toContain('online_check_required');
    expect(onlineCheckMessage).not.toContain('expired');
    expect(packageSealMessage).not.toContain('hash');
  });
});
