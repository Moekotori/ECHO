# Learnings - ECHO Audio Daemon

## Architecture Decisions
- Daemon is a single C++ process, no JUCE, no FFmpeg CLI
- IPC: JSON-RPC 2.0 over stdin/stdout, single protocol
- Decoder: libavcodec in-process
- Output: miniaudio for shared, raw platform APIs for exclusive/ASIO/DSD
- DSP: pure C++ biquad + KissFFT
- Frontend: zero audio logic, thin IPC relay

## Conventions
- Standard CMake, no FetchContent for network-dependent deps
- C++17, pkg-config for FFmpeg
- vendored deps: miniaudio, nlohmann/json, kissfft
- Keep main.cpp under 300 lines
- Each module file under 500 lines
- TDD: unit tests before implementation
- Agent-executed QA for all tasks

## Decoder Module (AvDecoder + ReplayGain)
- `src/decoder/AvDecoder.h/cpp` — libavformat/libavcodec/libswresample wrapper
  - `open(filePath, targetSampleRate, targetChannels)`: avformat_open_input → avformat_find_stream_info → av_find_best_stream → avcodec_alloc_context3 → avcodec_parameters_to_context → avcodec_open2 → swr_alloc_set_opts2(AV_SAMPLE_FMT_FLT) → swr_init
  - `decode(output, maxFrames)`: reads packets from format context via av_read_frame, sends via avcodec_send_packet, receives via avcodec_receive_frame, converts via swr_convert to interleaved float32, copies from internal sample buffer to caller
  - `seek(seconds)`: av_seek_frame with AVSEEK_FLAG_BACKWARD, avcodec_flush_buffers, clears internal buffer
  - `probe(filePath)`: static method, opens file, reads streams, returns AudioFormat
  - Thread-safe via std::mutex
  - Uses new FFmpeg API: AVChannelLayout (not deprecated uint64_t), swr_alloc_set_opts2 (not swr_alloc_set_opts), const AVCodec*
- `src/decoder/ReplayGain.h/cpp` — EBU R128 loudness scanning
  - `analyze(filePath)`: Opens file via AvDecoder, decodes entire file, feeds to libebur128 (ebur128_init → ebur128_set_channel → ebur128_add_frames_float → ebur128_loudness_global), returns gain relative to -18 LUFS (ReplayGain reference)
  - Channel mapping: mono→CENTER, stereo→LEFT/RIGHT, LFE→UNUSED (per BS.1770)
  - `applyGain(samples, frames, channels, gainDb)`: in-place multiply by 10^(gainDb/20)
  - `preventClipping(samples, frames, channels, peak, targetLufs)`: scales down if computed peak after reference gain exceeds 1.0
- Build: Both added to echo-audio-daemon target in src/CMakeLists.txt
  - ebur128 found via pkg_check_modules(EBUR128 libebur128)
  - ${EBUR128_LIBRARIES} and ${EBUR128_INCLUDE_DIRS} used in target_link_libraries and target_include_directories
- Tests: `tests/test_decoder.cpp` → `echo-daemon-decoder-tests` target
  - 16 tests covering: probe (WAV/FLAC/nonexistent), decode (mono/stereo/resampled), seek (mid/end/exact), reopen cycle, ReplayGain (apply +/- dB, prevent clipping, analyze)
  - Test files: /tmp/test_tone.wav (mono), /tmp/test_tone.flac (stereo) — generated via ffmpeg lavfi sine
  - CRITICAL: decode() maxFrames parameter is in frames, not samples. Caller must allocate buffer of maxFrames * channels floats
  - Registered as ctest `echo-daemon-decoder`

## Type Definitions
- `src/common/AudioTypes.h` — PlaybackState, OutputMode, AudioFormat, DeviceInfo, DecoderSession, DspState
- `src/common/ErrorCodes.h` — DaemonErrorCode enum aligned with JSON-RPC 2.0 spec (standard codes + daemon-specific in -32001..-32007)
- `src/common/Result.h` — Result<T, E> template with unwrap(), error(), valueOr(); E defaults to std::string
- Types are pure header-only C++17, no external dependencies
- Tested via `echo-daemon-tests` target in tests/CMakeLists.txt, registered as ctest `echo-daemon-types`

