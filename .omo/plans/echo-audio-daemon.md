# ECHO Audio Daemon — Full Architecture Replacement

## TL;DR

> **Quick Summary**: Build a single C++ daemon process (`echo-audio-daemon`) that handles all audio — file decoding via libavcodec, DSP via pure C++ biquad + KissFFT, device output via miniaudio + raw WASAPI/ASIO/DSD — with JSON-RPC 2.0 over stdin/stdout as the sole IPC protocol. Electron main process becomes a ~500-line relay. Renderer becomes pure UI with zero audio APIs.
>
> **Deliverables**:
> - JSON-RPC 2.0 protocol spec document
> - `echo-audio-daemon` binary (standard CMake, pkg-config, zero JUCE)
> - Daemon test harness with null-output backend
> - Electron `DaemonClient.ts` (~200-line JSON-RPC relay)
> - Simplified preload with zero audio logic
> - Updated Nix flake (no more FetchContent/JUCE)
>
> **Estimated Effort**: XL (large)
> **Parallel Execution**: YES — 5 waves, up to 7 tasks per wave
> **Critical Path**: Protocol spec → IPC module → Decoder → Output → DSP → Integration

---

## Context

### Original Request
用户要替换当前依赖 JUCE + FFmpeg 子进程的音频架构为前后端严格分离的全新架构。daemon 进程负责所有音频处理（解码、DSP、输出），Electron 只做 UI 和薄代理。不用 JUCE，不用 FFmpeg CLI，前端零音频逻辑。

### Interview Summary
**Key Discussions**:
- 解码: libavcodec/libavformat (FFmpeg 库，不是命令行子进程)
- 普通播放输出: miniaudio library (WASAPI Shared / ALSA)
- HiFi 输出: 保留现有原生 WASAPI Exclusive / ASIO / DSD 代码
- DSP: 纯 C++ 自实现 (biquad EQ + KissFFT convolution + limiter)
- IPC: JSON-RPC 2.0 over stdin/stdout，单一协议
- 策略: 全新 daemon，与现有代码并行开发
- 平台: Windows 优先，Linux Phase 2

**Research Findings**:
- 现有 wasapi_shared.cpp / wasapi_exclusive.cpp / asio_host.cpp 已不依赖 JUCE，可直接复用
- miniaudio 是单头文件 MIT 库，支持 WASAPI/ALSA/PulseAudio
- nlohmann/json 可嵌入用于 JSON-RPC
- Nix 构建当前因 JUCE FetchContent 断裂，新架构无此问题

### Metis Review
**Identified Gaps** (addressed in plan):
- JSON-RPC 协议规范必须先于代码 → Task 1
- 每个 TypeScript 文件需归类 MOVE/SIMPLIFY/KEEP → 已在 draft 中明确
- Gapless/crossfade 协议契约 → 在 Task 1 协议规范中定义
- 事件节流/背压机制 → 在 Task 2 IPC 模块实现
- 独立 daemon 测试 harness → Task 3
- 格式覆盖矩阵 → Task 7 中验证

---

## Work Objectives

### Core Objective
Build a single C++ daemon process (`echo-audio-daemon`) that handles all audio — file decoding via libavcodec, DSP via pure C++ biquad + KissFFT, device output via miniaudio + raw WASAPI/ASIO/DSD — controlled by JSON-RPC 2.0 over stdin/stdout. Electron becomes a thin relay.

### Concrete Deliverables
- `native/echo-audio-daemon/` — 完整 C++ 项目，标准 CMake，零 JUCE 依赖
- `native/echo-audio-daemon/docs/protocol-spec.md` — JSON-RPC 2.0 协议规范
- `native/echo-audio-daemon/src/ipc/JsonRpcServer.h/cpp` — stdin/stdout JSON-RPC 层
- `native/echo-audio-daemon/src/decoder/AvDecoder.h/cpp` — libavcodec 解码封装
- `native/echo-audio-daemon/src/dsp/` — 纯 C++ DSP 链 (Biquad, Convolution, Limiter)
- `native/echo-audio-daemon/src/output/` — 输出后端 (miniaudio + 原生 WASAPI/ASIO)
- `native/echo-audio-daemon/tests/` — 单元测试 + null-output 集成测试 harness
- `src/main/audio/DaemonClient.ts` — Electron 侧 JSON-RPC 客户端 (~200行)
- `src/preload/index.ts` — 简化为零音频逻辑的命令中继
- 更新 `flake.nix` / `shell.nix` — 移除 JUCE 依赖

### Definition of Done
- [ ] `ctest` 所有 daemon 测试通过（含 null-output integration test）
- [ ] daemon 可独立运行并响应所有 JSON-RPC 方法
- [ ] Electron 可通过 DaemonClient 播放本地文件、控制 EQ、切换设备
- [ ] 前端 UI 通过简化后的 preload API 控制播放（无 HTMLAudioElement）
- [ ] `nix build` 成功构建 daemon
- [ ] 现有音频宿主和 FFmpeg 子进程路径仍可工作（并行存在）

### Must Have
- 所有当前支持的音频格式可通过 libavcodec 解码
- WASAPI Exclusive / ASIO / DSD 输出与当前功能完全对等
- DSP 链功能对等 (EQ 10-band, Convolution, Balance, Limiter)
- Gapless 播放和 automix crossfade
- JSON-RPC 协议版本化，含错误码体系
- daemon 崩溃时 Electron 可检测并尝试重启
- daemon 作为单独二进制可 headless 测试

### Must NOT Have
- JUCE 框架的任何编译或链接
- FFmpeg CLI 子进程
- HTMLAudioElement / AudioContext / WebAudio 在 renderer 或 preload 中
- 新的音频功能（不增加新 DSP effect、新输出后端、新可视化）
- SMTC host 合并到 daemon
- 插件系统、远程来源、歌词、MV 的任何改动
- MacOS 支持

### Spec Framework Integration

> **N/A** — No SDD framework detected in this repository (checked openspec/, .specify/ — neither exists). This is a clean architecture project.

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Five-Layer Verification Architecture

```
Layer 5: 端到端 (Electron + Daemon + 真实硬件)     ← 最终确信
Layer 4: 集成测试 (Daemon + 真实输出 + 真实设备)     ← 每周跑
Layer 3: 功能测试 (Daemon + NullOutput + 真实文件)   ← 每次 push
Layer 2: 单元测试 (每个 C++ 模块独立)                ← 每次 commit
Layer 1: 静态检查 (编译 + 类型 + linter)             ← 每次 save
```

---

### Layer 1: Static Checks — Run on Every Save

```bash
# C++ side
cmake -B build && cmake --build build
# Expect: zero warnings, zero errors

# TypeScript side
npx tsc --noEmit
# Expect: zero type errors
```

Catches 90% of trivial errors (typos, type mismatches, API misuse) before any logic runs.

---

### Layer 2: Unit Tests — Each Module Independently, No Hardware Required

Run `ctest` per module after implementation:

```bash
# Decoder unit tests
ctest --test-dir build -R test_decoder -V
# Expected output:
#   test_probe_format ........ PASS (format: FLAC, 44100Hz, 2ch)
#   test_decode_frame_count ... PASS (44100 frames decoded)
#   test_seek_accuracy ........ PASS (seek offset < 100 samples)

# EQ filter unit tests
ctest --test-dir build -R test_biquad -V
# Expected output:
#   test_peaking_1khz_6db ..... PASS (gain at 1kHz = 6.0dB ± 0.5dB)
#   test_stability_1m_samples . PASS (no NaN/inf after 1M samples)

# Null output backend
ctest --test-dir build -R test_null_output -V
# Expected output:
#   test_open_and_close ....... PASS
#   test_write_counts_frames .. PASS (expected 1024, got 1024)

# IPC unit tests
ctest --test-dir build -R test_ipc -V
# Expected output:
#   test_valid_request ........ PASS
#   test_parse_error .......... PASS (code -32700)
#   test_method_not_found ..... PASS (code -32601)
#   test_event_throttling ..... PASS (10 events emitted from 100 rapid-fire updates)
```

**Key**: No audio hardware. No real files. `test_decoder` generates a 440Hz sine wave test WAV from code. Entirely CI-runnable.

---

### Layer 3: Functional Tests — Daemon Process + Real Files + NullOutput

Daemon runs with NullOutput backend. Real music files as input. Validates the entire internal pipeline end-to-end **without audio hardware**.

```bash
# 1. Generate known test file
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" \
  -ar 44100 -ac 2 -sample_fmt s16 /tmp/test_tone.flac

# 2. Start daemon with NullOutput
./build/echo-audio-daemon --null-output &
DAEMON_PID=$!

# 3. Send probe command
echo '{"jsonrpc":"2.0","id":1,"method":"probe","params":{"path":"/tmp/test_tone.flac"}}'
# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"format":"flac","sampleRate":44100,"channels":2,"duration":3.0}}

# 4. Play file
echo '{"jsonrpc":"2.0","id":2,"method":"play","params":{"path":"/tmp/test_tone.flac"}}'
# Expected response:
# {"jsonrpc":"2.0","id":2,"result":{"status":"playing"}}

# 5. Wait for file duration + 500ms
sleep 3.5

# 6. Verify trackEnded event appeared in daemon stdout
# Expected:
# {"jsonrpc":"2.0","method":"notify","params":{"event":"trackEnded"}}

# 7. Shutdown daemon
echo '{"jsonrpc":"2.0","method":"shutdown"}'
wait $DAEMON_PID
```

**Automated assertions at this layer**:

| What to verify | How |
|---|---|
| probe returns correct format/sampleRate/channels/duration | Parse JSON response, compare to known file metadata |
| position events are monotonically increasing | Collect position values, assert `pos[n+1] > pos[n]` |
| trackEnded fires at correct time | Measure wall-clock time from `play` to `trackEnded`, compare to duration |
| pause → position frozen | After pause, collect positions for 1s, assert `max == min` |
| resume → position advances | After resume, assert position at t+1s > position at t |
| seek → position jumps correctly | Seek to t=1.5s, next position event within 100ms of 1.5s |
| multiple formats (FLAC, MP3, WAV, OGG) all play | Parse trackEnded for each format |

**Does NOT need**: Audio output device. Does NOT need human listening. CI-runnable.

---

### Layer 4: Integration Tests — Daemon + Real Output + Real Device

```bash
# Device enumeration
echo '{"jsonrpc":"2.0","id":1,"method":"device.list"}' | ./build/echo-audio-daemon
# Expect: >= 1 device, each with name / sampleRate / channels

# Actual playback (requires speaker or loopback)
echo '{"jsonrpc":"2.0","id":1,"method":"play","params":{"path":"/tmp/test_tone.flac"}}' \
  | ./build/echo-audio-daemon
# Expect: audible 440Hz sine wave for 3s, then auto-stop
```

**Automated loopback verification** (no human ears):

```bash
# Linux: record daemon output via ALSA loopback
arecord -f FLOAT_LE -r 44100 -c 2 -d 3 /tmp/recording.wav &
./build/echo-audio-daemon < commands.json
ffprobe /tmp/recording.wav
# Expect: 44100 Hz, stereo, duration ≈ 3.0s

# Windows: record via WASAPI loopback (using built-in Stereo Mix or virtual cable)
# Validate with ffprobe similarly
```

**Validates**: Actual audio samples reach the OS audio stack. Format conversion correct (f32 plan → device format). Buffer negotiation works with real hardware.

---

### Layer 5: End-to-End — Electron + Daemon + Full UI (Task 26)

```
1. Start npm run dev (Electron + daemon)
2. Import test library (FLAC + MP3 + WAV, ≥3 tracks)
3. Play → verify progress bar advances
4. Pause → verify progress bar frozen
5. Drag seek bar → verify position jumps
6. Next track → verify track switch
7. Enable EQ, boost band 3 to +6dB → verify clipping risk flag or audible change
8. Switch output device → verify playback uninterrupted
9. Play 15 minutes continuously → verify no crash, no memory leak
10. Play corrupted file → verify error message, not daemon crash
```

**Each step is a Playwright script** — automated, no human clicking required.

---

### Regression Parity Matrix

Every capability of the old system must work in the new daemon:

| Capability | Old System | New Daemon | How to Verify |
|-----------|-----------|-----------|---------------|
| FLAC playback | ✅ FFmpeg | ✅ libavcodec | probe + play + compare position events |
| MP3 playback | ✅ FFmpeg | ✅ libavcodec | Same as above |
| WAV playback | ✅ FFmpeg/JUCE | ✅ libavcodec | Same |
| OGG/Opus | ✅ FFmpeg | ✅ libavcodec | Same |
| DSD/DSF playback | ✅ DSD host | ✅ AsioBackend DSD mode | Enumerate DSD mode + DoP marker check |
| Gapless transition | ✅ AudioSession | ✅ SessionManager | Two tracks: position continuous, no gap >50ms |
| Automix crossfade | ✅ AutomixPlanner | ✅ prepareAutomix | Crossfade frame count correct |
| EQ 10-band parametric | ✅ JUCE DSP | ✅ BiquadFilter | Biquad frequency response test |
| Convolution (room correction) | ✅ JUCE Conv | ✅ KissFFT partitioning | Unit impulse → pass-through |
| Channel balance | ✅ JUCE | ✅ ChannelBalanceProcessor | L gain=0.5 → L channel half amplitude |
| Peak limiter | ✅ JUCE | ✅ Limiter | 2x amplitude signal → all samples ≤1.0 |
| WASAPI Shared output | ✅ Miniaudio/WASAPI | ✅ MiniaudioBackend | Device enum + play + loopback record |
| WASAPI Exclusive output | ✅ Raw Win32 | ✅ WasapiExclusiveBackend (same code) | Device enum + open/close |
| ASIO output | ✅ Raw ASIO SDK | ✅ AsioBackend (same code) | Device enum + open/close |
| Linux ALSA output | ✅ JUCE ALSA backend | ✅ MiniaudioBackend (ALSA) | Device enum + play |

