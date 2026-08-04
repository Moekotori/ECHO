import type { AppSettings } from '../../shared/types/appSettings';
import type { AudioOutputSettings } from '../../shared/types/audio';
import { getConnectDonatorUnlockService } from '../plugins/ConnectDonatorUnlockService';
import { getEchoProAccountService } from '../plugins/EchoProAccountService';
import { getPluginService } from '../plugins/PluginService';

const echoProDspGateGraceMs = 30_000;
let lastEchoProDspGatePassedAt = 0;

type EchoProDspPatch =
  Partial<Pick<
    AppSettings,
    | 'audioEchoSrcMode'
    | 'audioSdmMode'
    | 'audioSdmOversamplingFilterProfile1x'
    | 'audioSdmOversamplingFilterProfileNx'
    | 'audioDsdOutputMode'
  >> &
  Partial<Pick<
    AudioOutputSettings,
    | 'echoSrcMode'
    | 'sdmMode'
    | 'sdmOversamplingFilterProfile1x'
    | 'sdmOversamplingFilterProfileNx'
    | 'dsdOutputMode'
  >>;

const hasOwn = (value: object, key: keyof EchoProDspPatch): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const patchEnablesSdmMode = (patch: EchoProDspPatch): boolean =>
  (hasOwn(patch, 'audioSdmMode') && patch.audioSdmMode !== undefined && patch.audioSdmMode !== 'off') ||
  (hasOwn(patch, 'sdmMode') && patch.sdmMode !== undefined && patch.sdmMode !== 'off');

const patchExplicitlyDisablesSdmMode = (patch: EchoProDspPatch): boolean =>
  (hasOwn(patch, 'audioSdmMode') && patch.audioSdmMode === 'off') ||
  (hasOwn(patch, 'sdmMode') && patch.sdmMode === 'off');

const patchTouchesSdmProfile = (patch: EchoProDspPatch): boolean =>
  hasOwn(patch, 'audioSdmOversamplingFilterProfile1x') ||
  hasOwn(patch, 'audioSdmOversamplingFilterProfileNx') ||
  hasOwn(patch, 'sdmOversamplingFilterProfile1x') ||
  hasOwn(patch, 'sdmOversamplingFilterProfileNx');

const isEchoProUser = (): boolean => {
  try {
    const licenseStatus = getPluginService().getEchoProLicenseStatus();
    if (licenseStatus.valid && licenseStatus.enabled && licenseStatus.features.includes('echo-pro')) {
      return true;
    }
  } catch {
    // Keep this gate light: fall through to other cached Pro status sources.
  }

  try {
    const accountStatus = getEchoProAccountService().getStatus();
    if (accountStatus.loggedIn && accountStatus.pro === true && accountStatus.status !== 'disabled') {
      return true;
    }
  } catch {
    // Keep this gate light: do not refresh or recover account state here.
  }

  try {
    return getConnectDonatorUnlockService().getStatus().unlocked === true;
  } catch {
    return false;
  }
};

export const patchEnablesEchoProDsp = (patch: EchoProDspPatch | null | undefined): boolean => {
  if (!patch || typeof patch !== 'object') {
    return false;
  }

  return (
    (hasOwn(patch, 'audioEchoSrcMode') && patch.audioEchoSrcMode !== undefined && patch.audioEchoSrcMode !== 'off') ||
    (hasOwn(patch, 'echoSrcMode') && patch.echoSrcMode !== undefined && patch.echoSrcMode !== 'off') ||
    patchEnablesSdmMode(patch) ||
    (patchTouchesSdmProfile(patch) && !patchExplicitlyDisablesSdmMode(patch)) ||
    (hasOwn(patch, 'audioDsdOutputMode') && patch.audioDsdOutputMode === 'dop') ||
    (hasOwn(patch, 'dsdOutputMode') && patch.dsdOutputMode === 'dop')
  );
};

export const requireEchoProForAudioDspPatch = async (patch: EchoProDspPatch | null | undefined): Promise<void> => {
  if (patchEnablesEchoProDsp(patch)) {
    const now = Date.now();
    if (now - lastEchoProDspGatePassedAt < echoProDspGateGraceMs) {
      return;
    }
    if (!isEchoProUser()) {
      throw new Error('echo_pro_required');
    }
    lastEchoProDspGatePassedAt = now;
  }
};