## Output Device Abstraction
- `src/output/OutputDevice.h` — pure virtual interface: open(DeviceInfo, sampleRate, channels, bufferFrames) → bool, close(), write(float*, frameCount) → bool, state queries
- `src/output/NullBackend.h/cpp` — zero-side-effect noop backend: stores params on open, copies samples on write, tracks framesWritten_/writeCount_ atomically, resets on close
- Test helpers: totalFramesWritten(), writeCount(), lastSamples() for unit test inspection
- Frame count verified via 6 tests (open/close, single write, multi-write accumulation, write-after-close rejection, reopen cycle reset, lastSamples content)
- New test target: `echo-daemon-null-output-tests` (separate executable from echo-daemon-tests to avoid main() conflict)
- Registered as ctest `echo-daemon-null-output`

## IPC Module
- `src/ipc/MessageTypes.h` — Header-only JSON-RPC 2.0 types: JsonRpcRequest, JsonRpcResponse, JsonRpcError, JsonRpcErrorCode enum, parseRequest(), makeResponse(), makeErrorResponse(), makeEvent(), param extraction helpers, method/event name constants (24 methods, 8 events)
- `src/ipc/JsonRpcServer.h/cpp` — Threaded stdin/stdout server: registerMethod(), start() (read loop, blocks until shutdown), sendEvent()/sendResponse() (thread-safe producers), write thread with condition-variable draining
- Event throttling: per-type minimum interval (event.position 100ms, event.levelMeter 50ms). Suppressed events store latest params; write thread flushes pending after interval expires
- Thread safety: std::mutex for output queue, std::atomic<bool> for shutdown flag
- 16 tests via `echo-daemon-ipc-tests` target (registered as ctest `echo-daemon-ipc`)
- Test pattern: pipe(2)+dup2 redirect stdin/stdout, ScopedServer RAII wrapper for clean thread teardown
- `src/CMakeLists.txt` must include both `${CMAKE_SOURCE_DIR}` AND `${CMAKE_SOURCE_DIR}/third_party` in target_include_directories
- Pipe-based server testing requires fflush(nullptr)+std::cout.flush() before dup2 to avoid stale buffered output
- `#include "src/ipc/..."` works with `${CMAKE_SOURCE_DIR}` in include path; `#include <nlohmann/json.hpp>` needs `${CMAKE_SOURCE_DIR}/third_party`