---

### Nix Reproducible Build Verification

```bash
# Verify daemon builds in sandbox (no network)
nix build .#echo-next

# Verify daemon binary exists in output
ls result/lib/echo-next/echo-audio-daemon

# Verify daemon can start
result/lib/echo-next/echo-audio-daemon --null-output < /dev/null &
```

Nix build itself validates the constraint: **no FetchContent, no network access at build time.**

---

### Test Decision
- **Infrastructure exists**: YES (Vitest for TypeScript; need to add CTest for C++)
- **Automated tests**: TDD — each module has tests written BEFORE implementation
- **Framework**: Vitest (TS side) + CTest (C++ side)
- **Daemon test harness**: Standalone harness that spawns daemon, sends JSON-RPC commands, verifies responses — uses null output backend (no real audio device needed)
- **Agent-Executed QA**: MANDATORY for all tasks. Each task includes Playwright/bash scenarios.

### QA Policy
Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Daemon unit tests (ctest)**: Use Bash — Run ctest, assert all pass
- **Daemon functional tests**: Use Bash — Spawn daemon with NullOutput, send JSON-RPC via stdin, read stdout, assert responses and event sequences
- **Daemon integration tests**: Use Bash — Spawn daemon with real output, record via ALSA/WASAPI loopback, validate with ffprobe FFT analysis
- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **Build/Nix**: Use Bash — nix build, assert exit code 0, assert binary exists

### Definition of Done
- [ ] Layer 1: `cmake build` + `tsc --noEmit` zero errors
- [ ] Layer 2: All 26 ctest passes (no audio hardware required)
- [ ] Layer 3: NullOutput harness runs full play-pause-seek-stop cycle
- [ ] Layer 4: Real playback on ≥2 output devices with loopback validation
- [ ] Layer 5: Electron UI end-to-end 10 scenarios pass via Playwright
- [ ] Regression matrix: 15/15 capability parity confirmed
- [ ] `nix build` succeeds
- [ ] 15-minute continuous playback with zero crashes

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — docs + scaffolding + types):
├── Task 1: JSON-RPC protocol spec document [writing]
├── Task 2: Daemon project scaffolding + CMake [quick]
├── Task 3: IPC module (JsonRpcServer + MessageTypes) [deep]
├── Task 4: Core types + error handling [quick]
├── Task 5: OutputDevice interface + NullBackend [quick]
└── Task 6: Null-output integration test harness [quick]

Wave 2 (After Wave 1 — decoder + output backends, MAX PARALLEL):
├── Task 7: Decoder module (AvDecoder + ReplayGain) [deep]
├── Task 8: MiniaudioBackend (shared mode output) [deep]
├── Task 9: RawWasapiExclusiveBackend (port existing code) [deep]
├── Task 10: RawAsioBackend (port existing code) [deep]
├── Task 11: Device enumerator + watcher [deep]
└── Task 12: DSP: BiquadFilter + EqProcessor [unspecified-high]

Wave 3 (After Wave 2 — DSP + pipeline assembly):
├── Task 13: DSP: ConvolutionProcessor (KissFFT) [deep]
├── Task 14: DSP: ChannelBalance + Limiter [deep]
├── Task 15: DspPipeline orchestrator [deep]
├── Task 16: SessionManager (playlist, gapless, automix) [deep]
└── Task 17: Main daemon entry point + wiring [deep]

Wave 4 (After Wave 3 — Electron integration):
├── Task 18: DaemonClient.ts (JSON-RPC relay) [quick]
├── Task 19: Simplify preload (zero audio logic) [quick]
├── Task 20: Simplify main IPC handlers [quick]
├── Task 21: UI verification — playback control works [visual-engineering]
├── Task 22: UI verification — EQ panel works [visual-engineering]
└── Task 23: Delete old audio code (AudioSession etc.) [quick]

Wave 5 (After Wave 4 — platform + polish):
├── Task 24: Nix flake update (remove JUCE, add daemon build) [quick]
├── Task 25: Linux ALSA output via miniaudio [deep]
└── Task 26: Final integration smoke test [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

**Critical Path**: Task 1 → Task 2 → Task 3 → Task 7 → Task 16 → Task 17 → Task 18 → Task 21 → F1-F4
**Parallel Speedup**: ~65% faster than sequential
**Max Concurrent**: 7 (Wave 2)

### Dependency Matrix

- **1-6**: None (Wave 1, all parallel) — block 7-17, 2-6
- **7**: 3 - 16, 2
- **8**: 5 - 17, 2
- **9**: 5 - 17, 2
- **10**: 5 - 17, 2
- **11**: 3, 5 - 17, 2
- **12**: None (can start in Wave 2) - 13, 14, 15, 3
- **13**: 12 - 15, 3
- **14**: 12 - 15, 3
- **15**: 13, 14 - 17, 3
- **16**: 7 - 17, 3
- **17**: 3, 7, 8, 9, 10, 11, 15, 16 - 18, 26, 4
- **18**: 17 - 21, 22, 4
- **19**: 18 - 21, 22, 4
- **20**: 18 - 21, 22, 4
- **21**: 18, 19 - 23, 26, 5
- **22**: 18, 19 - 23, 26, 5
- **23**: 21, 22 - 26, 5
- **24**: 17 - 26, 5
- **25**: 8 - 26, 5
- **26**: 17, 23, 24, 25 - FINAL

### Agent Dispatch Summary

- **1**: **6** — T1 → `writing`, T2 → `quick`, T3 → `deep`, T4 → `quick`, T5 → `quick`, T6 → `quick`
- **2**: **6** — T7 → `deep`, T8 → `deep`, T9 → `deep`, T10 → `deep`, T11 → `deep`, T12 → `unspecified-high`
- **3**: **5** — T13 → `deep`, T14 → `deep`, T15 → `deep`, T16 → `deep`, T17 → `deep`
- **4**: **6** — T18 → `quick`, T19 → `quick`, T20 → `quick`, T21 → `visual-engineering`, T22 → `visual-engineering`, T23 → `quick`
- **5**: **3** — T24 → `quick`, T25 → `deep`, T26 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> Task labels MUST use bare numbers: `1.`, `2.` — NOT `T1.`, `Task 1.`
> Final Verification Wave labels MUST use `F1.`, `F2.`

- [x] 1. JSON-RPC 2.0 Protocol Specification

  **What to do**:
  - Create `native/echo-audio-daemon/docs/protocol-spec.md`
  - Define ALL JSON-RPC methods with parameter schemas, return types, and error codes:
    - `play`, `pause`, `resume`, `stop`, `seek`, `next`, `previous`
    - `setVolume`, `setOutput`, `device.list`
    - `eq.setBand`, `eq.setEnabled`, `eq.setPreset`, `eq.reset`
    - `convolution.loadIr`, `convolution.setEnabled`
    - `channelBalance.setState`
    - `levelMeter.subscribe` / `levelMeter.unsubscribe`
    - `probe` (return file metadata: format, sampleRate, channels, duration)
  - Define ALL events pushed by daemon:
    - `position` ({seconds, duration, bufferedFrames})
    - `state` ({state: playing|paused|stopped|ended|error, error?})
    - `trackEnded`, `trackStarted`
    - `levelMeter` ({peak, rms, channels[]})
    - `deviceChanged` ({deviceId, event})
    - `dspState` ({clippingRisk, limiterProtecting})
  - Define error codes: -32700 (parse), -32600 (invalid request), -32601 (method not found), -32602 (invalid params), -32000+ (daemon-specific: device unavailable, decode error, format unsupported, etc.)
  - Define gapless/automix protocol: `queueNext` method + `trackEnded` event coordination
  - Define event throttling policy: position events min 100ms interval, levelMeter min 50ms
  - Document stdin/stdout framing: one JSON object per line, no pretty-printing

  **Must NOT do**:
  - Don't add methods for features not in current codebase
  - Don't define protocol features that can't be tested without audio hardware

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This is a documentation/specification task — no code, no build, pure specification writing.
  - **Skills**: [`git-master`]
    - `git-master`: For creating the commit with proper message format

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-6)
  - **Blocks**: Tasks 3, 7, 16, 18 (IPC module, decoder, session manager, Electron client all depend on this spec)
  - **Blocked By**: None (can start immediately)

  **References**:
  - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification — canonical protocol reference
  - `src/main/audio/NativeOutputBridge.ts:32-190` — Current stdin frame types and JSON event format to map into new protocol
  - `src/main/audio/EqBridge.ts` — Current EQ TCP protocol messages to map into JSON-RPC methods
  - `src/main/audio/audioTypes.ts` — Current TypeScript types for audio status to ensure protocol covers all fields
  - `src/main/audio/AudioSession.ts:200-500` — Current playback methods to map into JSON-RPC commands

  **Acceptance Criteria**:
  - [ ] Spec document covers ALL current audio features (play, pause, seek, volume, EQ, device, automix, gapless)
  - [ ] Every method has: JSON-RPC method name, params schema (types + required/optional), result schema, error codes
  - [ ] Every event has: event name, params schema, throttle policy
  - [ ] Gapless/automix protocol flow documented with sequence diagram or state machine
  - [ ] Error code table is complete and non-overlapping with JSON-RPC standard codes

  **QA Scenarios**:

  ```
  Scenario: Protocol spec completeness — every current feature has a method
    Tool: Bash (grep)
    Preconditions: protocol-spec.md exists
    Steps:
      1. grep for "### play" in protocol-spec.md — must find play method section
      2. grep for "### pause" — must find pause method section
      3. Count total methods via `grep -c "^### " protocol-spec.md` — should be >= 15
      4. Count total events via `grep -c "event:" protocol-spec.md` — should be >= 6
      5. Count error codes via `grep -c "^-32" protocol-spec.md` — should be >= 8
    Expected Result: All counts match expected minimums
    Failure Indicators: Any method/event/error code missing
    Evidence: .omo/evidence/task-1-spec-completeness.txt

  Scenario: Protocol spec well-formed — no ambiguous fields
    Tool: Bash (grep)
    Preconditions: protocol-spec.md exists
    Steps:
      1. grep for "TBD" or "TODO" in protocol-spec.md — should return empty
      2. grep for "\"\"" (empty string) in protocol-spec.md — should return empty
      3. Check every method param has a type annotation
    Expected Result: Zero placeholders, zero empty schemas
    Evidence: .omo/evidence/task-1-spec-wellformed.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-spec-completeness.txt — grep results
  - [ ] task-1-spec-wellformed.txt — grep results

  **Commit**: YES (groups with T2-T6 in Wave 1)
  - Message: `docs(daemon): add JSON-RPC 2.0 protocol specification`
  - Files: `native/echo-audio-daemon/docs/protocol-spec.md`

- [x] 2. Daemon Project Scaffolding + CMake

  **What to do**:
  - Create `native/echo-audio-daemon/` directory structure:
    ```
    echo-audio-daemon/
    ├── CMakeLists.txt
    ├── src/
    │   ├── ipc/
    │   ├── decoder/
    │   ├── dsp/
    │   ├── output/
    │   ├── device/
    │   └── main.cpp (skeleton only)
    ├── tests/
    │   └── CMakeLists.txt
    ├── third_party/
    │   ├── miniaudio/ (vendored .h + .c)
    │   ├── nlohmann/ (vendored json.hpp)
    │   └── kissfft/ (vendored)
    └── docs/
        └── protocol-spec.md
    ```
  - Write root `CMakeLists.txt`:
    - C++17, standard CMake (no FetchContent for deps that need network)
    - `find_package(PkgConfig REQUIRED)`
    - `pkg_check_modules(FFMPEG REQUIRED libavformat libavcodec libswresample libavutil)`
    - Add subdirectories: src/, tests/
    - Define `ECHO_ENABLE_ASIO` option (ON for Windows)
    - Define `ECHO_ENABLE_WASAPI_EXCLUSIVE` option (ON for Windows)
  - Write `tests/CMakeLists.txt`:
    - `enable_testing()`
    - `add_executable(echo-daemon-tests ...)`
    - `add_test(NAME echo-daemon-tests COMMAND echo-daemon-tests)`
  - Vendor dependencies:
    - Download miniaudio.h + miniaudio.c from https://github.com/mackron/miniaudio (MIT)
    - Download json.hpp from https://github.com/nlohmann/json (MIT)
    - Download kiss_fft.h + kiss_fft.c from https://github.com/mborgerding/kissfft (BSD)
  - Write skeleton `src/main.cpp`:
    - Print "echo-audio-daemon ready" to stderr
    - Enter stdin read loop (just echo JSON for now)
    - Exit cleanly on EOF or "shutdown" JSON-RPC method

  **Must NOT do**:
  - No JUCE FetchContent or any network-requiring CMake calls
  - No audio processing in the skeleton — pure scaffolding

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File creation, directory structure, CMake boilerplate — no complex logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-6)
  - **Blocks**: Tasks 3, 5, 6, 7, 8, 9, 10
  - **Blocked By**: None (can start immediately, but CMake needs to know project structure)

  **References**:
  - `native/audio-host/CMakeLists.txt` — Current CMake structure to understand project conventions
  - `native/smtc-host/CMakeLists.txt` — Simpler CMake example (no JUCE) for standard CMake pattern
  - Existing build scripts: `scripts/build-audio-host.mjs` — To understand current build workflow
  - miniaudio GitHub: https://github.com/mackron/miniaudio — Source for vendored files
  - nlohmann/json GitHub: https://github.com/nlohmann/json — Source for json.hpp

  **Acceptance Criteria**:
  - [ ] `cmake -B build && cmake --build build` succeeds with zero errors
  - [ ] `./build/echo-audio-daemon` prints "ready" to stderr and accepts JSON on stdin
  - [ ] Sending `{"jsonrpc":"2.0","method":"shutdown"}` causes clean exit

  **QA Scenarios**:

  ```
  Scenario: CMake configure and build succeeds
    Tool: Bash
    Preconditions: Project directory structure created
    Steps:
      1. cmake -B build -S native/echo-audio-daemon
      2. Assert exit code 0, no "error" in stderr
      3. cmake --build build
      4. Assert exit code 0
      5. ls build/echo-audio-daemon (or build/echo-audio-daemon.exe) — must exist
    Expected Result: Binary exists and is executable
    Evidence: .omo/evidence/task-2-build-success.txt

  Scenario: Daemon starts and responds to shutdown
    Tool: Bash
    Preconditions: Daemon binary built
    Steps:
      1. echo '{"jsonrpc":"2.0","method":"shutdown"}' | timeout 5 ./build/echo-audio-daemon
      2. Assert exit code 0
    Expected Result: Daemon exits cleanly on shutdown command
    Failure Indicators: Timeout (daemon hangs), non-zero exit code
    Evidence: .omo/evidence/task-2-shutdown-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-build-success.txt — cmake output
  - [ ] task-2-shutdown-test.txt — daemon stdout/stderr

  **Commit**: YES (groups with T1, T3-T6)
  - Message: `build(daemon): add project scaffolding with CMake and vendored deps`
  - Files: `native/echo-audio-daemon/CMakeLists.txt`, `native/echo-audio-daemon/src/main.cpp`, `native/echo-audio-daemon/tests/CMakeLists.txt`, `native/echo-audio-daemon/third_party/*`

