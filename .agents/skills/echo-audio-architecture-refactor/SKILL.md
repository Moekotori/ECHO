---
name: echo-audio-architecture-refactor
description: "ECHO audio architecture refactor principles and guardrails. MUST USE for any architecture design request, and whenever working on Audio Core, native audio host, playback backend abstractions, renderer audio control surfaces, main/preload IPC bridges, playback auto-advance, or JUCE-to-libav/miniaudio migration."
---

# ECHO Audio Architecture Refactor

## When To Load This Skill

Load this skill for any architecture design work, without exception.

Also load it for:

- Audio Core design or refactors.
- Native audio host lifecycle, decode, DSP, buffering, output, EOF, or drain behavior.
- Backend abstraction, backend selection, or backend factory work.
- Renderer audio settings/status UI.
- Main/preload IPC audio bridge additions.
- Playback queue auto-advance bugs.
- JUCE-to-libav/miniaudio migration work.
- Merge conflicts involving stale JUCE assumptions or backend ownership.

## Purpose

This refactor establishes a strict host-centered audio architecture for ECHO:

- Native audio host is the backend authority from file reading to decoding, DSP, buffering, output, and playback completion.
- Renderer is only the control plane. It sends commands, displays status, and controls host capabilities.
- Main/preload IPC exposes typed control surfaces between frontend and host-backed Audio Core.
- Legacy JUCE-centered assumptions must be removed or isolated.
- Playback state must reflect actual host/backend truth, not renderer guesses.
- Backend implementations must be object-oriented and grouped behind shared abstractions whenever they belong to the same category.

## Two Unshakable Principles

1. **毫不动摇宿主作为音频后端的地位。**
   - Native audio host owns the full audio pipeline: reading, decoding, processing, buffering, output, playback state, and lifecycle.
   - Renderer/main process must not recreate hidden playback truth.
   - Decoder EOF, PCM drain, output latency, backend state, and DSP/runtime status must be decided by the host or Audio Core host-facing layer.

2. **毫不动摇前端作为控制面的地位。**
   - Renderer is a control plane only.
   - Renderer may request playback actions, display status, and expose settings.
   - Renderer must not directly implement audio backend behavior, infer backend truth, or compensate for host bugs with UI-side playback logic.
   - Frontend controls host capabilities; it does not become an audio engine.

## Backend Design Principles

1. **坚定每一个后端都要面向对象。**
   - Every backend must be represented as an object with explicit lifecycle and responsibilities.
   - Backend behavior should live behind named classes/modules, not scattered conditionals.
   - Lifecycle methods should be obvious: initialize/open/start/stop/close/dispose where applicable.
   - State ownership must be local to the backend object unless there is a clearly named coordinator.

2. **坚定每一个同类都要抽象。**
   - Similar backend implementations must share an abstraction.
   - Do not add parallel one-off code paths for each backend.
   - If two implementations have the same role, define an interface/base contract and implement variants behind it.
   - Branching by backend type should happen at factory/selection boundaries, not throughout business logic.

## Third Unshakable Principle: Truth Ownership

3. **宿主是播放事实的唯一来源。**
   - If renderer and host disagree, fix the host/status contract.
   - Do not patch over backend lifecycle bugs by adding speculative frontend fallbacks.
   - Frontend guards are allowed only to prevent unsafe premature control actions, not to redefine audio truth.
   - This principle is above all numbered Core Invariants — it governs who owns truth, not just how to handle edge cases.

## Core Invariants

1. **Do not treat decoder EOF as playback EOF.**
   - Input ended means no more decoded PCM is coming.
   - Playback ended means buffered PCM has drained from native output/FIFO.

2. **Do not auto-advance early.**
   - Renderer must not switch tracks just because status reaches an old grace window.
   - `ended` auto-advance should only accept true tail positions.
   - Native buffered tail telemetry must block renderer auto-advance.

3. **Avoid JUCE compatibility drift.**
   - Do not reintroduce JUCE output/decode UI controls unless explicitly requested.
   - Prefer backend-neutral names in settings and status.
   - Tests should assert removed JUCE controls stay removed, but should not fail on harmless historical text unless it implies active controls.

4. **Keep IPC bridge explicit and typed.**
   - Main IPC handlers belong in focused registrar files.
   - Preload APIs should expose only intended `window.echo` capabilities.
   - Registry tests must include new IPC source files and push-only channels.

5. **Protect safety and stability first.**
   - Pro/entitlement paths stay fail-closed.
   - Audio output changes must avoid speculative fallback logic unless backed by current contracts.
   - Do not hide native host errors that explain playback state.

