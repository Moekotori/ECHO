import type { AppSettings } from '../../shared/types/appSettings';
import type { AudioOutputSettings } from '../../shared/types/audio';
import { isLocalProUnlocked } from '../plugins/LocalProEntitlements';

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

export const patchEnablesEchoProDsp = (patch: EchoProDspPatch | null | undefined): boolean => {
  if (!patch || typeof patch !== 'object') {
    return false;
  }

  return (
    (hasOwn(patch, 'audioEchoSrcMode') && patch.audioEchoSrcMode !== undefined && patch.audioEchoSrcMode !== 'off') ||
    (hasOwn(patch, 'echoSrcMode') && patch.echoSrcMode !== undefined && patch.echoSrcMode !== 'off') ||
    patchEnablesSdmMode(patch) ||
    (patchTouchesSdmProfile(patch) && !patchExplicitlyDisablesSdmMode(patch))
  );
};

export const requireEchoProForAudioDspPatch = async (patch: EchoProDspPatch | null | undefined): Promise<void> => {
  if (patchEnablesEchoProDsp(patch)) {
    if (!isLocalProUnlocked('dsp')) {
      throw new Error('echo_pro_required');
    }
  }
};