- [x] 3. IPC Module — JsonRpcServer + MessageTypes

  **What to do**:
  - Implement `src/ipc/MessageTypes.h`:
    - Define `JsonRpcRequest` struct: `{ id, method, params }`
    - Define `JsonRpcResponse` struct: `{ id, result?, error? }`
    - Define `JsonRpcError` struct: `{ code, message, data? }`
    - Define all method name constants as `constexpr std::string_view`
    - Define all event name constants
    - Define error code enum
    - Type-safe param extraction helpers: `getString(params, "key")`, `getNumber(params, "key")`, etc.
  - Implement `src/ipc/JsonRpcServer.h/cpp`:
    - Read stdin line-by-line (one JSON object per line)
    - Parse with nlohmann/json
    - Validate JSON-RPC 2.0 structure (jsonrpc, method fields)
    - Dispatch to registered method handlers (std::function map)
    - Queue outgoing responses and events to a thread-safe output queue
    - Write thread drains queue to stdout (one JSON per line)
    - Handle parse errors with proper JSON-RPC error responses
    - Handle "shutdown" method as special case (returns response, then exits)
    - Event throttling: per-event-type minimum interval (position: 100ms, levelMeter: 50ms)
  - Write `tests/test_ipc.cpp`:
    - Test valid request parsing
    - Test invalid JSON returns parse error
    - Test unknown method returns method-not-found error
    - Test method dispatch calls correct handler
    - Test response is valid JSON-RPC 2.0 format
    - Test event throttling: rapid events get coalesced
    - Test shutdown method exits cleanly

  **Must NOT do**:
  - No audio processing in the IPC layer
  - No blocking I/O on the write side (use queue)
  - No platform-specific code (#ifdef is for entire file, not sprinkled through)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core infrastructure with thread safety, error handling, protocol compliance — needs careful design
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-6)
  - **Blocks**: Tasks 7, 16, 17 (decoder, session manager, main entry all depend on IPC)
  - **Blocked By**: Task 1 (protocol spec), Task 2 (CMake scaffolding)

  **References**:
  - `native/echo-audio-daemon/docs/protocol-spec.md` — Generated in Task 1. The authoritative method/event/error definitions.
  - `native/audio-host/src/main.cpp:258-295` — Current logLine/writeJsonLine patterns for stdout output
  - JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification — Protocol compliance reference
  - nlohmann/json docs: https://json.nlohmann.me/ — JSON parsing API reference

  **Acceptance Criteria**:
  - [ ] Test file created: `native/echo-audio-daemon/tests/test_ipc.cpp`
  - [ ] ctest passes all IPC tests (parse, dispatch, error handling, throttling)
  - [ ] JSON-RPC 2.0 compliance verified: valid requests get valid responses, malformed requests get error responses
  - [ ] Event throttling works: sending 100 position updates in 1 second results in ≤10 emitted events

  **QA Scenarios**:

  ```
  Scenario: Valid request gets valid response
    Tool: Bash (echo to daemon stdin)
    Preconditions: Daemon binary built with IPC module, test handler registered
    Steps:
      1. echo '{"jsonrpc":"2.0","id":1,"method":"test.echo","params":{"msg":"hello"}}' | timeout 2 ./build/echo-audio-daemon
      2. Read stdout line
      3. Parse JSON from stdout
      4. Assert jsonrpc == "2.0"
      5. Assert id == 1
      6. Assert result.msg == "hello"
    Expected Result: Well-formed JSON-RPC 2.0 response matching the request
    Evidence: .omo/evidence/task-3-valid-request.json

  Scenario: Invalid JSON returns parse error
    Tool: Bash
    Preconditions: Daemon running
    Steps:
      1. echo 'not json at all' | timeout 2 ./build/echo-audio-daemon
      2. Read stdout line
      3. Assert jsonrpc == "2.0", error.code == -32700 (parse error)
    Expected Result: Parse error response with standard code
    Evidence: .omo/evidence/task-3-parse-error.json

  Scenario: Unknown method returns method-not-found error
    Tool: Bash
    Preconditions: Daemon running
    Steps:
      1. echo '{"jsonrpc":"2.0","id":1,"method":"nonexistent.method"}' | timeout 2 ./build/echo-audio-daemon
      2. Read stdout line
      3. Assert error.code == -32601 (method not found)
    Expected Result: Method-not-found error response
    Evidence: .omo/evidence/task-3-unknown-method.json
  ```

  **Evidence to Capture**:
  - [ ] task-3-valid-request.json — JSON-RPC response
  - [ ] task-3-parse-error.json — Error response
  - [ ] task-3-unknown-method.json — Error response

  **Commit**: YES (groups with T1-T2, T4-T6)
  - Message: `feat(daemon): implement JSON-RPC 2.0 IPC server with message types`
  - Files: `src/ipc/JsonRpcServer.cpp`, `src/ipc/JsonRpcServer.h`, `src/ipc/MessageTypes.h`, `tests/test_ipc.cpp`

- [x] 4. Core Types + Error Handling

  **What to do**:
  - Create `src/common/AudioTypes.h`:
    - `AudioFormat` struct: `{ sampleRate, channels, sampleFormat (f32/s16/s32), duration }`
    - `DeviceInfo` struct: `{ id, name, outputMode (shared|exclusive|asio), maxSampleRate, sharedSampleRate, channelCount, isDefault }`
    - `PlaybackState` enum: `Stopped, Playing, Paused, Ended, Error`
    - `DecoderSession` struct: `{ filePath, format, currentPosition, state }`
    - `DspState` struct: `{ eqEnabled, clippingRisk, limiterProtecting, headroomDb }`
    - `OutputMode` enum: `Shared, Exclusive, Asio`
  - Create `src/common/ErrorCodes.h`:
    - Align with protocol spec error codes
    - Define daemon-specific error categories: decode, output, device, dsp
  - Create `src/common/Result.h`:
    - Simple `Result<T, E>` type or `std::expected<T, Error>` wrapper
    - Used throughout daemon for consistent error propagation
  - Write `tests/test_types.cpp`:
    - Verify struct sizes, copy semantics, serialization round-trip

  **Must NOT do**:
  - No audio processing logic — types only
  - No platform-specific types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Header-only type definitions — straightforward, no complex logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5-6)
  - **Blocks**: Tasks 3, 5, 7, 11, 16 (IPC, output, decoder, device, session manager all use these types)
  - **Blocked By**: Task 1 (protocol spec defines what types are needed)

  **References**:
  - `native/echo-audio-daemon/docs/protocol-spec.md` — Generated in Task 1. All types must match the protocol method params/returns.
  - `src/main/audio/audioTypes.ts` — Current TS types to mirror in C++: AudioPlaybackState enum, AudioDeviceInfo, SampleRatePlan, NativeOutputTelemetry

  **Acceptance Criteria**:
  - [ ] All types compile with C++17
  - [ ] Test file created: `tests/test_types.cpp`
  - [ ] ctest passes all type tests (construction, copy, default values)

  **QA Scenarios**:

  ```
  Scenario: Types compile and have correct defaults
    Tool: Bash (cmake build + ctest)
    Preconditions: Types header files exist
    Steps:
      1. cmake --build build --target echo-daemon-tests
      2. Assert build succeeds
      3. ctest --test-dir build -R test_types
      4. Assert all tests pass
    Expected Result: Zero build errors, all test_types pass
    Evidence: .omo/evidence/task-4-types-test.txt
  ```

  **Commit**: YES (groups with T1-T3, T5-T6)
  - Message: `feat(daemon): add core audio types and error handling`
  - Files: `src/common/AudioTypes.h`, `src/common/ErrorCodes.h`, `src/common/Result.h`, `tests/test_types.cpp`

- [x] 5. OutputDevice Interface + NullBackend

  **What to do**:
  - Create `src/output/OutputDevice.h` — abstract interface:
    ```cpp
    class OutputDevice {
    public:
      virtual ~OutputDevice() = default;
      virtual bool open(const DeviceInfo& device, int sampleRate, int channels, int bufferFrames) = 0;
      virtual void close() = 0;
      virtual bool write(const float* interleavedSamples, int frameCount) = 0;
      virtual int getSampleRate() const = 0;
      virtual int getBufferFrames() const = 0;
      virtual bool isOpen() const = 0;
      virtual std::string getBackendName() const = 0;
    };
    ```
  - Create `src/output/NullBackend.h/cpp`:
    - Implements OutputDevice interface
    - `open()` always succeeds
    - `write()` consumes samples and returns true (no real output)
    - Tracks frames written for testing
    - `getSampleRate()` returns last opened rate
  - Write `tests/test_null_output.cpp`:
    - Test open/close cycle
    - Test write returns correct frame count
    - Test that framesWritten counter increments correctly

  **Must NOT do**:
  - No real audio device interaction
  - No platform-specific code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple interface + trivial implementation — straightforward

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4, 6)
  - **Blocks**: Tasks 6, 8, 9, 10, 17 (test harness, all real backends, main entry)
  - **Blocked By**: Task 4 (AudioTypes.h needed for DeviceInfo)

  **References**:
  - `native/audio-host/src/main.cpp:1323-1378` — Current PcmRingAudioSource::prepareToPlay pattern for understanding what an output callback needs
  - `native/audio-host/src/wasapi_shared.h` — Current WASAPI API surface shape to mirror in OutputDevice interface

  **Acceptance Criteria**:
  - [ ] OutputDevice interface compiles as a pure virtual class
  - [ ] NullBackend compiles and links
  - [ ] Test file created: `tests/test_null_output.cpp`
  - [ ] ctest passes: open, write, close, frame counting

  **QA Scenarios**:

  ```
  Scenario: NullBackend open-write-close cycle
    Tool: Bash (ctest)
    Preconditions: NullBackend compiled into test binary
    Steps:
      1. ctest --test-dir build -R test_null_output
      2. Assert test "open_and_close" passes
      3. Assert test "write_counts_frames" passes
    Expected Result: All null output tests pass
    Evidence: .omo/evidence/task-5-null-output.txt
  ```

  **Commit**: YES (groups with T1-T4, T6)
  - Message: `feat(daemon): add OutputDevice interface and NullBackend`
  - Files: `src/output/OutputDevice.h`, `src/output/NullBackend.h`, `src/output/NullBackend.cpp`, `tests/test_null_output.cpp`