## Daemon Path Invariants (learned from automix failures)

These invariants are mandatory for any daemon-path code. Violating any one of them caused real runtime bugs.

6. **JSON-RPC method names must match native host dispatch exactly.**
   - `DaemonAudioBackend` sends method names to native host `main.cpp` dispatch loop.
   - A mismatch (e.g., `'session.begin'` vs `'audio.sessionBegin'`) causes silent failure: the native host falls through to the generic handler which returns "Method not found", the TS side catches and continues, session counters desync.
   - **Rule**: before adding or changing any `jrpc.call`/`jrpc.notify` method name, grep `native/audio-host/src/main.cpp` for the exact string. If it's not in the dispatch loop, it won't be handled.

7. **Session lifecycle operations must be single-owner.**
   - `beginSession()` (which increments `generation_`) must be called exactly ONCE per session. If both the `audio.sessionBegin` handler AND `AudioDaemon::onOpenFile` call it, `generation_` advances by 2 while `daemonSessionId` advances by 1 → session mismatch → all automix commands silently skipped.
   - **Rule**: identify the single owner of each session lifecycle call. `audio.sessionBegin` owns `beginSession()`. `onOpenFile` must NOT call `beginSession()` if `session.begin` already does. `onStop` may call it to reset for the next session.

8. **Path parity: daemon path must mirror bridge path's state management.**
   - The bridge path (one-shot `NativePcmHostProcess`) calls `maybeAdvanceAutomix`, `recordPlaybackDiagnosticEvent`, and uses `activeChainedPlayback` in its `ended` handler.
   - The daemon path (`DaemonAudioBackend`) must call the SAME methods at the SAME lifecycle points. Missing `maybeAdvanceAutomix` in daemon `onPosition`/`onEnded` causes track identity to never update.
   - **Rule**: when adding a new lifecycle callback to one path, check the other path for the equivalent. If the equivalent exists, add it. If it doesn't exist, document WHY.

9. **Native host must not silently skip protocol commands.**
   - When `sessionMatches` is false, native automix handlers use `continue` without any error response or log. The TS side never knows the command was dropped.
   - **Rule**: any native host handler that conditionally skips a command must either (a) write a JSON-RPC error response, or (b) log to stderr with the method name and session mismatch details. Silent `continue` is forbidden for protocol commands that affect playback state.

10. **No fire-and-forget for state-affecting operations.**
    - `void this.runDaemonAutomixSetup(...)` discards the Promise. If setup fails, only a log message is produced — the caller doesn't know, and no fallback is triggered.
    - `notify()` (fire-and-forget JSON-RPC) is acceptable for high-volume PCM streaming where ordering is guaranteed by the transport. It is NOT acceptable for protocol commands that change native host state (prepare, cancel, end).
    - **Rule**: state-affecting protocol commands must use `call()` (await response) or must have a verification mechanism. Fire-and-forget is only for bulk data transport.

11. **No async in stream event handlers.**
    - `run.stream.on('data', async (chunk) => { ... await setImmediate(...) })` creates a scheduling gap: Node fires `end` while `setImmediate` callbacks are still queued → `automixNextEnd` sent before all PCM chunks arrive.
    - **Rule**: `data`/`end`/`error` handlers on Node streams must be synchronous. If backpressure is needed, use Transform streams (piped Writable with `_write`/`_final` guarantees) or a manual queue with explicit drain tracking.

12. **Listener cleanup is mandatory.**
    - `writable.on('error', (err) => ...)` with an anonymous function can never be removed. After 11+ open/close cycles → `MaxListenersExceededWarning`.
    - **Rule**: every `on('event', ...)` on a shared resource (socket, pipe, stream) must store the listener reference and call `removeListener` in the corresponding teardown/dispose path. Anonymous listeners on shared resources are forbidden.

## Anti-Patterns

- Scattering backend-specific `if/else` checks across Audio Core.
- Adding a new backend by copying an existing backend path and changing a few flags.
- Letting renderer code know backend implementation details.
- Treating backend state as loose global variables.
- Having multiple same-role implementations without a shared interface or base contract.
- Fixing host/backend bugs by adding renderer-only guesses.
- Reintroducing legacy JUCE controls as compatibility shims without explicit approval.
- Using `void` to discard a Promise from a function that changes playback state.
- Adding `async` to Node stream `data`/`end` event handlers.
- Calling `beginSession()` from more than one code path per session lifecycle.
- Sending JSON-RPC method names without verifying they match the native host dispatch loop.
- Using `writable.on('error', (err) => ...)` with an anonymous function on a socket/pipe.

