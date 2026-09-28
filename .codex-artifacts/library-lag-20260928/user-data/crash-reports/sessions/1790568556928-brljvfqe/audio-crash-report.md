# ECHO Next Audio Crash Report

Generated: 2026-09-28T04:09:36.062Z
Report file: audio-crash-report.md
AI review tip: Copy this report and paste it into AI to help identify the problem.

## Summary

- Phase: play-local-file-ipc
- Severity: fatal
- Recovered: n/a
- Message: ASIOInit failed driver="TEAC ASIO USB DRIVER" error=ASE_NotPresent(-1000) driverMessage="No device found."
- Crash timestamp: 2026-09-28T04:09:36.058Z

## Related Audio Events In This Session

- Events included: 2
- Time window: 2026-09-28T04:09:36.024Z -> 2026-09-28T04:09:36.058Z
- Reading tip: different top-level errors can be one incident when the device/mode changes during fallback.

| # | Time | Severity | Phase | Mode | Device | Rate | Failure class | Recovery signal |
| - | - | - | - | - | - | - | - | - |
| 1 | 04:09:36.024 | fatal | error | asio | TEAC ASIO USB DRIVER | 96000 | audio_pipeline_error | n/a |
| 2 | 04:09:36.058 | fatal | play-local-file-ipc | shared | n/a | n/a | audio_pipeline_error | n/a |

## Correlation Analysis

- Likely one chained incident: unknown
- Failure classes observed: audio_pipeline_error
- Output modes involved: asio, shared
- Devices involved: TEAC ASIO USB DRIVER
- Requested/actual rate transitions: 96000
- Recovery/fallback signals: n/a

## Why This Error Happened

- Operation phase: play-local-file-ipc
- Output mode at the time: shared
- Output device at the time: unknown
- Active warnings: n/a
- Direct cause: ECHO received an audio pipeline error that does not match a specialized diagnosis rule yet.
- Next clue: read the exact message, details JSON, audio status snapshot, and recent audio logs below. They include the phase, selected device, output mode, requested rate, opened rate, buffer sizes, and native stderr tail when available.

## Error Cause Details

- Raw message: ASIOInit failed driver="TEAC ASIO USB DRIVER" error=ASE_NotPresent(-1000) driverMessage="No device found."
- Severity: fatal
- Recovered automatically: false
- Requested sample rate: n/a
- Actual device sample rate: n/a
- Requested buffer frames: n/a
- Actual buffer frames: n/a

## Session

```json
{
  "sessionId": "[redacted]",
  "appVersion": "26.9.25",
  "electronVersion": "42.3.3",
  "chromeVersion": "148.0.7778.218",
  "nodeVersion": "24.15.0",
  "platform": "win32",
  "arch": "x64",
  "startedAt": "2026-09-28T04:09:16.929Z",
  "status": "running",
  "shutdownRequestedAt": "2026-09-28T04:09:35.927Z"
}
```

## Audio Error

