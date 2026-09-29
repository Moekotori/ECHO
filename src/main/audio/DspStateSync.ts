import type { EqProfileBindingTarget } from '../../shared/types/eq';
import { EqStateStore } from './EqStateStore';
import type { JsonRpcBridge } from './JsonRpcBridge';

type NativeDspSyncTarget = Pick<
  JsonRpcBridge,
  | 'setState'
  | 'setDspHeadroom'
  | 'setDspSafetyLimiterEnabled'
  | 'setDspRackState'
  | 'setCompressorState'
  | 'setCrossfeedState'
  | 'setStereoFieldState'
  | 'setChannelMatrixState'
  | 'setChannelBalanceState'
  | 'clearRoomCorrection'
  | 'call'
>;

/**
 * Rehydrate the complete persisted DSP graph into the host that actually owns
 * the current output. This is intentionally awaited and ordered: a new host
 * starts with flat/default processors and must not receive PCM before its EQ,
 * balance and convolution state are authoritative.
 */
export async function syncPersistedDspStateToNative(
  target: NativeDspSyncTarget,
  profileTarget?: EqProfileBindingTarget,
): Promise<void> {
  if (profileTarget) {
    EqStateStore.applyBoundProfileForOutput(profileTarget);
  }

  const eqState = EqStateStore.loadEqState();
  const dspRackState = EqStateStore.loadDspRackState();
  const channelBalanceState = EqStateStore.loadChannelBalanceState();
  const roomCorrectionState = EqStateStore.loadRoomCorrectionState();
  const roomCorrectionIrPath = EqStateStore.getRoomCorrectionIrPath();

  await target.setDspRackState(dspRackState);
  await target.setCompressorState(dspRackState.compressor);
  await target.setCrossfeedState(dspRackState.crossfeed);
  await target.setStereoFieldState(dspRackState.stereoField);
  await target.setChannelMatrixState(dspRackState.channelMatrix);
  await target.setState(eqState);
  await target.setDspHeadroom(eqState.dspHeadroomDb ?? 0);
  await target.setDspSafetyLimiterEnabled(eqState.dspSafetyLimiterEnabled !== false);
  await target.setChannelBalanceState(channelBalanceState);

  // Clearing first prevents a resident/restarted host from retaining a stale
  // impulse response when the persisted state no longer has one.
  await target.clearRoomCorrection();
  if (roomCorrectionIrPath && roomCorrectionState.irId && roomCorrectionState.irName) {
    await target.call('roomCorrection.loadIr', [{
      path: roomCorrectionIrPath,
      irId: roomCorrectionState.irId,
      irName: roomCorrectionState.irName,
    }]);
    await target.call('roomCorrection.setTrim', [roomCorrectionState.trimDb]);
    await target.call('roomCorrection.setEnabled', [roomCorrectionState.enabled]);
  }
}
