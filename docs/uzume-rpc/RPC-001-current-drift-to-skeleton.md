# RPC-001：Current Drift Closure -> Skeleton Gate

## 状态

- Phase：0-1
- Gate：Contract Gate + Skeleton Gate
- 目标版本：第一个可执行实施批次
- 前置条件：当前 `UzumeEngine` 过渡实现存在
- 操作分支：`uzume-dspchain-replacement`
- Upstream tracking：`origin/main`

## 实施记录

- 2026-06-08：已创建本地 safepoint commit `ebdfcfe`，随后 merge `origin/main` 到 `uzume-dspchain-replacement`，merge commit 为 `8e54b0d`。
- 已解决上游同步冲突：`DspChain.cpp` 保留上游 legacy DSP chain / safety limiter 路径，`audio_engine_tests.cpp` 合并 UZUME 与 legacy DspChain 测试注册。
- 已移除 `DspChain -> UzumeEngine` wrapper route：`DspChain.h/.cpp` 不再 include、持有或转发 `UzumeEngine`。
- 已推进 skeleton status：`UzumeEngine` 使用 `uzume-skeleton-compat`，按 active state 暴露 `transitional-processor-chain` / `identity-bypass`，并透出 `formatPath`、`bitPerfectState`、`directDisabledReason`、`headroomActive`、`transitionalConvolutionPath`、`fusedMacroKernel=false`、`bypassReason`。
- 已修正 headroom-only：`DspHeadroomProcessor::isEnabled()` 会激活 UZUME processed path；旧的 headroom bypass 断言已替换为 `testDspHeadroomActivatesUzumeProcessedPath`。
- 2026-06-08：`5badcd6` 将 UZUME DSP 页替代旧 DSP 模块 UI，未真正实现的子模块全部显示 `未实现`，只保留 legacy / compat readout。
- 2026-06-08：`3b4ff01` 增加 `uzumeFormatPathPlan`，六条 path 均透出 state/reason，并把 Signal Path / Professional Status 文案收紧为 `UZUME skeleton` / transitional compatibility。
- 代码收口提交：`3b4ff01`；文档反馈在其后单独追踪，PR 前以 `git status --short --branch` 再确认 clean / ahead 状态。

## 当前偏移

本 RPC 必须从当前代码偏移开始，不从理想架构空降。

| 偏移 | 当前证据 | 目标处理 |
| --- | --- | --- |
| Headroom 单独启用不生效 | `UzumeEngine::processBlock()` 只有 `active` 时调用 headroom；`isActive()` 不看 headroom；测试 `testDspHeadroomOnlyAppliesToActiveDsp` 明确断言 bypass | 在 UZUME processed path 中，headroom 本身就是 profile section，必须能激活处理；bit-perfect bypass 由 `formatPath` / compiler gating 决定 |
| `UzumeEngine` 仍是小 processor 协调器 | 当前顺序调用 `headroomProcessor -> eqProcessor -> convolutionProcessor -> channelBalanceProcessor -> safety limiter` | 短期诚实命名为 transitional processor chain；不要在 status / docs 中称其已是 fused macro-kernel |
| `ConvolutionProcessor` 仍在 UZUME 主路径 | `UzumeEngine` 持有并调用 `ConvolutionProcessor` | Phase 1 不强行删除；先标记为 legacy/transitional convolver source，Phase 4 再替换为 Shared Convolution Engine |
| `DspChain` 反向包住 `UzumeEngine` | 当前 `DspChain.h` include `UzumeEngine.h`，并以成员 `UzumeEngine uzumeEngine` 转发 prepare / process / status | 这条路线必须剔除；DspChain 只能成为 legacy backend 或被 `LegacyDspChain` 取代，不能作为 UZUME wrapper |
| telemetry 过早像最终 UZUME | 当前 profile 类似 `legacy-dsp-compat`，backend/status 主要表达 CUDA/cuFFT 能力 | 增加 skeleton 所需的 formatPath、runtimeModel、transitional flags、disabled reason；避免误报完整 UZUME profile |
| phase 与当前 PR 状态混在一起 | 文档已改为 Phase Exit Gates，但代码仍是过渡实现 | 当前 PR 只应落在 RPC-001 的 drift closure / skeleton 范围 |
| 上游已前进，本地工作区有重叠改动 | 已创建 safepoint 并 merge `origin/main`；代码收口提交为 `3b4ff01` | 已完成 upstream conflict closure；后续 PR 提交前只需常规 rebase/merge 检查 |
| 本地 multi-stage UZUME PR 需要纳入评估 | 当前本地未发现独立 `uzume` ref，multi-stage 内容表现为当前 dirty working tree / staged additions | 可以吸收 CUDA probe、telemetry、tests 等资产；依赖 `DspChain -> UzumeEngine` 的 route 必须改造或丢弃 |

## 目标

把当前实现收敛到一个诚实、可测试的 UZUME skeleton：