## Current Architecture Map

> 下表是 refactor/audio-architecture 分支当前的模块映射。冲突解决、新增后端、IPC 桥接必须对照此表判断"这个文件属于后端还是控制面"。重构仍在进行中；未完成的迁移见 "Daemon Migration Goal"。

| 模块 | 路径 | 职责 | 层级 |
| --- | --- | --- | --- |
| `NativePcmHostProcess` | `src/main/audio/NativePcmHostProcess.ts` | PCM host 进程生命周期、session 编排、JSON-RPC 桥 | 后端 / host-facing |
| `NativeOutputBridge.ts` | `src/main/audio/NativeOutputBridge.ts` | facade re-export，不再是实现 | facade |
| `HostBridgeRegistry` | `src/main/audio/HostBridgeRegistry.ts` | active daemon bridge、active JSON-RPC bridge 注册 | 后端 / 桥注册 |
| `DaemonHostProcess` | `src/main/audio/DaemonHostProcess.ts` | daemon spawn/stop、`createDaemonSpawnArgs` | 后端 / daemon 生命周期 |
| `JsonRpcBridge` | `src/main/audio/JsonRpcBridge.ts` | JSON-RPC over fd3/fd4 双工通道 | 后端 / 传输 |
| `AudioSession` | `src/main/audio/AudioSession.ts` | 主进程编排层，调用 host-facing 接口 | 编排层 |
| `DecoderPipeline` | `src/main/audio/DecoderPipeline.ts` | FFmpeg 解码后端 | 后端 / 解码 |
| `JuceDecodePipeline` | `src/main/audio/JuceDecodePipeline.ts` | 长驻原生解码后端（恢复自 origin/main） | 后端 / 解码 |
| `EqBridge` | `src/main/audio/EqBridge.ts` | EQ IPC、预设持久化、native 控制 socket | 后端 / DSP |
| `native/audio-host/src/main.cpp` | `native/audio-host/src/main.cpp` | native host 实现（PCM ring、DSD、ASIO、WASAPI） | native host |

## Removed JUCE Surfaces (Do Not Reintroduce)

合并或重构中删除的 JUCE 时代表面。冲突里再出现以下任一项，按"已删除"处理，不要恢复：

- `NativeOutputBridge` 单体类 — 已 facade 化为 `NativePcmHostProcess` re-export。
- `ECNP` framed stdin 协议 — `writePcmFrame`、Shutdown frame、framed PCM wrap。
- `-framed-stdin` / `-juce-output` CLI 启动参数（native host main.cpp 已不再接受）。
- `audioUseJuceOutput` / `audioUseJuceDecode` renderer toggle handler。
- `juce-directsound-shared` backendImpl 优雅关闭等待路径。
- JUCE 设备列表命名 (`JUCE Speakers`) 和独立 JUCE 缓存桶。
- `audioDrawer.note.juceDecode` 文案（4 个语言区）。

`${severity}` `tests asserting these` 已删除（见 `5f118642`）。不要再次重新适用旧 JUCE 测试。

## Daemon Migration Goal

**目标：无音频启动参数 daemon。**

当前 daemon（`DaemonHostProcess.createDaemonSpawnArgs`）启动参数分两类：

- **传输参数**（保留）：`--no-stdin --rpc-stdin-fd 3 --rpc-stdout-fd 4` — IPC 通道分配，必须保留。
- **音频参数**（待迁移）：`-sr 48000 -ch 2 -buffer 4096 -fifo-ms 3000 -prebuffer-ms 1000` — 应改为 session-time JSON-RPC 配置。

完成无参数 daemon 的 Top 5 阻塞（按优先级）：

1. **native host `main.cpp` 启动时打开默认设备**，依赖 `-sr -ch`。需要支持"延迟打开设备"：spawn 时不打开设备，第一个 `session.begin` JSON-RPC 调用时再 open。
2. **缓冲参数硬编码在 spawn args**。`-buffer -fifo-ms -prebuffer-ms` 应迁移到 `session.begin` 或独立的 `output.configure` JSON-RPC 方法。
3. **ready 事件语义**。当前 `{"ready":true}` 假设设备已打开。改成延迟打开后需要两级 ready：`process-ready` vs `device-ready`。
4. **per-play host 路径仍用 20+ CLI 参数**（`NativePcmHostProcess.start` :1267-1353）。更大迁移工作，但 daemon 路径可以先独立做到无音频参数。
5. **`Options` 结构体**在 native main.cpp 启动时依赖 CLI 参数初始化。需改造成"启动时全默认，运行时 JSON-RPC 覆盖"。