```json
{
  "message": "ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\"",
  "stack": "Error: ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\"\n    at JsonRpcBridge.handleResponse (file:///D:/ECHOCommunity/out/main/index.js:8575:24)\n    at JsonRpcBridge.handleLine (file:///D:/ECHOCommunity/out/main/index.js:8563:12)\n    at Interface.lineHandler (file:///D:/ECHOCommunity/out/main/index.js:8379:33)\n    at Interface.emit (node:events:509:28)\n    at [_onLine] [as _onLine] (node:internal/readline/interface:465:12)\n    at [_normalWrite] [as _normalWrite] (node:internal/readline/interface:647:22)\n    at Socket.ondata (node:internal/readline/interface:263:23)\n    at Socket.emit (node:events:509:28)\n    at addChunk (node:internal/streams/readable:563:12)\n    at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)",
  "phase": "play-local-file-ipc",
  "severity": "fatal",
  "details": {
    "request": {
      "filePath": {
        "basename": "02. Roselia - Ringing Bloom.flac",
        "pathHash": "333ed4bd5b9aebbf"
      },
      "trackId": "8e64cd4d-5a21-4c9a-848d-fa1e98ae6bad",
      "metadata": {
        "title": "Ringing Bloom",
        "artist": "Roselia",
        "album": "FIRE BIRD",
        "albumArtist": "Roselia",
        "coverUrl": "echo-cover://thumb/5cf4a99c-2a85-46fb-830f-4582a03895fc"
      },
      "output": {
        "playbackRate": 1,
        "playbackSpeedMode": "nightcore"
      },
      "probe": {
        "durationSeconds": 335.03333333333336,
        "fileSampleRate": 96000,
        "channels": 2,
        "codec": "FLAC",
        "bitDepth": 24,
        "bitrate": 3398259,
        "bpm": 194.5,
        "bpmConfidence": 0.608,
        "beatOffsetMs": 93
      },
      "replayGain": null
    }
  },
  "audioStatus": {
    "host": "not-initialized",
    "cpuModel": "AMD Ryzen 9 9950X3D 16-Core Processor",
    "state": "idle",
    "outputDeviceId": null,
    "outputDeviceName": null,
    "outputDeviceType": null,
    "outputBackend": null,
    "activeOutputBackendImpl": null,
    "nativeOutputFormat": null,
    "outputMode": "shared",
    "automaticOutputEnabled": false,
    "automaticOutputStage": "disabled",
    "sharedBackend": "auto",
    "useMiniaudioOutputRequested": false,
    "nativeDirectLocalPlaybackRequested": true,
    "nativeDirectLocalPlaybackActive": false,
    "nativeDirectLocalPlaybackFallbackReason": null,
    "activeDecodeBackendImpl": null,
    "activeDecodeBackendLabel": null,
    "dsdOutputModeRequested": "pcm",
    "activeDsdOutputMode": null,
    "dsdNativeSampleRate": null,
    "dsdTransportSampleRate": null,
    "sdmMode": "off",
    "sdmTargetRate": "dsd128",
    "sdmQualityProfile": {
      "basename": "safe",
      "pathHash": "8b3369944dd2a3fa"
    },
    "sdmComputeBackend": "cpu",
    "sdmOversamplingFilterProfile1x": {
      "basename": "sinc-long",
      "pathHash": "a2ff4caec0eced99"
    },
    "sdmOversamplingFilterProfileNx": {
      "basename": "poly-sinc-hb",
      "pathHash": "582ed7be15aca72e"
    },
    "sdmActualComputeBackend": null,
    "sdmActive": false,
    "sdmRuntimeState": "off",
    "sdmNativeSampleRate": null,
    "sdmTransportSampleRate": null,
    "sdmModulatorProfile": null,
    "sdmCudaStatus": null,
    "sdmRuntime": null,
    "latencyProfile": {
      "basename": "balanced",
      "pathHash": "c0905088ba5b8067"
    },
    "volume": 1,
    "playbackRate": 1,
    "playbackSpeedMode": "nightcore",
    "replayGainEnabled": false,
    "replayGainMode": "track",
    "replayGainAppliedDb": 0,
    "replayGainPreventedClipping": false,
    "gaplessPlaybackEnabled": false,
    "automix": {
      "enabled": false,
      "mode": "off",
      "active": false,
      "transitionSeconds": null,
      "transitionStartedAtSeconds": null,
      "nextTrackId": null,
      "transitionMode": null,
      "fallbackReason": null,
      "beatAligned": false,
      "gapless": false,
      "skipIntroSilence": false,
      "engine": null,
      "tempoRatio": null,
      "nextStartSeconds": null,
      "overlapSeconds": null,
      "advanceAtSeconds": null,
      "plannedTrackCount": 0,
      "nextTransitionIndex": 0,
      "phase": "native_beta",
      "runtimeState": "idle",
      "planId": null,
      "analysisVersion": null,
      "bitPerfectDisabled": false,
      "automixBypassed": null
    },
    "currentFilePath": null,
    "currentTrackId": null,
    "currentQueueItemId": null,
    "queueRevision": null,
    "currentTrackTitle": null,
    "currentTrackArtist": null,
    "currentTrackAlbum": null,
    "currentTrackAlbumArtist": null,
    "currentTrackCoverUrl": null,
    "durationSeconds": 0,
    "positionSeconds": 0,
    "channels": null,
    "codec": null,
    "bitDepth": null,
    "bitrate": null,
    "fileSampleRate": null,
    "decoderOutputSampleRate": null,
    "requestedOutputSampleRate": null,
    "actualDeviceSampleRate": null,
    "sharedDeviceSampleRate": null,
    "resampling": false,
    "ffmpegPath": {
      "basename": "ffmpeg.exe",
      "pathHash": "ca3920c6a72c864e"
    },
    "ffmpegSource": "dev-bundled",
    "ffmpegVersion": "8.1.1-essentials_build-www.gyan.dev",
    "ffmpegHealthy": true,
    "soxrAvailable": false,
    "resamplerEngine": "default",
    "resamplerFallbackActive": false,
    "echoSrcMode": "off",
    "echoSrcQualityProfile": {
      "basename": "transparent",
      "pathHash": "10e9f5602d2492b3"
    },
    "echoSrcAdvancedModeEnabled": false,
    "echoSrcFilterProfile": {
      "basename": "poly-sinc-gauss-long",
      "pathHash": "6f58a9cda7af2dc3"
    },
    "echoSrcFilterProfile1x": {
      "basename": "poly-sinc-gauss-long",
      "pathHash": "6f58a9cda7af2dc3"
    },
    "echoSrcFilterProfileNx": {
      "basename": "poly-sinc-hb",
      "pathHash": "582ed7be15aca72e"
    },
    "echoSrcComputeBackend": "cpu",
    "echoSrcCudaActive": false,
    "echoSrcTargetSampleRate": null,
    "echoSrcActive": false,
    "echoSrcRuntime": null,
    "pcmDitherMode": "off",
    "pcmDitherActive": false,
    "pcmDitherTargetBitDepth": null,
    "pcmDitherReason": "off",
    "bitPerfectCandidate": false,
    "sampleRateMismatch": false,
    "eqEnabled": false,
    "roomCorrectionEnabled": false,
    "channelBalanceEnabled": false,
    "dspActive": false,
    "preampDb": 0,
    "dspHeadroomDb": 0,
    "eqPresetName": "Flat",
    "clippingRisk": false,
    "dspClippingRisk": false,
    "dspLimiterProtecting": false,
    "audioLevels": {
      "inputPeakDb": null,
      "inputRmsDb": null,
      "estimatedOutputPeakDb": null,
      "estimatedOutputRmsDb": null,
      "inputTruePeakDb": null,
      "estimatedOutputTruePeakDb": null,
      "truePeakHeadroomDb": null,
      "intersamplePeakDb": null,
      "visualSpectrum": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "visualSpectrumVersion": 2,
      "visualEnergy": 0,
      "visualTransient": 0,
      "visualTelemetryState": "fallback",
      "levelMeterObserveCostMs": 0,
      "visualSpectrumComputeCostMs": 0,
      "headroomDb": null,
      "clipCount": 0,
      "lastClipAt": null,
      "meterSource": "pre_native_estimated_post_dsp"
    },
    "bitPerfectDisabledReason": null,
    "sharedStabilityTier": null,
    "nativeDeviceBufferFrames": null,
    "nativeRequestedBufferFrames": null,
    "nativeActualBufferFrames": null,
    "nativeOutputLatencyMs": null,
    "nativePositionStalenessMs": null,
    "nativeFifoCapacityFrames": null,
    "nativeStartupPrebufferFrames": null,
    "nativeBufferedFrames": null,
    "nativeBufferedMs": null,
    "nativeUnderrunCallbacks": 0,
    "nativeUnderrunFrames": 0,
    "mainEventLoopLagMs": 0,
    "audioHostRestartCount": 0,
    "playbackRecoveryCount": 0,
    "lastSharedStabilityRecoveryAt": null,
    "warnings": [],
    "error": null
  },
  "type": "audio",
  "timestamp": "2026-09-28T04:09:36.058Z",
  "sessionId": "[redacted]"
}
```