- 路径可解释：PCM bit-perfect、PCM processed、DSD direct、DSD upsampling、D2P、SDM 都能给出 `available / unavailable / disabled reason`。
- Headroom-only 在 `pcm_processed` 下生效；在 `pcm_bitperfect` / `dsd_direct` 下由 compiler 或 formatPath gating 禁用。
- 当前 chain 不再被描述为最终 fused macro-kernel，而是明确标记为 transitional compatibility execution。
- `DspChain -> UzumeEngine` wrapper 被拆除或隔离为 legacy-only path；UZUME skeleton 由 host / output bridge 直接选择。
- Frontend thin UI 能显示基础 section、formatPath、disabled reason 和 runtime status。
- 上游同步有明确处理结果；不能在未检查冲突的旧基线继续堆 UZUME skeleton。
- 本地 multi-stage UZUME PR 的可复用资产被分类：保留、改造、丢弃。
- 默认关闭，不影响普通播放、曲库和资料功能。

## 非目标

- 不实现 AVX2 fused macro-kernel。
- 不实现正式 Poly-Sinc SRC。
- 不替换 `ConvolutionProcessor`。
- 不实现 Shared Convolution Engine production path。
- 不实现 D2P / SDM 音频算法。

## 实施切片

### 1. Upstream Sync / Conflict Closure

RPC-001 的第一步是同步上游并关闭冲突风险。目标不是盲目 `git pull`，而是在当前大量本地改动存在时，先保护本地状态，再把上游变化纳入可评审基线。

已执行并收口的状态：

```text
current branch: uzume-dspchain-replacement
upstream: origin/main
fetched upstream head: ee751ed
integration merge: 8e54b0d
code closure head: 3b4ff01
post-doc status: run git status --short --branch before PR
```

Dirty files 说明：

- 早期 dirty overlap 已通过 safepoint、integration merge 和后续 commits 收口。
- 当前 RPC-001 评审基线不再依赖未提交 multi-stage UZUME 改动。
- 后续只需在 PR 前重新检查 `git status --short --branch` 与 upstream 差异，避免新的未跟踪生成物进入提交。

Required procedure:

```powershell
git fetch origin
git branch --set-upstream-to=origin/main uzume-dspchain-replacement
git merge-tree --write-tree HEAD origin/main
git diff --name-only HEAD..origin/main
git status --short --branch
```

If dirty overlap exists, do one of these before actual merge / pull:

- create a local safepoint commit on the feature branch, or
- create a temporary integration branch and merge there, or
- stash with explicit name only if the team accepts stash-based recovery.

Conflict resolution requirements:

- Resolve upstream changes before touching RPC-001 implementation code.
- Re-run `git diff --check`.
- Re-run affected tests for files touched by both upstream and local UZUME work.
- Update this RPC if upstream changed the assumptions about DSP/SRC/Safety UI or native audio path.

Do not use `git reset --hard` or discard user changes as a conflict strategy.

### 2. Local Multi-Stage UZUME PR Intake

RPC-001 必须把本地 multi-stage UZUME PR 纳入评估，但不能照单全收。评估单位是实现资产，不是整个分支/PR。

分类表：

| 分类 | 可进入 RPC-001 的条件 | 处理 |
| --- | --- | --- |
| Keep | 不依赖 `DspChain -> UzumeEngine` wrapper，且不会误报 fused macro-kernel | 直接保留或小修 |
| Adapt | 有价值，但绑定了 DspChain route、legacy processor ownership 或过早的 profile 命名 | 改造成 host-selected UZUME skeleton / transitional telemetry |
| Drop | 让 `DspChain` 承载 UZUME 新功能，或把 legacy chain 当成 UZUME compiler/runtime | 从 RPC-001 中剔除 |

优先保留的资产：

- CUDA probe / compile gate。
- GPU fallback telemetry 基座。
- 现有 audio-engine tests 中可证明 backend fallback / scratch reuse 的部分。
- Professional Status / AudioStatus 中已存在但命名需要收紧的 UZUME 能力字段。

必须改造或剔除的资产：

- `DspChain` 持有 `UzumeEngine`。
- `DspChain::processBlock()` 转发到 UZUME。
- `DspChain` status 直接等同 UZUME status。
- 任何让 UZUME profile compiler 复用 legacy processor ownership 的设计。

### 3. Remove DspChain Wrapper Route

RPC-001 的 skeleton 目标不是继续做 `DspChain` 外壳，而是形成并列 backend：

```text
AudioSession / NativeOutputBridge
  -> LegacyDspChain backend
  -> UzumeEngine skeleton backend
```

Required implementation direction：

- `DspChain` 不再 include `UzumeEngine.h`。
- `DspChain` 不再持有 `UzumeEngine` 成员。
- `DspChain` 保持 legacy same-rate compatibility 行为，或重命名 / 拆出为 `LegacyDspChain`。
- native host / output bridge 负责选择 legacy backend 或 UZUME backend。
- 如果短期仍需要兼容 shim，shim 必须标为 temporary adapter，不能成为 RPC-001 exit gate 的正式路径。

验收证据：

- `rg -n "UzumeEngine" native/audio-engine/DspChain.*` 不应命中正式 include/member/forwarding route。
- Signal Path 中 legacy rollback 显示 `UZUME bypass / legacy DSP chain`。
- UZUME skeleton status 不通过 `DspChain` status 间接暴露。

