# ECHO Next Audio Core

This folder owns local playback, device discovery, native host bridging, and
output-side timing. It deliberately does not copy the old mixed `AudioEngine.js`
shape from ECHO.

Before changing the local playback data plane, native DSP, FIFO, WASAPI, ASIO,
DoP, or Native DSD paths, read
[`docs/ECHO_NEXT_NATIVE_AUDIO_PIPELINE.md`](../../../docs/ECHO_NEXT_NATIVE_AUDIO_PIPELINE.md).

## Modules

- `AudioSession.ts`: playback state machine, path selection, sample-rate policy,
  and native DSP control-plan orchestration; it must not process live PCM for
  daemon-direct local playback.
- `DaemonAudioBackend.ts` / `JsonRpcBridge.ts`: awaited device/session/playback
  commands and host-owned position, ended, and error events.
- `NativePcmHostProcess.ts`: resident `echo-audio-host` process lifecycle and
  control-channel ownership.
- `NativeOutputBridge.ts`: compatibility facade that re-exports the native host
  implementation; do not add a second data plane here.
- `DecoderPipeline.ts`: generic/legacy decode support for paths that are not yet
  daemon-direct, including remote, CUE, and chained playback cases.
- `SdmFormatPlan.ts`: pure SDM rate/profile planning; real modulation is native.
- `DeviceService.ts`: native/shared and ASIO device listing.
- `PlaybackClock.ts`: output-side frame counter to position conversion.
- `audioTypes.ts`: main-process audio core contracts.

## Windows Native Backends

Windows playback defaults to WASAPI Shared, WASAPI Exclusive, and ASIO SDK paths.
DirectSound is available only as a Shared-mode compatibility backend through
`sharedBackend: 'directsound'`. It is not enumerated or selected by default; the
session promotes it only for explicit user selection. Automatic recovery stays
on WASAPI Shared/Safe Shared because DirectSound compatibility can add enough
latency to break normal playback.

## Sample-Rate Fields

The status contract keeps source, decoder, requested output, and actual device
rates separate:

- `fileSampleRate`
- `decoderOutputSampleRate`
- `requestedOutputSampleRate`
- `actualDeviceSampleRate`
- `sharedDeviceSampleRate`
- `outputMode`
- `resampling`
- `bitPerfectCandidate`
- `sampleRateMismatch`

Exclusive and ASIO playback default `requestedOutputSampleRate` to the source
file rate. Shared mode uses a fixed mix-rate policy for transition stability:
explicit request, selected shared mix rate, current ready device rate, then
48 kHz fallback. Shared mode must not fall back to the source file rate, and
`decoderOutputSampleRate` should match the requested shared mix rate so track
sample-rate changes do not recreate the resident host.