## Stack

```text
Error: ASIOInit failed driver="TEAC ASIO USB DRIVER" error=ASE_NotPresent(-1000) driverMessage="No device found."
    at JsonRpcBridge.handleResponse (file:///D:/ECHOCommunity/out/main/index.js:8575:24)
    at JsonRpcBridge.handleLine (file:///D:/ECHOCommunity/out/main/index.js:8563:12)
    at Interface.lineHandler (file:///D:/ECHOCommunity/out/main/index.js:8379:33)
    at Interface.emit (node:events:509:28)
    at [_onLine] [as _onLine] (node:internal/readline/interface:465:12)
    at [_normalWrite] [as _normalWrite] (node:internal/readline/interface:647:22)
    at Socket.ondata (node:internal/readline/interface:263:23)
    at Socket.emit (node:events:509:28)
    at addChunk (node:internal/streams/readable:563:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)
```

## Audio Status Snapshot

```json
{
  "host": "not-initialized",
  "cpuModel": "AMD Ryzen 9 9950X3D 16-Core Processor",
  "state": "idle",
  "outputDeviceId": null,
  "outputDeviceName": null,
  "outputDeviceType": null,
  "outputBackend": null,
  "activeOutputBackendImpl": null,
  "nativeOutputFormat": null,
  "outputMode": "shared",
  "automaticOutputEnabled": false,
  "automaticOutputStage": "disabled",
  "sharedBackend": "auto",
  "useMiniaudioOutputRequested": false,
  "nativeDirectLocalPlaybackRequested": true,
  "nativeDirectLocalPlaybackActive": false,
  "nativeDirectLocalPlaybackFallbackReason": null,
  "activeDecodeBackendImpl": null,
  "activeDecodeBackendLabel": null,
  "dsdOutputModeRequested": "pcm",
  "activeDsdOutputMode": null,
  "dsdNativeSampleRate": null,
  "dsdTransportSampleRate": null,
  "sdmMode": "off",
  "sdmTargetRate": "dsd128",
  "sdmQualityProfile": {
    "basename": "safe",
    "pathHash": "8b3369944dd2a3fa"
  },
  "sdmComputeBackend": "cpu",
  "sdmOversamplingFilterProfile1x": {
    "basename": "sinc-long",
    "pathHash": "a2ff4caec0eced99"
  },
  "sdmOversamplingFilterProfileNx": {
    "basename": "poly-sinc-hb",
    "pathHash": "582ed7be15aca72e"
  },
  "sdmActualComputeBackend": null,
  "sdmActive": false,
  "sdmRuntimeState": "off",
  "sdmNativeSampleRate": null,
  "sdmTransportSampleRate": null,
  "sdmModulatorProfile": null,
  "sdmCudaStatus": null,
  "sdmRuntime": null,
  "latencyProfile": {
    "basename": "balanced",
    "pathHash": "c0905088ba5b8067"
  },
  "volume": 1,
  "playbackRate": 1,
  "playbackSpeedMode": "nightcore",
  "replayGainEnabled": false,
  "replayGainMode": "track",
  "replayGainAppliedDb": 0,
  "replayGainPreventedClipping": false,
  "gaplessPlaybackEnabled": false,
  "automix": {
    "enabled": false,
    "mode": "off",
    "active": false,
    "transitionSeconds": null,
    "transitionStartedAtSeconds": null,
    "nextTrackId": null,
    "transitionMode": null,
    "fallbackReason": null,
    "beatAligned": false,
    "gapless": false,
    "skipIntroSilence": false,
    "engine": null,
    "tempoRatio": null,
    "nextStartSeconds": null,
    "overlapSeconds": null,
    "advanceAtSeconds": null,
    "plannedTrackCount": 0,
    "nextTransitionIndex": 0,
    "phase": "native_beta",
    "runtimeState": "idle",
    "planId": null,
    "analysisVersion": null,
    "bitPerfectDisabled": false,
    "automixBypassed": null
  },
  "currentFilePath": null,
  "currentTrackId": null,
  "currentQueueItemId": null,
  "queueRevision": null,
  "currentTrackTitle": null,
  "currentTrackArtist": null,
  "currentTrackAlbum": null,
  "currentTrackAlbumArtist": null,
  "currentTrackCoverUrl": null,
  "durationSeconds": 0,
  "positionSeconds": 0,
  "channels": null,
  "codec": null,
  "bitDepth": null,
  "bitrate": null,
  "fileSampleRate": null,
  "decoderOutputSampleRate": null,
  "requestedOutputSampleRate": null,
  "actualDeviceSampleRate": null,
  "sharedDeviceSampleRate": null,
  "resampling": false,
  "ffmpegPath": {
    "basename": "ffmpeg.exe",
    "pathHash": "ca3920c6a72c864e"
  },
  "ffmpegSource": "dev-bundled",
  "ffmpegVersion": "8.1.1-essentials_build-www.gyan.dev",
  "ffmpegHealthy": true,
  "soxrAvailable": false,
  "resamplerEngine": "default",
  "resamplerFallbackActive": false,
  "echoSrcMode": "off",
  "echoSrcQualityProfile": {
    "basename": "transparent",
    "pathHash": "10e9f5602d2492b3"
  },
  "echoSrcAdvancedModeEnabled": false,
  "echoSrcFilterProfile": {
    "basename": "poly-sinc-gauss-long",
    "pathHash": "6f58a9cda7af2dc3"
  },
  "echoSrcFilterProfile1x": {
    "basename": "poly-sinc-gauss-long",
    "pathHash": "6f58a9cda7af2dc3"
  },
  "echoSrcFilterProfileNx": {
    "basename": "poly-sinc-hb",
    "pathHash": "582ed7be15aca72e"
  },
  "echoSrcComputeBackend": "cpu",
  "echoSrcCudaActive": false,
  "echoSrcTargetSampleRate": null,
  "echoSrcActive": false,
  "echoSrcRuntime": null,
  "pcmDitherMode": "off",
  "pcmDitherActive": false,
  "pcmDitherTargetBitDepth": null,
  "pcmDitherReason": "off",
  "bitPerfectCandidate": false,
  "sampleRateMismatch": false,
  "eqEnabled": false,
  "roomCorrectionEnabled": false,
  "channelBalanceEnabled": false,
  "dspActive": false,
  "preampDb": 0,
  "dspHeadroomDb": 0,
  "eqPresetName": "Flat",
  "clippingRisk": false,
  "dspClippingRisk": false,
  "dspLimiterProtecting": false,
  "audioLevels": {
    "inputPeakDb": null,
    "inputRmsDb": null,
    "estimatedOutputPeakDb": null,
    "estimatedOutputRmsDb": null,
    "inputTruePeakDb": null,
    "estimatedOutputTruePeakDb": null,
    "truePeakHeadroomDb": null,
    "intersamplePeakDb": null,
    "visualSpectrum": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    "visualSpectrumVersion": 2,
    "visualEnergy": 0,
    "visualTransient": 0,
    "visualTelemetryState": "fallback",
    "levelMeterObserveCostMs": 0,
    "visualSpectrumComputeCostMs": 0,
    "headroomDb": null,
    "clipCount": 0,
    "lastClipAt": null,
    "meterSource": "pre_native_estimated_post_dsp"
  },
  "bitPerfectDisabledReason": null,
  "sharedStabilityTier": null,
  "nativeDeviceBufferFrames": null,
  "nativeRequestedBufferFrames": null,
  "nativeActualBufferFrames": null,
  "nativeOutputLatencyMs": null,
  "nativePositionStalenessMs": null,
  "nativeFifoCapacityFrames": null,
  "nativeStartupPrebufferFrames": null,
  "nativeBufferedFrames": null,
  "nativeBufferedMs": null,
  "nativeUnderrunCallbacks": 0,
  "nativeUnderrunFrames": 0,
  "mainEventLoopLagMs": 0,
  "audioHostRestartCount": 0,
  "playbackRecoveryCount": 0,
  "lastSharedStabilityRecoveryAt": null,
  "warnings": [],
  "error": null
}
```

