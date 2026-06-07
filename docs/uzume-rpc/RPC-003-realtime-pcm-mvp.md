# RPC-003：Realtime PCM MVP

## 状态

- Phase：3
- Gate：UZUME PCM MVP
- 前置 RPC：RPC-002

## 目标

让 UZUME 在受控开关下替代 legacy `DspChain` 的 PCM realtime path。此阶段是唯一被称为 `PCM MVP` 的 gate。

## 非目标

- 不要求 production-grade long FIR。
- 不要求 GPU offload。
- 不要求 D2P / SDM 正式可用。
- 不要求完整高级编辑 UI。

## 实施切片

### 1. Realtime Plan

`CompiledUzumePlan` 驱动 realtime path，不再由前端或 AudioSession 直接拼 processor chain。

必须保留：

- generation id
- flush / seek / pause / resume
- bypass transition
- latency report
- realtime telemetry ring

### 2. PCM Macro-Kernel Scope

Phase 3 scope：

- headroom / gain
- EQ
- stereo procedural primitives
- IIR crossfeed + delay + matrix-filter
- channel balance / trim / mono / swap / invert
- safety meter / safety limiter
- UZUME Poly-Sinc realtime SRC initial profiles

Crossfeed 不要求 FIR。Advanced matrix FIR 不进入 Phase 3。

### 3. Worker / Ring

音频 callback 只读 committed block。

```text
decoder / source queue
-> UZUME realtime worker
-> committed output ring
-> audio callback
```

callback 中禁止：

- CUDA launch
- FFT plan creation
- JSON
- file IO
- dynamic heavy allocation

### 4. Continuity

必须支持：

- gapless no-reset
- SRC phase continuity
- FIR / overlap history continuity if present
- next-track pre-roll
- different format dual-pipeline handoff
- random-access short bridge only for `user_random_seek_or_skip`

### 5. Telemetry

至少报告：

- active profile
- runtime backend
- callback ring depth
- latency
- realtime factor if available
- quality rollback
- short bridge state
- headroom recommendation
- safety meter state
- limiter gain reduction

RPC-003 是首个允许移除 RPC-001 skeleton 文案的 gate。只有在受控开关下真实 PCM realtime macro-kernel 生效、reference parity 通过、legacy fallback reason 清晰时，Signal Path / Professional Status 才能把 `UZUME skeleton`、`transitional-processor-chain`、`uzume-skeleton-compat` 改成正式 PCM runtime 文案。

## 验收

- 在开关下可替代 legacy `DspChain` 的 PCM processed path。
- CPU reference vs realtime output 通过误差门槛。
- Headroom-only、EQ-only、crossfeed-only、channel-only、SRC-only 均可作为独立 profile section 生效。
- bit-perfect bypass 不改变样本。
- Signal Path 不再显示 transitional processor chain；这条变更只能由 RPC-003 的真实 PCM MVP 完成，不能由 RPC-001 / RPC-002 的 skeleton 或 reference planner 提前改名。
- Phase 3 不依赖 CUDA。

## 必跑测试

```powershell
npm run test:audio-engine
npm run typecheck
npx vitest run src/main/audio/AudioCore.test.ts
```

新增 realtime tests 必须覆盖 callback ring、generation invalidation、gapless continuity 和 rollback reason。