## Null-Output Integration Test Harness
- `src/main.cpp` — `--null-output` CLI flag creates JsonRpcServer + NullBackend, registers handlers: test.echo, test.play, device.list, test.getStatus, pause/resume/stop, setVolume. Prints `[echo-audio-daemon] null-output mode` to stderr.
- `tests/test_harness.cpp` — 7 in-process integration tests using pipe(2)+dup2 pattern: device.list, test.play (verifies NullBackend frame counter), pause→resume state transitions, setVolume (including [0,1] clamping), shutdown, test.echo, unknown-method error (-32601).
- `tests/harness_runner.sh` — Shell-script test that pipes JSON-RPC commands via heredoc to daemon binary with `--null-output`, captures stdout, validates responses line-by-line with python3 assertions. Exits 0 on all-pass, 1 on failure.
- New ctest tests: `echo-daemon-harness` (C++ binary), `echo-daemon-harness-runner` (shell script).
- `src/CMakeLists.txt` now links pthread for echo-audio-daemon target (required by JsonRpcServer's std::thread).
- Heredoc+mapfile approach for shell runner avoids FIFO deadlock (FIFO open blocks until writer connects, which deadlocks daemon startup).

## ASIO Backend
- `src/output/AsioBackend.h/cpp` — OutputDevice subclass wrapping raw ASIO SDK (no JUCE dependency).
- `AsioBackend.cpp` merges code from `native/audio-host/src/asio_host.cpp` (ASIO driver init, buffer negotiation, sample format conversion) and `main.cpp` (DopRingSource, NativeDsdRingSource).
- `juce::AbstractFifo` replaced with `SimpleRingBuffer` — a minimal power-of-2 ring buffer with the same prepareToRead/prepareToWrite/finishedRead/finishedWrite interface.
- DSD modes: `setDsdMode(Pcm | Dop | NativeDsd)` — must be called before `open()`.
- Ring state structs (`PcmRingState`, `DopRingState`, `NativeDsdRingState`) hold per-mode data; the active one is selected at `open()` time.
- Global `g_activeRuntime` atomic pointer routes ASIO SDK callbacks to the active `AsioRuntime` (not the full `Impl`), keeping the callback path independent of the backend wrapper.
- ASIO SDK vendored at `third_party/asio-sdk/` (copied from `native/audio-host/`).
- CMake option `ECHO_ENABLE_ASIO` defaults ON for WIN32, OFF otherwise.
- Test: `tests/test_asio_backend.cpp` — compile, enumerate, open/close (skip if no ASIO driver).
- Stub path for non-Windows builds: all methods return false/0/"asio (stub)".

## Ring Buffer (SimpleRingBuffer)
- Single-producer, single-consumer index manager (not a data store).
- Fixed capacity rounded up to next power of 2.
- Mutex must be held by caller (same pattern as original DopRingSource).
- Methods: `prepareToRead`/`prepareToWrite` (returns two contiguous regions for wrap-around), `finishedRead`/`finishedWrite` (advance indices), `getNumReady`/`getFreeSpace`, `reset`.

## Device Enumeration
- `src/device/DeviceEnumerator.h/cpp` — Unified device listing across all backends
  - `enumerateShared()`: uses `ma_context_init()` + `ma_context_get_devices()` to list shared-mode playback devices. Device IDs are FNV-1a hashes of `ma_device_id` (256 bytes) → `"miniaudio::<16-hex>"`.
  - `enumerateExclusive()`: On Windows (`_WIN32`), uses raw COM `IMMDeviceEnumerator` to enumerate render endpoints; excluded at compile time on non-Windows.
  - `enumerateAsio()`: Stub returning empty; `#ifdef ECHO_ENABLE_ASIO` skeleton for future ASIO SDK integration.
  - `enumerateAll()`: concatenates all three, deduplicates by name.
  - `findById()` / `getDefaultShared()`: convenience lookups.
  - `#include "miniaudio/miniaudio.h"` (via `${CMAKE_SOURCE_DIR}/third_party` in include path).
  - Test target: `echo-daemon-device-enumerator-tests`, ctest `echo-daemon-device-enumerator`.

## Device Hotplug Monitoring
- `src/device/DeviceWatcher.h/cpp` — Threaded hotplug monitor
  - Windows: `IMMNotificationClient` COM object (NotificationClient) registered via `IMMDeviceEnumerator::RegisterEndpointNotificationCallback`. Callbacks: "added", "removed", "default_changed", "state_changed".
  - Linux: polls `/proc/asound/cards` every 1 s, diffs card set, emits "added"/"removed".
  - Thread safety: `std::atomic<bool> running_`, start/stop/join pattern.
  - `setCallback(Callback)` before or after `start()`.
  - Test target: `echo-daemon-device-watcher-tests`, ctest `echo-daemon-device-watcher`.
  - 5 tests: create/destroy, start/stop, double-start, stop-without-start, set-callback-after-start.

## WASAPI Exclusive Backend
- `src/output/WasapiExclusiveBackend.h/cpp` — OutputDevice wrapper around existing pure Win32 WASAPI exclusive code.
- Core WASAPI logic copied verbatim from `native/audio-host/src/wasapi_exclusive.cpp` (1457 lines). Changes:
  1. Wrapped into `OutputDevice` interface class
  2. Lock-free SPSC ring buffer bridges `write()` (producer) → WASAPI render callback (consumer)
  3. Local `kExitDeviceInitializeTimeout` replaces `audio_host_exit_codes.h` dependency
  4. Entire Win32 implementation under `#ifdef _WIN32`; non-Windows stub returns false
- `src/output/wasapi_timeout.h` — Copied from `native/audio-host/src/wasapi_timeout.h` with `audio_host_exit_codes.h` include removed (unnecessary dependency)
- Architecture: `write()` → `AudioRingBuffer` (SPSC, `alignas(64)` cache-line-padded head/tail counters) → render callback reads from ring buffer. Underruns produce silence (callback buffer zeroed before fill attempt).
- Ring buffer capacity: 4× the requested `bufferFrames` for headroom
- Notification callback: `nullptr` (watchers not registered — no device change notifications)
- Compile guard pattern: The `#include "WasapiExclusiveBackend.h"` must be OUTSIDE any `#ifdef _WIN32` guard so both Win32 and stub code can see the class definition. The `#else` block in the .cpp provides out-of-line stub method implementations that satisfy the linker.
- CMake: `ECHO_ENABLE_WASAPI_EXCLUSIVE=ON` (default ON). Source always compiled (internal `#ifdef _WIN32` guards the content). Linker libs (`ole32`, `oleaut32`, `avrt`) gated on `$<AND:$<BOOL:${ECHO_ENABLE_WASAPI_EXCLUSIVE}>,$<PLATFORM_ID:Windows>>`.
- Test target: `echo-daemon-wasapi-exclusive-tests`, ctest `echo-daemon-wasapi-exclusive`. On Linux prints SKIP + returns 0.
- Windows linker requirements: `ole32`, `oleaut32` (COM), `avrt` (AvSetMmThreadCharacteristicsW for Pro Audio MMCSS).

## Pure C++ DSP Modules (BiquadFilter + EqProcessor)
- `src/dsp/BiquadFilter.h/cpp` — Generic biquad using RBJ Audio EQ Cookbook formulas.
  - 8 filter types: Peaking, LowPass, HighPass, LowShelf, HighShelf, BandPass, Notch, AllPass
  - Direct Form I for numerical stability; double precision for coefficient calc, float for samples
  - `setParameters(type, freq, gainDb, q, sampleRate)` → `calculateCoefficients()` computes RBJ coefficients
  - `process(float)`, `processBlock(input, output, frames, channels)` for per-sample and block processing
  - Bypass support with `setBypassed(bool)` — bypassed filter copies input verbatim
  - `reset()` zeros all z⁻¹ state registers
  - Frequency clamped to [1 Hz, 0.47 * sampleRate]; Q clamped to ≥ 0.1
  - a0 near-zero guard (|a0| < 1e-12) returns identity
- `src/dsp/EqProcessor.h/cpp` — 10-band parametric EQ (kMaxBands = 10)
  - Default frequencies (ISO 1/3-octave): 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz
  - `prepare(sampleRate, blockSize, channels)` — sets up processing context
  - `setBand(index, type, freq, gainDb, q, enabled)` — configure a band
  - `setBandGain(index, gainDb)` — real-time gain change (fast path)
  - `setPreamp(preampDb)` — global preamp gain (applied as linear multiplier before filters)
  - `processBlock(samples, frames, channels)` — in-place interleaved processing
  - Each band is an independent `BiquadFilter`; disabled bands skipped
  - Preamp applied as: `samples[i] *= pow(10, preampDb / 20)`
- Tests: `tests/test_biquad.cpp` (6 tests), `tests/test_eq_processor.cpp` (5 tests)
  - Biquad: peaking boost accuracy (±0.5 dB at center freq), low-shelf cut verification, 1M-sample stability (7 filter types), bypass RMS < 0.0001, reset repeatability, allpass unity gain
  - EQ: flat response RMS < 0.0001, single-band boost (output > 1.5× input), preamp accuracy (±0.5 dB), enable/disable verification, all-10-band stability
  - Test targets: `echo-daemon-biquad-tests`, `echo-daemon-eq-tests`; ctest `echo-daemon-biquad`, `echo-daemon-eq`
- CMake: DSP sources added to `ECHO_AUDIO_DAEMON_SOURCES` in `src/CMakeLists.txt`
- LSP may report `pp_file_not_found` for `src/dsp/...` headers due to missing include path config; actual CMake build works correctly with `${CMAKE_SOURCE_DIR}` in include paths.

## ChannelBalanceProcessor + Limiter
- `src/dsp/ChannelBalanceProcessor.h/cpp` — Pure C++ per-channel gain, delay, balance, mono mode, phase invert, channel swap.
  - Interface: `setChannelGain(int ch, double gainDb)`, `setChannelDelay(int ch, double delayMs, double sampleRate)`, `setBalance(double pan)`, `setMonoMode(Sum|Left|Right|Off)`, `setPhaseInvert(int ch, bool)`, `setSwapChannels(bool)`, `processBlock(float*, frames, channels)` in-place, `reset()`.
  - Delay line: fixed-size circular buffer per channel with linear interpolation for fractional sample delays. Buffer sized for up to 100 ms at current sample rate. Write-first-then-read pattern: push at `writeIndex`, read at `writeIndex - delaySamples`, advance index.
  - Minimum buffer must be at least 2 elements (for `bufLen - 2` in interpolation read) — constructor allocates default 100ms@44100Hz buffer.
  - No JUCE, no external DSP libs. Namespace `echo_audio_daemon`. Interleaved float format.
- `src/dsp/Limiter.h/cpp` — Peak limiter at 0 dBFS (threshold = 1.0).
  - Implementation: peak detector envelope with attack (~1 ms) / release (~50 ms) ballistics. Envelope tracks signal peak level; gain computer computes reduction when envelope exceeds threshold.
  - Attack coeff: `1 - exp(-1 / (0.001 * sampleRate))`, Release coeff: `1 - exp(-1 / (0.050 * sampleRate))`.
  - Key design choice: envelope tracks PEAK LEVEL, not gain reduction. Gain is computed from envelope each sample. This avoids erroneously attenuating sub-threshold signals when envelope starts at 0.
  - `processBlock` modifies buffer in-place. Callers must refill buffer between calls if re-processing the same signal.
  - Tests: 3 tests each via `CHECK` macro pattern. Pre-fill attack envelope by processing multiple blocks with re-filled input.
- Tests: `tests/test_channel_balance.cpp`, `tests/test_limiter.cpp`, registered as ctest `echo-daemon-channel-balance` and `echo-daemon-limiter`.
- CMake: Sources added to `ECHO_AUDIO_DAEMON_SOURCES` list; test targets follow existing pattern (`target_compile_features(cxx_std_17)`, `EXCLUDE_FROM_ALL TRUE`, `${CMAKE_SOURCE_DIR}` include dir).

## ConvolutionProcessor (Partitioned FFT Convolution)
- `src/dsp/ConvolutionProcessor.h/cpp` — Partitioned FFT convolution for room correction / IR processing using KissFFT.
  - `loadIr(wavPath)` — Parses WAV header (44+ bytes), handles PCM 16/24/32-bit integer and 32-bit float, stereo → mono averaging.
  - `loadIrFromSamples(float*, numSamples, numChannels)` — Load IR from raw interleaved float data (used in tests).
  - `prepare(blockSize, channels)` — Builds frequency-domain partitions. Partition size = nextPow2(blockSize), min 64.
  - `processBlock(input, output, frameCount, channels)` — Processes interleaved float audio.
    - Direct convolution (circular history buffer, O(L) per sample) for short IRs (length ≤ 256 or ≤ partitionSize).
    - Partitioned FFT convolution (overlap-add, Gardner 1994) for long IRs.
    - Per-channel processing, mono IR applied to all channels.
  - Algorithm: IR split into M partitions of N samples each → zero-padded to 2N → FFT → pre-computed H_p.
    - Input processed in N-sample blocks: FFT → ring buffer → Σ X_{b-p}·H_p → IFFT → overlap-add.
    - Ring buffer stores last M FFT'd input blocks; ring index = (ringWriteIdx - p + M) % M for partition p.
    - IFFT output normalised by `/ fftSz` (KissFFT IFFT is unnormalized).
    - Overlap from previous block added to first N output samples; second N saved as overlap for next block.
  - KissFFT notes: `kiss_fft.c` must be compiled as a source; needs `kiss_fft_log.h` stub (provides KISS_FFT_WARNING/KISS_FFT_DEBUG/KISS_FFT_ERROR as no-ops) and `#include <stdint.h>` for SIZE_MAX.
  - CMake: `kiss_fft.c` added as source file to both main daemon target and test target; link `m` for math functions.
  - Test target: `echo-daemon-convolution-tests`, ctest `echo-daemon-convolution`. 11 tests covering direct (impulse, delay, known IR, stereo, disable bypass) and partitioned modes (impulse, delay, known IR, stereo, disable bypass, stereo IR loading).

## SessionManager (Playback State Machine)
- `src/session/SessionManager.h/cpp` — Playback state machine managing play/pause/seek/stop, gapless transitions, automix crossfade, position tracking, volume, underrun detection.
  - Constructor: `SessionManager(JsonRpcServer&, AvDecoder&, DspPipeline&, OutputDevice&)`
  - `init()`: Registers handlers for play, pause, resume, stop, seek, setVolume, queueNext, prepareAutomix, levelMeter.subscribe/unsubscribe
  - Handlers are public and can be called directly for testing (no IPC needed)
  - `playbackLoop()`: Background thread — decode → gain → DSP → output → events. 512-frame blocks.
  - Gapless: `queueNextTrack()` pre-decodes entire next track into `GaplessBuffer`; `tryGaplessTransition()` switches on EOF.
  - Automix: `AutomixConfig` stores crossfade params; `applyGain()` applies volume + fade during playback.
  - State transitions: Stopped → Playing → Paused ↔ Playing → Ended | Stopped | Error
  - NullBackend does NOT throttle — 2-second file plays out in <1ms in tests
  - Playback thread does NOT close output on natural end (output stays open for gapless; closed by `stopPlayback()`)
- Dependencies: JsonRpcServer, AvDecoder, DspPipeline, OutputDevice
- Test target: `echo-daemon-session-manager-tests`, ctest `echo-daemon-session-manager`
- Test pattern: Direct handler calls (no pipes/IPC needed for state machine verification)

## NullBackend Thread Safety
- `NullBackend.h`: `isOpen_` changed from `bool` to `std::atomic<bool>` — accessed by both main thread (open/close) and playback thread (write). Data race caused writes to silently fail.

## DspPipeline
- `src/dsp/DspPipeline.h` — Header-only DSP chain wrapper around EqProcessor.
  - `prepare(sampleRate, blockSize, channels)` — delegates to EqProcessor::prepare
  - `processBlock(samples, frames, channels)` — skips if EQ disabled
  - Extensible: additional DSP modules can be added without changing SessionManager interface.

## Include Path for Vendored miniaudio
- miniaudio is at `third_party/miniaudio/miniaudio.h` — include as `"miniaudio/miniaudio.h"`.
- Test targets that use miniaudio must list `${CMAKE_SOURCE_DIR}/third_party/miniaudio/miniaudio.c` as a source file and add `${CMAKE_SOURCE_DIR}/third_party` to include dirs.
- The main target includes `${CMAKE_SOURCE_DIR}/third_party/miniaudio` in its include directories for backward compat.