- [x] 6. Null-Output Integration Test Harness

  **What to do**:
  - Create `tests/test_harness.cpp`:
    - Spawns daemon with NullBackend
    - Registers a test "play" method handler that accepts a file path
    - Sends file path to decoder (stub for now), writes decoded samples to NullBackend
    - Registers "position" event emitter (fake position based on frames written)
    - Registers "device.list" method that returns a fake device list
  - Write `tests/harness_runner.py` (or shell script):
    - Start daemon as subprocess
    - Send JSON-RPC commands via stdin pipe
    - Read JSON-RPC responses/events from stdout pipe
    - Verify responses match expected schema
    - Test full cycle: device.list → play → wait for position events → pause → resume → stop
  - Verify that the daemon binary works as a standalone subprocess communicating via stdin/stdout

  **Must NOT do**:
  - Don't use real files or real audio devices
  - Don't make the harness depend on specific audio formats

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Integration test script + fake handlers — straightforward wiring

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-5)
  - **Blocks**: Task 17 (validates that main entry can be wired with real components)
  - **Blocked By**: Tasks 3, 5 (IPC server + NullBackend)

  **References**:
  - `native/echo-audio-daemon/docs/protocol-spec.md` — Protocol spec from Task 1 for correct JSON-RPC message format
  - `scripts/smoke-audio-host.mjs` — Current smoke test pattern: spawn host, send commands, verify output

  **Acceptance Criteria**:
  - [ ] Harness script starts daemon, sends commands, reads responses
  - [ ] Full play-pause-resume-stop cycle passes with NullBackend
  - [ ] Device list returns fake devices in correct format
  - [ ] Harness exits zero on success, non-zero on failure

  **QA Scenarios**:

  ```
  Scenario: Full play cycle with null output
    Tool: Bash (run harness script)
    Preconditions: Daemon binary built, harness script created
    Steps:
      1. ./tests/harness_runner.sh
      2. Assert exit code 0
      3. grep for "TEST: device.list → PASS" in output
      4. grep for "TEST: play → PASS" in output
      5. grep for "TEST: pause → PASS" in output
      6. grep for "TEST: stop → PASS" in output
    Expected Result: All harness tests pass
    Failure Indicators: Any "FAIL" line, non-zero exit code
    Evidence: .omo/evidence/task-6-harness-output.txt
  ```

  **Evidence to Capture**:
  - [ ] task-6-harness-output.txt — Full harness run output

  **Commit**: YES (groups with T1-T5)
  - Message: `test(daemon): add null-output integration test harness`
  - Files: `tests/test_harness.cpp`, `tests/harness_runner.sh`

- [x] 7. Decoder Module — AvDecoder + ReplayGain

  **What to do**:
  - Create `src/decoder/AvDecoder.h/cpp`:
    - Open file via `avformat_open_input()` + `avformat_find_stream_info()`
    - Find best audio stream via `av_find_best_stream()`
    - Create decoder via `avcodec_alloc_context3()` + `avcodec_open2()`
    - Create resampler via `swr_alloc_set_opts()` — target: planar f32, requested sample rate + channels
    - `decode()` method: read packet → send to codec → receive frame → resample → push to output buffer
    - `seek(seconds)` method: `av_seek_frame()` with AVSEEK_FLAG_BACKWARD
    - `probe(path)` static method: return AudioFormat struct
    - Thread-safe: mutex around decode operations
  - Create `src/decoder/ReplayGain.h/cpp`:
    - EBU R128 loudness analysis using libebur128 or manual RMS + LUFS calculation
    - `analyze(path, sampleRate, channels)`: scan file, compute track gain + peak
    - `applyGain(samples, frameCount, gainDb)`: multiply samples by linear gain
    - `applyPreventClipping(samples, frameCount, peak, targetLufs)`: limit gain to prevent clipping
  - Write `tests/test_decoder.cpp`:
    - Create a minimal valid WAV file (440Hz sine, 1 second, 44100Hz, mono, 16-bit) in test setup
    - Test probe returns correct format/sampleRate/channels/duration
    - Test decode produces correct number of frames
    - Test seek to 0.5s produces samples close to expected
    - Test decode after EOF returns 0 frames

  **Must NOT do**:
  - No dependency on output device or IPC layer
  - No assumptions about platform audio APIs

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: libavcodec API is complex, requires careful resource management, thread safety
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-12)
  - **Blocks**: Task 16 (SessionManager depends on decoder for playback)
  - **Blocked By**: Task 3 (IPC), Task 4 (AudioTypes)

  **References**:
  - FFmpeg decoding example: https://ffmpeg.org/doxygen/trunk/decode__audio_8c-example.html — Official decode API usage
  - `src/main/audio/DecoderPipeline.ts:453-650` — Current FFmpeg spawn args (codec params, resampler settings) to replicate in libavcodec
  - `native/audio-host/src/main.cpp:240-260` — DecodeServerRequest struct for decode parameter conventions
  - libswresample docs: https://ffmpeg.org/doxygen/trunk/group__lswr.html — Resampler API

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_decoder.cpp`
  - [ ] ctest passes: probe format detection, decode frame count, seek accuracy
  - [ ] Supports FLAC, WAV, MP3, AAC, OGG (verified by test)
  - [ ] Seek accuracy within 100ms for lossless, 500ms for lossy

  **QA Scenarios**:

  ```
  Scenario: Decode known test file produces expected frame count
    Tool: Bash (generate test file via ffmpeg, then run ctest)
    Preconditions: Test WAV file generated (1s 44100Hz mono 16-bit = 44100 frames)
    Steps:
      1. ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -ar 44100 -ac 1 -sample_fmt s16 /tmp/test_tone.wav
      2. ctest --test-dir build -R test_decoder
      3. Assert test "decode_frame_count" passes with expected ~44100 frames
    Expected Result: Decoded frame count within 1% of expected
    Failure Indicators: Zero frames, wildly wrong frame count
    Evidence: .omo/evidence/task-7-decode-test.txt

  Scenario: Probe returns correct metadata
    Tool: Bash (ctest)
    Preconditions: Test WAV file exists
    Steps:
      1. ctest --test-dir build -R test_decoder
      2. Assert test "probe_format" passes: sampleRate=44100, channels=1
    Expected Result: Probe metadata matches file properties
    Evidence: .omo/evidence/task-7-probe-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-decode-test.txt — ctest decode output
  - [ ] task-7-probe-test.txt — ctest probe output

  **Commit**: YES (groups with T8-T12)
  - Message: `feat(daemon): implement libavcodec decoder with ReplayGain support`
  - Files: `src/decoder/AvDecoder.cpp`, `src/decoder/AvDecoder.h`, `src/decoder/ReplayGain.cpp`, `src/decoder/ReplayGain.h`, `tests/test_decoder.cpp`

- [x] 8. MiniaudioBackend — Shared Mode Output

  **What to do**:
  - Create `src/output/MiniaudioBackend.h/cpp`:
    - Implements OutputDevice interface
    - Uses miniaudio in blocking/pull mode (`ma_device` with `ma_device_type_playback`)
    - `open()`: enumerates devices via `ma_context_get_devices()`, selects matching device, configures format (f32, requested sample rate + channels)
    - `write()`: feeds interleaved f32 samples to miniaudio's internal buffer
    - `close()`: calls `ma_device_uninit()`
    - Device enumeration: `static enumerate()` returns `std::vector<DeviceInfo>` from miniaudio context
    - Handles device disconnect gracefully (catch miniaudio errors, return error state)
  - Write `tests/test_miniaudio_backend.cpp`:
    - Test device enumeration returns non-empty list (on real hardware)
    - Test open/close cycle with default device
    - Test write returns correct frame count
    - Skip tests gracefully if no audio device available (CTest `SKIP`)

  **Must NOT do**:
  - No exclusive mode or ASIO — miniaudio handles shared mode only
  - No blocking during open (use timeout)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: miniaudio API has many configuration options, error handling for device enumeration, thread safety for write calls
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 9-12)
  - **Blocks**: Task 17 (main entry wires output backends)
  - **Blocked By**: Task 5 (OutputDevice interface)

  **References**:
  - miniaudio documentation: https://miniaud.io/docs/manual/index.html — API reference for device enumeration and playback
  - miniaudio simple playback example: https://github.com/mackron/miniaudio/blob/master/examples/simple_playback.c — Working example of playback setup
  - `native/audio-host/src/wasapi_shared.cpp:1300-1400` — Current WASAPI shared start to understand buffer frame negotiation logic
  - `native/audio-host/src/main.cpp:1088-1179` — enumerateDevices() for device enumeration pattern to replicate

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_miniaudio_backend.cpp`
  - [ ] ctest passes: device enumeration, open, write, close
  - [ ] Open with default device succeeds on machine with audio hardware
  - [ ] Write returns correct frame count

  **QA Scenarios**:

  ```
  Scenario: Miniaudio enumeration returns devices
    Tool: Bash (ctest)
    Preconditions: Audio hardware present (or VM with dummy audio)
    Steps:
      1. ctest --test-dir build -R test_miniaudio_backend -V
      2. Assert "enumerate_returns_devices" test output shows device count > 0
    Expected Result: At least one playback device found
    Failure Indicators: Zero devices (check audio system), crash during enumeration
    Evidence: .omo/evidence/task-8-enumeration.txt
  ```

  **Evidence to Capture**:
  - [ ] task-8-enumeration.txt — Device list output from test

  **Commit**: YES (groups with T7, T9-T12)
  - Message: `feat(daemon): implement miniaudio shared-mode output backend`
  - Files: `src/output/MiniaudioBackend.cpp`, `src/output/MiniaudioBackend.h`, `tests/test_miniaudio_backend.cpp`

- [x] 9. RawWasapiExclusiveBackend — Port Existing Code

  **What to do**:
  - Copy `native/audio-host/src/wasapi_exclusive.cpp` → `native/echo-audio-daemon/src/output/WasapiExclusiveBackend.cpp`
  - Copy `native/audio-host/src/wasapi_exclusive.h` → `native/echo-audio-daemon/src/output/WasapiExclusiveBackend.h`
  - Wrap existing C-style API into `OutputDevice` interface class:
    - Replace `wasapi_exclusive_runtime*` with class member
    - `open()` calls `wasapi_exclusive_start()` with device name/index/sampleRate/channels
    - `write()` calls `renderInterleaved()` on the audio source
    - `close()` calls `wasapi_exclusive_stop()`
  - The `wasapi_render_callback` function pointer → adapt to call into the DSP pipeline (for now, just copy samples)
  - Add `#ifdef _WIN32` guards around entire file
  - Write `tests/test_wasapi_exclusive_backend.cpp` (Windows only, skips on Linux):
    - Test device enumeration
    - Test open/close with an exclusive-mode device
    - Test write produces no error

  **Must NOT do**:
  - Don't modify the core WASAPI logic — only adapt the interface
  - Don't introduce new WASAPI features

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: WASAPI COM API is intricate, porting existing code while preserving behavior requires careful attention
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-8, 10-12)
  - **Blocks**: Task 17 (main entry)
  - **Blocked By**: Task 5 (OutputDevice interface)

  **References**:
  - `native/audio-host/src/wasapi_exclusive.cpp` (entire file) — Source to port. Pure Win32, zero JUCE.
  - `native/audio-host/src/wasapi_exclusive.h` — Function declarations to wrap
  - `native/audio-host/src/wasapi_timeout.h` — Also needed for timeout-safe Activate/Initialize/Start
  - `native/audio-host/src/audio_host_exit_codes.h` — Exit code constant needed

  **Acceptance Criteria**:
  - [ ] WasapiExclusiveBackend compiles on Windows with `#ifdef _WIN32`
  - [ ] Implements OutputDevice interface
  - [ ] ctest passes: enumerate, open, close (Windows only)
  - [ ] ctest gracefully skips on Linux

  **QA Scenarios**:

  ```
  Scenario: WASAPI exclusive backend compiles and enumerates devices (Windows)
    Tool: Bash (ctest)
    Preconditions: Windows build environment with WASAPI
    Steps:
      1. cmake --build build --config Release
      2. ctest --test-dir build -R test_wasapi_exclusive -C Release
      3. Assert enumerate test shows devices
    Expected Result: Devices enumerated, open succeeds on at least one device
    Evidence: .omo/evidence/task-9-wasapi-exclusive.txt
  ```

  **Evidence to Capture**:
  - [ ] task-9-wasapi-exclusive.txt — ctest output

  **Commit**: YES (groups with T7-T8, T10-T12)
  - Message: `feat(daemon): port raw WASAPI exclusive backend with OutputDevice adapter`
  - Files: `src/output/WasapiExclusiveBackend.cpp`, `src/output/WasapiExclusiveBackend.h`, `tests/test_wasapi_exclusive_backend.cpp`