## Current Playback Snapshot

```json
{
  "state": "idle",
  "currentTrackId": null,
  "positionSeconds": 0,
  "durationSeconds": 0,
  "currentFilePath": null
}
```

## Recent Audio Logs

### audio.log

```text
{"timestamp":"2026-09-28T04:09:36.055Z","scope":"audio","level":"error","message":"ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\"","payload":{"message":"ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\"","stack":"Error: ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\"\n    at JsonRpcBridge.handleResponse (file:///D:/ECHOCommunity/out/main/index.js:8575:24)\n    at JsonRpcBridge.handleLine (file:///D:/ECHOCommunity/out/main/index.js:8563:12)\n    at Interface.lineHandler (file:///D:/ECHOCommunity/out/main/index.js:8379:33)\n    at Interface.emit (node:events:509:28)\n    at [_onLine] [as _onLine] (node:internal/readline/interface:465:12)\n    at [_normalWrite] [as _normalWrite] (node:internal/readline/interface:647:22)\n    at Socket.ondata (node:internal/readline/interface:263:23)\n    at Socket.emit (node:events:509:28)\n    at addChunk (node:internal/streams/readable:563:12)\n    at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)","phase":"error","severity":"fatal","details":{"outputWarnings":["daemon_playback_failed_closed:ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No devi"],"currentOutputSettings":{"outputMode":"asio","automaticOutputEnabled":false,"latencyProfile":{"basename":"stable","pathHash":"f379ccb92b911644"},"sharedBackend":"auto","useMiniaudioOutput":false,"nativeDirectLocalPlaybackEnabled":true,"dsdOutputMode":"pcm","sdmMode":"off","sdmTargetRate":"dsd256","sdmQualityProfile":{"basename":"safe","pathHash":"8b3369944dd2a3fa"},"sdmComputeBackend":"cuda","sdmOversamplingFilterProfile1x":{"basename":"sinc-long","pathHash":"a2ff4caec0eced99"},"sdmOversamplingFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"exclusiveInstabilityFallbackEnabled":false,"defaultDeviceFallbackEnabled":false,"soxrFallbackEnabled":true,"echoSrcMode":"off","echoSrcQualityProfile":{"basename":"transparent","pathHash":"10e9f5602d2492b3"},"echoSrcAdvancedModeEnabled":true,"echoSrcFilterProfile":{"basename":"poly-sinc-gauss-long","pathHash":"6f58a9cda7af2dc3"},"echoSrcFilterProfile1x":{"basename":"poly-sinc-gauss-long","pathHash":"6f58a9cda7af2dc3"},"echoSrcFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"echoSrcComputeBackend":"cuda","pcmDitherMode":"ultra-shaped","releaseExclusiveOnPauseExperimentalEnabled":false,"volume":0.24999999999999958,"playbackRate":1,"playbackSpeedMode":"nightcore","deviceIndex":1,"deviceName":"TEAC ASIO USB DRIVER","useLibavDecode":false},"currentPlan":{"fileSampleRate":96000,"outputChannels":2,"decoderOutputSampleRate":96000,"requestedOutputSampleRate":96000,"actualDeviceSampleRate":null,"sharedDeviceSampleRate":null,"dsdOutputMode":"pcm","dsdNativeSampleRate":null,"dsdTransportSampleRate":null,"outputMode":"asio","resampling":false,"echoSrcMode":"off","echoSrcQualityProfile":{"basename":"transparent","pathHash":"10e9f5602d2492b3"},"echoSrcAdvancedModeEnabled":true,"echoSrcFirActive":false,"echoSrcFilterProfile":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"echoSrcFilterProfile1x":{"basename":"poly-sinc-gauss-long","pathHash":"6f58a9cda7af2dc3"},"echoSrcFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"echoSrcFilterSlot":"nx","echoSrcComputeBackend":"cuda","echoSrcCudaActive":false,"echoSrcTargetSampleRate":null,"echoSrcActive":false,"echoSrcRuntime":null,"sdmPcmToDsdActive":false,"sdmOutputFormat":null,"sdmNativeSampleRate":null,"sdmTransportSampleRate":null,"sdmComputeBackend":"cuda","sdmActualComputeBackend":null,"sdmModulatorProfile":null,"sdmProcessingMode":null,"sdmBatchFrames":null,"sdmMaxBlockFrames":null,"sdmOversamplingFilterProfile":{"basename":"sinc-long","pathHash":"a2ff4caec0eced99"},"sdmOversamplingFilterProfile1x":{"basename":"sinc-long","pathHash":"a2ff4caec0eced99"},"sdmOversamplingFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"sdmOversamplingFirActive":false,"sdmRuntime":null,"bitPerfectCandidate":true,"sampleRateMismatch":false,"warnings":[]}},"audioStatus":{"host":"error","cpuModel":"AMD Ryzen 9 9950X3D 16-Core Processor","state":"error","outputDeviceId":"asio:1","outputDeviceName":"TEAC ASIO USB DRIVER","outputDeviceType":null,"outputBackend":null,"activeOutputBackendImpl":null,"nativeOutputFormat":null,"outputMode":"asio","automaticOutputEnabled":false,"automaticOutputStage":"disabled","sharedBackend":"auto","useMiniaudioOutputRequested":false,"nativeDirectLocalPlaybackRequested":true,"nativeDirectLocalPlaybackActive":false,"nativeDirectLocalPlaybackFallbackReason":null,"activeDecodeBackendImpl":null,"activeDecodeBackendLabel":null,"dsdOutputModeRequested":"pcm","activeDsdOutputMode":null,"dsdNativeSampleRate":null,"dsdTransportSampleRate":null,"sdmMode":"off","sdmTargetRate":"dsd256","sdmQualityProfile":{"basename":"safe","pathHash":"8b3369944dd2a3fa"},"sdmComputeBackend":"cuda","sdmOversamplingFilterProfile1x":{"basename":"sinc-long","pathHash":"a2ff4caec0eced99"},"sdmOversamplingFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"sdmActualComputeBackend":null,"sdmActive":false,"sdmRuntimeState":"off","sdmNativeSampleRate":null,"sdmTransportSampleRate":null,"sdmModulatorProfile":null,"sdmCudaStatus":null,"sdmRuntime":null,"latencyProfile":{"basename":"stable","pathHash":"f379ccb92b911644"},"volume":0.24999999999999958,"playbackRate":1,"playbackSpeedMode":"nightcore","replayGainEnabled":false,"replayGainMode":"track","replayGainAppliedDb":0,"replayGainPreventedClipping":false,"gaplessPlaybackEnabled":false,"automix":{"enabled":false,"mode":"off","active":false,"transitionSeconds":null,"transitionStartedAtSeconds":null,"nextTrackId":null,"transitionMode":null,"fallbackReason":null,"beatAligned":false,"gapless":false,"skipIntroSilence":false,"engine":null,"tempoRatio":null,"nextStartSeconds":null,"overlapSeconds":null,"advanceAtSeconds":null,"plannedTrackCount":0,"nextTransitionIndex":0,"phase":"native_beta","runtimeState":"idle","planId":null,"analysisVersion":null,"bitPerfectDisabled":false,"automixBypassed":null},"currentFilePath":{"basename":"02. Roselia - Ringing Bloom.flac","pathHash":"333ed4bd5b9aebbf"},"currentTrackId":"8e64cd4d-5a21-4c9a-848d-fa1e98ae6bad","currentQueueItemId":null,"queueRevision":6,"currentTrackTitle":"Ringing Bloom","currentTrackArtist":"Roselia","currentTrackAlbum":"FIRE BIRD","currentTrackAlbumArtist":"Roselia","currentTrackCoverUrl":"echo-cover://thumb/5cf4a99c-2a85-46fb-830f-4582a03895fc","durationSeconds":335.03333333333336,"positionSeconds":0,"channels":2,"codec":"FLAC","bitDepth":24,"bitrate":3398259,"fileSampleRate":96000,"decoderOutputSampleRate":96000,"requestedOutputSampleRate":96000,"actualDeviceSampleRate":null,"sharedDeviceSampleRate":null,"resampling":false,"ffmpegPath":{"basename":"ffmpeg.exe","pathHash":"ca3920c6a72c864e"},"ffmpegSource":"dev-bundled","ffmpegVersion":"8.1.1-essentials_build-www.gyan.dev","ffmpegHealthy":true,"soxrAvailable":false,"resamplerEngine":"default","resamplerFallbackActive":false,"echoSrcMode":"off","echoSrcQualityProfile":{"basename":"transparent","pathHash":"10e9f5602d2492b3"},"echoSrcAdvancedModeEnabled":true,"echoSrcFilterProfile":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"echoSrcFilterProfile1x":{"basename":"poly-sinc-gauss-long","pathHash":"6f58a9cda7af2dc3"},"echoSrcFilterProfileNx":{"basename":"poly-sinc-hb","pathHash":"582ed7be15aca72e"},"echoSrcComputeBackend":"cuda","echoSrcCudaActive":false,"echoSrcTargetSampleRate":null,"echoSrcActive":false,"echoSrcRuntime":null,"pcmDitherMode":"ultra-shaped","pcmDitherActive":false,"pcmDitherTargetBitDepth":null,"pcmDitherReason":"output_format_pending","bitPerfectCandidate":false,"sampleRateMismatch":false,"eqEnabled":false,"roomCorrectionEnabled":false,"channelBalanceEnabled":false,"dspActive":false,"preampDb":0,"dspHeadroomDb":0,"eqPresetName":"Flat","clippingRisk":false,"dspClippingRisk":false,"dspLimiterProtecting":false,"audioLevels":{"inputPeakDb":null,"inputRmsDb":null,"estimatedOutputPeakDb":null,"estimatedOutputRmsDb":null,"inputTruePeakDb":null,"estimatedOutputTruePeakDb":null,"truePeakHeadroomDb":null,"intersamplePeakDb":null,"visualSpectrum":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"visualSpectrumVersion":2,"visualEnergy":0,"visualTransient":0,"visualTelemetryState":"fallback","levelMeterObserveCostMs":0,"visualSpectrumComputeCostMs":0,"headroomDb":null,"clipCount":0,"lastClipAt":null,"meterSource":"pre_native_estimated_post_dsp"},"bitPerfectDisabledReason":null,"sharedStabilityTier":null,"nativeDeviceBufferFrames":null,"nativeRequestedBufferFrames":null,"nativeActualBufferFrames":null,"nativeOutputLatencyMs":null,"nativePositionStalenessMs":null,"nativeFifoCapacityFrames":null,"nativeStartupPrebufferFrames":null,"nativeBufferedFrames":null,"nativeBufferedMs":null,"nativeUnderrunCallbacks":0,"nativeUnderrunFrames":0,"mainEventLoopLagMs":10,"audioHostRestartCount":0,"playbackRecoveryCount":0,"lastSharedStabilityRecoveryAt":null,"warnings":["daemon_playback_failed_closed:ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No devi"],"error":"ASIOInit failed driver=\"TEAC ASIO USB DRIVER\" error=ASE_NotPresent(-1000) driverMessage=\"No device found.\""},"type":"audio","timestamp":"2026-09-28T04:09:36.024Z","sessionId":"[redacted]"}}
```

