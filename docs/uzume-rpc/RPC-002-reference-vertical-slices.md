# RPC-002：CPU Reference Vertical Slices

## 状态

- Phase：2
- Gate：Reference Gate
- 前置 RPC：RPC-001

## 当前推进记录

- 2026-06-08：新增主进程纯函数 `UzumeReferencePlan`，先落地 RPC-002 的第一条 vertical slice：formatPath reference planner、compiler assignment inspect report、ResamplingProfile reference metadata、PCM float64 reference helper、deterministic artifact seed。
- `AudioSession` 现在会生成 `uzumeReferencePlan`，并用 reference planner 产出的六条 `uzumeFormatPathPlan` 替代 RPC-001 skeleton placeholder reason；`source_is_pcm`、`sdm_engine_not_ready` 这类占位 reason 已在主状态中替换为 `requires_dsd_source`、`d2p_requires_dsd_source`、`sdm_reference_engine_not_ready` 等可解释 reason。
- Professional Status 已显示 reference compiler schema/internal domain、active engine assignment、UZUME SRC reference report，供 Signal Path/状态排查使用；它仍是只读 inspect surface，不开放新控制。
- Professional Status 增加 jsdom visual-state 分析测试，读取 badges、signal nodes、detail rows 的 `data-tone`，锁定 RPC-002 reference UI 当前应呈现 warning/good 而不是 danger 的视觉语义状态；这不是截图基线。
- 2026-06-08：补 absent-plan visual-state guard：当 `uzumeReferencePlan` 缺失时，Professional Status 的 RPC-002 reference rows 必须保持 muted，Signal Path 不渲染 UZUME reference nodes，避免 skeleton / legacy 状态被误读为 compiled reference telemetry。
- 2026-06-08：补 Professional Status reference inspectability：assignment 行现在按 `orderedProfileSections` 展示 active/inactive、merge group、split reason 和 latency owner，新增 merge groups / latency owners detail row，并用 jsdom visual-state 测试锁定这些 row 的 warning 语义；这让 Signal Path/状态面板能解释每个 reference UI section 的 engine assignment，而不只显示前几个 active section。
- 2026-06-08：补底部 Signal Path popover 的 reference nodes：在 Roon-style 处理链中显示 `UZUME reference compiler`、`Reference assignment`、`Reference merge groups` 和 `Reference latency owners`，并用 `PlayerBar.test.tsx` 覆盖 format-path / PEQ / shared convolution / SRC 的 assignment、merge group、split reason 与 latency owner 文案；仍是只读状态面，不开放完整高级 UI。
- 2026-06-08：继续补底部 Signal Path reference telemetry：新增 `UZUME SRC reference` 与 `UZUME convolution reference` nodes，显示 SRC family/phase/apodizing/source-target/group-delay/lookahead/realtime safety/double-resampling risk、deterministic impulse+sweep+near-Nyquist+phase/group-delay artifact、alias metric，以及 Shared Convolution merged sources/sample-rate family/latency class/block/FFT/tail/drain；`PlayerBar.test.tsx` 覆盖这些只读状态文案。
- 2026-06-08：继续补 Headroom / Safety / Limiter 分离显示：Professional Status 新增独立 `UZUME safety meter` 与 `UZUME limiter reference` rows，并把 `UZUME headroom` row 扩展为 gain-reference telemetry；底部 Signal Path 新增 `UZUME headroom reference`、`UZUME safety meter`、`UZUME limiter reference` nodes。测试覆盖 near-limit safety meter 仍保持 limiter standby，不把 risk 误报成 limiter active。
- 2026-06-08：继续补 continuity/cache UI telemetry surface：`uzumeReferencePlan.continuity` 现在汇总 Continuity Strategy、Pre-Roll Deadline、CPU Callback Ring、Render-Ahead Cache 和 Fallback Injection 的 reference inspect report；底部 Signal Path 新增 continuity / pre-roll / callback ring / render-ahead cache / underrun fallback nodes，Professional Status 新增对应 rows，并用 `PlayerBar.test.tsx` 与 jsdom visual-state 测试锁定 callback read-committed-only、no GPU wait、short bridge rejection、cache miss/commit state 和 fallback tone。此项仍是只读 reference surface，不接入 audio callback 或 production render-ahead。
- 2026-06-08：继续补 Callback-Safe Urgent Controls / Equal-Power Crossfade inspect UI：compiled plan 现在携带 `uzumeReferencePlan.callbackSafeControls` 与 `uzumeReferencePlan.equalPowerCrossfade`，Signal Path / Professional Status 能显示 mute/declick urgent control、render-cache preserve、seek generation boundary invalidation、Random-Access Short Bridge -> full profile equal-power gain law、hard-switch residual 和 gapless-boundary rejection；这是只读 deterministic artifact telemetry，不接入 production callback urgent-control path 或 short-bridge crossfade runtime。
- 2026-06-08：补 expected Callback-Safe / Crossfade visual-state guard：mute/declick over committed output + seek generation boundary invalidate、random-seek equal-power crossfade accepted + gapless boundary rejected 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；这是 reference contract 已通过，不表示 production callback urgent-control path 或 short-bridge crossfade runtime 已接入。
- 2026-06-08：继续补 SRC rollback UI telemetry：底部 Signal Path 新增 `UZUME SRC rollback reference` node，Professional Status 新增对应 row，显示 Poly-Sinc primary profile、balanced/short rollback chain、`poly-sinc-reference-only` family lock、legacy fallback 只能显示 `UZUME bypass / legacy non-UZUME path`，并明确 Random-Access Short Bridge 不是 quality rollback；测试锁定 armed rollback 为 warning 但不 danger。此项仍是 reference telemetry，不启用 runtime profile 降级。
- 2026-06-08：继续补 reference bit-perfect inspect surface：底部 Signal Path 新增 `UZUME reference bit-perfect` node，Professional Status 新增对应 row，直接显示 compiled reference plan 的 `bitPerfectState`、`directDisabledReason`、source/output container、internal domain 与 format path；这与 runtime/native `UZUME bit-perfect` row 分开，避免把 reference planner 误报成正式播放状态。
- 2026-06-08：继续补 Backend Support Reference inspect UI：compiled plan 现在携带 `uzumeReferencePlan.backendSupport`，Signal Path / Professional Status 能显示 RPC-002 当前只选择 `cpu-float64-reference`、realtime backend 未启用、AVX2/GPU backend 延后到后续 gate、legacy DSP chain 不进入 UZUME compiler；这是只读 Reference Gate telemetry，不启用 runtime backend switch。
- 2026-06-08：继续补 Output Device Policy inspect UI：compiled plan 现在携带 `uzumeReferencePlan.outputDevicePolicy`，Signal Path / Professional Status 能显示 output mode、device capability、file/decoder/requested/actual/shared rate、bit-perfect candidate、resampling/mismatch、shared/system mixer risk 或 direct-like device-rate mismatch recommendation；这是只读 Reference Gate telemetry，不改变 output device / mixer policy。
- 2026-06-08：继续补 Latency Budget Reference inspect UI：compiled plan 现在携带 `uzumeReferencePlan.latencyBudget`，Signal Path / Professional Status 能把 backend、SRC group delay/lookahead、shared convolution latency/direct-head/warm-up/tail/drain、callback block、pre-roll、callback ring depth、render-ahead/cache budget 与 latency owners 汇总到一个 reference-only row/node；这是只读预算摘要，不启用 production scheduler、latency compensation 或 realtime backend。
- 2026-06-08：继续补 Readiness Contract Reference inspect UI：compiled plan 现在携带 `uzumeReferencePlan.readinessContract`，Signal Path / Professional Status 能显示 full-profile ready/not-ready、GPU prewarm gate、cache/commit state、render-ahead depth、deadline slack、callback ring status、short-bridge candidate、generation commit rule 与 production scheduler 状态；这是只读 readiness contract，不让 Renderer 控制 timeline，也不启用 production scheduler。
- 2026-06-08：补 direct-like output / readiness positive visual-state guard：当 output device policy 为 `direct-like-ready` 且 readiness contract 为 `ready-to-commit` 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning，并继续显示 `scheduler not-enabled`；这是 reference-only 状态，不改变 output policy 或 production scheduler。
- 2026-06-08：继续补 Generation Cache Key Reference inspect UI：compiled plan 现在携带 `uzumeReferencePlan.generationCacheKey`，Signal Path / Professional Status 能显示 generation id、timeline scope、request/cache key、profile/device fingerprint、album segment/index、invalidate/preserve 规则、stale commit rule 与 late callback slot rule；这是只读 cache-key contract，不启用 production cache writer。
- 2026-06-08：补 Latency Budget / Generation Cache Key ready visual-state guard：`latencyBudget.state: ready` 与 `generationCacheKey.state: ready` 在 Professional Status 标成 good，Signal Path 节点保持 process/non-warning，同时文案继续显示 `reference-only` 与 `renderer inspect-only`；这是 reference contract 已可审计，不表示 production scheduler、latency compensation 或 production cache writer 已启用。
- 2026-06-08：继续补 Realtime Budget Summary Reference inspect UI：compiled plan 现在携带 `uzumeReferencePlan.realtimeBudgetSummary`，Signal Path / Professional Status 能把 RPC-002 未实测 realtime factor、scalar float64 SRC 预算、callback ring depth、render-ahead coverage、CPU full-profile fallback、RPC-003 CPU realtime gate 与 RPC-005 GPU render-ahead gate 汇总到一个只读 row/node；jsdom visual-state 测试锁定 offline-reference-only 状态为 warning，且不宣称 production realtime backend 已启用。
- 2026-06-08：收紧 reference-only UI 标题：Realtime Budget Summary 与 Render-Ahead Cache 在 Signal Path / Professional Status 中都显式标为 `reference`，visual-state 测试同步锁定，避免误读为 production realtime backend、production scheduler 或 production cache writer 已启用。
- 2026-06-08：继续补 Artifact Manifest Reference inspect UI：Signal Path / Professional Status 现在显示 `UZUME artifact manifest reference`，按 deterministic / planned / not-applicable 分桶汇总 `artifactPlan`，并列出 source artifact 与 report artifact 清单；visual-state 测试锁定无 planned 项时为 good/process、存在 planned 项时为 warning，避免把 DSD not-applicable 或 reference-only artifact 误报成 RPC-002 阻塞。
- 2026-06-08：补 Artifact Manifest shared formatter helper 测试：`buildUzumeReferenceArtifactManifestSummary` 现在有 helper-level unit test 锁定 deterministic 38/38、planned 项 warning flag、not-applicable 非阻塞、null/undefined fallback，避免 Professional Status 与 Signal Path 的 manifest 文案/状态漂移。
- 2026-06-08：继续补 reference path plan Signal Path surface：底部 Signal Path 新增 `UZUME reference path plan` node，逐条显示 `pcm_bitperfect`、`pcm_processed`、`dsd_direct`、`dsd_upsampling`、`d2p_processed`、`sdm_processed` 的 state/reason，覆盖 direct disabled 与 unavailable path reason 的可视解释；仍是 compiled reference plan inspect，不改变正式播放状态。
- 2026-06-08：继续补 SRC realtime-budget/null-residual UI telemetry：底部 Signal Path 新增 `UZUME SRC budget reference` node，Professional Status 新增对应 row，显示 scalar float64 reference backend、estimated multiply-adds、realtime factor 是否未实测、safety class 和 same-rate null residual 状态；这是 deterministic artifact telemetry，不宣称 realtime SRC 已完成。
- 2026-06-08：补 same-rate bypass SRC budget visual-state guard：Professional Status 现在把 `same-rate-bypass-reference` realtime summary 与 `same-rate-bypass` SRC budget 标成 good，Signal Path popover 对应节点保持 process/non-warning，并显示 exact-bypass null residual；这是 reference-only good/process state，不表示 production realtime SRC backend 已启用。
- 2026-06-08：继续补 SRC artifact inspect UI：底部 Signal Path 新增 `UZUME SRC artifact reference` node，Professional Status 新增对应 row，显示 passband ripple、stopband attenuation、cutoff/transition estimate、phase group-delay spread、silence residual、multi-tone peak、seeded-random peak 和 deterministic random seed；这是 artifact telemetry，不表示 realtime SRC 已接入。
- 2026-06-08：继续补 SRC formal validation inspect UI：compiled reference plan 现在携带 `poly-sinc-formal-validation-reference` report，底部 Signal Path 新增 `UZUME SRC validation reference` node，Professional Status 新增对应 row，显示 overall 与 passband/stopband/transition/silence/same-rate-null/realtime-budget checks；这是 reference gate telemetry，不启用 runtime SRC gate。
- 2026-06-08：继续补 SRC output-risk inspect UI：底部 Signal Path 新增 `UZUME SRC output risk reference` node，Professional Status 新增对应 row，显示 `output-double-resampling-risk-reference` 的 state、reason、requested/actual/shared rate、current legacy resampler、Signal Path tone 和 recommendation；这是 reference telemetry，不改变 output device / mixer policy。
- 2026-06-08：继续补 SRC phase/apodizing inspect UI：底部 Signal Path 新增 `UZUME SRC phase/apodizing reference` node，Professional Status 新增对应 row，显示 linear/minimum/intermediate phase artifact 的 group-delay/spread/residual，以及 apodizing vs rectangular baseline 的 ringing reduction / response residual / no-high-frequency-restoration claim；这是 deterministic artifact telemetry，不表示 runtime SRC profile 已启用。
- 2026-06-08：继续补 Resampling Reference：新增离线 windowed-sinc float64 SRC、same-rate exact bypass、rational phase accumulator telemetry、filter contract、deterministic impulse/sweep/logarithmic-sweep/near-Nyquist/silence/phase-spread/alias-rejection metrics；Professional Status 的 UZUME SRC 行现在显示 taps、cutoff、alias artifact。
- 2026-06-08：新增 Shared Convolution Planner Reference：能模拟 FIR EQ / headphone FIR / room IR 合并，报告 sample-rate family、callback block vs internal FFT block、direct head、FFT tail ladder、tail/drain/warm-up、CPU/GPU plan id 和 split reason；新增离线 merged-response vs serial direct FIR null reference artifact，兼容来源 residual 为 0，不兼容来源返回 split/inactive；Professional Status 增加 UZUME convolution reference 行。
- 2026-06-08：补 Shared Convolution Response Preflight Reference artifact：IR/FIR import response 现在离线报告 peak、DC offset、NaN/Inf zeroing、channel mismatch 和 sanitized response，不让 shared convolution planner 静默吞掉坏 response；这是 import/preflight reference，不实现 production convolver。
- 2026-06-08：补 PCM Stereo Procedural / Crossfeed Reference helper：覆盖 trim、mute/solo、invert、swap、mono fold-down、L/R fractional delay、2x2 matrix mix、crossfeed matrix-filter、cross delay、low-pass/head-shadow 和 mono center preservation；当前仍是离线 deterministic reference，不开放 UI 控制。
- 2026-06-08：补 PCM Ingress Guard Reference artifact：显式覆盖 silence、NaN/Inf replacement、denormal zeroing 和 channel/frame mismatch preflight；mismatch 以 explainable artifact 返回，不让 runtime graph 静默吞掉。
- 2026-06-08：补 Gain Staging Reference artifact：固定 headroom -> ReplayGain -> materialized gain -> output 的顺序、cumulative gain telemetry、clip-risk 与 recommended extra headroom；说明这些 stage 可合并到 `gain-reference`，但 report 不能混淆来源。
- 2026-06-08：补 Headroom / Safety Metering / Limiter reference telemetry：PCM reference 现在按 stage 输出 sample peak/RMS/true-peak estimate/clip count/peak expansion，单独报告 recommended headroom 和 sample-domain safety limiter gain reduction；near-limit safety meter 不会被误报成 limiter active，sample-domain limiter 也不标成 true-peak/lookahead limiter。
- 2026-06-08：补 PCM After-Convolution Safety Stage Reference：PCM reference 增加离线 direct convolution response stage，Safety Metering 可把 peak expansion / stageOfMaxPeak / stageOfMaxTruePeak 归因到 `after-convolution`，并驱动 recommended headroom；这是 safety telemetry reference，不接入 production convolver。
- 2026-06-08：补 Resampling Preflight artifact metrics：deterministic artifacts 现在报告 passband ripple、cutoff estimate、transition width estimate、stopband attenuation、scalar float64 realtime budget estimate，以及 same-rate exact-bypass null residual。
- 2026-06-08：补 Gapless Concat Reference artifact：以 source PCM concat-before-SRC 为 reference policy，比较 no-reset continuity 与 reset-per-track SRC 的边界 residual，证明 gapless 边界不能重置 SRC state；non-integer SRC ratio 使用累计 source/output offset，避免分段四舍五入漂移；当前仍是离线 deterministic reference，不接入播放热路径。
- 2026-06-08：补 FIR Gapless History Reference artifact：以 source PCM concat-before-FIR + direct float64 FIR 为 truth，对比逐曲 no-reset history 与 reset-per-track，报告 tail/drain frames、boundary overlap history 和 reset residual；这是离线 reference，不是 production partitioned FFT convolver。
- 2026-06-08：补 Continuity Strategy Reference artifact：覆盖 Quality First、GPU Wait、Predictive Cache、Random-Access Short Bridge 的 policy decision，固定 gapless/normal boundary/cache miss 不启用 short bridge、随机 seek/skip 才可临时 short bridge、full profile ready 时不用 short bridge、stale generation 不可 commit，以及 callback 只读 committed output 的规则。
- 2026-06-08：补 Pre-Roll Deadline Reference artifact：数值化 next-track full-profile pre-roll window、callback ring read-committed-only 规则、render-ahead cache hit/warming/miss 状态、stale generation 拒绝和不同采样率/声道下一首的 dual-pipeline handoff；仍是离线 planner/report，不接入 callback。
- 2026-06-08：补 CPU Callback Ring Reference artifact：模拟 CPU full-profile producer 写入 committed ring、callback 只读 committed frames、ring depth / underrun risk telemetry、stale producer write rejection；CPU-only ring 不启用 Random-Access Short Bridge。
- 2026-06-08：补 Render-Ahead Cache Reference artifact：覆盖 generation-valid cache hit commit、late block 只能保留给未来 cache/boundary/crossfade、stale generation hit 拒绝、over-budget cache 按 stale / farthest-from-boundary evict，以及 callback 不等待 GPU 的读规则。
- 2026-06-08：补 Callback-Safe Urgent Controls Reference artifact：把 pause/stop/mute/volume/declick 归为 committed output 之后的 callback-safe 控制，输出 gain envelope / declick report；seek/flush/reset/profile/device change 归为 generation boundary，只生成 invalidate / rebuild report，不在 callback 中重渲染。
- 2026-06-08：补 Fallback Injection / Underrun Simulation Reference artifact：模拟 callback 不等待 GPU、GPU late block 只保留未来使用、CPU full-profile fallback 接管、全部输出缺失时 controlled silence + underrun telemetry；underrun protection 不启用 Random-Access Short Bridge。
- 2026-06-08：补 Equal-Power Crossfade Reference artifact：只允许 `user-random-seek-or-skip` 从 Random-Access Short Bridge 过渡到 full profile，测量 equal-power gain law、hard-switch residual、peak，并在 full profile 未 ready 或非随机 seek/skip intent 时拒绝渲染。
- 2026-06-08：补 Per-Ear EQ Placement Reference artifact：分别渲染 pre-crossfeed EQ 与 post-crossfeed EQ，输出 placement residual 和 `do-not-reorder-across-crossfeed-without-null-proof` compiler rule，固定 crossfeed 前后 per-ear EQ 不可静默重排。
- 2026-06-08：补 Poly-Sinc Formal Validation artifact：对 deterministic resampling artifacts 做 passband ripple、stopband attenuation、transition width、same-rate null residual 和 scalar float64 realtime budget 阈值化 validation report；same-rate bypass 的 stopband/transition 标记为 not-applicable，不误报失败。
- 2026-06-08：补 High-Precision Response Resample Reference artifact：FIR / IR / target response 跨 sample-rate family 时走 windowed-sinc float64 reference，输出与 linear interpolation baseline 的 residual，并标记 linear interpolation rejected；same-rate response 仍 exact bypass。
- 2026-06-08：继续补 response resample inspect UI：Shared Convolution reference report 现在携带 `high-precision-response-resample-policy-reference`，Signal Path 新增 `UZUME response resample reference` node，Professional Status 新增对应 row，显示 FIR/IR response source/target rate family、same-rate exact bypass 或 windowed-sinc float64 reference、linear interpolation rejected 和 filter contract；这是 policy/reference surface，不接入 production convolver。
- 2026-06-08：补 SRC phase/apodizing/output-risk/rollback reference artifacts：deterministic artifacts 现覆盖 multi-tone 与 seeded random stimulus；phase mode artifact 对 linear / minimum / intermediate 输出可测 group-delay / residual 差异；apodizing artifact 只声明 ringing/response target 改变且不伪装成高频修复；output double-resampling risk 与 quality rollback 进入 formal report，rollback chain 锁定 `poly-sinc-reference` 家族，legacy fallback 只能显示 `UZUME bypass / legacy non-UZUME path`。
- 2026-06-08：补 DSD Family Path / Control Reference artifact：固定 DSD direct bitstream-only、DSD upsampling SDM-only disabled-controls、D2P decimation/internal PCM rate report、SDM modulator/overload/ultrasonic telemetry 与 PCM dither / SDM noise-shaping 分离；这是路径与控制策略 reference，不实现 D2P decimator 或 SDM runtime。
- 2026-06-08：继续补 DSD Family inspect UI：compiled reference plan 现在可携带 `dsd-family-path-control-reference` report，Signal Path 新增 `UZUME DSD family reference` node，Professional Status 新增对应 row，显示 Direct / DSD upsampling / D2P / SDM 的 state、direct-disabled reason、allowed/disabled controls、D2P decimation/internal PCM rate、SDM telemetry 与 fallback reason；这是只读 reference surface，不实现 D2P/SDM runtime。
- 2026-06-08：补 D2P / SDM unavailable fallback reason：D2P reference engine 未就绪时不进入 PCM DSP、不开放 PCM-domain controls，并报告 `d2p_reference_engine_not_ready`；DSD upsampling / SDM processed 在 SDM reference engine 未就绪时标记 unavailable / experimental、禁用 SDM controls，并报告 `sdm_reference_engine_not_ready`。
- 2026-06-08：补 DSD Direct Positive Bypass Reference：native/DoP direct path 在只请求 Safety Metering 时保持 `direct`，不进入 PCM DSP / SRC / limiter / dither，不开放 PCM dither 或 SDM telemetry；这是正向 bypass reference，不实现正式 DSD packetizer。
- 2026-06-08：补 DSD direct positive bypass visual-state guard：Professional Status / Signal Path 现在把 `dsd_direct:direct` 的 `UZUME DSD family reference` 标成 good，显示 direct allowed、only safety-metering allowed、PCM DSP/dither blocked、DoP output encoding 与 bypass reason；这是 reference-only 正向 bypass 状态，不表示正式 DSD packetizer 已启用。
- 2026-06-08：补 SRC Latency Telemetry Reference：Poly-Sinc reference report 同时输出 group delay / lookahead 的 samples 与 milliseconds，Professional Status 的 UZUME SRC row 也显示 ms 读数；这是离线 telemetry/report，不接入 realtime SRC。
- 2026-06-08：补 SRC Silence Preservation Reference artifact：Poly-Sinc deterministic artifact 现在包含 silence stimulus / response、`silenceResidual` 和 formal validation check，证明 sample-rate conversion 不向静音输入引入残留；这是离线 artifact，不接入 realtime SRC。
- 2026-06-08：补 SRC Logarithmic Sweep Reference artifact：Poly-Sinc deterministic artifact 现在单独包含 logarithmic sweep stimulus / response 和 `logSweepPeak` metric，区别于普通 sweep；这是离线 artifact，不接入 realtime SRC。
- 2026-06-08：补 PCM Output Quantization / Dither Reference artifact：固定 bit-perfect path 不进入 dither、float PCM output bypass、fixed-point PCM deterministic TPDF / noise-shaped quantization telemetry，以及 SDM/DSD 输出拒绝 PCM dither 并转交 SDM noise-shaping telemetry；这是离线 reference，不启用播放链路 dither。
- 2026-06-08：继续补 PCM Output Quantization / Dither inspect UI：compiled plan 现在携带 `uzumeReferencePlan.pcmOutputQuantization`，把 output sample format、bit-perfect/dither state、deterministic seed、LSB、residual、clip count、SDM noise-shaping separation 和 reasons 暴露给 Signal Path / Professional Status；这是只读 reference telemetry，不接入 production dither 或 output writer。
- 2026-06-08：继续补 PCM Ingress Guard / Gain Staging inspect UI：compiled plan 现在携带 `uzumeReferencePlan.pcmIngressGuard` 和 `uzumeReferencePlan.gainStaging`，Signal Path / Professional Status 能显示 expected/channel/frame/rectangular/sanitizer counts、peak、gain stage 顺序、cumulative gain、clip risk、recommended extra headroom 和 reasons；这是只读 Reference Gate telemetry，不接入 production ingress sanitizer 或 gain processor。
- 2026-06-08：继续补 Block Boundary / Flush-Drain inspect UI：compiled plan 现在携带 `uzumeReferencePlan.blockBoundary` 和 `uzumeReferencePlan.flushDrain`，Signal Path / Professional Status 能显示 block size、coverage、padding-not-committed、boundary residual、natural EOF drain commit、manual flush tail drop、generation increment/reset 和 reasons；这是只读 Reference Gate telemetry，不接入 callback block scheduler 或 transport flush/drain runtime。
- 2026-06-08：补 expected Flush / Drain visual-state guard：natural EOF drain commit + manual flush tail drop/reset 且 residual 为 0 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；这是 reference contract 已通过，不表示 production transport drain runtime 已接入。
- 2026-06-08：继续补 Gapless SRC / FIR Gapless History inspect UI：compiled plan 现在携带 `uzumeReferencePlan.gaplessConcat` 和 `uzumeReferencePlan.firGaplessHistory`，Signal Path / Professional Status 能显示 source PCM concat-before-SRC/FIR policy、no-reset residual、reset-per-track residual、boundary offset、FIR overlap history、tail/drain 和 reasons；这是只读 deterministic artifact telemetry，不接入 production gapless callback 或 production FIR runtime。
- 2026-06-08：补 expected Gapless visual-state guard：source PCM concat-before-SRC/FIR 的 no-reset/history residual 为 0，reset-per-track 对照 residual 非 0 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；这是 reference contract 已通过，不表示 production gapless callback 或 production FIR runtime 已接入。
- 2026-06-08：继续补 PEQ/IIR / Channel Scope / Stereo Procedural inspect UI：compiled plan 现在携带 `uzumeReferencePlan.iirEq`、`uzumeReferencePlan.channelScope` 和 `uzumeReferencePlan.stereoProcedural`，Signal Path / Professional Status 能显示 biquad band/order/response/residual、target-channel scope/no-op/invalid-source decisions、stereo procedural trim/delay/routing/matrix/crossfeed-disabled state 和 visual tone；这是只读 Reference Gate telemetry，不接入 production PEQ、channel router 或 crossfeed runtime。
- 2026-06-08：继续补 Per-Ear EQ Placement inspect UI：compiled plan 现在携带 `uzumeReferencePlan.perEarEqPlacement`，Signal Path / Professional Status 能显示 pre-crossfeed EQ / crossfeed matrix-filter / post-crossfeed EQ order contract、placement residual、compiler rule `do-not-reorder-across-crossfeed-without-null-proof` 和 reasons；这是只读 Reference Gate telemetry，不接入 production crossfeed/per-ear EQ runtime。
- 2026-06-08：补 PCM Bit-Perfect Bypass Reference artifact：`pcm_bitperfect` 在 planner direct 条件满足时走 `identity-bypass`，输出 clone 与输入零 residual，禁用 requested sample-changing sections；planner 已给 direct-disabled reason、`pcm_processed` 或 `dsd_direct` 时均拒绝 bit-perfect/null claim；这是离线 reference，不接入播放热路径。
- 2026-06-08：补 PCM bit-perfect positive bypass visual-state guard：Professional Status 把 `bitPerfectState: available` 的 `UZUME reference bit-perfect` 标成 good，Signal Path 对应节点保持 process/non-warning，并显示 direct path available、pcm->pcm、pcm-bypass 与 `pcm_bitperfect`；这是 reference-only identity-bypass 状态，不表示 production output bridge 已改变。
- 2026-06-08：补 PEQ / basic IIR Reference artifact：按 UI band 顺序生成 biquad cascade coefficients、frequency response magnitude/phase 和 processed-vs-bypass residual；disabled band 与 neutral-gain PEQ 走 exact bypass；这是离线 reference，不接入播放热路径。
- 2026-06-08：补 Channel Scope Reference artifact：按 `all` / explicit channels / stereo pair scope 解析目标声道，离线验证 scoped gain/mute/invert/mix-from 只作用于 target channels，out-of-scope channels 保持 exact bypass；invalid scope / source 生成 explainable no-op report；这是离线 reference，不接入播放热路径。
- 2026-06-08：补 Block Boundary Split Reference artifact：按 callback block size 切分 source PCM，验证每个 source frame 只 commit 一次、final block padding 不进入输出、reassembled output 与 source 零 residual，且 block boundary 不引入额外 discontinuity；这是离线 reference，不接入 callback。
- 2026-06-08：补 Flush / Drain Reference artifact：natural EOF commit FIR drain tail 且不递增 generation；manual flush / seek / profile-change 丢弃 pending tail、递增 generation 并要求 render-state reset；这是离线 reference，不接入 callback。
- 2026-06-08：补 Shared Convolution Duplicate Plan Guard / Serial Null Reference inspect UI：compiled plan 现在携带 duplicate convolver/FFT guard 与 serial-null reference report，Signal Path / Professional Status 能显示共享 plan、split reason、per-source duplicate rejection、merged-vs-serial residual 或 split/inactive skip reason；这是 planner/reference，不实现 production convolver 或 production serial-null gate。
- 2026-06-08：补 Shared Convolution serial-null merged visual-state guard：当 reference report 为 `merged-matches-serial` 且 residual 为 0 时，Professional Status 标成 good，Signal Path serial-null node 标成 good；split/inactive skip 仍保持 non-danger muted。这是 reference visual-state guard，不实现 production convolver 或 production serial-null gate。
- RPC-002 的 Shared Convolution 范围固定为 planner/reference surface：merge/split reason、sample-rate family、callback/internal block、direct head、FFT tail ladder、tail/drain/warm-up、offline serial/null artifact 与 inspect report。production-grade Shared Convolution DSP、partitioned FFT runtime 和 production serial/null gate 由 RPC-004 `Convolution Production Gate` 承接，不作为 RPC-002 阻塞项。

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
- Signal Path / Professional Status 能只读显示 reference bit-perfect state 与 direct-disabled reason，且不覆盖 runtime/native bit-perfect 状态。
- Backend support telemetry 能解释 RPC-002 reference backend、AVX2/GPU 后续 gate、legacy fallback 不能进入 UZUME compiler，且不得暗示 runtime backend switch 已启用。
- Output device policy telemetry 能解释 output mode、device capability、actual device rate、shared/system mixer risk 和 direct-like rate mismatch，且不得暗示 output policy 已改变。
- Latency budget telemetry 能把 backend、SRC latency/lookahead、shared convolution latency/direct-head/warm-up/tail/drain、callback block、pre-roll、callback ring、render-ahead/cache depth 与 latency owners 汇总展示，且不得暗示 production scheduler、latency compensation 或 realtime backend 已启用。
- Readiness contract telemetry 能解释 full-profile readiness、GPU prewarm gate、cache hit/miss/commit state、render-ahead depth、deadline risk、Random-Access Short Bridge candidate、generation commit rule 和 main playback policy boundary，且不得暗示 production scheduler 已启用或 Renderer 可控制 timeline。
- Generation/cache-key telemetry 能解释 generation id、profile/device fingerprint、timeline scope、album segment/index keying、invalidation/preserve rules、stale commit rejection 与 late-current-generation retain-for-future rule，且不得暗示 production cache writer 已启用。
- Realtime budget summary telemetry 能解释 RPC-002 未实测 realtime factor、scalar float64 reference budget、callback ring/render-ahead margin、CPU full-profile fallback 以及 RPC-003/RPC-005 后续 gate，且不得暗示 production realtime backend、production scheduler 或 GPU render-ahead worker 已启用。
- Artifact manifest telemetry 能解释 compiled `artifactPlan` 中 deterministic、planned 与 not-applicable 项，并把 source artifact / report artifact 清单暴露给 Signal Path 与 Professional Status；planned 项必须显示 warning，not-applicable 不得自动视为缺口。
- Signal Path 能逐条解释六个 reference formatPath 的 state/reason，而不是只显示当前 active path。
- Headroom / Safety / Limiter telemetry 能分开显示。
- Continuity / pre-roll / callback ring / render-ahead cache / fallback reference telemetry 能在 Signal Path 与 Professional Status 中只读解释，且不得暗示 production callback/render-ahead 已完成。
- Callback-safe urgent controls / equal-power crossfade telemetry 能解释 committed output 后的 mute/declick/volume 控制、seek/flush/reset generation boundary、render-cache preserve/invalidate、Random-Access Short Bridge crossfade gain law 与非随机边界 rejection，且不得暗示 production callback urgent controls / short-bridge crossfade runtime 已启用。
- SRC rollback telemetry 能解释 Poly-Sinc-only rollback chain、legacy fallback boundary 和 Random-Access Short Bridge 非 rollback 的边界。
- SRC budget telemetry 能解释 scalar reference 预算、realtime factor 是否实测、safety class 和 same-rate null residual。
- SRC formal validation telemetry 能解释 passband、stopband、transition、silence、same-rate null 和 scalar budget checks，且不得暗示 runtime SRC gate 已启用。
- SRC output-risk telemetry 能解释 legacy resampler / shared mixer / device-rate mismatch 的 state、rate、current resampler 和 recommendation，且不得暗示 output policy 已改变。
- SRC phase/apodizing telemetry 能解释 linear/minimum/intermediate phase artifact、apodizing response artifact 和 no-high-frequency-restoration claim，且不得暗示 runtime SRC profile 已启用。
- DSD family telemetry 能解释 Direct / DSD upsampling / D2P / SDM 的 state、direct-disabled reason、allowed/disabled controls、fallback reason，以及 D2P/SDM reference-only 边界。
- PCM output quantization / dither telemetry 能解释 bit-perfect bypass、float PCM bypass、fixed-point PCM deterministic dither/quantization、SDM/DSD 拒绝 PCM dither 与 residual/clip count，且不得暗示 production output writer / dither gate 已启用。
- PCM ingress guard / gain staging telemetry 能解释 sanitizer/preflight counts、channel/frame mismatch、headroom -> ReplayGain -> materialized gain 顺序、cumulative gain、clip risk 和 recommended headroom，且不得暗示 production ingress/gain processor 已启用。
- Block boundary / flush-drain telemetry 能解释 exact frame coverage、padding not committed、boundary discontinuity residual、natural EOF drain commit、manual flush tail drop、generation increment 和 reset requirement，且不得暗示 production callback scheduler / transport drain 已启用。
- Gapless SRC / FIR gapless telemetry 能解释 source PCM concat-before-SRC/FIR truth、no-reset continuity residual、reset-per-track residual、boundary offset、FIR overlap history、tail/drain frames 和 reason，且不得暗示 production gapless callback / production FIR runtime 已启用。
- Per-Ear EQ placement telemetry 能解释 pre/post-crossfeed EQ order、placement residual 与 no-reorder rule，且不得暗示 production crossfeed/per-ear EQ runtime 已启用。
- Shared Convolution duplicate guard / serial-null telemetry 能解释 compatible sources 共享 single convolution plan、duplicate convolver/FFT rejection、explicit split reason 与 merged-vs-serial null residual，且不得暗示 production convolver / production serial-null gate 已启用。
- Resampling artifact 至少覆盖 impulse、sweep、near-Nyquist、phase/group-delay。
- `uzumeFormatPathPlan` 六条 path 的 reference reason 可被 snapshot / inspect report 稳定验证。

## 必跑测试

```powershell
npx vitest run src/main/audio/UzumeReferencePlan.test.ts
npm run test:audio-engine
npm run typecheck
npx vitest run src/main/audio/AudioCore.test.ts
npx vitest run src/renderer/components/player/uzumeReferenceArtifactManifest.test.ts src/renderer/components/player/AudioProfessionalStatusPanel.test.tsx src/renderer/components/player/PlayerBar.test.tsx
```

如果新增 artifact 生成脚本，应输出到稳定目录，并避免污染用户资料库。
