import type { NativeOutputStartOptions } from '../audioTypes';
import type { StabilityRecoveryOptions } from '../AudioSessionTypes';
import type { SharedStabilityTier } from '../../../shared/types/audio';

export const normalizeStabilityRecoveryOptions = (
  callerTokenOrOptions: number | StabilityRecoveryOptions | undefined,
): StabilityRecoveryOptions => {
  if (typeof callerTokenOrOptions === 'number') {
    return { runToken: callerTokenOrOptions };
  }

  return callerTokenOrOptions ?? {};
};

export type SharedOutputProfile = Pick<
  NativeOutputStartOptions,
  'bufferSizeFrames' | 'fifoCapacityMs' | 'startupPrebufferMs' | 'startupPrebufferTimeoutMs'
>;

export const sharedLowLatencyProfile: SharedOutputProfile = {
  bufferSizeFrames: 2048,
  fifoCapacityMs: 420,
  startupPrebufferMs: 120,
  startupPrebufferTimeoutMs: 450,
};

export const sharedStabilityProfiles: Record<SharedStabilityTier, SharedOutputProfile> = {
  standard: {
    bufferSizeFrames: 4096,
    fifoCapacityMs: 750,
    startupPrebufferMs: 180,
    startupPrebufferTimeoutMs: 650,
  },
  recovery: {
    bufferSizeFrames: 8192,
    fifoCapacityMs: 1200,
    startupPrebufferMs: 240,
    startupPrebufferTimeoutMs: 800,
  },
  emergency: {
    bufferSizeFrames: 8192,
    fifoCapacityMs: 1500,
    startupPrebufferMs: 300,
    startupPrebufferTimeoutMs: 1000,
  },
};

export const stableSharedProfile: SharedOutputProfile = {
  bufferSizeFrames: 8192,
  fifoCapacityMs: 1500,
  startupPrebufferMs: 300,
  startupPrebufferTimeoutMs: 1000,
};

export const echoSrcUltraOutputProfile: SharedOutputProfile = {
  bufferSizeFrames: 8192,
  fifoCapacityMs: 1200,
  startupPrebufferMs: 180,
  startupPrebufferTimeoutMs: 800,
};

export const nativeAdaptiveOutputProfiles: Record<'recovery' | 'emergency', SharedOutputProfile> = {
  recovery: {
    bufferSizeFrames: 4096,
    fifoCapacityMs: 1000,
    startupPrebufferMs: 160,
    startupPrebufferTimeoutMs: 700,
  },
  emergency: {
    bufferSizeFrames: 8192,
    fifoCapacityMs: 1500,
    startupPrebufferMs: 260,
    startupPrebufferTimeoutMs: 1000,
  },
};

export const httpStreamingSharedProfile: SharedOutputProfile = {
  bufferSizeFrames: 8192,
  fifoCapacityMs: 3000,
  startupPrebufferMs: 250,
  startupPrebufferTimeoutMs: 1500,
};

export const directSoundSharedProfile: SharedOutputProfile = {
  bufferSizeFrames: 256,
  fifoCapacityMs: 120,
  startupPrebufferMs: 0,
  startupPrebufferTimeoutMs: 0,
};
