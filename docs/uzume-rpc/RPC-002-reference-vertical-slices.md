# RPC-002：CPU Reference Vertical Slices

## 状态

- Phase：2
- Gate：Reference Gate
- 前置 RPC：RPC-001

## 目标

建立可审计的 CPU reference 层。此阶段重点不是实时性能，而是固定算法语义、compiler assignment、telemetry 和测试 artifact。

## 非目标

- 不替换正式播放链路。
- 不要求 AVX2/GPU 性能。
- 不要求 production-grade partitioned FFT convolution。
- 不开放完整高级 UI。

## 实施切片

### 1. ProfileCompiler Reference

Profile compiler 输入 UI 参数，输出 compiled plan：

```text
CompiledUzumePlan
  formatPath
  orderedProfileSections
  engineAssignments
  mergeGroups
  splitReasons
  latencyOwners
  telemetrySchemaVersion
```

要求：

- UI section 只生成参数，不拥有 runtime processor。
- compatible sources 必须可合并；不能合并时必须写 split reason。
- plan 可以先只驱动 reference backend，不进入 realtime path。

### 2. FormatPath Reference

覆盖：

- `pcm_bitperfect`
- `pcm_processed`
- `dsd_direct`
- `dsd_upsampling`
- `d2p_processed`
- `sdm_processed`

D2P / SDM 可以报告 unavailable，但必须有准确 reason。

继承 RPC-001：

- 继续使用 `uzumeFormatPathPlan` 作为六条 path 的状态 / reason contract。
- RPC-002 必须把 RPC-001 skeleton 的 placeholder reason（例如 `source_is_pcm`、`sdm_engine_not_ready`）替换为 reference planner 可解释 reason，不能把 unavailable reason 当作实现完成。
- tests 必须覆盖六条 path 的 state / reason，而不是只检查当前 active path。

### 3. PCM Reference DSP

Reference 行为覆盖：

- headroom / materialized gain
- PEQ / basic IIR
- stereo procedural：trim、mute、solo、invert、swap、mono、L/R delay、matrix mix
- crossfeed 2x2 matrix-filter reference
- safety meter / limiter reference

### 4. Resampling Reference

实现 UZUME Poly-Sinc reference contract：

- ratio planner
- phase accumulator
- same-rate bypass
- linear / minimum / intermediate phase metadata
- group delay / lookahead report
- frequency response / alias rejection artifacts

此阶段不要求实时优化。

### 5. Shared Convolution Planner Reference

实现 planner，不必完成 production DSP：

- FIR EQ / headphone FIR / room IR merge simulation
- sample-rate family
- callback block vs internal FFT block distinction
- tail / drain / warm-up report
- split reason

## 验收

- 每个 compiled plan 都能生成 inspectable report。
- Reference output 有 deterministic test。
- Signal Path 能解释每个 UI section 被分配到哪个 engine。
- Headroom / Safety / Limiter telemetry 能分开显示。
- Resampling artifact 至少覆盖 impulse、sweep、near-Nyquist、phase/group-delay。
- `uzumeFormatPathPlan` 六条 path 的 reference reason 可被 snapshot / inspect report 稳定验证。

## 必跑测试

```powershell
npm run test:audio-engine
npm run typecheck
npx vitest run src/main/audio/AudioCore.test.ts
```

如果新增 artifact 生成脚本，应输出到稳定目录，并避免污染用户资料库。
