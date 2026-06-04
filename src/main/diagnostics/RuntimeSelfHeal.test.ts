import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverClosedHelperPipe } from './RuntimeSelfHeal';

const mocks = vi.hoisted(() => ({
  recoverSmtcIntegration: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../integrations/smtc/SmtcStatusSync', () => ({
  recoverSmtcIntegration: mocks.recoverSmtcIntegration,
}));

vi.mock('./CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => ({
      info: mocks.info,
      warn: mocks.warn,
    }),
  }),
}));

describe('RuntimeSelfHeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tries to recover SMTC after a closed helper pipe write', async () => {
    mocks.recoverSmtcIntegration.mockResolvedValueOnce(true);

    await expect(recoverClosedHelperPipe('uncaughtException', new Error('write EOF'))).resolves.toBe(true);

    expect(mocks.recoverSmtcIntegration).toHaveBeenCalledWith('closed-helper-pipe:uncaughtException');
    expect(mocks.info).toHaveBeenCalledWith(
      'main',
      '[self-heal] closed helper pipe recovery finished',
      expect.objectContaining({
        recovered: true,
        action: 'recover-smtc-integration',
      }),
    );
  });

  it('keeps recovery failures non-fatal', async () => {
    mocks.recoverSmtcIntegration.mockRejectedValueOnce(new Error('restart failed'));

    await expect(recoverClosedHelperPipe('unhandledRejection', new Error('write EPIPE'))).resolves.toBe(false);

    expect(mocks.warn).toHaveBeenCalledWith(
      'main',
      '[self-heal] closed helper pipe recovery failed',
      expect.objectContaining({
        source: 'unhandledRejection',
        error: 'restart failed',
      }),
    );
  });
});