### main.log

```text
{"timestamp":"2026-09-28T04:09:16.930Z","scope":"main","level":"info","message":"diagnostics session started","payload":{"sessionId":"[redacted]"}}
{"timestamp":"2026-09-28T04:09:17.263Z","scope":"main","level":"warn","message":"[WallpaperEngineBridge] failed to start localhost bridge","payload":{"error":"listen EADDRINUSE: address already in use 127.0.0.1:47668"}}
{"timestamp":"2026-09-28T04:09:17.373Z","scope":"main","level":"info","message":"[SMTC] Windows SMTC host initialized","payload":{"hostPath":{"basename":"echo-smtc-host.exe","pathHash":"4050a7e176c2dac8"}}}
{"timestamp":"2026-09-28T04:09:17.381Z","scope":"main","level":"info","message":"[DiscordPresence] RPC initialization failed","payload":{"error":"Could not connect"}}
{"timestamp":"2026-09-28T04:09:35.928Z","scope":"main","level":"info","message":"diagnostics session shutdown requested","payload":{"sessionId":"[redacted]"}}
```

## Notes For Audio Debugging

- timeout_waiting_for_ready usually means echo-audio-host was spawned but did not report ready before the main process timeout.
- Useful fields: phase, severity, recovered, outputMode, outputDeviceId, outputDeviceName, warnings, stderrTail, elapsedMs, and mode.
- If recovered is true, playback continued after falling back to default shared output or safe shared output.

## Privacy

This report is generated locally. Music files, cover binaries, lyric contents, tokens, cookies, and authentication secrets are not included. Local media paths are reduced to basename plus pathHash when captured through diagnostics snapshots.