## Known Fix Patterns

### Premature Track Advance

Observed symptom:

- Track switches around 2.8 to 3 seconds early.
- Logs show `inputEnded: true` and `bufferedFrames` around 130k at 48 kHz.
- Remaining duration matches buffered native tail.

Correct fix pattern:

- Native host emits ended only after PCM drain.
- Renderer blocks auto-advance while `nativeBufferedMs` is above tail tolerance.
- Renderer `ended` natural-end window is tight, not multi-second.

Relevant tests:

- Native audio engine test for input ended waiting for buffered drain.
- PlayerBar regression for native buffered tail blocking auto-advance.
- PlayerBar regression for old multi-second ended grace not auto-advancing.

### Closed Daemon Bridge

Observed symptom:

- JSON-RPC forwarding continues after daemon stream close.

Correct fix pattern:

- Mark daemon JSON-RPC bridge closed on stream close.
- Skip DSP/RPC forwarding when daemon bridge is closed.
- Add tests for stale bridge behavior.

### Merge: Restored Dependencies

Observed symptom:

- 采 `origin/main` 的 `AudioSession` 后，测试报 `Cannot find module './JuceDecodePipeline'`。

Root cause:

- HEAD 分支重构删除了 `JuceDecodePipeline.ts` 和 `EqBridge.ts`，但 `origin/main` 的 `AudioSession` 仍然依赖它们。Git auto-merge 以 HEAD 的删除为准，需要手动从 `MERGE_HEAD` 恢复。

Correct fix pattern:

```bash
GIT_MASTER=1 git checkout MERGE_HEAD -- "src/main/audio/JuceDecodePipeline.ts" "src/main/audio/JuceDecodePipeline.test.ts"
GIT_MASTER=1 git checkout MERGE_HEAD -- "src/main/audio/EqBridge.ts" "src/main/audio/EqBridge.test.ts"
```

- 采 theirs 的文件和恢复的依赖必须在同一 commit 里，避免中间状态编译失败。
- 每次采 theirs 整文件前，先检查 `import` 列表里有没有 HEAD 已删除的模块。
- 删除过时的 JUCE 时代测试（测试旧单体 `NativeOutputBridge` 的 `ECNP` / `writePcmFrame` / `-framed-stdin` / `-juce-output` / JUCE 设备命名）。见 `Removed JUCE Surfaces`。

## Verification Guide

按改动面分层，不要为小改动跑全量测试。

| 改动面 | 最低验证 | 完整验证 |
| --- | --- | --- |
| 任何 TS 改动 | `npm run typecheck` | — |
| `AudioSession` / 编排层 | `src/main/audio/AudioCore.test.ts` focused | + typecheck |
| `NativePcmHostProcess` / daemon bridge | `AudioCore.test.ts` + typecheck | + `build:audio-host` + `smoke:audio-host` |
| native host (`main.cpp` / `*.cpp`) | `npm run build:audio-host` | + `ctest --test-dir out/native/audio-host --output-on-failure` + `npm run smoke:audio-host` |
| IPC / preload | registry test + typecheck | — |
| renderer 控制面（PlayerBar / AudioSettingsDrawer） | focused `.test.tsx` | + typecheck |
| docs / 文案 | 检查 diff | — |

不要因为改了文案或小 UI 就跑重音频测试。也不要因为改了音频热路径只跑静态检查。

## Git Discipline

### 通用

- Commit every completed change atomically.
- Use `GIT_MASTER=1` for all git commands.
- Do not stage unrelated dirty files.
- Keep implementation and direct regression test together.
- Squash only when explicitly requested.

### Merge 场景

- `git checkout --ours` / `--theirs` 只用于明确的整文件取舍（facade vs 旧单体、已删 vs 保留）。
- 选择性合并（保留部分 hunk、丢部分 hunk）必须手动编辑冲突块，不要用 `checkout` 整文件。
- 采 theirs 整文件后，检查 `import` 列表里有没有 HEAD 已删除的依赖；有就按 "Merge: Restored Dependencies" 模式从 `MERGE_HEAD` 恢复。
- 恢复的依赖文件和采 theirs 的文件必须在同一 merge commit 里。
- Merge commit message 要记录每个冲突文件的解决策略（保留哪边、为什么），不要只写 "Merge origin/main"。