- [x] 10. RawAsioBackend — Port Existing Code

  **What to do**:
  - Copy ASIO-related code from `native/audio-host/src/asio_host.cpp` + `.h` → `native/echo-audio-daemon/src/output/AsioBackend.cpp` + `.h`
  - Also copy ASIO SDK third-party files needed: `asio.cpp`, `asiodrivers.cpp`, `asiolist.cpp` + headers
  - Wrap into OutputDevice interface class:
    - `open()`: loads ASIO driver, configures channels/buffer/sample rate
    - `write()`: feeds samples to ASIO buffer (interleaved f32 → device format conversion)
    - `close()`: `ASIOExit()`, `ASIOStop()`
    - Also support DSD modes: DoP and native DSD — separate write methods or mode flag
  - Add `#ifdef ECHO_ENABLE_ASIO` guards
  - Write `tests/test_asio_backend.cpp` (requires ASIO driver installed, skips gracefully)
  - Copy DSD-related code from `main.cpp`: DopRingSource, native DSD output path — adapt to work with AsioBackend

  **Must NOT do**:
  - Don't modify the core ASIO logic — only adapt the interface
  - Don't bundle ASIO drivers — only the SDK

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: ASIO API is complex, DSD modes add additional complexity, COM interop on Windows
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-9, 11-12)
  - **Blocks**: Task 17 (main entry)
  - **Blocked By**: Task 5 (OutputDevice interface)

  **References**:
  - `native/audio-host/src/asio_host.cpp` (entire file) — Source to port. Raw ASIO SDK, zero JUCE.
  - `native/audio-host/src/asio_host.h` — Function declarations
  - `native/audio-host/third_party/asio-sdk/` — ASIO SDK files needed for compilation
  - `native/audio-host/src/main.cpp:2079-2300` — DopRingSource class for DSD/DoP output (uses juce::AbstractFifo → replace with custom ring buffer)

  **Acceptance Criteria**:
  - [ ] AsioBackend compiles when `ECHO_ENABLE_ASIO=ON` (Windows only)
  - [ ] Implements OutputDevice interface + DSD write methods
  - [ ] ctest skips gracefully when no ASIO driver present
  - [ ] Existing DopRingSource logic adapted with custom ring buffer (no juce::AbstractFifo)

  **QA Scenarios**:

  ```
  Scenario: ASIO backend compiles and links (Windows with SDK)
    Tool: Bash (cmake build)
    Preconditions: Windows, ECHO_ENABLE_ASIO=ON, ASIO SDK vendored
    Steps:
      1. cmake -B build -DECHO_ENABLE_ASIO=ON
      2. cmake --build build
      3. Assert build succeeds
    Expected Result: Zero compile/link errors
    Evidence: .omo/evidence/task-10-asio-build.txt
  ```

  **Evidence to Capture**:
  - [ ] task-10-asio-build.txt — cmake build output

  **Commit**: YES (groups with T7-T9, T11-T12)
  - Message: `feat(daemon): port raw ASIO backend with DSD support`
  - Files: `src/output/AsioBackend.cpp`, `src/output/AsioBackend.h`, `third_party/asio-sdk/*`, `tests/test_asio_backend.cpp`

- [x] 11. Device Enumerator + Watcher

  **What to do**:
  - Create `src/device/DeviceEnumerator.h/cpp`:
    - `enumerateShared()`: uses miniaudio context to list shared-mode devices
    - `enumerateExclusive()`: uses raw WASAPI enumeration (port from existing `enumerateCoreAudioRenderEndpoints()` in main.cpp)
    - `enumerateAsio()`: uses ASIO SDK driver enumeration
    - Returns `std::vector<DeviceInfo>` with id, name, sample rates, channels, isDefault
    - Deduplication: matching by name across backends
  - Create `src/device/DeviceWatcher.h/cpp`:
    - Windows: `IMMNotificationClient` for device plug/unplug/default-change events
    - Linux: ALSA snd_device_name_hint or udev monitoring
    - Emits `deviceChanged` events via a callback
    - Thread-safe: watcher runs on its own thread
  - Write `tests/test_device_enumerator.cpp`:
    - Test shared enumeration returns at least 1 device
    - Test exclusive enumeration returns devices (Windows)
    - Test each DeviceInfo has non-empty name and valid sample rate
  - Write `tests/test_device_watcher.cpp`:
    - Test that watcher initializes without error
    - Test that callback is invoked (may need manual device plug test for full validation)

  **Must NOT do**:
  - No dependency on output backends or decoder
  - No assumptions about which backends are compiled in

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multiple platform APIs (miniaudio, WASAPI COM, ASIO SDK), thread safety for watcher
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-10, 12)
  - **Blocks**: Task 17 (main entry wires device listing)
  - **Blocked By**: Task 3 (IPC for emitting events), Task 5 (OutputDevice interface for DeviceInfo type)

  **References**:
  - `native/audio-host/src/main.cpp:746-1217` — Current createDeviceTypes(), enumerateDevices(), enumerateCoreAudioRenderEndpoints() patterns to port
  - `native/audio-host/src/wasapi_shared.cpp:706-796` — enumerate_devices() for WASAPI shared device listing
  - `native/audio-host/src/wasapi_exclusive.cpp:665-737` — enumerate_devices() for WASAPI exclusive device listing
  - `native/audio-host/src/main.cpp:477-631` — shouldIncludeType(), sharedTypePriority(), isAsioType() logic for device filtering

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_device_enumerator.cpp`
  - [ ] ctest passes: shared devices enumerated, each has valid info
  - [ ] Device watcher initializes without crash
  - [ ] Deduplication works: same physical device not listed twice

  **QA Scenarios**:

  ```
  Scenario: Shared mode device enumeration returns valid devices
    Tool: Bash (ctest)
    Preconditions: Audio system running
    Steps:
      1. ctest --test-dir build -R test_device_enumerator -V
      2. Assert device count > 0
      3. Assert each device has non-empty name
      4. Assert each device has valid sample rate (> 0)
    Expected Result: At least one device with valid metadata
    Evidence: .omo/evidence/task-11-device-list.txt
  ```

  **Evidence to Capture**:
  - [ ] task-11-device-list.txt — Enumerated device list

  **Commit**: YES (groups with T7-T10, T12)
  - Message: `feat(daemon): implement device enumerator and hotplug watcher`
  - Files: `src/device/DeviceEnumerator.cpp`, `src/device/DeviceEnumerator.h`, `src/device/DeviceWatcher.cpp`, `src/device/DeviceWatcher.h`, `tests/test_device_enumerator.cpp`, `tests/test_device_watcher.cpp`

- [x] 12. DSP: BiquadFilter + EqProcessor

  **What to do**:
  - Create `src/dsp/BiquadFilter.h/cpp`:
    - Implement RBJ cookbook formulas for: peaking, lowpass, highpass, lowshelf, highshelf, bandpass, notch, allpass
    - `setParameters(frequency, gainDb, Q, type, sampleRate)` → recalculate coefficients
    - `process(inputSample)` → single sample IIR
    - `processBlock(input, output, frameCount)` → vectorized (use float* arrays, NOT juce::AudioBuffer)
    - Use double precision for coefficient calculation (stability), float for processing
  - Create `src/dsp/EqProcessor.h/cpp`:
    - 10-band parametric EQ (match current EqProcessor capabilities)
    - Each band: BiquadFilter with enable/disable, frequency/gain/Q/type
    - `setBandGain(bandIndex, gainDb)` → recalculate single band
    - `setPreamp(preampDb)` → linear gain applied to output
    - `processBlock(input, output, frameCount, channels)` → in-place processing
    - Per-band bypass toggle
  - Write `tests/test_biquad.cpp`:
    - Test peaking filter: 1kHz, 6dB boost, Q=1.0 → verify frequency response at 5 test points
    - Test lowshelf: 200Hz, -3dB cut → verify gain at 50Hz vs 1kHz
    - Test filter stability: run 1M samples, verify no NaN or inf
    - Test bypass: verify input == output
  - Write `tests/test_eq_processor.cpp`:
    - Test 10-band EQ with all bands flat → verify signal unchanged (within 0.01dB)
    - Test single band boost → verify gain at center frequency
    - Test preamp → verify overall gain change
    - Test enable/disable → verify band bypass works

  **Must NOT do**:
  - No dependency on juce::AudioBuffer or any JUCE type
  - No external DSP library — pure C++ math

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: DSP math is precise, requires frequency response verification, stability testing
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (can start in Wave 2 since it only depends on types, not IPC/output)
  - **Parallel Group**: Wave 2 (with Tasks 7-11)
  - **Blocks**: Tasks 13, 14, 15 (DSP pipeline depends on EQ)
  - **Blocked By**: None (pure C++ math, no daemon infrastructure needed)

  **References**:
  - RBJ Audio EQ Cookbook: https://www.w3.org/TR/audio-eq-cookbook/ — Authoritative biquad coefficient formulas
  - `native/audio-engine/EqProcessor.cpp` — Current JUCE-based EQ to replicate filter types and band configuration
  - `native/audio-engine/EqBand.h` — Current EQ band type enum to match
  - `native/audio-engine/EqTypes.h` — Current EQ type definitions

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_biquad.cpp`, `tests/test_eq_processor.cpp`
  - [ ] ctest passes all biquad tests (frequency response, stability, bypass)
  - [ ] ctest passes all EQ processor tests (flat, boost, preamp, bypass)
  - [ ] 10-band EQ flat: output within 0.01dB of input
  - [ ] No NaN/inf after 1M samples at any filter setting

  **QA Scenarios**:

  ```
  Scenario: Biquad peaking filter frequency response
    Tool: Bash (ctest)
    Preconditions: test_biquad compiled
    Steps:
      1. ctest --test-dir build -R test_biquad -V
      2. Assert test "peaking_1khz_6db" passes: gain_at_1khz within 5.5-6.5dB
      3. Assert test "stability_1m_samples" passes: no NaN/inf
    Expected Result: Measured gain matches expected within tolerance
    Evidence: .omo/evidence/task-12-biquad-test.txt

  Scenario: EQ processor flat bypass
    Tool: Bash (ctest)
    Preconditions: test_eq_processor compiled
    Steps:
      1. ctest --test-dir build -R test_eq_processor -V
      2. Assert test "all_bands_flat" passes: RMS difference < 0.0001
    Expected Result: Zero audible difference with flat EQ
    Evidence: .omo/evidence/task-12-eq-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-12-biquad-test.txt — ctest output
  - [ ] task-12-eq-test.txt — ctest output

  **Commit**: YES (groups with T13-T15)
  - Message: `feat(daemon): implement pure C++ biquad filter and 10-band EQ processor`
  - Files: `src/dsp/BiquadFilter.cpp`, `src/dsp/BiquadFilter.h`, `src/dsp/EqProcessor.cpp`, `src/dsp/EqProcessor.h`, `tests/test_biquad.cpp`, `tests/test_eq_processor.cpp`

- [x] 13. DSP: ConvolutionProcessor (KissFFT)

  **What to do**:
  - Create `src/dsp/ConvolutionProcessor.h/cpp`:
    - Implement partitioned convolution using KissFFT
    - `loadIr(wavFilePath)`: read WAV impulse response file via libavcodec, extract mono/stereo IR
    - `setEnabled(bool)`: enable/disable convolution
    - `processBlock(input, output, frameCount, channels)`: convolve input with IR
    - Partition size auto-selection based on IR length (short IR → single FFT, long IR → multi-partition)
    - Support stereo IRs (separate convolution per channel) and mono-to-stereo IR
    - Zero-latency mode for short IRs, uniform-partition mode for long IRs
  - Write `tests/test_convolution.cpp`:
    - Generate a unit impulse IR (1.0 at sample 0, 0 elsewhere) → convolution should pass signal unchanged
    - Generate a delay IR (1.0 at sample 100) → output should be delayed by 100 samples + zero-padded
    - Test with real small WAV file as IR
    - Test enable/disable: disabled should pass signal unchanged
    - Test memory: load/unload/load cycle should not leak

  **Must NOT do**:
  - No dependency on juce::dsp::Convolution or juce::WavAudioFormat
  - No external FFT library except vendored KissFFT

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Partitioned convolution with FFT is mathematically intensive, needs careful implementation and testing
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 14-17)
  - **Blocks**: Task 15 (DspPipeline)
  - **Blocked By**: Task 12 (needs audio buffer conventions from BiquadFilter)

  **References**:
  - `native/audio-engine/ConvolutionProcessor.cpp` — Current JUCE-based convolution to replicate functionality
  - `native/audio-engine/ConvolutionProcessor.h` — Current interface: prepare(), process(), IR loading
  - KissFFT documentation: https://github.com/mborgerding/kissfft — API reference for FFT/IFFT
  - Partitioned convolution paper: "Efficient Convolution without Latency" by William G. Gardner. Key concepts for partition strategy.

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_convolution.cpp`
  - [ ] ctest passes: unit impulse → pass-through, delay IR → delayed output, enable/disable
  - [ ] No memory leak in 100-cycle load/unload test
  - [ ] Supports stereo IRs

  **QA Scenarios**:

  ```
  Scenario: Unit impulse IR passes signal through unchanged
    Tool: Bash (ctest)
    Preconditions: test_convolution compiled
    Steps:
      1. ctest --test-dir build -R test_convolution -V
      2. Assert test "unit_impulse_pass_through" passes: RMS diff < 0.001
    Expected Result: Convolution with unit impulse = identity
    Evidence: .omo/evidence/task-13-convolution.txt
  ```

  **Evidence to Capture**:
  - [ ] task-13-convolution.txt — ctest output

  **Commit**: YES (groups with T12, T14-T15)
  - Message: `feat(daemon): implement partitioned convolution processor with KissFFT`
  - Files: `src/dsp/ConvolutionProcessor.cpp`, `src/dsp/ConvolutionProcessor.h`, `tests/test_convolution.cpp`

