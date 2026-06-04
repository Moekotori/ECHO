import type { AudioDiagnostics } from '../../../shared/types/audio';

const formatDiagnosticsValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '[]';
  }

  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }

  return String(value);
};

export const formatAudioDiagnostics = (diagnostics: AudioDiagnostics): string => {
  const rows: Array<[string, unknown]> = [
    ['state', diagnostics.state],
    ['host', diagnostics.host],
    ['outputMode', diagnostics.outputMode],
    ['sharedBackend', diagnostics.sharedBackend],
    ['latencyProfile', diagnostics.latencyProfile],
    ['asioCompatibilityProfile', diagnostics.asioCompatibilityProfile],
    ['outputBackend', diagnostics.outputBackend],
    ['activeOutputBackendImpl', diagnostics.activeOutputBackendImpl],
    ['nativeOutputFormat', diagnostics.nativeOutputFormat],
    ['useJuceOutputRequested', diagnostics.useJuceOutputRequested],
    ['activeDecodeBackendImpl', diagnostics.activeDecodeBackendImpl],
    ['useJuceDecodeRequested', diagnostics.useJuceDecodeRequested],
    ['dsdOutputModeRequested', diagnostics.dsdOutputModeRequested],
    ['activeDsdOutputMode', diagnostics.activeDsdOutputMode],
    ['dsdNativeSampleRate', diagnostics.dsdNativeSampleRate],
    ['dsdTransportSampleRate', diagnostics.dsdTransportSampleRate],
    ['outputDeviceName', diagnostics.outputDeviceName],
    ['currentFilePath', diagnostics.currentFilePath],
    ['currentTrackId', diagnostics.currentTrackId],
    ['durationSeconds', diagnostics.durationSeconds],
    ['positionSeconds', diagnostics.positionSeconds],
    ['playbackRate', diagnostics.playbackRate],
    ['fileSampleRate', diagnostics.fileSampleRate],
    ['decoderOutputSampleRate', diagnostics.decoderOutputSampleRate],
    ['requestedOutputSampleRate', diagnostics.requestedOutputSampleRate],
    ['actualDeviceSampleRate', diagnostics.actualDeviceSampleRate],
    ['sharedDeviceSampleRate', diagnostics.sharedDeviceSampleRate],
    ['resampling', diagnostics.resampling],
    ['ffmpegPath', diagnostics.ffmpegPath],
    ['ffmpegSource', diagnostics.ffmpegSource],
    ['ffmpegVersion', diagnostics.ffmpegVersion],
    ['ffmpegHealthy', diagnostics.ffmpegHealthy],
    ['soxrAvailable', diagnostics.soxrAvailable],
    ['resamplerEngine', diagnostics.resamplerEngine],
    ['resamplerFallbackActive', diagnostics.resamplerFallbackActive],
    ['bitPerfectCandidate', diagnostics.bitPerfectCandidate],
    ['sampleRateMismatch', diagnostics.sampleRateMismatch],
    ['sharedStabilityTier', diagnostics.sharedStabilityTier],
    ['nativeDeviceBufferFrames', diagnostics.nativeDeviceBufferFrames],
    ['nativeRequestedBufferFrames', diagnostics.nativeRequestedBufferFrames],
    ['nativeActualBufferFrames', diagnostics.nativeActualBufferFrames],
    ['nativeOutputLatencyMs', diagnostics.nativeOutputLatencyMs],
    ['nativePositionStalenessMs', diagnostics.nativePositionStalenessMs],
    ['nativeFifoCapacityFrames', diagnostics.nativeFifoCapacityFrames],
    ['nativeStartupPrebufferFrames', diagnostics.nativeStartupPrebufferFrames],
    ['nativeBufferedFrames', diagnostics.nativeBufferedFrames],
    ['nativeBufferedMs', diagnostics.nativeBufferedMs],
    ['nativeUnderrunCallbacks', diagnostics.nativeUnderrunCallbacks],
    ['nativeUnderrunFrames', diagnostics.nativeUnderrunFrames],
    ['mainEventLoopLagMs', diagnostics.mainEventLoopLagMs],
    ['audioHostRestartCount', diagnostics.audioHostRestartCount],
    ['playbackRecoveryCount', diagnostics.playbackRecoveryCount],
    ['lastSharedStabilityRecoveryAt', diagnostics.lastSharedStabilityRecoveryAt],
    ['warnings', diagnostics.warnings],
    ['error', diagnostics.error],
    ['watchdogStatus', diagnostics.watchdogStatus],
    ['recentWatchdogRecoveryCount', diagnostics.recentWatchdogRecoveryCount],
    ['lastWatchdogRecoveryTime', diagnostics.lastWatchdogRecoveryTime],
    ['playbackIssueSummary', diagnostics.playbackIssueSummary ? JSON.stringify(diagnostics.playbackIssueSummary) : null],
    ['recentPlaybackEvents', diagnostics.recentPlaybackEvents ? JSON.stringify(diagnostics.recentPlaybackEvents, null, 2) : null],
  ];

  return ['ECHO Next Audio Diagnostics', ...rows.map(([label, value]) => `${label}: ${formatDiagnosticsValue(value)}`)].join('\n');
};