### 4. Profile / Status Contract

新增或扩展轻量 schema，先满足 skeleton：

```text
UzumeProfileDraft
  formatPath
  sections:
    headroom
    eq
    channel
    convolutionLegacy
    safetyLimiter
  runtimeModel:
    transitional-processor-chain
    identity-bypass
  disabledReasons
```

Runtime status 至少报告：

- `formatPath.path`
- `formatPath.bitPerfectState`
- `formatPath.directDisabledReason`
- `uzumeFormatPathPlan`：`pcm_bitperfect`、`pcm_processed`、`dsd_direct`、`dsd_upsampling`、`d2p_processed`、`sdm_processed` 均提供 `state` 与 `reason`
- `runtimeModel`
- `profileName`
- `headroomActive`
- `transitionalConvolutionPath`
- `uzumeBypassReason`

### 5. Headroom Activation Fix

推荐第一处代码修改：

- `UzumeEngine::isActive()` 纳入 `headroomProcessor.isEnabled()`。
- `processBlock()` 在 active path 下继续先执行 headroom。
- 更新测试：把 `testDspHeadroomOnlyAppliesToActiveDsp` 改为 `testDspHeadroomActivatesUzumeProcessedPath`。
- 新增 bypass 测试：当 profile/formatPath 为 bit-perfect 或所有 section disabled 时，buffer 不改变。

关键原则：不要用 “isActive 忽略 headroom” 来保护 bit-perfect。bit-perfect 应由 formatPath/profile compiler 禁止 headroom section，而不是让 headroom 配置静默失效。

### 6. Transitional Chain Honesty

短期保留现有 processor 调用顺序，但必须显式暴露：

```text
runtimeModel = transitional-processor-chain
profileName = uzume-skeleton-compat
convolutionPath = legacy-convolution-processor
fusedMacroKernel = false
```

这避免前端和测试把当前状态误认为 Phase 3 exit。

### 7. Frontend Thin UI

前端只做基础可视化，不做完整编辑器：

- Format / Output Path
- Headroom
- EQ enabled state
- Legacy FIR / IR transitional state
- Channel tools
- Output Safety
- Signal Path

UI gating 必须覆盖：

- `dsd_direct` 禁用所有改样本 DSP。
- `dsd_upsampling` 只开放 SDM modulator、headroom、Safety Metering / overload guard。
- `pcm_bitperfect` 禁用 headroom/EQ/FIR/channel/limiter。
- `pcm_processed` 允许当前 transitional chain section。

当前 RPC-001 UI 落地比原始 thin UI 更严格：`pcm_processed` 可以解释当前 transitional compatibility path，但未真正实现的 UZUME 子模块不得出现可操作开关、滑杆或错误状态，只能显示 `未实现` 与必要的 legacy / compat readout。真正启用会改样本的功能时，后续 RPC 必须通过 profile / formatPath compiler 退出 bit-perfect、DSD direct 或 DSD upsampling 的不兼容路径。

## 验收

RPC-001 完成时必须满足：

- Upstream conflict closure 完成：actual merge/pull 已完成，或有明确 integration branch 记录和剩余阻塞说明。
- 本地 multi-stage UZUME PR intake 完成：每项相关资产被标记为 keep / adapt / drop。
- `DspChain -> UzumeEngine` wrapper route 被拆除，或有明确 temporary adapter 和删除 deadline。
- Headroom-only 在 `pcm_processed` 下实际衰减输出。
- 无 active section 时输出 bit-identical bypass。
- `UzumeEngine` status 不再暗示已完成 fused macro-kernel。
- `ConvolutionProcessor` 在 status 中标记为 transitional / legacy path。
- Signal Path 能显示当前 formatPath、runtimeModel、profile、disabled reason。
- `uzumeFormatPathPlan` 覆盖六条 path，且每条都有 `state` / `reason`；D2P / SDM / DSD unavailable reason 不得被当作实现完成。
- DSP 页面由 UZUME 工作台替代旧 DSP 页面；未实现子模块显示 `未实现`，不保留假开关或空功能错误指示。
- 当前测试不再断言 “headroom only applies to active DSP” 这种与目标设计冲突的行为。

## 必跑测试

```powershell
git fetch origin
git merge-tree --write-tree HEAD origin/main
npm run test:audio-engine
npm run typecheck
npx eslint src/renderer/pages/DspPage.tsx src/renderer/components/player/AudioProfessionalStatusPanel.tsx src/renderer/components/player/AudioSettingsDrawer.tsx src/renderer/components/player/PlayerBar.tsx src/main/audio/AudioCore.ts src/shared/types/library.ts
npx vitest run src/renderer/pages/DspPage.test.tsx src/renderer/components/player/AudioProfessionalStatusPanel.test.tsx src/renderer/components/player/AudioSettingsDrawer.test.tsx src/renderer/components/player/PlayerBar.test.tsx src/renderer/components/audio/EqPanel.test.tsx src/main/audio/AudioCore.test.ts
npm run build:win:unsigned
```

CUDA opt-in 测试如果本机具备 CUDA SDK，则作为附加检查，不作为 RPC-001 阻塞项。