- [x] 14. DSP: ChannelBalance + Limiter

  **What to do**:
  - Create `src/dsp/ChannelBalanceProcessor.h/cpp`:
    - Per-channel gain (L/R independent volume)
    - Per-channel delay (delay line buffer, configurable ms)
    - Balance (pan between L and R)
    - Mono modes: sum L+R, left-only, right-only
    - Phase invert per channel
    - Channel swap (swap L and R)
    - `processBlock(input, output, frameCount, channels)`: applies all active transformations
  - Create `src/dsp/Limiter.h/cpp`:
    - Peak limiter at 0dBFS
    - Attack time ~1ms, release time ~50ms
    - Soft-clip above threshold (tanh or polynomial)
    - `setEnabled(bool)`
    - `processBlock(input, output, frameCount, channels)`: in-place limiting
    - `isProtecting()`: returns true when gain reduction is active
    - `hasClippingRisk()`: returns true when input approaches 0dBFS
  - Write `tests/test_channel_balance.cpp`:
    - Test L gain = 0.5 → L channel output half amplitude, R unchanged
    - Test delay = 10ms → output delayed by expected sample count
    - Test mono sum → output identical on both channels = (L+R)/2
    - Test phase invert → output is negated
  - Write `tests/test_limiter.cpp`:
    - Test signal at 0.5 amplitude → no limiting (pass-through)
    - Test signal at 2.0 amplitude → limited to ≤1.0
    - Test sustained overload → verify release behavior
    - Test isProtecting() flag

  **Must NOT do**:
  - No dependency on juce::SmoothedValue or any JUCE DSP type
  - No external DSP library

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Delay line implementation, limiter envelope tracking, edge case testing for clipping
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 13, 15-17)
  - **Blocks**: Task 15 (DspPipeline)
  - **Blocked By**: Task 12 (BiquadFilter audio buffer conventions)

  **References**:
  - `native/audio-engine/ChannelBalanceProcessor.cpp` — Current JUCE-based channel balance to replicate
  - `native/audio-engine/ChannelBalanceProcessor.h` — Current interface
  - `native/audio-engine/DspSafetyLimiter.h` — Current safety limiter design to replicate
  - `native/audio-engine/DspHeadroomProcessor.cpp` — Current headroom processor for gain staging reference

  **Acceptance Criteria**:
  - [ ] Tests created: `tests/test_channel_balance.cpp`, `tests/test_limiter.cpp`
  - [ ] ctest passes: gain, delay, mono sum, phase invert, limiter threshold
  - [ ] Limiter prevents any sample from exceeding 1.0 in magnitude
  - [ ] Limiter isProtecting() returns true only during active gain reduction

  **QA Scenarios**:

  ```
  Scenario: Limiter prevents clipping at 2x amplitude
    Tool: Bash (ctest)
    Preconditions: test_limiter compiled
    Steps:
      1. ctest --test-dir build -R test_limiter -V
      2. Assert test "prevents_clipping" passes: max_abs_sample <= 1.0001
    Expected Result: All output samples within [-1.0, 1.0]
    Evidence: .omo/evidence/task-14-limiter.txt
  ```

  **Evidence to Capture**:
  - [ ] task-14-limiter.txt — ctest output

  **Commit**: YES (groups with T12-T13, T15)
  - Message: `feat(daemon): implement channel balance and peak limiter processors`
  - Files: `src/dsp/ChannelBalanceProcessor.cpp`, `src/dsp/ChannelBalanceProcessor.h`, `src/dsp/Limiter.cpp`, `src/dsp/Limiter.h`, `tests/test_channel_balance.cpp`, `tests/test_limiter.cpp`

- [x] 15. DspPipeline Orchestrator

  **What to do**:
  - Create `src/dsp/DspPipeline.h/cpp`:
    - Aggregates: EqProcessor → ConvolutionProcessor → ChannelBalanceProcessor → Limiter
    - `prepare(sampleRate, blockSize, channels)`: initialize all processors
    - `processBlock(input, output, frameCount, channels)`: run the full chain
    - `isActive()`: returns true if any processor is enabled/modified
    - `hasClippingRisk()`: delegates to Limiter
    - `isLimiterProtecting()`: delegates to Limiter
    - `reset()`: flush all processor states (delay lines, filter memories)
    - Thread-safe: processBlock can be called from audio thread, settings from control thread
  - Write `tests/test_dsp_pipeline.cpp`:
    - Test empty pipeline → pass-through
    - Test EQ + Limiter chain → EQ boost followed by limiting
    - Test ChannelBalance → verify stereo effects
    - Test isActive() reflects processor state
    - Test reset() → verify state cleared

  **Must NOT do**:
  - No new DSP processing — only orchestration of existing processors
  - No dependency on output or IPC layer

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Coordinates multiple DSP modules, thread safety for audio/control thread separation
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after T13, T14)
  - **Parallel Group**: Wave 3 (with Tasks 13-14, 16-17 — but blocked by 13+14)
  - **Blocks**: Task 17 (main entry wires DSP into audio pipeline)
  - **Blocked By**: Tasks 13, 14 (needs ConvolutionProcessor and ChannelBalance/Limiter)

  **References**:
  - `native/audio-engine/DspChain.cpp` — Current JUCE-based DSP chain to replicate exactly
  - `native/audio-engine/DspChain.h` — Current interface: prepare(), reset(), processBlock(), isActive()
  - `native/audio-host/src/main.cpp:1346-1348` — Current DspChain instantiation pattern in PcmRingAudioSource

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_dsp_pipeline.cpp`
  - [ ] ctest passes: empty pipeline pass-through, EQ+Limiter chain, stereo balance
  - [ ] isActive() returns true when EQ band gain != 0
  - [ ] reset() clears all filter states (verified by comparing output before/after reset)

  **QA Scenarios**:

  ```
  Scenario: Empty DSP pipeline = transparent pass-through
    Tool: Bash (ctest)
    Preconditions: All processors at default (flat EQ, no convolution, center balance, limiter off)
    Steps:
      1. ctest --test-dir build -R test_dsp_pipeline -V
      2. Assert test "empty_pipeline_passthrough" passes: RMS diff < 0.00001
    Expected Result: DSP chain is bit-transparent when all processors are bypassed
    Evidence: .omo/evidence/task-15-pipeline.txt
  ```

  **Evidence to Capture**:
  - [ ] task-15-pipeline.txt — ctest output

  **Commit**: YES (groups with T12-T14)
  - Message: `feat(daemon): implement DSP pipeline orchestrator`
  - Files: `src/dsp/DspPipeline.cpp`, `src/dsp/DspPipeline.h`, `tests/test_dsp_pipeline.cpp`

- [x] 16. SessionManager — Playlist, Gapless, Automix

  **What to do**:
  - Create `src/SessionManager.h/cpp`:
    - Manages playback state machine: Stopped → Playing → Paused → Ended
    - `play(filePath, startSeconds?)`: probe file → create decoder session → start output
    - `pause()`: stop feeding output (keep device open, send silence)
    - `resume()`: continue feeding output
    - `stop()`: close decoder, stop output, close device
    - `seek(seconds)`: av_seek_frame, flush DSP state
    - `setVolume(0.0-1.0)`: update linear gain applied at output stage
    - Gapless: `queueNext(filePath)` → decoder pre-buffers next track while current plays
    - Automix: `prepareAutomix(plan)` → set up crossfade parameters
    - Position tracking: maintain frame counter, emit position events
    - Level metering: compute peak/RMS per block, emit levelMeter events (throttled to 50ms)
    - Underrun detection: track output buffer starvation, emit diagnostics
    - Register all JSON-RPC method handlers with JsonRpcServer
  - Write `tests/test_session_manager.cpp`:
    - Test play → pause → resume → stop cycle with NullBackend
    - Test seek: verify position advances to correct frame
    - Test gapless: queue two files, verify no gap in output
    - Test automix: prepare crossfade, verify transition

  **Must NOT do**:
  - No UI logic — pure state machine
  - No platform-specific code (output abstraction handles that)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex state machine, gapless/automix timing, thread coordination between decode thread and output callback
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (integrates decoder, DSP, output)
  - **Parallel Group**: Wave 3 (sequential after decoder, DSP, output)
  - **Blocks**: Task 17 (main entry)
  - **Blocked By**: Tasks 7 (decoder), 15 (DSP pipeline)

  **References**:
  - `src/main/audio/AudioSession.ts:1940-2800` — Current playLocalFile/playPcmStream state machine to replicate in C++
  - `native/audio-host/src/main.cpp:1323-1527` — Current PcmRingAudioSource push/render/mix logic for audio thread
  - `native/audio-host/src/main.cpp:1596-1619` — prepareAutomix() for crossfade protocol
  - `native/audio-host/src/main.cpp:176-190` — StdinFrameType enum for protocol frame types to map

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_session_manager.cpp`
  - [ ] ctest passes: full play cycle, seek, gapless, automix
  - [ ] Playback with NullBackend produces expected position events
  - [ ] Gapless: position advances continuously across track boundary (no gap > 50ms)

  **QA Scenarios**:

  ```
  Scenario: Full play-pause-resume-stop cycle
    Tool: Bash (harness script with daemon)
    Preconditions: Test WAV file exists, daemon built with NullBackend
    Steps:
      1. Send JSON-RPC: {"method":"play","params":{"path":"/tmp/test_tone.wav"}}
      2. Wait 500ms, read position events from daemon stdout
      3. Assert position advancing (second > first)
      4. Send {"method":"pause"}
      5. Wait 200ms, assert position unchanged
      6. Send {"method":"resume"}
      7. Wait 200ms, assert position advancing again
      8. Send {"method":"stop"}
      9. Assert "state" event with "stopped"
    Expected Result: All state transitions correct
    Evidence: .omo/evidence/task-16-play-cycle.json
  ```

  **Evidence to Capture**:
  - [ ] task-16-play-cycle.json — Full event log from daemon

  **Commit**: YES (groups with T17)
  - Message: `feat(daemon): implement session manager with gapless and automix support`
  - Files: `src/SessionManager.cpp`, `src/SessionManager.h`, `tests/test_session_manager.cpp`

- [x] 17. Main Daemon Entry Point + Full Wiring

  **What to do**:
  - Complete `src/main.cpp`:
    - Initialize JsonRpcServer on stdin/stdout
    - Initialize DeviceEnumerator + DeviceWatcher
    - Initialize DspPipeline
    - Initialize SessionManager with decoder + DSP + output backends
    - Register all JSON-RPC method handlers:
      - `play` → SessionManager::play
      - `pause` → SessionManager::pause
      - `resume` → SessionManager::resume
      - `stop` → SessionManager::stop
      - `seek` → SessionManager::seek
      - `setVolume` → SessionManager::setVolume
      - `setOutput` → switch output backend (miniaudio ↔ exclusive ↔ asio)
      - `device.list` → DeviceEnumerator::enumerate
      - `eq.setBand`, `eq.setEnabled`, `eq.setPreset`, `eq.reset` → DspPipeline
      - `probe` → Decoder::probe
      - `queueNext` → SessionManager::queueNext
      - `prepareAutomix` → SessionManager::prepareAutomix
      - `shutdown` → clean exit
    - Main loop: read stdin → parse → dispatch → write stdout responses
    - Signal handling: SIGTERM → graceful shutdown, SIGINT → immediate stop
    - Startup diagnostics: check FFmpeg libs, miniaudio init, enumerate devices
  - Write `tests/test_main_entry.cpp`: mini integration test that starts daemon, sends play command with NullBackend, verifies response

  **Must NOT do**:
  - No new feature implementation — pure wiring
  - No 5700-line main.cpp — keep it under 300 lines

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Final integration point, wiring all modules, signal handling, startup diagnostics
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after all modules)
  - **Parallel Group**: Wave 3 (last task in wave)
  - **Blocks**: Tasks 18, 24, 26 (Electron integration, nix build, smoke test)
  - **Blocked By**: Tasks 3, 7, 8, 9, 10, 11, 15, 16

  **References**:
  - `native/echo-audio-daemon/docs/protocol-spec.md` — All method/event/error definitions for handler registration
  - `native/audio-host/src/main.cpp:1-18` — Current main.cpp includes to understand initialization order
  - `native/audio-host/src/main.cpp:355-468` — parseOptions() for CLI argument handling pattern

  **Acceptance Criteria**:
  - [ ] Daemon binary starts and responds to `device.list`
  - [ ] Daemon responds to `play` with NullBackend
  - [ ] `shutdown` causes clean exit with zero return code
  - [ ] Full harness script (Task 6) passes with real implementations
  - [ ] main.cpp is under 300 lines

  **QA Scenarios**:

  ```
  Scenario: Daemon starts, lists devices, accepts play
    Tool: Bash (full integration test)
    Preconditions: Daemon built with all modules
    Steps:
      1. Start daemon: ./build/echo-audio-daemon
      2. Send: {"jsonrpc":"2.0","id":1,"method":"device.list"}
      3. Read response, assert result.devices is array
      4. Send: {"jsonrpc":"2.0","id":2,"method":"play","params":{"path":"/tmp/test_tone.wav"}}
      5. Read response, assert result.status == "playing"
      6. Wait for position events (read stdout for 2 seconds)
      7. Assert at least 5 position events received
      8. Send: {"jsonrpc":"2.0","id":3,"method":"stop"}
    Expected Result: Full end-to-end cycle works
    Evidence: .omo/evidence/task-17-e2e.json
  ```

  **Evidence to Capture**:
  - [ ] task-17-e2e.json — Full event log

  **Commit**: YES
  - Message: `feat(daemon): complete main entry point with full module wiring`
  - Files: `src/main.cpp`, `tests/test_main_entry.cpp`

