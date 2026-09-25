import type { AudioStatus } from '../../shared/types/audio';
import { safeAudioDspOutputSettings, safeAudioResetOutputSettings } from '../../shared/audioSafeBaseline';
import { getLocalProEntitlementSnapshot, type LocalProEntitlementSnapshot } from '../plugins/LocalProEntitlements';
import { enqueueAudioCommand } from '../ipc/audioCommandQueue';
import { getAudioSession } from './AudioSession';

const statusUsesEchoProDsp = (status: AudioStatus): boolean =>
  (status.sdmMode !== undefined && status.sdmMode !== 'off') ||
  status.sdmActive === true ||
  (status.echoSrcMode !== undefined && status.echoSrcMode !== 'off') ||
  status.echoSrcActive === true;

export const applySafeAudioDspRuntimeBaseline = async (): Promise<AudioStatus> =>
  enqueueAudioCommand(() => getAudioSession().setOutput(safeAudioDspOutputSettings));

export const applyDefaultAudioRuntimeBaseline = async (): Promise<AudioStatus> =>
  enqueueAudioCommand(() => getAudioSession().setOutput(safeAudioResetOutputSettings));

export const reconcileEchoProAudioEntitlement = async (): Promise<LocalProEntitlementSnapshot> => {
  const snapshot = getLocalProEntitlementSnapshot('dsp');
  if (!snapshot.unlocked) {
    const session = getAudioSession();
    if (statusUsesEchoProDsp(session.getStatus())) {
      await enqueueAudioCommand(() => session.setOutput(safeAudioDspOutputSettings));
    }
  }
  return snapshot;
};
