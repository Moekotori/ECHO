import { beforeEach, describe, expect, it, vi } from 'vitest';
import { patchEnablesEchoProDsp, requireEchoProForAudioDspPatch } from './audioProFeatureGate';

const { getEchoProLicenseStatusMock, getEchoProAccountStatusMock, getConnectStatusMock } = vi.hoisted(() => ({
  getEchoProLicenseStatusMock: vi.fn(),
  getEchoProAccountStatusMock: vi.fn(),
  getConnectStatusMock: vi.fn(),
}));

vi.mock('../plugins/PluginService', () => ({
  getPluginService: () => ({ getEchoProLicenseStatus: getEchoProLicenseStatusMock }),
}));

vi.mock('../plugins/EchoProAccountService', () => ({
  getEchoProAccountService: () => ({ getStatus: getEchoProAccountStatusMock }),
}));

vi.mock('../plugins/ConnectDonatorUnlockService', () => ({
  getConnectDonatorUnlockService: () => ({ getStatus: getConnectStatusMock }),
}));

describe('audioProFeatureGate', () => {
  beforeEach(() => {
    getEchoProLicenseStatusMock.mockReset();
    getEchoProAccountStatusMock.mockReset();
    getConnectStatusMock.mockReset();
    getEchoProLicenseStatusMock.mockReturnValue({ valid: true, enabled: true, features: ['echo-pro'] });
    getEchoProAccountStatusMock.mockReturnValue({ loggedIn: false, pro: false, status: 'anonymous' });
    getConnectStatusMock.mockReturnValue({ unlocked: false });
  });

  it('gates ECHO SRC/SDM processing but leaves DoP output available', async () => {
    expect(patchEnablesEchoProDsp({ audioEchoSrcMode: 'off' })).toBe(false);
    expect(patchEnablesEchoProDsp({ audioSdmMode: 'off', audioDsdOutputMode: 'pcm' })).toBe(false);
    expect(patchEnablesEchoProDsp({
      sdmMode: 'off',
      sdmOversamplingFilterProfile1x: 'poly-sinc-ext2-long',
      sdmOversamplingFilterProfileNx: 'poly-sinc-ext2-hires-lp',
    })).toBe(false);
    expect(patchEnablesEchoProDsp({ sdmTargetRate: 'dsd512' } as never)).toBe(false);

    expect(patchEnablesEchoProDsp({ audioEchoSrcMode: 'family4x' })).toBe(true);
    expect(patchEnablesEchoProDsp({ sdmMode: 'pcmToDsd' })).toBe(true);
    expect(patchEnablesEchoProDsp({ sdmOversamplingFilterProfile1x: 'poly-sinc-ext2-long' })).toBe(true);
    expect(patchEnablesEchoProDsp({ dsdOutputMode: 'dop' })).toBe(false);
    expect(patchEnablesEchoProDsp({ audioDsdOutputMode: 'dop' })).toBe(false);

    await requireEchoProForAudioDspPatch({ echoSrcMode: 'family2x' });
    await requireEchoProForAudioDspPatch({ sdmMode: 'pcmToDsd' });
    expect(getEchoProLicenseStatusMock).toHaveBeenCalledTimes(2);
  });

  it('rechecks the existing local entitlement after it is revoked', async () => {
    await expect(requireEchoProForAudioDspPatch({ echoSrcMode: 'family2x' })).resolves.toBeUndefined();

    getEchoProLicenseStatusMock.mockReturnValue({ valid: false, enabled: false, features: [] });

    await expect(requireEchoProForAudioDspPatch({ dsdOutputMode: 'dop' })).resolves.toBeUndefined();
    await expect(requireEchoProForAudioDspPatch({ audioDsdOutputMode: 'dop' })).resolves.toBeUndefined();
    await expect(requireEchoProForAudioDspPatch({ echoSrcMode: 'family4x' })).rejects.toThrow('echo_pro_required');
    await expect(requireEchoProForAudioDspPatch({ sdmMode: 'pcmToDsd' })).rejects.toThrow('echo_pro_required');
  });
});