- [x] 18. Electron DaemonClient.ts — JSON-RPC Relay

  **What to do**:
  - Create `src/main/audio/DaemonClient.ts` (~200 lines):
    - `spawnDaemon()`: resolve daemon binary path, spawn with `{ stdio: ['pipe', 'pipe', 'pipe'] }`
    - `send(method, params)`: construct JSON-RPC 2.0 request, write to daemon stdin
    - Returns Promise that resolves with result or rejects with error
    - `on(event, callback)`: register event listener based on daemon stdout JSON-RPC notifications
    - Auto-reconnect: detect daemon crash (process exit), attempt restart with backoff
    - Health check: send `ping` method periodically to verify daemon is responsive
    - Graceful shutdown: send `shutdown` method, wait for exit, force kill after timeout
    - Binary resolution: check `resourcesPath/echo-audio-daemon`, dev path, system PATH
  - Write `tests/test_daemon_client.test.ts` (Vitest):
    - Mock child_process spawn
    - Test send/receive with mock daemon responses
    - Test auto-reconnect on process exit
    - Test graceful shutdown

  **Must NOT do**:
  - No audio logic — this is a pure transport layer
  - No dependency on old AudioSession, DecoderPipeline, EqBridge, etc.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple stdin/stdout JSON-RPC client with spawn management — straightforward Node.js
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 19-23)
  - **Blocks**: Tasks 19, 20, 21, 22 (preload, IPC, UI verification)
  - **Blocked By**: Task 17 (daemon binary must be buildable)

  **References**:
  - `src/main/audio/NativeOutputBridge.ts:562-700` — Current spawn pattern, binary resolution, graceful stop logic
  - `src/main/audio/NativeOutputBridge.ts:24-46` — HostBinaryResolveOptions for binary path resolution
  - `native/echo-audio-daemon/docs/protocol-spec.md` — Method names and event types for the client API

  **Acceptance Criteria**:
  - [ ] Test file created: `tests/test_daemon_client.test.ts`
  - [ ] Vitest passes: spawn, send, receive, reconnect, shutdown
  - [ ] DaemonClient compiles with `tsc --noEmit` zero errors
  - [ ] File is under 250 lines

  **QA Scenarios**:

  ```
  Scenario: DaemonClient sends command and receives response
    Tool: Bash (npx vitest)
    Preconditions: Test file compiled
    Steps:
      1. npx vitest run tests/test_daemon_client.test.ts
      2. Assert "send_and_receive" passes
      3. Assert "auto_reconnect" passes
    Expected Result: All client tests pass
    Evidence: .omo/evidence/task-18-client-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-18-client-test.txt — vitest output

  **Commit**: YES (groups with T19-T23)
  - Message: `feat(electron): add DaemonClient JSON-RPC transport layer`
  - Files: `src/main/audio/DaemonClient.ts`, `src/main/audio/__tests__/test_daemon_client.test.ts`

- [x] 19. Simplify Preload — Zero Audio Logic

  **What to do**:
  - Edit `src/preload/index.ts`:
    - Remove ALL audio processing code: HTMLAudioElement creation, AudioContext/WebAudio graph, system audio fallback, transport fade, ReplayGain calculation, `echo-audio://` protocol usage
    - Remove `window.echo.audio` object with its status/getStatus/setOutput/listDevices methods
    - Replace `window.echo.playback` methods with thin wrappers that call new IPC channels:
      ```typescript
      play: (params) => ipcRenderer.invoke('daemon:command', { method: 'play', params }),
      pause: () => ipcRenderer.invoke('daemon:command', { method: 'pause' }),
      // etc.
      ```
    - Add event forwarding:
      ```typescript
      ipcRenderer.on('daemon:event', (_, { event, params }) => {
        listeners[event]?.forEach(cb => cb(params))
      })
      ```
    - Keep non-audio functionality: window controls, settings, etc.
  - Write `tests/test_preload_audio.test.ts`:
    - Verify no AudioContext/HTMLAudioElement references
    - Verify all methods route through IPC invoke
    - Verify event subscription works

  **Must NOT do**:
  - No audio processing or Web Audio API usage
  - No breaking changes to non-audio preload methods

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Purely deletion + thin IPC wrappers — straightforward code reduction
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 18, 20-23)
  - **Blocks**: Tasks 21, 22 (UI verification needs this)
  - **Blocked By**: Task 18 (DaemonClient must exist)

  **References**:
  - `src/preload/index.ts` — Current preload to edit. Target: remove ~2000 lines of audio, replace with ~30 lines of relay.
  - `native/echo-audio-daemon/docs/protocol-spec.md` — Method names for wrapper functions

  **Acceptance Criteria**:
  - [ ] Zero references to HTMLAudioElement in preload
  - [ ] Zero references to AudioContext/WebAudio in preload
  - [ ] All playback methods route through `ipcRenderer.invoke`
  - [ ] `tsc --noEmit` passes
  - [ ] Existing non-audio preload methods unaffected

  **QA Scenarios**:

  ```
  Scenario: Preload has zero audio APIs
    Tool: Bash (grep)
    Preconditions: preload/index.ts edited
    Steps:
      1. grep -c "HTMLAudioElement" src/preload/index.ts → assert 0
      2. grep -c "AudioContext" src/preload/index.ts → assert 0
      3. grep -c "WebAudio" src/preload/index.ts → assert 0
    Expected Result: All counts are 0
    Evidence: .omo/evidence/task-19-zero-audio.txt
  ```

  **Evidence to Capture**:
  - [ ] task-19-zero-audio.txt — grep results

  **Commit**: YES (groups with T18, T20-T23)
  - Message: `refactor(electron): strip all audio logic from preload, add daemon IPC relay`
  - Files: `src/preload/index.ts`, `tests/test_preload_audio.test.ts`

- [x] 20. Simplify Main IPC Handlers

  **What to do**:
  - Edit `src/main/ipc/audioIpc.ts` (~756 lines → ~100 lines):
    - Remove all old handler registrations for audio:get-status, audio:set-output, audio:list-devices, etc.
    - Add new single handler: `daemon:command` → delegates to DaemonClient.send()
    - Add event forwarding: DaemonClient.on('*') → mainWindow.webContents.send('daemon:event', ...)
  - Edit `src/main/ipc/audioCommandQueue.ts`:
    - Keep as-is (serialized command queue, 15s timeout) — still needed for daemon commands
  - Remove `src/main/protocol/audioProtocol.ts`:
    - Delete `echo-audio://` protocol handler (no longer needed)
  - Remove `src/main/audio/` old files that DaemonClient replaces:
    - These will be DELETED in Task 23, but for now just stop importing them
  - Reference `shared/constants/ipcChannels.ts` — update audio channel constants

  **Must NOT do**:
  - Don't break non-audio IPC handlers
  - Don't remove settings/permissions IPC that audio used to use (if still needed)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Deletion + thin wiring — straightforward
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 18-19, 21-23)
  - **Blocks**: Tasks 21, 22 (UI verification)
  - **Blocked By**: Task 18 (DaemonClient), Task 19 (preload)

  **References**:
  - `src/main/ipc/audioIpc.ts` — Current audio IPC handlers to simplify
  - `src/shared/constants/ipcChannels.ts` — IPC channel constants to update

  **Acceptance Criteria**:
  - [ ] `daemon:command` IPC handler routes to DaemonClient
  - [ ] `daemon:event` forwarded to renderer
  - [ ] `tsc --noEmit` passes
  - [ ] Old audio IPC handlers removed

  **QA Scenarios**:

  ```
  Scenario: Daemon command IPC handler works
    Tool: Bash (vitest)
    Preconditions: IPC test file compiled
    Steps:
      1. npx vitest run src/main/ipc/__tests__/audioIpc.test.ts
      2. Assert "daemon_command_routes_to_client" passes
    Expected Result: IPC handler test passes
    Evidence: .omo/evidence/task-20-ipc-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-20-ipc-test.txt — vitest output

  **Commit**: YES (groups with T18-T19, T21-T23)
  - Message: `refactor(electron): simplify IPC handlers to daemon relay, remove audio protocol`
  - Files: `src/main/ipc/audioIpc.ts`, `src/main/ipc/audioCommandQueue.ts`, `src/main/protocol/audioProtocol.ts`, `src/shared/constants/ipcChannels.ts`

- [x] 21. UI Verification — Playback Controls Work

  **What to do**:
  - Start ECHO NEXT in dev mode with daemon running
  - Navigate to Songs page, play a local file
  - Verify: play button toggles to pause, progress bar advances
  - Verify: click pause → button toggles back, progress stops
  - Verify: click next → next track plays
  - Verify: seek bar drag → position changes
  - Verify: volume slider → daemon receives setVolume command
  - Capture screenshots of each state
  - If anything doesn't work: diagnose whether it's a preload/IPC/DaemonClient/daemon issue, fix and re-test

  **Must NOT do**:
  - No UI redesign — just verify existing UI works with new backend
  - No new features in the playback UI

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Browser-based UI verification with Playwright — needs visual assertion and interaction testing
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 18-20, 22-23)
  - **Blocks**: Task 23 (can delete old code once verified)
  - **Blocked By**: Tasks 18, 19, 20 (Electron integration must be wired)

  **References**:
  - `src/renderer/components/player/PlayerBar.tsx` — Playback controls to interact with
  - `src/renderer/stores/playbackStatusStore.ts` — Status store to verify updates

  **Acceptance Criteria**:
  - [ ] Play/Pause button works (toggles state correctly)
  - [ ] Progress bar updates during playback (advances ≥1s per second)
  - [ ] Seek works (click at 50% → position near 50% of duration)
  - [ ] Next/Previous track works
  - [ ] Volume slider changes daemon volume

  **QA Scenarios**:

  ```
  Scenario: Play a local file and verify progress bar advances
    Tool: Playwright
    Preconditions: ECHO NEXT running in dev mode, test file in library, daemon operational
    Steps:
      1. Navigate to Songs page
      2. Find a song row, double-click it
      3. Wait 2 seconds
      4. Locate .progress-bar-fill element
      5. Get its width as percentage
      6. Assert width > 0% and width < 100%
      7. Wait another 3 seconds
      8. Assert new width > previous width (progress advancing)
    Expected Result: Progress bar width increases after playback starts
    Failure Indicators: Width stays at 0%, play button doesn't change to pause icon
    Evidence: .omo/evidence/task-21-playback.png

  Scenario: Pause stops progress advancement
    Tool: Playwright
    Preconditions: Song playing, progress advancing
    Steps:
      1. Click .play-pause-button
      2. Record current progress bar width
      3. Wait 2 seconds
      4. Assert progress bar width unchanged
    Expected Result: Progress frozen after pause
    Evidence: .omo/evidence/task-21-pause.png
  ```

  **Evidence to Capture**:
  - [ ] task-21-playback.png — Screenshot of playing state
  - [ ] task-21-pause.png — Screenshot of paused state

  **Commit**: NO (verification only — fixes committed separately if needed)

- [x] 22. UI Verification — EQ Panel Works

  **What to do**:
  - Open EQ panel in ECHO NEXT settings
  - Enable EQ, adjust a band gain
  - Verify: EQ band slider sends `eq.setBand` via daemon
  - Verify: EQ enable/disable toggle works
  - Verify: EQ preset switching works
  - Verify: Channel balance controls work (pan, gain, delay)
  - Capture screenshots
  - If anything doesn't work: fix preload/IPC/DaemonClient mapping

  **Must NOT do**:
  - No EQ UI redesign — verify existing UI works through new IPC path
  - No new EQ features

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI interaction with sliders/knobs in settings panel — needs Playwright
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 18-21, 23)
  - **Blocks**: Task 23 (delete old code once verified)
  - **Blocked By**: Tasks 18, 19, 20 (Electron integration)

  **References**:
  - `src/renderer/components/player/AudioSettingsDrawer.tsx` — Settings drawer with EQ panel
  - `src/main/audio/EqBridge.ts` — Current EQ TCP protocol to verify new JSON-RPC path replaces it

  **Acceptance Criteria**:
  - [ ] EQ enable/disable toggle works
  - [ ] Band gain slider changes daemon EQ state
  - [ ] Preset selection sends correct bands to daemon
  - [ ] Channel balance pan works

  **QA Scenarios**:

  ```
  Scenario: Enable EQ and adjust band gain
    Tool: Playwright
    Preconditions: ECHO NEXT running, daemon operational, EQ panel open in settings
    Steps:
      1. Navigate to Settings > Audio > EQ
      2. Click .eq-enable-toggle to enable
      3. Drag .eq-band-slider[data-band="3"] to +3dB position
      4. Assert that daemon receives JSON-RPC: {"method":"eq.setBand","params":{"band":3,"gainDb":3.0}}
      5. Take screenshot of EQ panel
    Expected Result: EQ command reaches daemon, UI reflects new band value
    Evidence: .omo/evidence/task-22-eq-panel.png
  ```

  **Evidence to Capture**:
  - [ ] task-22-eq-panel.png — Screenshot of EQ panel with band adjusted

  **Commit**: NO (verification only)

- [x] 23. Delete Old Audio Code

  **What to do**:
  - Delete files that are fully replaced by the daemon:
    - `src/main/audio/AudioSession.ts` (8676 lines)
    - `src/main/audio/DecoderPipeline.ts` (1067 lines)
    - `src/main/audio/JuceDecodePipeline.ts` (649 lines)
    - `src/main/audio/EqBridge.ts` (1390 lines)
    - `src/main/audio/NativeOutputBridge.ts` (1422 lines)
    - `src/main/audio/DeviceService.ts` (312 lines)
    - `src/main/audio/PlaybackClock.ts` (36 lines)
    - `src/main/audio/AutomixAnalyzer.ts` (371 lines)
    - `src/main/audio/AutomixPlanner.ts` (559 lines)
    - `src/main/audio/AudioLevelMeter.ts` (642 lines)
    - `src/main/audio/FfmpegToolchain.ts` (228 lines)
    - `src/main/protocol/audioProtocol.ts` (208 lines)
    - Old audio IPC handler registrations (already simplified in Task 20)
  - Update imports everywhere: any remaining imports of deleted files must be fixed
  - Run `tsc --noEmit` to verify no broken imports
  - Run `vitest run` to verify no broken tests

  **Must NOT do**:
  - Don't delete shared types (audioTypes.ts, etc.) that are still referenced by settings/UI
  - Don't delete test files that test the old code (they fail, that's expected — they'll be cleaned up separately)
  - Don't delete `native/audio-host/` — old native code stays for reference/fallback during transition

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Bulk file deletion + import fix — straightforward but needs careful `tsc` verification

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on verification)
  - **Parallel Group**: Wave 4 (final task in wave)
  - **Blocks**: Task 26 (smoke test)
  - **Blocked By**: Tasks 21, 22 (verified new code works)

  **References**:
  - `src/main/audio/` — Directory listing to identify all files for deletion
  - `src/main/ipc/audioIpc.ts` — Already modified in Task 20, verify no broken references

  **Acceptance Criteria**:
  - [ ] All listed files deleted
  - [ ] `tsc --noEmit` passes with zero errors (no broken imports)
  - [ ] `vitest run` shows zero failing tests from old audio code (old audio test files may be skipped/ignored)

  **QA Scenarios**:

  ```
  Scenario: TypeScript compiles after deletion
    Tool: Bash
    Preconditions: All old files deleted, imports updated
    Steps:
      1. npx tsc --noEmit
      2. Assert exit code 0
      3. Assert zero errors in output
    Expected Result: Clean TypeScript compilation
    Failure Indicators: "Cannot find module" errors, "has no exported member" errors
    Evidence: .omo/evidence/task-23-tsc-clean.txt
  ```

  **Evidence to Capture**:
  - [ ] task-23-tsc-clean.txt — tsc output

  **Commit**: YES
  - Message: `refactor(electron): delete old audio stack replaced by daemon`
  - Files: Multiple deletions across `src/main/audio/`, plus import fixes

- [x] 24. Nix Flake Update — Remove JUCE, Add Daemon Build

  **What to do**:
  - Edit `shell.nix`:
    - Remove JUCE X11/GTK3/Freetype dependencies: `libX11`, `libXcomposite`, `libXcursor`, `libXext`, `libXinerama`, `libXrandr`, `libXrender`, `gtk3`
    - Keep ALSA: `alsa-lib` (needed by miniaudio)
    - Keep FFmpeg: `ffmpeg` (provides libavformat/libavcodec/libswresample shared libs)
    - Add `pkg-config` (already present)
    - Ensure `cmake`, `gcc`, `gnumake` are present (already there)
  - Edit `package.nix`:
    - Replace the old `buildPhase` that tried to run `cmake FetchContent` for JUCE
    - Add daemon build step: `cmake -B build native/echo-audio-daemon && cmake --build build`
    - Install daemon binary to `$out/lib/echo-next/echo-audio-daemon`
    - Update `npmDepsHash` if package.json changed
  - Edit `flake.nix`:
    - Update description if needed
    - Verify `nix flake check` passes
  - Test: `nix build .#echo-next` must succeed
  - Test: `nix run .#echo-next` must start the application
  - Verify daemon binary exists in the output: `ls result/lib/echo-next/echo-audio-daemon`

  **Must NOT do**:
  - Don't break the `better-sqlite3` or `sharp` build steps (those are separate concerns)
  - Don't change the Electron version or packaging config

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Nix derivation editing with known dependencies — add/remove packages
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 25)
  - **Parallel Group**: Wave 5 (with Tasks 25-26)
  - **Blocks**: Task 26 (smoke test)
  - **Blocked By**: Task 17 (daemon must compile)

  **References**:
  - `shell.nix` — Current dev shell to modify (remove JUCE deps)
  - `package.nix` — Current build derivation to add daemon step
  - `flake.nix` — Current flake to update
  - `native/audio-host/CMakeLists.txt:18-25` — Current FetchContent JUCE to understand what's being removed

  **Acceptance Criteria**:
  - [ ] `nix develop` enters shell with cmake + pkg-config + ffmpeg + alsa-lib
  - [ ] `nix build .#echo-next` succeeds
  - [ ] Daemon binary exists in build output
  - [ ] `nix flake check` passes

  **QA Scenarios**:

  ```
  Scenario: Nix build produces working daemon binary
    Tool: Bash
    Preconditions: Nix installed with flakes enabled, daemon CMakeLists.txt complete
    Steps:
      1. nix build .#echo-next
      2. Assert exit code 0
      3. ls result/lib/echo-next/echo-audio-daemon
      4. Assert file exists and is executable
    Expected Result: Daemon binary in nix output
    Evidence: .omo/evidence/task-24-nix-build.txt
  ```

  **Evidence to Capture**:
  - [ ] task-24-nix-build.txt — nix build output

  **Commit**: YES (groups with T25-T26)
  - Message: `build(nix): remove JUCE deps, add daemon build to flake`
  - Files: `shell.nix`, `package.nix`, `flake.nix`

- [x] 25. Linux ALSA Output via Miniaudio

  **What to do**:
  - Verify that `MiniaudioBackend` (Task 8) already works on Linux via ALSA
  - Add Linux-specific ALSA configuration:
    - Device name mapping (ALSA device strings like "hw:0,0")
    - ALSA mixer integration (volume control)
    - `#ifdef __linux__` guards where needed
  - Test on Linux with real audio hardware:
    - Device enumeration returns ALSA devices
    - Playback works via default device
    - Device switching works (hw:0,0 → hw:1,0)
  - If miniaudio on Linux needs additional setup (e.g., `ma_backend_alsa` config), add it

  **Must NOT do**:
  - No raw ALSA API calls — use miniaudio's abstraction
  - No PulseAudio/JACK-specific code (miniaudio handles those via backend selection)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Linux audio device naming, ALSA quirks, cross-platform testing
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 24)
  - **Parallel Group**: Wave 5 (with Tasks 24, 26)
  - **Blocks**: Task 26 (smoke test)
  - **Blocked By**: Task 8 (MiniaudioBackend)

  **References**:
  - miniaudio ALSA backend docs: https://miniaud.io/docs/manual/index.html#ALSA — ALSA-specific device ID format and configuration
  - `native/audio-host/CMakeLists.txt:48-54` — Current ALSA find_package and JUCE_ALSA define pattern
  - `shell.nix:23-34` — Current ALSA/X11 deps in nix shell (X11/GTK will be removed in Task 24)

  **Acceptance Criteria**:
  - [ ] Device enumeration returns valid ALSA devices on Linux
  - [ ] Playback works via default ALSA device
  - [ ] Device switching between two ALSA devices works
  - [ ] No crashes or silent failures

  **QA Scenarios**:

  ```
  Scenario: ALSA device enumeration on Linux
    Tool: Bash (ctest or daemon command)
    Preconditions: Linux machine with ALSA audio devices
    Steps:
      1. echo '{"jsonrpc":"2.0","id":1,"method":"device.list"}' | ./build/echo-audio-daemon
      2. Read response
      3. Assert result.devices.length > 0
      4. Assert at least one device has outputMode "shared"
    Expected Result: ALSA devices enumerated
    Evidence: .omo/evidence/task-25-alsa-devices.json
  ```

  **Evidence to Capture**:
  - [ ] task-25-alsa-devices.json — device.list response

  **Commit**: YES (groups with T24, T26)
  - Message: `feat(daemon): verify and configure Linux ALSA output via miniaudio`
  - Files: `src/output/MiniaudioBackend.cpp` (updates only)

- [x] 26. Final Integration Smoke Test

  **What to do**:
  - Run full ECHO NEXT application with daemon:
    1. Start dev mode: `npm run dev`
    2. Import a test music folder (at least 3 tracks, mixed formats: FLAC + MP3)
    3. Play each file: verify format detection, playback, progress
    4. Test playback controls: play/pause/next/previous/seek
    5. Test volume control
    6. Test EQ: enable, adjust bands, disable
    7. Test output device switching: shared → exclusive (Windows only) → back to shared
    8. Test gapless: play 2 tracks, verify no audible gap
    9. Run for 15+ minutes: verify no crashes, no memory leaks
    10. Test error handling: play invalid file → verify error state, not crash
  - Test Nix package: `nix run .#echo-next` → verify same steps above
  - Document any issues found

  **Must NOT do**:
  - No new test infrastructure — this is a manual smoke test run
  - No production release — dev mode only

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive integration testing across all subsystems, multiple formats, edge cases
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (final verification)
  - **Parallel Group**: Wave 5 (last task before FINAL wave)
  - **Blocks**: FINAL wave
  - **Blocked By**: Tasks 17, 23, 24, 25

  **References**:
  - `scripts/smoke-audio-host.mjs` — Current smoke test patterns to adapt
  - All previous task QA scenarios — accumulated evidence to validate

  **Acceptance Criteria**:
  - [ ] All 3 test tracks play correctly
  - [ ] Playback controls all work
  - [ ] EQ changes are audible
  - [ ] Gapless transition verified
  - [ ] No crash after 15 minutes
  - [ ] Error on invalid file is graceful (error state, not daemon crash)

  **QA Scenarios**:

  ```
  Scenario: Full smoke test — play, EQ, device switch, gapless
    Tool: Playwright + Bash
    Preconditions: ECHO NEXT running, test library imported, daemon operational
    Steps:
      1. Play FLAC file — assert progress advances
      2. Play MP3 file — assert format detected correctly
      3. Enable EQ, set band 3 to +6dB — assert audio changes (or clipping risk flag appears)
      4. Switch output device (shared → another shared device) — assert playback continues
      5. Queue 2 tracks for gapless — assert no gap in transition
      6. Play invalid file (corrupted WAV) — assert error message, not daemon crash
      7. Run --duration 15m continuous playback — assert no crash
    Expected Result: All scenarios pass
    Failure Indicators: Any crash, freeze, or silent error
    Evidence: .omo/evidence/task-26-smoke-log.txt
  ```

  **Evidence to Capture**:
  - [ ] task-26-smoke-log.txt — Full smoke test log

  **Commit**: NO (verification only — fixes committed separately)

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `ctest` + `nix build` for daemon. Run `tsc --noEmit` + `vitest run` for TS. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | CTest [N pass/N fail] | Vitest [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Run daemon. Send each JSON-RPC method from protocol spec via Bash — verify responses against schema. Test cross-task integration: play → pause → seek → resume → track end. Test edge cases: invalid file path, device unplugged during playback, rapid seek spamming.
  Output: `Methods [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1-6**: `docs(daemon): add protocol spec and project scaffolding` — protocol-spec.md, CMakeLists.txt, src/ipc/*, src/output/NullBackend.*, tests/*
- **7-11**: `feat(daemon): implement decoder and output backends` — src/decoder/*, src/output/*, src/device/*
- **12-15**: `feat(daemon): implement DSP pipeline` — src/dsp/*
- **16-17**: `feat(daemon): implement session manager and main entry` — SessionManager.*, main.cpp
- **18-20**: `feat(electron): integrate daemon client and simplify IPC` — DaemonClient.ts, preload/index.ts, audioIpc.ts
- **21-23**: `refactor(electron): verify UI and delete old audio code` — AudioSession.ts, DecoderPipeline.ts, etc.
- **24-26**: `feat(daemon): nix build support and linux output` — flake.nix, shell.nix, src/output/LinuxAlsa*

---

## Success Criteria

### Verification Commands
```bash
# Daemon unit tests
cd native/echo-audio-daemon && cmake -B build && cmake --build build && ctest --test-dir build

# Daemon integration test (null output)
echo '{"jsonrpc":"2.0","id":1,"method":"play","params":{"path":"/tmp/test.flac"}}' | ./build/echo-audio-daemon

# TypeScript checks
npx tsc --noEmit && npx vitest run

# Nix build
nix build .#echo-next
```

### Final Checklist
- [ ] All "Must Have" present (format parity, output mode parity, DSP parity, gapless)
- [ ] All "Must NOT Have" absent (no JUCE, no FFmpeg CLI, no WebAudio, no new features)
- [ ] All ctest pass
- [ ] All Vitest pass
- [ ] nix build succeeds
- [ ] Old audio stack still functional (parallel coexistence)
