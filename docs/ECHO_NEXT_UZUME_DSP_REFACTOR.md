# ECHO NEXT UZUME DSP 重构方案

生成时间：2026-06-07
仓库状态：`uzume-dspchain-replacement` PR 准备分支；RPC-001 skeleton 收口后的 RPC-002 reference UI / test / 文档推进均在本分支继续追踪。`origin` 是 upstream `Moekotori/ECHO`，`fork` 是 `DnucleusZ/ECHO`；`npm run sync:fork-base` 负责保持 `fork/main` 与 `origin/main` 只通过 fast-forward 同步，遇到 fork main 分叉必须先停下确认。当前远端备份是 fork 上的 `fork/uzume-dspchain-replacement`，上游 PR 尚未创建；PR 前以 `git status --short --branch`、`git rev-list --left-right --count origin/main...fork/main`、`git rev-list --left-right --count origin/main...HEAD` 与 `git log --oneline origin/main..HEAD` 确认 fork base 同步、feature 未落后 upstream main、提交序列可审。
文档位置：当前仓库没有 `doc` 目录，既有工程文档位于 `docs`，因此本文按现有约定放入 `docs`。

`UZUME` 是 ECHO NEXT 的下一代数字处理核心层。它不是把现有 EQ、FFmpeg/SOXR SRC、IR 卷积简单改名，也不是在现有 `DspChain` 旁边外挂一串小 DSP 模块。它的目标是直接替代现有 DSP 层，把 ECHO 的原生高质量 Poly-Sinc SRC、长 FIR、卷积预处理接口、PCM 输出位深保护、未来 SDM/DSD 生成，以及 CPU/GPU offload 融合到一个可审计、可回退、可解释的大 kernel 系统里。

一句话：**UZUME 是 ECHO 的播放器级高保真 fused DSP / SRC / offload engine，必须有 CPU 与 GPU 两套等价大 kernel，同时不能破坏曲库和基础播放链路。**

## 依据

本文是自包含的 UZUME 重构方案，不要求读者跳转到父目录报告才能理解设计边界。外部分析报告只作为背景材料；真正需要执行的原则、前后端责任、telemetry 和验收门槛都应直接写在本文。

本文参考当前源码边界：

- `src/main/audio/AudioSession.ts`
  - 当前 `echoSrcMode` 默认 `off`。
  - Echo SRC 在 sample-rate plan 层决定，只对 ASIO / exclusive 等 direct-like 输出尝试。
  - `dspActive` 同时包含 EQ、room correction、channel balance、ReplayGain、automix/gapless 和 Echo SRC。
- `src/main/audio/DecoderPipeline.ts`
  - 当前 SRC 通过 FFmpeg `aresample=resampler=soxr` 注入。
  - 三档为 `precision=28`、`20`、`16`。
  - SOXR 不可用或失败时已有 fallback 到 FFmpeg default resampler 的路径。
- `native/audio-engine/DspChain.cpp`
  - 当前 native DSP 链是 same-rate block processor。
  - 顺序为 `Headroom -> EQ -> Convolution -> Channel Balance -> Safety Limiter`。
  - `isActive()` 只看 EQ、Convolution、Channel Balance。
- `native/audio-engine/ConvolutionProcessor.cpp`
  - 当前 IR 卷积是直接时域卷积，最多 8192 taps。
  - IR 只读 WAV，最多 2ch，重采样用线性插值。
- `native/audio-host/src/main.cpp`
  - 当前 PR 过渡实现为 PCM FIFO / automix 渲染后调用 `uzumeEngine.processBlock()`，再做 declick ramp。
  - RPC-001 已移除 `DspChain -> UzumeEngine` wrapper route；`DspChain.h/.cpp` 不再 include、持有或转发 `UzumeEngine`。
  - 当前 host/output 仍是 skeleton / transitional compatibility execution，不是最终 fused macro-kernel 边界；后续正式目标仍是 host / output bridge 在 `UzumeEngine` 与独立 `LegacyDspChain` backend 之间二选一。
  - 音频 callback 必须保持轻量、可预测。
- `src/renderer/pages/DspPage.tsx`
  - 当前 UI 已由 UZUME 工作台替代旧 DSP 面板，但 RPC-001 阶段所有未真正实现的 UZUME 子模块均显示 `未实现`，不提供假开关。
  - 旧 Headroom / EQ / FIR / Matrix / Safety / ECHO-SOXR 等状态只作为 legacy / compat readout，不冒充 UZUME kernel 能力。
- `src/renderer/components/player/AudioSignalPathPopover.tsx`、`AudioProfessionalStatusPanel.tsx`
  - Signal Path / Professional Status 已显示 `UZUME skeleton`、`transitional-processor-chain` / `identity-bypass`、`uzume-skeleton-compat`、format path 和 disabled reason。
  - UZUME 前端应沿这个方向强化，而不是只做一个算法开关页；在 RPC-003 以前不得把 skeleton 文案改成正式 `UZUME processed`。

这些证据决定了 UZUME 不应硬塞进现有 `DspChain` 当作普通后置效果器，也不应被拆成一串小 DSP processor 逐个拼接。SRC、长 FIR、GPU offload 和未来 SDM 都会改变处理域、延迟、缓冲和输出格式，UZUME 应在 Audio Core 的 sample-rate plan / native worker / output bridge 边界替代现有 DSP 层，并通过 fused macro-kernel 降低模块串联开销。

## 目标

UZUME 的目标从高到低：

1. 保持 ECHO 默认播放稳定，默认不改变 bit-perfect 策略。
2. 直接替代现有 native DSP 层，以 fused macro-kernel 作为实时执行单位。
3. 保留独立 legacy same-rate DSP chain 作为非 UZUME 回退 / 对照 backend，而不是让 legacy chain 包住 UZUME 或进入 UZUME compiler。
4. 建立 CPU/GPU 两套并行等价 kernel，同一 profile、同一参数、同一可验证输出。
5. 建立以 CPU AVX2 为主链、GPU 为可选 render-ahead/offload/cache 的连续播放模型。
6. 支持 playlist pre-roll、gapless no-reset、输出 ring buffer、质量优先随机切歌策略和 generation-safe cache。
7. 以 compile-time shared engine 复用为硬原则，把 FIR EQ、耳机响应矫正、房间 IR、SRC 长 FIR 等参数归并到共享 convolution / resampling / matrix / meter engine。
8. CPU kernel 从高性能数学库和 AVX2 起步，预留 AVX512 FFT 路线。
9. GPU kernel 使用 cuFFT 作为第一可落地后端，同时允许后续自研更快 kernel。
10. kernel 层必须包含完整 offload 能力，不把 GPU 当成只能手动调用的孤立函数。
11. UZUME 正式 SRC 不引入 SOXR adapter；quality rollback 也应回退到 UZUME Poly-Sinc 家族内的较低复杂度 profile。
12. `ConvolutionProcessor` 不作为 UZUME 正式实现依赖，只保留 IR import / preflight / legacy fallback 接口。
13. SRC、长 FIR、卷积预处理、dither/noise shaping、SDM/DSD 生成都进入可编译 profile。
14. 不影响 ECHO 核心资料库、扫描、metadata、封面和基础播放功能。
15. Signal Path 必须能解释：输入、内部处理域、算法、CPU/GPU backend、延迟、实时倍速、queue/cache 深度、shared engine merge、quality rollback、random-access short bridge 和 bit-perfect 状态。

## 非目标

UZUME 第一阶段不做这些事：

- 不把 ECHO 改成 DAW。
- 不引入 VST 插件宿主。
- 不做测量麦克风、目标曲线生成、Dirac/Sonarworks 式完整校正闭环。
- 不做 AI 高频修复、DSEE-like、BWE、去噪、去混响或自动 remaster。
- 不默认开启升频或 DSD 转换。
- 不把 UZUME 拆成小 DSP 模块链来换取表面灵活性。
- 不把 GPU 失败变成播放失败。
- 不让 Renderer 参与音频热路径。
- 不让曲库扫描、封面提取、网络元数据和下载任务抢占 UZUME 实时线程。
- 不把“零等待切歌”作为默认目标。极长 sinc-L / 长 FIR 的默认策略应是 Quality First，可接受受控等待；短滤波 fallback 只能用于用户主动随机切歌 / 随机 seek，不能用于冷启动、正常 playlist 边界、gapless 或普通 cache miss。

## 总体架构

UZUME 分成六层，但实时执行层不是模块链，而是 profile 编译出的 fused macro-kernel：

```text
Renderer DSP / Audio Status UI
  -> Typed preload / IPC
  -> AudioSession sample-rate plan
  -> UZUME planner
       profile, device, rate, latency, backend selection
  -> UZUME runtime
       CPU fused macro-kernel backend
       GPU fused macro-kernel backend
       offload scheduler
       telemetry
  -> Native output bridge
       FIFO / worker ring / callback-safe pull
  -> output device
```

关键原则：

- `AudioSession` 仍然是播放事实来源。
- UZUME planner 决定是否进入 UZUME，不由 UI 猜。
- UZUME runtime 负责把当前 profile 编译成 CPU/GPU fused macro-kernel、异步 offload、缓冲和 telemetry。
- native audio callback 只拉取已经准备好的 PCM/SDM block，不在 callback 里做 FFT、GPU kernel launch、JSON、文件 IO 或动态大分配。
- legacy DSP chain 必须独立成 `LegacyDspChain` / legacy backend，与 UZUME 并列，由 AudioSession / output bridge 选择；UZUME runtime 不调用、不包裹、不复用 legacy processor 链。
- UZUME 正式 SRC 直接实现原生 Poly-Sinc 家族，不收编 SOXR，也不把 SOXR 作为 UZUME profile 的 adapter / fallback。SOXR 只保留为当前 legacy DecoderPipeline 事实或非 UZUME rollback 路径。

## 与现有链路的关系

当前链路可以理解为：

```text
file / stream
  -> AudioSession plan
  -> DecoderPipeline / FFmpeg
  -> optional SOXR aresample
  -> PCM FIFO
  -> native audio host
  -> DspChain same-rate DSP
  -> output device
```

UZUME 目标链路：

```text
file / stream
  -> AudioSession plan
  -> DecoderPipeline / resident decoder
  -> UZUME input queue
  -> UZUME profile compiler
       resolve SRC / gain / FIR / channel / limiter / dither / future SDM
       compile one fused macro-kernel plan
  -> UZUME fused macro-kernel
       CPU backend or GPU backend
  -> UZUME output queue
  -> native audio host
  -> output device
```

独立 legacy DSP chain 的目标边界是：

```text
AudioSession / output bridge
  -> choose processing backend by profile / policy
       UZUME backend
         -> UZUME input queue
         -> UZUME profile compiler
         -> UZUME fused macro-kernel
       LegacyDspChain backend
         -> Headroom
         -> EqProcessor
         -> ConvolutionProcessor
         -> ChannelBalanceProcessor
         -> Safety Limiter
  -> output device
```

`LegacyDspChain` 是独立 same-rate compatibility backend，只用于回退、对照测试和旧功能保底。它不能承载 UZUME 新功能，不能进入 UZUME profile compiler，也不能让 UZUME runtime 在内部调用 legacy processor 链。若播放退回 legacy，Signal Path 必须显示 `UZUME bypass / legacy DSP chain`；若 legacy 还走旧 DecoderPipeline resampler，则进一步显示 `legacy decoder resampler`。

迁移策略不是把 UZUME 放到 `DspChain` 后面，也不是把 EQ、卷积、声道、limiter 拆成许多小 processor 重新串起来。更稳的做法是：

1. 先定义 UZUME profile schema，把现有 Headroom、EQ、Channel Balance、Limiter、SRC、IR pre 接口统一成一个可编译 profile。
2. 在 UZUME CPU reference 中实现整条 fused sample path，证明它能替代现有 `DspChain` 的功能面。
3. 拆出 / 保留独立 `LegacyDspChain` backend，直到 UZUME CPU/GPU 等价、meter、latency compensation、fallback 全部通过；它是并列 backend，不是 `UzumeEngine` wrapper。
4. `ConvolutionProcessor` 不进入 UZUME 正式实现；只保留 IR import / validation / legacy compatibility 的 pre 接口。
5. UZUME SRC 直接走原生 Poly-Sinc 家族；SOXR 不进入 UZUME compile profile，只能作为旧链路/非 UZUME rollback 的历史兼容。

## 实时连续流执行模型

UZUME 的第一体验目标不是“某个 kernel 峰值跑分最高”，而是播放器听感连续、边界无感、质量可信。实时播放主链必须先由 CPU 保底，GPU 只能作为可选提前计算 / offload / cache 后端，不能成为 audio callback 的实时依赖；但这不等于默认牺牲滤波质量来追求零等待。

推荐把播放列表视为一条连续 audio timeline，而不是一首歌结束后再启动下一首：

```text
AudioSession playlist intent
  -> continuity planner
       current track
       next track pre-roll
       generation id
       gapless boundary policy
  -> decoder thread
       current PCM
       next-track PCM predecode
  -> UZUME input queue
       source-rate PCM blocks
  -> UZUME realtime worker
       CPU main chain
       optional GPU render-ahead/offload
  -> committed output ring / render-ahead cache
  -> native audio callback
       read-only pull
  -> WASAPI / ASIO exclusive
```

核心规则：

- audio callback 只读已经 commit 的输出 block，不做 CUDA、FFT、文件 IO、JSON、动态大分配或长锁等待。
- CPU AVX2 fused path 是硬实时保底主链。正常情况下它应执行当前选定 full-quality profile；短滤波只允许在主播放逻辑明确标记 `user_random_seek_or_skip` 且用户策略允许 `Random-Access Short Bridge` 时启用。冷启动、正常 playlist 边界、gapless、GPU 预热、cache miss 和 underrun 保护都不能用短滤波替代 full profile。
- GPU worker 只处理已经可提前知道的工作：当前 track 后续 block、下一首 pre-roll、gapless 专辑连续段、极长 FIR / SRC 的 render-ahead cache。
- 所有 block 和 cache 都带 playback generation id。seek、随机切歌、profile 变化、设备变化时，旧 generation 的 GPU 结果不能回写新播放 intent。
- `prepare()` 阶段创建 FFT plan、filter FFT、CUDA stream/event、device memory、pinned host staging、CPU scratch；`process()` 和 callback 路径不做 heavy init。
- 输出缓存应区分 urgent control 和 rendered audio。pause、stop、mute、主音量、declick 这类即时控制必须在 callback-safe 层可立即生效；改变 SRC/FIR/EQ/profile 时则 invalidate 或重建 render-ahead cache。
- 质量策略由主播放逻辑决定。UZUME 不能擅自把 full profile 降级成短滤波，也不能为了赶 deadline 静默丢弃仍可能用于未来边界的高质量结果。

### 责任边界：主播放逻辑 vs UZUME

主播放逻辑负责“播放什么、什么时候播放、用户愿意接受什么取舍”。UZUME 处理侧负责“怎样处理、需要多少准备、现在是否 ready”。两者边界必须固定，避免把播放队列决策藏进 DSP kernel。

主播放逻辑 / `AudioSession` / output bridge 负责：

- 管理 playlist、queue、当前曲、下一曲、用户 seek / skip / stop / pause intent。
- 判断 gapless / non-gapless 曲目边界，决定是否把下一首纳入连续 timeline。
- 根据 UZUME latency / lookahead / pre-roll requirement 提前启动 N+1 decode / prepare。
- 维护 playback generation id，并在 seek、切歌、profile、device、output mode 变化时递增 generation。
- 选择播放质量策略：Quality First、GPU Wait、Predictive Cache；只有 `user_random_seek_or_skip` 才能进入 Random-Access Short Bridge。
- 在 full profile 尚未 ready 时决定体验行为：冷启动 / 正常下一首 / gapless / cache miss 应等待 GPU 或 CPU full profile ready、显示 preparing、使用已命中的 predictive cache，不能启用短滤波。
- 根据用户的质量和听音环境噪声偏好，在尚未开始 callback 或尚未到达曲目边界时，优先等待 GPU full profile prewarm / render-ahead ready，而不是急切切到 CPU/短滤波。
- 当 profile 声明 `gpu_preferred_for_acoustic_noise` 时，冷启动和 playlist 边界应允许受控等待 GPU ready。CPU full-quality path 仍必须存在，用于无 GPU、GPU 失败、播放已经开始后的硬实时保底和 CPU/GPU 验证；但它不是“能等 GPU 时就抢先播放”的默认路径。
- 处理不同采样率 / channel layout / device rate 的 pipeline handoff、设备重开、输出 format plan。
- 保证 native audio callback 有可读的 committed block；callback 不等待 decoder、UZUME worker 或 GPU。
- 把 UZUME telemetry 转成 Signal Path / Professional Status，而不是让 Renderer 直接控制 kernel 热路径。

UZUME 处理侧负责：

- 根据 profile 编译 CPU/GPU fused macro-kernel，并报告 latency、lookahead、group delay、pre-roll requirement、backend support。
- 接收主播放逻辑送入的 source-rate PCM / processed PCM blocks，按 generation id 处理和提交结果。
- 维护 SRC phase、FIR history、overlap-save history、future SDM feedback state，并在主播放逻辑标记 gapless no-reset 时跨曲目保持状态。
- 在主播放逻辑标记 seek / reset / profile change 时清理或重建状态，拒绝 stale generation commit。
- 管理 CPU realtime worker、GPU render-ahead worker、FFT plan、CUDA memory、pinned host buffer、events、scratch 和 cache。
- 提供 readiness：full profile ready、GPU prewarm ready、cache hit/miss、render-ahead depth、deadline risk、random-access short bridge candidate 是否可用。
- 只在主播放逻辑请求 `user_random_seek_or_skip` short bridge 时提供短滤波处理结果，不自行决定启用它。
- 提供 crossfade-ready 的 full profile 对齐点和建议增益曲线参数，但是否 crossfade 由主播放逻辑按用户策略决定。

边界原则：

```text
主播放逻辑决定 timeline / policy / handoff。
UZUME 决定 kernel / state / readiness / processed output。
audio callback 只读取已经 commit 的输出。
```

实施分工：

```text
主播放逻辑必须改：
  playlist continuity planner
  N+1 decode / prepare pre-roll
  cold-start / boundary GPU wait policy
  user_random_seek_or_skip 标记
  generation id lifecycle
  dual-pipeline handoff
  callback ring ownership
  Signal Path policy display

UZUME 处理侧必须改：
  full-quality CPU/GPU profile readiness
  latency / lookahead / pre-roll requirement report
  GPU prewarm / render-ahead state
  source-rate gapless no-reset state
  generation-safe process / commit
  random-access short bridge candidate only
  quality rollback report
  CPU/GPU reference equivalence artifacts
```

任何需要知道“下一首是什么、用户刚才是不是随机切歌、是否愿意等 GPU、是否要重开设备”的判断，都属于主播放逻辑。任何需要知道“滤波器状态、kernel 是否 ready、GPU block 是否 generation-valid、full profile 输出是否可提交”的判断，都属于 UZUME 处理侧。

推荐内部缓冲分两层：

```text
callback ring
  小而确定
  只放已经 commit 的输出 block
  满足 WASAPI/ASIO callback 安全读取

render-ahead cache
  5-30 秒目标窗口
  存放已经升频 / 卷积 / 安全处理后的 PCM 或未来 SDM block
  支持当前 track tail、next track head、N+1 / N+2 预渲染
```

这样既能让 CUDA / 长 FIR 永远提前算，又不把用户交互变成 30 秒延迟。实时听感依赖 callback ring 的稳定读取；高阶算法的稳定性依赖 render-ahead cache 的提前填充。

### Playlist Pre-Roll

当前 track 剩余时间进入预热窗口时，AudioSession 应提前启动下一首 decode / UZUME prepare：

```text
preRollSeconds =
  clamp(pipelineDelaySeconds + outputBufferMarginSeconds + decoderWarmupSeconds,
        2,
        15)
```

极长 sinc / FFT hybrid profile 可以突破 15 秒，改用 N+1 / N+2 render-ahead cache，但 UI 必须显示 cache 状态和实时风险。

常规连续播放目标：

```text
Track N 正在播放
  -> Track N+1 提前 decode 到 source-rate PCM
  -> N+1 PCM 进入同一个 continuity planner
  -> CPU 主链或 GPU worker 提前产出 N+1 开头输出 block
  -> output ring / cache 在边界前已 commit
  -> callback 到边界直接继续读取
```

如果下一首 sample rate / channel layout / profile 与当前一致，并且是 gapless boundary，应优先在 source-rate PCM 层面拼成连续流，再做 SRC / FIR。这样 SRC 和 FIR state 自然跨曲目边界连续，不需要 flush、reset 或重新 warm-up。

如果下一首 format 或 profile 不同，不能假装它是同一个滤波状态。正确做法是提前准备第二套 pipeline，在边界处切换已经预热好的输出，并用 Signal Path 标明发生了 pipeline handoff；必要时只做极短 declick，而不是让 callback 等新 pipeline 初始化。

### Gapless FIR / SRC State

gapless 专辑的理想语义是“先拼 PCM，再处理”，尤其适用于线性相位长 FIR / sinc-L：

```text
Track A decoded PCM
Track B decoded PCM
  -> concatenate at original PCM rate
  -> one continuous SRC / FIR state
  -> split UI track index only affects position display
```

这要求 UZUME runtime 把“曲目边界”和“滤波状态边界”分开：

- gapless boundary 不 reset FIR history、SRC phase accumulator、overlap-save history、SDM feedback state。
- non-gapless boundary 可以 drain / reset，并按用户设置插入 gap、crossfade 或 silence。
- seek、手动切歌、profile 改变必须 reset 或 rebuild state，并递增 generation id。
- cue / album 连续预渲染时，cache key 应使用 album segment + index，而不是只用单曲文件路径。

gapless 验收不能只听感判断。应有离线测试：把两首 source PCM 先 concat 后跑 UZUME，与逐首播放但 gapless no-reset 路径做 null / residual 对比。

### 随机切歌和极长滤波器

严格 sinc-L 或超长线性相位 FIR 需要未来样本。用户突然点下一首时，不可能既零等待又从第一个样本开始严格使用完整 lookahead。UZUME 应支持三种策略，但默认应偏质量优先：

```text
Quality First
  等待完整 lookahead / cache ready
  音质严格
  冷启动、正常 playlist 边界、gapless 边界都走这个策略
  允许 1 秒到数秒启动延迟或边界 preparing 状态

Predictive Cache
  根据 playlist / queue 预渲染 N+1 / N+2
  命中时直接进入正式 profile
  未命中时回到 Quality First 的受控等待

Random-Access Short Bridge
  只允许用户主动随机切歌 / 随机 seek 时启用
  0 ms 起声
  先用短 poly-sinc / 4096-16384 tap CPU profile
  后台准备完整 sinc-L / long FIR
  ready 后 200-500 ms equal-power crossfade 到正式 profile
```

默认推荐 `Quality First + Predictive Cache`。这样 playlist 连续播放、冷启动和 gapless 专辑优先保证完整 profile；如果 GPU full profile 需要预热，就等待 GPU ready，而不是用短滤波糊过去。`Random-Access Short Bridge` 的合法触发条件只有 `user_random_seek_or_skip`，不能用于冷启动、正常下一首、gapless 边界、GPU 预热、普通 cache miss 或后台 decode late。启用时 Signal Path 必须诚实显示开头短时间处于 short bridge，并显示 crossfade 到正式 profile 的状态。

### CPU 主链与可选 GPU 链

CPU 主链：

```text
decoder thread
  -> input PCM queue
  -> CPU UZUME fused realtime worker
       AVX2 baseline
       optional AVX512 / library FFT
       selected quality profile
       optional random-access short bridge candidate
  -> committed output ring
audio callback
  -> read committed output
  -> callback-safe urgent controls
  -> device
```

GPU 可选链：

```text
continuity planner
  -> render job queue
       current tail
       next-track head
       album gapless segment
       N+1 / N+2 speculative cache
  -> CUDA worker
       pinned host buffer
       cudaMemcpyAsync
       cuFFT / custom kernel
       CUDA event
       D2H async
  -> commit completed block with generation id
  -> output ring or render-ahead cache
```

GPU 结果只有在完整、generation 匹配且仍适用于目标 timeline 时才 commit。晚于当前 callback slot 的结果不能追写已经播放的位置，但只要仍然 generation-valid，就应保留为后续边界、render-ahead cache 或 crossfade 候选；只有过期、被 seek/profile/device 变化淘汰，或超过 cache 预算时才 retire。GPU offload 的成功标准不是“调用过 CUDA kernel”，而是它能在不阻塞 callback 的前提下，稳定提高 render-ahead depth、降低 CPU 压力，并把 ready / not-ready / deadline risk 诚实交给主播放逻辑做质量优先决策。

## 处理域

UZUME 必须明确区分处理域：

```text
PCM bit-perfect path
  不进入 UZUME，或只旁路统计，不改变样本。

PCM processed path
  PCM -> UZUME fused DSP/SRC kernel -> PCM output。

DSD direct path
  DSD native / DoP 直通，不允许 EQ、IR、limiter、ReplayGain 等改变内容的 DSP。

DSD-to-PCM processed path
  DSD decode -> multibit PCM internal -> UZUME PCM DSP -> PCM output。

DSD-to-SDM processed path
  PCM/DSD -> multibit high-rate internal -> SDM modulator -> DSD output。
```

如果 UZUME 的 SDM engine 尚未完成，UI 和 status 必须诚实显示：启用 DSP 的 DSD 源会退出 DSD direct，进入 DSD-to-PCM processed path。

## PCM / DSD / DSD Upsampling / D2P / SDM 前后端覆盖

`D2P` 在本文中固定指 `DSD-to-PCM processed path`。前端可以把它显示为“DSD 转 PCM 处理”，但 telemetry / profile schema 应保留 `d2p` 这个稳定枚举，便于后端、测试和日志统一。

`dsd_upsampling` 固定指 DSD source 到更高 DSD rate 的 SDM-only path。它不是完整 DSP processed path；只开放 SDM modulator、headroom、Safety Metering / overload guard。EQ、FIR、crossfeed、ReplayGain、PCM SRC 用户档位、PCM dither 都必须禁用。

四条路径的责任边界：

| Path | 前端显示 / 控制 | 后端执行 owner | DSP 允许范围 | 输出 |
| --- | --- | --- | --- | --- |
| `pcm_bitperfect` | `PCM Bit-Perfect / Lossless`，显示 DSP bypass、设备实际采样率、bit-perfect 条件 | AudioSession format plan + output bridge | 不进入 UZUME 改样本；只允许旁路统计 | PCM direct output |
| `pcm_processed` | `PCM Processed by UZUME`，显示 Headroom、EQ、Crossfeed、FIR、SRC、Safety、Dither | UZUME PCM fused macro-kernel | PCM-domain DSP、SRC、FIR、limiter、PCM dither/noise shaping | PCM output |
| `dsd_direct` | `DSD Direct / Native / DoP`，DSP 控件禁用并显示原因 | DSD packetizer + output bridge | 不允许 EQ、ReplayGain、IR、limiter、SRC、PCM dither | Native DSD / DoP output |
| `dsd_upsampling` | `DSD Upsampling / SDM Only`，显示 source DSD rate、target DSD rate、modulator、headroom/safety、overload risk | DSD ingress + UZUME SDM modulator + output bridge | 只允许 headroom、Safety Metering / overload guard、SDM modulator；不开放 PCM-domain DSP | Native DSD / DoP output |
| `d2p_processed` | `DSD -> PCM Processed`，显示 decimation、internal PCM rate、DSD direct disabled reason | DSD decode / low-pass / decimation + UZUME PCM chain | DSD 转 multibit PCM 后进入 PCM-domain DSP；输出前可用 PCM dither | PCM output |
| `sdm_processed` | `PCM/DSD -> SDM / DSD Processed`，显示 modulator、target DSD rate、overload/noise/realtime risk | UZUME SDM engine + output bridge | PCM-domain preprocessing + SDM modulator；不用 PCM dither，使用 SDM noise shaping / overload guard | Native DSD / DoP output |

前端责任：

- 以 `formatPath` 作为顶层模式显示，而不是只显示一个“DSP on/off”。
- 在每个 path 上显示 `bitPerfectState`、`directDisabledReason`、`outputContainer`、`deviceCapability` 和 `actualDeviceRate`。
- 当用户打开会改变 DSD 内容的功能时，必须从 `dsd_direct` 显式切换到 `dsd_upsampling`、`d2p_processed` 或 `sdm_processed`，并解释原因。
- `dsd_upsampling` 下除 headroom、Safety Metering / overload guard、SDM modulator 外，所有 PCM-domain DSP 控件必须 disabled，并显示 `requires d2p_processed or sdm_processed`。
- `sdm_processed` 未完成时不暴露为可选正式路径；只能显示为 disabled / experimental / unavailable。
- PCM 控件可以保留同一组用户心智，但在 `dsd_direct` 和 `dsd_upsampling` 下必须禁用，在 `d2p_processed` 下显示“作用于 DSD 解码后的 multibit PCM”，在 `sdm_processed` 下显示“作用于 SDM 调制前的 multibit internal”。

后端责任：

- AudioSession / output format plan 决定 `formatPath`，并把结果交给 UZUME compiler；Renderer 不直接拼 runtime graph。
- UZUME compiler 根据 path 选择 PCM macro-kernel、D2P ingress、DSD upsampling SDM-only plan、SDM macro-kernel 或 bypass。
- DSD direct 不进入 UZUME PCM Resampling Engine、Convolution Engine、Limiter 或 Dither Engine。
- DSD upsampling 可做必要的 DSD ingress / rate preparation，但这些属于 SDM modulator 的内部 rate plan，不作为用户可选 PCM SRC section 暴露。
- D2P 必须有明确的 low-pass / decimation profile、internal PCM rate、headroom policy 和 PCM output quantization policy。
- SDM 必须有明确的 modulator profile、target DSD rate、overload guard、ultrasonic noise telemetry、fallback path 和 realtime safety class。
- audio callback 对四条路径都只读 committed output block；PCM path 读 PCM block，DSD/SDM path 读已经封装好的 DSD/DoP 或 native DSD block。

## Kernel 双后端原则

UZUME 的每一个核心算法都必须有两套 backend：

```text
UZUME fused profile spec
  -> CPU fused macro-kernel backend
  -> GPU fused macro-kernel backend
```

两套 backend 必须满足：

- 相同输入 layout。
- 相同参数 schema。
- 相同 block 边界语义。
- 相同 flush / seek / reset / drain 行为。
- 相同 latency report。
- 相同 clipping / overload / telemetry 语义。
- 可做 offline reference 对比。
- 实时模式允许浮点误差，但误差门槛必须写入测试。

不允许出现这种结构：

```text
CPU: 完整 fused DSP path
GPU: 只有某个内部函数的实验加速
```

GPU backend 可以分阶段覆盖，但只要 UI 暴露为 UZUME GPU，就必须覆盖完整可 offload profile，至少包括数据搬运、计划、执行、同步、错误回退和 telemetry。

## Fused Macro-Kernel 原则

UZUME 的核心执行单位是 fused macro-kernel。Profile 可以为了配置、UI 和测试而分层描述，但 runtime 不应按小 DSP 模块逐个调用。

更进一步，UZUME 不应让每个 UI 模块各自拥有一套相似 DSP 实现。UI 模块只是参数来源；compile 阶段必须把这些参数归并到少数共享 engine，再由 engine 生成 CPU/GPU fused execution plan。

推荐逻辑：

```text
profile description
  Headroom / gain
  EQ coefficients
  SRC filter
  FIR / IR pre interface
  channel tools
  safety / limiter
  dither / noise shaping
  future SDM

compile
  -> collect module parameters
  -> classify by math primitive / domain / latency
  -> merge compatible operations
  -> allocate shared engine plan / state / scratch
  -> CPU fused macro-kernel
  -> GPU fused macro-kernel
```

执行时应尽量融合：

- gain、headroom、ReplayGain materialized gain。
- EQ biquad bank 或未来 FIR EQ。
- channel gain / balance / invert / mono。
- limiter pre-meter / final safety stage。
- SRC 与 FIR 的缓冲计划。
- dither/noise shaping 的输出写回。

不应这样做：

```text
block -> GainProcessor -> EqProcessor -> SrcProcessor -> FirProcessor -> ChannelProcessor -> LimiterProcessor -> DitherProcessor
```

这样会增加函数边界、buffer 读写、cache miss、同步点和 GPU/CPU 往返开销。UZUME 应把这些阶段编译成一个少边界的大处理核；只有在算法上必须分块的地方，例如 long-tail FFT、GPU async queue、SDM feedback state，才允许形成受控子 kernel。

也不应这样做：

```text
FIR EQ module
  -> one partitioned FFT convolver
Headphone correction module
  -> another partitioned FFT convolver
Room IR module
  -> another partitioned FFT convolver
```

正确做法是在 compile 阶段把它们变成一个共享 convolution plan：

```text
FIR EQ target
Headphone response correction target
Room / FIR IR target
Optional SRC/FIR tail dependency
  -> shared convolution engine
       response merge
       partition plan
       latency/state ownership
       CPU FFT / GPU cuFFT plan
  -> one fused convolution section
```

允许的内部切分：

- head direct section 与 tail FFT section。
- CPU/GPU async offload section。
- SDM feedback loop section。
- meter / reduction section。
- quality rollback adapter section。

这些切分是 macro-kernel 内部实现细节，不是对外模块化 DSP 图。

## Compile-Time Shared Engine 原则

UZUME 的模块复用发生在 compile 阶段，而不是 runtime 阶段。所谓“模块”只描述用户意图和参数；真正执行的是共享 engine。

```text
UI / profile section
  EQ
  headphone correction
  stereo procedural equalizer
  crossfeed
  room / FIR import
  SRC
  channel tools
  limiter / meter
  dither / noise shaping
  future SDM

compile
  -> shared engine registry
        precision / normalization engine
        convolution engine
        resampling engine
        biquad / IIR engine
        gain-matrix engine
        delay / fractional-delay engine
        stereo matrix-filter engine
        safety-metering engine
        limiter engine
        dither / noise-shaping engine
       future SDM engine
  -> fused execution plan
```

共享 engine 的职责：

- 接收多个 profile section 的参数。
- 识别数学上可合并的操作。
- 拒绝会破坏语义或延迟约束的合并。
- 统一计算 latency、lookahead、warm-up、flush、drain、seek reset 和 gapless no-reset 行为。
- 统一分配 CPU/GPU scratch、FFT plan、filter FFT、CUDA buffers、pinned host staging 和 telemetry。
- 将 Headroom、Safety Metering、Limiter 分成三个语义：主动留余量、证明余量是否足够、最后兜底保护。
- 输出一个可审计的 compiled plan，让 Signal Path 能解释哪些 UI section 被合并到哪个 engine。

禁止的 runtime 形态：

```text
profile section owns DSP processor
processor owns buffers
processor owns latency
processor owns GPU plan
block passes through processors one by one
```

推荐的 runtime 形态：

```text
profile sections are parameters
compiler owns merge decision
shared engines own state and latency
macro-kernel owns execution order
callback reads committed output only
```

Signal Path 应该显示用户理解的 section，但状态细节要说明 compile 结果：

```text
UI:
  EQ: enabled
  Headphone Correction: enabled
  FIR / Room: enabled

Compiled:
  Convolution Engine:
    sources: fir-eq, headphone-response, room-ir
    partitioning: head-direct + fft-tail
    backend: gpu-cufft render-ahead
    latency: 68 ms
```

这能同时满足两个目标：用户仍按熟悉模块理解声音处理；runtime 不重复做相似的 FFT、buffer pass、latency compensation 和 GPU sync。

## Stereo Procedural Equalizer / Crossfeed

从抽象功能看，现有 `Channel Balance` 不应继续被理解为一个单独小工具。它应升级为面向双声道 / 耳机听音的 `Stereo Procedural Equalizer` profile section，并把旧功能作为其中的基础原语：

```text
old channel balance intent
  L/R balance
  per-channel trim
  invert
  swap
  mono / solo
  L/R delay
  simple low/mid/high compensation

new stereo procedural intent
  channel scope / channel targeting
  ordered procedural steps
  per-channel volume / trim / mute / solo
  per-channel delay / distance / fractional delay
  phase invert / polarity
  swap / route / stereo matrix mix
  per-channel or linked PEQ
  generic IIR / biquad cascade
  optional FIR / target response section
  headphone listening crossfeed
```

目标不是照搬 Roon 的 UI，而是达到 Roon Procedural Equalizer 的功能级别：用户可以定义一组有顺序的处理步骤，指定步骤作用于哪些 channel，并表达 matrix mixing、PEQ/IIR、mute、volume、delay、mix、invert phase 这些抽象操作。Crossfeed 作为耳机听音功能，还要能表达左右互馈、滤波、延迟和输出补偿。

ECHO / UZUME 应把这些能力收敛成一个 `StereoProceduralProfile`，而不是拆成 `ChannelBalanceProcessor + CrossfeedProcessor + PerEarEqProcessor` 的 runtime 串联：

```text
StereoProceduralProfile
  enabled
  scope:
    stereo-pair
    channel map
    headphone / speaker intent

  calibration:
    left trim
    right trim
    left delay
    right delay
    invert left / right
    swap
    mono / solo / mute

  proceduralEq:
    linked L/R PEQ
    independent L/R PEQ
    generic IIR filters
    optional FIR / target response
    pre-crossfeed or post-crossfeed placement

  matrix:
    2x2 mix
    center preservation policy
    mono compatibility policy
    output gain normalization

  crossfeed:
    enabled
    preset family
    amount
    cross gain
    cross delay
    low-pass / head-shadow filter
    bass / center compensation
    wet/dry or matrix strength
    output trim
```

功能责任划分：

| 抽象功能 | 用户心智 | Compile 后归属 |
| --- | --- | --- |
| Balance / trim / mute / solo | 声像、左右响度、快速校准 | gain / matrix engine |
| Invert / swap / mono | 接线、相位、声道检查 | gain / matrix engine |
| L/R delay / distance | 声像居中、左右路径差 | delay / fractional-delay engine |
| Per-ear PEQ | 左右耳、耳机、输出校正 | IIR engine；只有用户选择 FIR target / linear-phase 时才进入 convolution |
| Generic IIR | 更自由的滤波器原语 | IIR engine |
| FIR / target response | 线性相位或任意响应 | Shared Convolution Engine |
| Matrix mix | Roon Procedural EQ 级 matrix mixing | stereo matrix-filter engine |
| Crossfeed | 耳机扬声器化、硬左右录音修正 | stereo matrix-filter engine；Phase 3 scope 采用 IIR + delay，不要求 FIR |

Crossfeed 的数学模型应被视为 2x2 matrix filter，而不是普通后置效果：

```text
Lout = H_LL(z) * Lin + H_RL(z) * Rin
Rout = H_LR(z) * Lin + H_RR(z) * Rin
```

其中：

- `H_LL` / `H_RR` 表达直通信号、per-ear EQ、trim 和必要的补偿。
- `H_RL` / `H_LR` 表达对侧声道的 crossfeed，包含 cross gain、delay、low-pass / head-shadow filter。
- 耳机 crossfeed 的 Phase 3 scope 采用 IIR / delay / matrix-filter，不要求 FIR crossfeed，也不要求 matrix FIR。
- 只有当用户导入 HRTF、2x2 FIR、串扰抵消、扬声器虚拟化或其他明确 matrix response 时，才进入 Shared Convolution Engine 的 advanced matrix FIR path。
- 如果同时存在 FIR EQ、耳机 FIR 校正、room IR 或 advanced matrix FIR，compile 阶段必须尝试合并或解释 split reason。

顺序语义必须明确。默认建议：

```text
Headroom
  -> source/global EQ
  -> stereo procedural pre-matrix EQ
  -> crossfeed matrix filter
  -> stereo procedural post-matrix / per-ear calibration
  -> output gain / route matrix
  -> limiter / meter
```

但 profile 需要允许 `placement` 表达用户意图：

- `preCrossfeed`：用于修录音或输入声道问题，例如录音左声道过亮。
- `postCrossfeed`：用于修耳机、左右耳或输出链路，例如右耳需要更高频补偿。
- `global`：用于所有声道共同 tone shaping。

Compiler 可以合并可交换的 gain / EQ / matrix 操作，但不能错误重排不可交换操作。特别是 crossfeed matrix 前后的 per-ear EQ 语义不同，不能为了减少一次处理 pass 而无解释调换。Signal Path 必须显示：

```text
Stereo Procedural EQ:
  steps: trim, delay, per-ear PEQ, matrix mix, crossfeed
  order: source EQ -> crossfeed -> per-ear calibration
  compiled engines:
    gain-matrix
    fractional-delay
    iir matrix-filter
    shared convolution only for imported FIR / advanced matrix FIR
  latency:
    delay samples
    filter group delay
  headroom:
    required trim / clipping risk
```

这样 ECHO 可以达到 Roon Procedural Equalizer + Crossfeed 的功能级别，同时仍保持 UZUME 的核心哲学：profile section 表达意图，compile 阶段归并数学原语，runtime 执行 fused macro-kernel。

## Shared Convolution Engine

Convolution engine 是 UZUME 共享 engine 哲学的第一重点。它不应只是 `Room Correction` 的实现，也不应只是 FIR EQ 的实现，而应是所有 FIR / frequency-response 类处理的统一执行引擎。

它也不能停留在 8192 taps demo 级 IR convolver。8192 taps direct convolution 只能作为 legacy / diagnostic / tiny-IR fallback。UZUME 正式路径必须是高精度、高性能、按采样率族管理的 partitioned FFT convolution engine，并显式管理 latency、block size、partition plan 和 tail state。

正式 engine 的最低定位：

```text
Shared Convolution Engine
  sample-rate-family aware
  high-precision response merge
  high-performance partitioned FFT convolution
  explicit latency owner
  explicit block-size / FFT-size planner
  explicit tail / drain / reset state
  CPU library FFT + AVX path
  GPU cuFFT render-ahead path
```

采样率族必须作为 plan key，而不是每个文件临时猜：

```text
44.1k family:
  44100, 88200, 176400, 352800, 705600, 1411200

48k family:
  48000, 96000, 192000, 384000, 768000, 1536000

device / custom family:
  only when output device or profile requires it
```

每个 family 至少要有独立的：

- response resample / synthesis policy。
- partition-size ladder。
- FFT plan cache。
- filter FFT cache。
- latency class。
- block-size compatibility table。
- CPU/GPU backend support matrix。
- render-ahead safety class。

不允许把 44.1k 系列的 FIR 直接临时线性插值到 48k 系列后进入正式路径；IR / FIR / target response 的 resample 必须使用 UZUME SRC 或等价高质量 resampler，并记录到 Signal Path。

可能进入 convolution engine 的参数来源：

```text
FIR EQ
  linear-phase EQ
  arbitrary target response
  FIR graphic EQ

Headphone correction
  headphone measurement compensation
  target curve

Room / FIR import
  user IR
  room correction IR
  speaker correction IR

Advanced matrix response import
  HRTF / 2x2 FIR import
  crosstalk cancellation FIR
  speaker virtualization FIR

SRC / long filter dependency
  sinc-L tail
  apodizing FIR section
  FFT hybrid resampling tail

Safety / analysis side data
  convolved gain estimate
  headroom recommendation
  true-peak / clipping risk preflight
```

这些参数不应该各自拥有一个 runtime convolver。Compile 阶段应把它们归一化到同一个 response model：

```text
profile sections
  -> response import / synthesis
       FIR EQ response
       headphone correction response
       room IR response
       optional SRC/FIR response
  -> response alignment
       sample-rate family
       exact sample rate
       channel layout
       minimum / linear phase policy
       latency target
       gain normalization
  -> response merge
       time-domain convolution where needed
       frequency-domain multiply where possible
       per-channel FIR routing
       advanced matrix FIR routing only when imported / explicitly requested
  -> partition planner
       direct head
       block size
       hop size
       FFT size
       uniform / non-uniform FFT partitions
       tail length / tail duration
       CPU FFT or GPU cuFFT
       render-ahead cache policy
       latency class
  -> one convolution section in fused macro-kernel
```

Convolution engine 的 Phase 4 production scope 至少需要覆盖：

- mono / stereo / multichannel FIR。
- per-channel FIR。
- stereo pair FIR。
- head-direct + FFT-tail hybrid，并显式报告 direct head latency。
- uniform partitioned convolution。
- non-uniform partitioned convolution，为低延迟头部和超长尾部服务。
- overlap-save / overlap-add 策略选择。
- CPU reference / CPU AVX2 / CPU library FFT / GPU cuFFT backend。
- GPU render-ahead 和 CPU full-quality backup。
- gapless no-reset history。
- seek / reset / profile change generation invalidation。
- latency、lookahead、warm-up、block size、FFT size、drain 和 tail report。

Advanced matrix FIR 不进入 Phase 4 必需项，只作为明确导入或未来功能：

- 2x2 HRTF / headphone matrix FIR。
- crosstalk cancellation。
- speaker virtualization。
- future speaker correction。

Partition plan 必须显式建模：

```text
ConvolutionPartitionPlan
  sampleRateFamily
  exactSampleRate
  channelLayout
  latencyClass
  inputBlockFrames
  outputBlockFrames
  directHeadTaps
  fftHeadSize
  fftTailSizes[]
  partitionHopSizes[]
  partitionCount
  tailFrames
  tailSeconds
  warmupFrames
  drainFrames
  cpuPlanId
  gpuPlanId
```

推荐 latency class：

```text
Realtime Low:
  short direct head
  small first FFT partition
  lower tail cache depth
  for CPU fallback and interactive control

Quality First:
  larger partitions allowed
  higher efficiency
  waits for full profile at cold start / track boundary

Render-Ahead Extreme:
  very long FIR / sinc-L / advanced matrix FIR
  GPU preferred when waitable
  output consumed from render-ahead cache
```

block size 不是任意 callback block 的影子参数。Convolution engine 必须允许 output callback block 与 internal FFT block 不同，并用 committed output ring 做适配。Callback 不应该反过来决定 FFT size；FFT size 应由 sample-rate family、latency class、tail length、backend 和 cache budget 共同决定。

Convolution engine 的 compile-time 合并规则：

- FIR EQ、耳机频响校正、房间 IR 如果 sample rate、channel layout、phase policy 和 latency policy 兼容，应合并成同一个 FIR plan。
- 线性相位 FIR EQ 可以与耳机校正、房间 IR 做频域响应相乘，不应单独跑一个 FIR EQ convolver。
- 普通 PEQ / tone EQ 默认属于 IIR / biquad engine，不进入 convolution engine；只有用户选择 FIR EQ、linear-phase EQ 或 arbitrary FIR target 时才进入。
- 耳机校正可以是 IIR 或 FIR。IIR 耳机校正进入 biquad engine；FIR 耳机校正进入 convolution engine。
- 如果某个 SRC profile 的长滤波 tail 与 FIR correction 可在同一输出 rate / phase policy 下合并，compiler 可以把相关响应合并或共享 FFT plan；如果合并会破坏 SRC 多相结构、相位语义或 latency，必须保持为同一 engine 内的受控子 section，而不是变成多个外部 processor。
- 不同 channel routing 的 FIR 不强行合并成错误的 per-channel FIR；advanced matrix FIR 只有在导入或明确请求时才显式建模。
- 会改变 loudness / headroom 的合并必须生成 headroom recommendation 和 clipping risk telemetry。

Convolution engine 的状态必须归 engine 所有，而不是归 UI section 所有：

```text
ConvolutionEngineState
  generation id
  sample rate / channel layout
  partition plan
  direct head history
  fft overlap history
  per-channel / matrix routing state
  CPU scratch
  GPU scratch
  filter FFT cache
  render-ahead cache key
  latency report
```

Signal Path 应能解释“用户模块”和“共享 engine”的关系：

```text
Signal Path sections:
  FIR EQ: enabled
  Headphone Correction: HD650 target
  Room FIR: studio-small.wav

Compiled engine:
  Shared Convolution Engine
    merged sources: fir-eq + headphone-response + room-ir
    mode: stereo / per-channel FIR
    partitions: direct head + non-uniform FFT tail
    backend: gpu-cufft render-ahead
    CPU backup: avx2/library-fft full-quality
    latency: 68 ms
```

这样做的结果是：ECHO 可以拥有庞大且功能齐全的卷积能力，但用户不会听到三个相似卷积器串联造成的额外延迟、额外 rounding、额外 buffer pass 和额外 GPU 同步。

## Kernel ABI

建议定义 C++17 原生 ABI，先不让 JS/Renderer 直接碰 kernel：

```cpp
struct UzumeAudioFormat {
    int sampleRate;
    int channels;
    UzumeSampleFormat sampleFormat; // f32, f64, s32, dsd1
    UzumeChannelLayout channelLayout;
};

struct UzumeBlock {
    float* const* channels;
    int channelCount;
    int frameCount;
    uint64_t streamFrameStart;
};

struct UzumeKernelLatency {
    int inputDelayFrames;
    int outputDelayFrames;
    int lookaheadFrames;
    int pipelineDelayFrames;
};

struct UzumeTelemetry {
    double realtimeFactor;
    double minRealtimeFactor;
    double queueDepthMs;
    double cpuPercentEstimate;
    double gpuPercentEstimate;
    double peakDbfs;
    double truePeakDbtpEstimate;
    bool qualityRollbackActive;
    bool randomAccessShortBridgeActive;
    bool underrunRisk;
};

class IUzumeKernel {
public:
    virtual ~IUzumeKernel() = default;
    virtual UzumePrepareResult prepare(const UzumePrepareRequest& request) = 0;
    virtual UzumeProcessResult process(const UzumeBlock& input, UzumeBlock& output) = 0;
    virtual void flush() = 0;
    virtual void resetToStreamPosition(uint64_t frame) = 0;
    virtual UzumeKernelLatency latency() const = 0;
    virtual UzumeTelemetry telemetry() const = 0;
};
```

这里的重点不是具体命名，而是把实时处理必须回答的问题固定下来：输入输出格式、延迟、flush/seek、telemetry、quality rollback 和 random-access short bridge。

## CPU Backend

CPU backend 是 UZUME 的基线，不是 fallback 小玩具。它必须做到没有 GPU 时也能完整运行。

更准确地说，CPU backend 是硬实时保底主链。它不仅要在 GPU 不存在时可用，还要在 GPU 正在预渲染、cache 未命中、device lost 或用户随机切歌时提供 full-quality 安全路径。但在 `gpu_preferred_for_acoustic_noise` 或极长 FIR/SRC full profile 下，主播放逻辑可以在冷启动和曲目边界等待 GPU ready，以换取更稳定的高质量处理和更低听音环境噪声。

推荐分层：

```text
uzume_cpu_reference
  scalar / double precision reference
  offline correctness

uzume_cpu_avx2
  realtime baseline
  x64 AVX2

uzume_cpu_avx512
  high-end path
  AVX512 FIR / FFT / vector math

uzume_cpu_library
  oneMKL / IPP / FFTW / pocketfft 等可选后端
```

Windows x64 第一阶段建议：

- 编译时检测 AVX2。
- 运行时 CPUID 选择 AVX2 / AVX512。
- FFT 后端优先抽象成接口，不把具体库写死到算法层。
- 可选库顺序建议：
  - oneMKL DFTI：Windows / Intel 平台优先验证。
  - Intel IPP：FIR、FFT、vector math 可作为高性能候选。
  - FFTW：可作为跨平台高性能 FFT 候选，但要处理 license / 分发策略。
  - pocketfft / KFR / PFFFT：可作为轻量 fallback 或测试基线。

CPU kernel 起步要求：

- AVX2 FIR inner loop。
- AVX2 windowed-sinc / polyphase FIR processing。
- AVX2 peak/RMS meter。
- FFT convolution 支持 library backend。
- AVX512 先用于 FFT-heavy path 和长 FIR partitioned convolution。
- float32 realtime，float64 reference / offline validation。
- Random-Access Short Bridge profile，只能用于 `user_random_seek_or_skip`，不能用于 GPU cache miss、冷启动、正常下一首或 gapless。
- committed output ring writer，支持 generation id 和 deadline-aware commit。
- gapless no-reset state path，支持 SRC phase / FIR history 跨曲目连续。
- callback-safe urgent controls hook，支持 mute、volume、declick 这类即时控制不等待重渲染。

不要在第一阶段追求所有 CPU 都极致优化。正确顺序是：

1. scalar reference 正确。
2. AVX2 realtime 可用。
3. library FFT convolver 可用。
4. AVX512 对长 FIR / FFT path 加速。
5. 再做 per-CPU micro tuning。

## GPU Backend

GPU backend 第一目标是可提前、可回退、可缓存的完整 offload，而不是零散加速。它必须服务实时听感，而不是让播放线程等待显卡。

推荐分层：

```text
uzume_gpu_cuda
  CUDA runtime
  cuFFT
  stream / event / pinned buffer
  async H2D / D2H

uzume_gpu_cuda_custom
  自研 FIR / window / reduction / SDM kernel
  只替换实测比 cuFFT 更快的热点

uzume_gpu_null
  测试 backend
  验证 planner / fallback / telemetry
```

GPU 第一阶段可落地能力：

- cuFFT R2C/C2R。
- overlap-save / partitioned convolution。
- polyphase FIR 批处理。
- batched stereo/multichannel block。
- peak/RMS reduction。
- async stream pipeline。
- pinned host buffer。
- double-buffer 或 triple-buffer。
- device memory pool。
- watchdog / timeout / error fallback。
- render-ahead job queue，支持 current tail、next-track head、album gapless segment。
- output ring / render-ahead cache commit，所有结果带 generation id。
- callback-slot miss handling：GPU block 晚于当前 callback slot 时不能追写已播放位置；generation 仍有效时保留给未来 cache / boundary / crossfade。
- crossfade candidate 输出，只用于 `user_random_seek_or_skip` 从 Random-Access Short Bridge 过渡到 full sinc-L / long FIR。

GPU 自研 kernel 的边界：

- 可以先做 FIR inner loop、window application、complex multiply、peak reduction。
- 只有当 benchmark 证明比 cuFFT 或 library path 更快、更稳，才替代 cuFFT。
- 不把自研 GPU kernel 作为 correctness 唯一来源。
- 所有自研 kernel 都要和 CPU reference 做 impulse、sweep、sine、random、null test。

GPU backend 不应该进入 audio callback。推荐结构：

```text
decoder thread
  -> UZUME input ring
  -> CPU realtime worker
       stable main-chain output
  -> optional GPU worker thread
       H2D async
       cuFFT/custom kernel
       D2H async
       telemetry
       generation-safe commit
  -> UZUME output ring / render-ahead cache
audio callback
  -> pull prepared block
  -> if GPU block missing: continue CPU main-chain block
  -> if all output missing: controlled fallback / silence / underrun telemetry
```

GPU backend 不能把“当前 block 现算现等”作为正常播放模型。正常模型应是 render-ahead：GPU 永远处理未来窗口，audio callback 永远读取已经完成的窗口。

## Offload 设计

完整 offload 至少包含：

1. 能力探测
   - GPU vendor / device name。
   - CUDA runtime / driver version。
   - cuFFT 可用性。
   - device memory。
   - supported sample formats。
   - max practical block size。

2. 计划选择
   - CPU reference / CPU AVX2 / CPU AVX512 / GPU cuFFT / GPU custom。
   - 根据算法、采样率、tap 数、目标延迟、设备能力选择 backend。
   - 支持用户偏好：Auto / CPU / GPU / GPU if safe。

3. 内存管理
   - pinned host buffer。
   - device memory pool。
   - plan cache。
   - FFT work area cache。
   - stream-safe buffer ownership。
   - committed output ring，供 callback read-only pull。
   - render-ahead cache，存放 current tail / next head / gapless album segment。
   - cache memory budget，超过预算时按 generation、距离播放边界和命中概率淘汰。

4. 调度
   - continuity planner。
   - worker thread。
   - CUDA stream。
   - deadline-aware command queue。
   - backpressure。
   - prewarm。
   - gapless next-track pre-roll。
   - N+1 / N+2 predictive cache。
   - random access policy and short-bridge eligibility。
   - CPU main-chain priority 高于 GPU render-ahead。

5. 同步
   - CUDA event。
   - output ring commit。
   - audio callback 只读 committed block。
   - seek / flush 时有 generation id，旧 block 不能回写新播放 intent。
   - GPU block 必须在目标 callback slot 前完成才可进入该 slot；迟到但 generation 仍有效的 block 可进入后续 cache / boundary / crossfade 候选，stale 或超预算时 retire。
   - format/profile 不同的下一首必须提前准备第二套 pipeline，边界处切换已 commit 输出。

6. 错误处理
   - cuFFT plan failed。
   - CUDA device lost。
   - timeout。
   - realtime factor 低于门槛。
   - memory pressure。
   - render-ahead cache miss。
   - next-track pre-roll decode late。
   - stale generation commit attempt。
   - quality rollback 到 CPU full-quality / UZUME Poly-Sinc lower-complexity profile；若退到旧 DecoderPipeline resampler，必须显示 UZUME bypass / legacy non-UZUME path。

7. Telemetry
   - 当前 backend。
   - realtime factor。
   - queue depth。
   - shared engine assignments。
   - merged response sources。
   - engine split reason。
   - callback ring depth。
   - render-ahead depth。
   - pre-roll track id / state。
   - gapless continuity state。
   - cache hit / miss / evict。
   - GPU memory。
   - kernel time。
   - H2D/D2H time。
   - quality rollback reason。
   - quality rollback profile。
   - random-access short-bridge profile。
   - crossfade-to-full-profile state。
   - underrun risk。

没有这些能力的 GPU 路线不能在 UI 里叫做完整 UZUME offload。

## UZUME 处理 Profile

第一版建议采用固定 profile schema，不开放任意 graph。Profile 是配置与编译输入，不是 runtime 模块链：

```text
FormatPathProfile
  formatPath:
    pcm_bitperfect
    pcm_processed
    dsd_direct
    dsd_upsampling
    d2p_processed
    sdm_processed
  sourceContainer:
    pcm
    dsd
  outputContainer:
    pcm
    dsd_native
    dop
  directDisabledReason
  deviceCapability
  actualDeviceRate
  bitPerfectState

Input PCM
  internal precision normalization
  gain / ReplayGain materialized gain
  EQ / FIR EQ coefficients
  stereo procedural EQ / crossfeed profile
  PCM SRC profile
  long FIR / IR pre interface
  channel tools
  safety / limiter policy
  output bit-depth protection
  => one UZUME fused PCM macro-kernel
  => PCM output
```

Profile section 只表达用户意图。Compile 阶段必须生成 shared engine assignment：

```text
profile sections
  format path
  headroom
  replaygain
  peq / fir-eq
  headphone correction
  stereo procedural equalizer
  crossfeed
  room / fir import
  pcm src
  dsd direct policy
  dsd upsampling policy
  d2p decimation profile
  sdm modulator profile
  channel tools
  limiter / meter
  dither

compile
  -> engine assignments
       format path planner:
          pcm_bitperfect / pcm_processed / dsd_direct / dsd_upsampling / d2p_processed / sdm_processed
       dsd ingress engine:
          dsd direct packet handoff, DSD upsampling ingress, D2P low-pass / decimation to multibit PCM
       precision / normalization engine:
           integer/float PCM ingress, wide working domain, NaN/Inf/denormal guard
       gain engine:
          headroom, replaygain, materialized gain
       iir engine:
          peq, minimum-phase headphone eq, stereo procedural iir
        convolution engine:
          fir-eq, headphone fir correction, room-ir, imported advanced matrix-fir
       resampling engine:
          pcm src, long sinc profile
       gain-matrix engine:
          channel balance, trim, mono, invert, routing matrix, matrix mix
        delay / fractional-delay engine:
          channel delay, crossfeed delay
        stereo matrix-filter engine:
          crossfeed iir, per-ear matrix filtering
        safety-metering engine:
          stage peak, rms, true-peak, clip history, headroom recommendation
        limiter engine:
          final safety limiter, trigger count, gain reduction telemetry
        dither engine:
           output bit-depth protection
       sdm engine:
           DSD upsampling SDM-only plan, PCM/DSD processed source to DSD output, overload guard, ultrasonic noise telemetry
  -> fused execution plan
```

如果多个 section 需要同一种数学原语，compiler 必须优先归并到同一个 shared engine。只有当 sample rate、phase policy、channel routing、latency、state 或 correctness 约束不兼容时，才允许在同一 shared engine 内部形成受控子 section，并必须在 Signal Path 中解释原因。

DSD Direct 模板：

```text
Input DSD
  validate native DSD / DoP capability
  no PCM decode
  no ReplayGain / EQ / FIR / limiter / SRC / dither
  optional transport-safe packetization
  => UZUME bypass for sample-changing DSP
  => DSD native / DoP output
```

DSD Upsampling 模板：

```text
Input DSD
  validate target native DSD / DoP capability
  DSD ingress / rate preparation for SDM modulator
  headroom / overload guard
  Safety Metering:
    modulator input margin
    overload risk
    ultrasonic noise risk
  SDM modulator profile
  no ReplayGain / EQ / FIR / crossfeed / channel matrix / PCM SRC UI / PCM dither
  => one UZUME DSD upsampling SDM-only plan
  => higher-rate DSD native / DoP output
```

D2P 模板：

```text
Input DSD
  DSD decode / low-pass / decimation profile
  multibit PCM internal
  internal precision normalization
  gain / ReplayGain materialized gain if allowed
  EQ / FIR / stereo procedural / crossfeed if enabled
  PCM SRC profile if target PCM output rate requires it
  safety / limiter policy
  output bit-depth protection
  => one UZUME D2P + PCM fused plan
  => PCM output
```

SDM 模板：

```text
Input PCM / DSD processed source
  multibit high-rate internal
  gain / headroom safety
  optional PCM-domain FIR / EQ coefficients
  SDM modulator profile
  => one UZUME fused SDM macro-kernel
  => DSD output
```

固定 profile 的好处：

- 延迟可计算。
- Signal Path 容易解释。
- CPU/GPU 等价容易测试。
- fallback 容易做。
- 不会把播放器变成 DAW graph。
- runtime 不需要小模块串联，避免多次 buffer pass 和 GPU/CPU 同步点。
- compile 阶段可以复用 shared engine，避免 FIR EQ、耳机校正、IR、SRC tail 等重复创建相似卷积/FFT pipeline。

等稳定后可以增加 matrix / routing profile 字段，但仍应编译进 fused macro-kernel，不把播放器变成通用 DAW graph。

## Headroom / Safety Metering / Limiter

UZUME 不能把 headroom、meter 和 limiter 揉成一个“安全保护”状态。三者必须拆开：

```text
Headroom
  主动留余量的 pre-DSP / materialized gain

Safety Metering
  证明余量是否足够的 sample peak / true peak / clip history / peak expansion 追踪

Limiter
  最后的兜底保护，不是默认音色处理工具
```

后端 telemetry 必须按 stage 记录，而不是只报一个最终 clipping flag：

```text
SafetyTelemetry
  stages:
    input
    after-precision-normalization
    after-headroom
    after-eq-iir
    after-src-convolution
    after-stereo-procedural-crossfeed
    pre-limiter
    post-limiter
    output-quantization

  per stage:
    peakDbfs
    rmsDbfs
    truePeakDbtp
    sampleClipCount
    truePeakOverCount
    peakExpansionDb
```

`peakExpansionDb` 是严谨性关键字段。minimum-phase EQ、minimum-phase SRC、IIR crossfeed、IR / convolution 都可能改变相位和瞬态分布，让 post-DSP peak 或 true peak 高于 input peak。Signal Path 必须能指出峰值扩张来自哪个 stage。

Headroom recommendation 由 profile preflight 和 live meter 共同决定：

```text
recommendedHeadroomDb =
  max(
    predictedDspBoostDb,
    livePreLimiterTruePeakOverDb + safetyMarginDb,
    limiterMaxGainReductionDb + recoveryMarginDb
  )
```

推荐上报字段：

```json
{
  "headroom": {
    "currentDb": -3.0,
    "recommendedDb": -5.0,
    "missingDb": 2.0,
    "reason": "post_dsp_true_peak",
    "sourceStage": "pre-limiter",
    "confidence": "measured",
    "targetSafetyMarginDb": 1.0,
    "autoHeadroomEnabled": false
  },
  "safetyMeter": {
    "state": "over",
    "maxSamplePeakDbfs": -0.2,
    "maxTruePeakDbtp": 0.8,
    "interSampleOverCount": 14,
    "stageOfMaxPeak": "after-convolution",
    "stageOfMaxTruePeak": "pre-limiter",
    "historyWindowSeconds": 30
  },
  "limiter": {
    "enabled": true,
    "active": true,
    "triggerCount": 37,
    "currentGainReductionDb": 0.6,
    "maxGainReductionDb": 2.4,
    "limitedFrames": 8192,
    "mode": "safety-soft-limiter",
    "truePeakLookahead": false
  }
}
```

前端回馈不应只有一个红灯，应分四档：

```text
Safe
  headroom sufficient，不打断用户。

Near Limit
  黄色提示，建议增加 1-2 dB headroom。

Over
  红色提示 sample peak / true peak over，显示来源 stage 和 recommended headroom。

Limiting
  红色提示 limiter 已介入，显示 trigger count 和 max gain reduction。
```

允许的用户动作：

```text
Apply recommended headroom
Enable Auto Headroom for this profile
Ignore for this track
Mute warning for this profile
Open safety details
```

默认策略必须保守：

- Safety Metering 默认 tracking / warning，不改变声音。
- Limiter 是最后兜底，不能替代 headroom 长期工作。
- 不自动修改用户 headroom，除非用户开启 `Auto Headroom`。
- `Auto Headroom` 只能平滑增加保护余量；减少 headroom 应等待曲目或 profile 边界，避免播放中音量突然变大。
- Limiter 长期触发时，前端应优先建议增加 headroom，而不是把 limiter active 当成正常状态。
- 如果当前 limiter 不是 true-peak / lookahead limiter，Signal Path 必须明确显示 `sample-domain safety limiter`，不能暗示 mastering / true-peak limiter。

## Resampling Engine / PCM SRC

Resampling Engine 负责时间采样率重建，不负责“内部精度扩展”。这两个概念必须分开：

```text
Internal precision domain
  int16 / int24 / float PCM ingress
  -> float / wide accumulator working domain
  -> 避免中间量化、clamp、整数溢出
  -> 不改变 sample grid

Resampling Engine
  source sample grid
  -> UZUME Poly-Sinc / Sinc-FFT Hybrid
  -> target sample grid
  -> 改变 sample rate、latency、buffer frame rate、device format plan
```

SRC 不应被当成 same-rate DSP 小模块塞进 legacy `DspChain`。它属于 AudioSession / output format plan / UZUME profile compiler 的共同决策，因为它会影响：

- output device open / format negotiation。
- callback frame rate 和 ring buffer 尺寸。
- EQ / IIR coefficient sample rate。
- FIR / IR sample-rate family。
- latency、lookahead、pre-roll 和 render-ahead cache。
- shared/system output 是否会被系统 mixer 二次 SRC。

UZUME 的 PCM SRC 正式路线直接采用原生 Poly-Sinc 家族，不再应用 SOXR / libsoxr 作为 adapter、fallback 或质量基线。SOXR 只属于当前 legacy DecoderPipeline 的现状事实，不能进入 UZUME compile profile。

### Formal Profile Families

UZUME PCM SRC 分三层，但 Phase 3 / initial realtime scope 只要求 Poly-Sinc Family：

```text
UZUME Poly-Sinc Family
  formal main path
  high-quality bandlimited sinc / polyphase FIR
  realtime / gapless / seek-friendly
  covers default quality, quality rollback, random-access short bridge

UZUME Gaussian / Apodizing Sinc
  pro / experimental path
  apodizing or time/frequency tradeoff variants
  not high-frequency restoration
  requires measured impulse / sweep / spectrogram artifacts

UZUME Sinc / FFT Hybrid
  extreme long-filter path
  sinc-M / sinc-L style experiments
  uses render-ahead, pre-roll, optional GPU, Shared Convolution Engine coordination
```

第一阶段只暴露验证通过的档位。不要把 HQPlayer 菜单逐项复制进 ECHO；ECHO 需要的是少量可解释、可验证、可实时播放的 profile。

建议 initial / Advanced 边界：

```text
Initial:
  UZUME Poly-Sinc Linear
  UZUME Poly-Sinc Minimum
  UZUME Poly-Sinc Extended
  UZUME Poly-Sinc Short Bridge
  UZUME Poly-Sinc Balanced Rollback

Advanced:
  UZUME Gaussian Sinc
  UZUME Gaussian Apodizing
  UZUME Sinc-M
  UZUME Sinc-L Extreme
  UZUME Closed-Form 2x
```

### Profile Schema

每个 SRC profile 必须定义完整技术语义，而不是只叫 “transparent / balanced / low latency”：

```text
ResamplingProfile
  id
  displayName
  family:
    poly-sinc
    gaussian-sinc
    sinc-fft-hybrid
    closed-form-2x

  sourceFamily:
    44.1k
    48k
    custom

  conversion:
    sourceRate
    targetRate
    integerRatio
    ratioNumerator
    ratioDenominator
    maxOutputRate
    deviceRateConstraint

  filter:
    phaseMode:
      linear
      intermediate
      minimum
    apodizing:
      none
      gaussian
      apodizing
    latencyMode:
      short
      normal
      extended
      render-ahead
    tapsPerPhase
    effectiveTaps
    cutoff
    transitionWidth
    passbandRippleDb
    stopbandAttenuationDb
    groupDelayFrames
    groupDelayMs
    lookaheadFrames

  realtime:
    cpuSupport
    gpuSupport
    realtimeSafetyClass:
      safe
      marginal
      unsafe
    rollingRealtimeFactor
    minimumRealtimeFactor
    bufferMarginMs
    preRollRequirementMs
    renderAheadRequirementMs

  continuity:
    gaplessStateContinuity
    phaseAccumulatorContinuity
    seekWarmupFrames
    drainFrames
    randomAccessShortBridgeEligible
    randomAccessShortBridgeProfile

  fallback:
    qualityRollbackProfile
    legacyNonUzumeRollbackAllowed
```

Phase mode 的 UI 语义必须清楚：

```text
Linear phase
  频域中性，固定群延迟。
  可能有对称 pre-ringing / post-ringing。
  默认高保真基线。

Minimum phase
  减少 pre-ringing，瞬态能量更偏后。
  代价是非线性相位 / 频率相关群延迟。
  需要记录 peakExpansionDb。

Intermediate phase
  线性相位与最小相位折中。
  只在有实测响应和清楚命名时暴露。

Apodizing
  目标是降低既有链路或源素材中可能存在的 ringing 痕迹。
  不是高频修复，也不是带宽扩展。
```

### Compile / Preflight Contract

Resampling Engine 不能只在运行时拿一个名字开始算。Profile compiler 必须在播放前生成可审计的 `ResamplingPlan`：

```text
ResamplingPlan
  profile id / family / phase mode / apodizing mode
  source rate / target rate / ratio / source family
  target device policy and double-resampling risk
  tap / phase / cutoff / transition / ripple / stopband contract
  group delay / lookahead / latency class
  pre-roll / render-ahead / cache requirement
  realtime safety class and rollback chain
  continuity state owner:
    phase accumulator
    filter history
    drain frames
    seek warm-up
```

每个正式 SRC profile 至少要能生成这些 preflight artifacts：

- impulse response：验证 impulse alignment、group delay、pre/post ringing。
- sweep / near-Nyquist：验证 alias rejection、stopband attenuation、transition width。
- passband plot：验证 ripple 和 cutoff 行为。
- phase / group-delay report：验证 linear / minimum / intermediate 的真实差异。
- realtime budget report：记录 CPU/GPU backend、rolling realtime factor、buffer margin 和 pre-roll 要求。
- Signal Path summary：给前端显示 `sourceRate -> targetRate`、family、phase、apodizing、latency、double-resampling risk。

Quality rollback 也必须是一个已编译 `ResamplingProfile`，不能是“随便换一个库”。它只允许在 UZUME Poly-Sinc 家族内降低复杂度，例如 taps、attenuation、latency class 或 render-ahead requirement。它必须保持明确的 source/target rate、连续性策略和 telemetry；如果退到 legacy non-UZUME 路径，Signal Path 必须显示 bypass，而不是把 legacy resampler 当成 UZUME profile。

`poly_sinc_short_bridge` 不是 rollback。它只服务 `user_random_seek_or_skip` 的即时出声策略，不能用于冷启动、gapless、正常 playlist 边界、GPU wait、cache miss 或普通 underrun recovery。

### Engine Placement

Resampling Engine 的位置由 profile 决定，但必须在 Signal Path 中解释。默认播放器路径：

```text
decode source PCM
-> internal precision domain
-> materialized gain / headroom
-> optional source-rate DSP if profile requests it
-> Resampling Engine to target processing/output rate
-> target-rate EQ / FIR / stereo procedural if profile requests it
-> Safety Metering / Limiter
-> dither / output quantization
-> output ring
```

如果 EQ / FIR 在 SRC 前后存在声音或性能取舍，profile 必须显式声明：

```text
dspPlacement:
  source-rate-before-src
  target-rate-after-src
  split-source-and-target-rate
```

不能让用户以为“开了 SRC”就自动让所有 DSP 更严谨。Headroom 这种线性 gain 主要依赖内部高精度；limiter / true-peak estimator 这类非线性或峰值相关处理才更需要 oversampling / true-peak aware 设计。

### Output / Device Policy

SRC 默认关闭仍是严谨基线。只有用户或 profile 明确要求，且输出路径适合，才启用 UZUME SRC。

```text
Direct-like output:
  WASAPI exclusive
  ASIO
  device rate known
  target rate supported
  UZUME SRC allowed

Shared / system output:
  system mixer may resample again
  UZUME high-order SRC is not recommended by default
  Signal Path must show double-resampling risk

DSD direct:
  no PCM SRC
  DSP disabled unless entering DSD processed path

DSD processed / SDM:
  separate SDM engine plan
  PCM SRC may prepare multibit internal rate before modulation
```

设备相关 target rate 选择必须考虑：

- source family：44.1k / 48k。
- device supported rates。
- requested output rate。
- ASIO native DSD / DoP capability。
- CPU/GPU realtime margin。
- user latency preference。
- render-ahead cache budget。
- acoustic noise preference。

### Runtime Telemetry

所有内置 SRC 模式都可以暴露，但不能只给名字。Signal Path / Professional Status 至少显示：

```json
{
  "resampling": {
    "active": true,
    "engine": "uzume-resampling",
    "profile": "poly_sinc_extended",
    "displayName": "UZUME Poly-Sinc Extended",
    "family": "poly-sinc",
    "phaseMode": "linear",
    "apodizing": "none",
    "sourceRate": 44100,
    "targetRate": 705600,
    "sourceFamily": "44.1k",
    "ratio": "16/1",
    "tapsPerPhase": 96,
    "effectiveTaps": 1536,
    "cutoff": 0.98,
    "transitionWidth": 0.02,
    "stopbandAttenuationDb": 180,
    "passbandRippleDb": 0.0001,
    "groupDelayMs": 68,
    "lookaheadMs": 68,
    "placement": "target-rate-after-src",
    "rollingRealtimeFactor": 5.4,
    "minimumRealtimeFactor": 3.1,
    "realtimeSafetyClass": "safe",
    "bufferMarginMs": 420,
    "preRollRequirementMs": 2500,
    "gaplessStateContinuity": true,
    "doubleResamplingRisk": false,
    "qualityRollbackProfile": "poly_sinc_balanced",
    "randomAccessShortBridgeProfile": "poly_sinc_short_bridge"
  }
}
```

实时状态规则：

```text
Safe:
  rolling realtime factor >= 2.0x
  buffer margin stable
  no deadline miss

Marginal:
  rolling realtime factor 1.1x - 2.0x
  occasional buffer margin drop
  show yellow warning

Unsafe:
  rolling realtime factor < 1.1x
  repeated deadline risk or underrun risk
  show red warning and suggest quality rollback / GPU wait / profile change
```

### Current Legacy Facts

当前源码中的 SOXR 三档只作为 legacy 链路事实记录，不作为 UZUME profile：

```text
transparent: aresample=resampler=soxr:precision=28
balanced:    aresample=resampler=soxr:precision=20
lowLatency:  aresample=resampler=soxr:precision=16
```

UZUME 启用后必须清楚显示实际使用的是哪一个 UZUME Poly-Sinc / Sinc-FFT Hybrid profile。若播放被回退到 legacy non-UZUME 路径，Signal Path 必须明确显示“UZUME bypass / legacy decoder resampler”，而不是把 SOXR 包装成 UZUME backend。

## 长 FIR / 共享卷积路线

当前 `ConvolutionProcessor` 是 8192 taps 直接卷积，适合作为短 IR utility 或 legacy fallback，不适合作为 UZUME 正式实现依赖。

UZUME 不把 `ConvolutionProcessor` 引入主路径。它只需要保留一个 IR pre 接口；正式路径由 Shared Convolution Engine 接管：

```text
IR file import
IR validation
IR resample/precompute
IR metadata
prepared coefficient handoff
  -> shared convolution engine input
```

UZUME fused kernel 接收的是已经 preflight 的 FIR / response data 和 shared convolution partition plan，而不是调用 `ConvolutionProcessor.processBlock()`。内部目标：

```text
shared convolution engine
  sources:
    fir-eq
    headphone-fir-correction
    room-ir
    optional advanced-matrix-fir
    optional long-src-tail
  compile:
    response merge
    channel routing
    advanced matrix routing only when imported
    head/tail partition plan
  execute:
    fused head FIR section
    partitioned FFT tail section
    overlap-save or overlap-add
    CPU FFT backend
    GPU cuFFT backend
```

建议内部结构：

```text
head partition
  short direct FIR or small FFT
  low latency

tail partitions
  FFT partitioned convolution
  larger block
  CPU/GPU offload
```

shared convolution engine 不只服务 IR。FIR EQ、耳机频响矫正、房间 IR 和可兼容的长 SRC tail 都应在 compile 阶段进入同一个 engine assignment。扬声器校正、串扰抵消、HRTF / 2x2 FIR 这类 advanced matrix response 只在导入或明确请求时进入 advanced matrix FIR path。只有当相位策略、采样率、channel routing、latency 或 state 语义不兼容时，才允许同一 engine 内部分裂为多个受控子 section，并由 Signal Path 解释。

IR 导入最低要求：

- WAV 第一阶段继续支持，可由 pre 接口完成。
- 记录 IR sample rate、channels、tap count、duration。
- 检查 peak、DC offset、NaN/Inf。
- 提示是否发生 IR resample。
- 重采样必须用高质量 SRC，不再用线性插值作为正式路径。
- Signal Path 显示 IR latency、shared convolution engine assignment、merged response sources 和 recommended headroom。

产品命名建议：

```text
当前功能: Experimental IR Convolver / legacy fallback
UZUME 完成后: UZUME FIR Pre Interface + Shared Convolution Engine
不要过早叫: Room Correction
```

如果仍叫 `Room Correction`，必须明确它只是加载外部生成 IR，不包含测量和滤波器生成。

## PCM Dither / Noise Shaping

UZUME 需要把输出位深保护作为音频工程功能，不要包装成音效。

适用场景：

- float / double internal 输出到 16-bit PCM。
- float / double internal 输出到 24-bit PCM。
- 用户明确选择 fixed-point output。

建议档位：

```text
TPDF
High-rate shaped
NS4
NS5
NS9
LNS15 experimental
None for test only
```

规则：

- PCM -> DSD 不使用 PCM dither；核心是 SDM noise shaping。
- fixed-point PCM 输出才显示 dither/noise shaping。
- bit-perfect path 不进入 dither。
- dither 触发会让 bit-perfect 为 false。

## SDM / DSD 路线

UZUME 的 SDM 是未来高端路线，不能在没有测试时提前承诺。

目标路径：

```text
PCM input
  -> UZUME high-quality PCM SRC to modulator rate
  -> headroom / overload guard
  -> SDM modulator
  -> DSD128 / DSD256 / DSD512 / DSD1024
```

DSD source processed path：

```text
DSD64 / DSD128 input
  -> low-pass / decimation to multibit internal
  -> optional PCM-domain DSP / SRC
  -> SDM remodulation
  -> higher-rate DSD output
```

建议调制器阶段：

```text
UZUME SDM 5th-order
  稳定优先。

UZUME SDM 7th-order
  更强噪声整形，更高负载。

UZUME SDM EC experimental
  只在稳定性和 overload 测试充分后开放。
```

必须实现：

- modulator overload 检测。
- headroom guard。
- ultrasonic noise risk。
- target DSD rate 与 realtime factor 匹配。
- fallback 到 PCM 或较低 DSD rate。
- DSD Direct 与 DSD Processed 状态不可混淆。

不要默认打开 DSD1024，也不要默认把所有 PCM 转 DSD。

D2P、DSD Upsampling 与 SDM 的 UI / backend 差异必须固定：

```text
DSD Upsampling / SDM-only
  UI:
    shows source DSD rate, target DSD rate, SDM modulator profile, headroom, safety/overload margin
    disables EQ, FIR, crossfeed, channel matrix, ReplayGain, PCM SRC profile, PCM dither
    explains that this is not full PCM-domain DSP processing
  backend:
    DSD ingress / rate preparation for SDM modulator
    headroom / overload guard
    SDM modulator and feedback state
    DSD native / DoP packet output

D2P / DSD-to-PCM processed
  UI:
    shows DSD source rate, decimation profile, internal PCM rate, PCM output format
    explains why DSD direct is disabled
    enables PCM-domain DSP controls
  backend:
    DSD ingress -> low-pass / decimation -> multibit PCM internal
    then UZUME PCM fused macro-kernel
    then PCM dither / output quantization if needed

SDM / PCM-or-DSD-to-DSD processed
  UI:
    shows modulator profile, target DSD rate, overload margin, ultrasonic noise risk, realtime safety
    disables PCM dither display and replaces it with SDM noise-shaping / overload telemetry
    marks the path experimental until SDM tests pass
  backend:
    PCM or D2P internal -> optional UZUME SRC to modulator rate
    headroom / overload guard
    SDM modulator and feedback state
    DSD native / DoP packet output
```

DSD upsampling telemetry 至少应能表达：

```json
{
  "formatPath": {
    "path": "dsd_upsampling",
    "sourceContainer": "dsd",
    "outputContainer": "dop",
    "inputEncoding": "dsd64",
    "internalDomain": "sdm-modulator-input",
    "outputEncoding": "dsd256",
    "bitPerfectState": "disabled",
    "directDisabledReason": "dsd_upsampling_enabled",
    "disabledSections": ["replaygain", "eq", "fir", "crossfeed", "channel-matrix", "pcm-src", "pcm-dither"]
  },
  "sdm": {
    "active": true,
    "mode": "dsd-upsampling",
    "modulator": "uzume-sdm-5th-order",
    "sourceDsdRate": "dsd64",
    "targetDsdRate": "dsd256",
    "headroomDb": -3,
    "overloadRisk": "safe",
    "ultrasonicNoiseRisk": "normal",
    "realtimeSafetyClass": "safe"
  }
}
```

## Signal Path 与状态

UZUME 必须先补可解释性，再补复杂算法。状态建议拆成：

```text
formatProcessingActive
  SRC, DSD/PCM conversion, SDM modulation, dither

audioDspActive
  EQ, convolver, channel tools, limiter

playbackMixActive
  ReplayGain, automix, gapless transition, tempo
```

UZUME telemetry 示例：

```json
{
  "uzumeActive": true,
  "backend": "gpu-cufft",
  "mainChainBackend": "cpu-avx2",
  "offloadBackend": "gpu-cufft",
  "backendPreference": "gpu_preferred_for_acoustic_noise",
  "profile": "UZUME Poly-Sinc Extended",
  "formatPath": {
    "path": "pcm_processed",
    "sourceContainer": "pcm",
    "outputContainer": "pcm",
    "inputEncoding": "pcm",
    "internalDomain": "multibit-pcm",
    "outputEncoding": "pcm",
    "bitPerfectState": "disabled",
    "directDisabledReason": "uzume_src_enabled",
    "availablePaths": ["pcm_bitperfect", "pcm_processed", "sdm_processed"],
    "unavailableReasons": {
      "dsd_direct": "source_is_pcm",
      "dsd_upsampling": "source_is_pcm",
      "d2p_processed": "source_is_pcm",
      "sdm_processed": "sdm_engine_not_ready"
    }
  },
  "sharedEngines": [
    {
      "engine": "shared-convolution",
      "sources": ["fir-eq", "headphone-fir-correction", "room-ir"],
      "mode": "stereo-fir",
      "sampleRateFamily": "44.1k",
      "exactSampleRate": 705600,
      "latencyClass": "Quality First",
      "inputBlockFrames": 2048,
      "outputBlockFrames": 2048,
      "directHeadTaps": 256,
      "fftHeadSize": 4096,
      "fftTailSizes": [8192, 32768, 131072],
      "tailSeconds": 1.86,
      "partitioning": "direct-head+non-uniform-fft-tail",
      "backend": "gpu-cufft-render-ahead",
      "splitReason": "none"
    }
  ],
  "activeRenderProfile": "UZUME Poly-Sinc Extended",
  "randomAccessShortBridgeProfile": "UZUME Poly-Sinc Short",
  "randomAccessShortBridgeEligible": false,
  "inputSampleRate": 44100,
  "internalSampleRate": 705600,
  "outputSampleRate": 705600,
  "latencyMs": 68,
  "realtimeFactor": 5.4,
  "minRealtimeFactor": 3.1,
  "callbackRingDepthMs": 180,
  "renderAheadDepthMs": 12400,
  "gpuPrewarmState": "ready",
  "nextTrackPreRollState": "ready",
  "gaplessContinuity": "no-reset",
  "renderAheadCache": "hit",
  "shortBridgeCrossfadeToFullProfile": "inactive",
  "status": "safe",
  "qualityRollback": "none",
  "bitPerfectDisabledReason": "uzume_src_enabled"
}
```

状态规则：

```text
Safe:
  rolling realtime factor >= 2.0x
  callback ring depth stable
  render-ahead depth above profile threshold
  no underrun

Marginal:
  rolling realtime factor 1.1x - 2.0x
  callback ring depth occasionally falls
  render-ahead cache sometimes misses
  UI shows warning

Unsafe:
  rolling realtime factor < 1.1x
  callback ring depth below hard threshold
  underrun likely
  automatic quality rollback may be armed
```

Signal Path 至少显示：

- format path：PCM bit-perfect / PCM processed / DSD direct / DSD upsampling / D2P / SDM。
- source container / output container：PCM、native DSD、DoP。
- internal processing domain：none、multibit PCM、SDM feedback domain。
- direct disabled reason / unavailable path reason。
- source rate / bit depth。
- decoder output rate。
- UZUME active / bypass。
- backend：CPU scalar / CPU AVX2 / CPU AVX512 / GPU cuFFT / GPU custom。
- profile。
- shared engine assignment。
- merged parameter sources。
- engine split reason。
- convolution sample-rate family。
- convolution latency class。
- convolution block size / FFT size。
- convolution tail length / drain state。
- latency。
- realtime factor。
- CPU main-chain backend。
- optional GPU offload backend。
- callback ring depth。
- render-ahead cache depth。
- next-track pre-roll state。
- gapless continuity state。
- random-access short bridge / crossfade state。
- quality fallback / rollback reason。
- output mode。
- actual device rate。
- bit-perfect disabled reason。

## 前端设计参考

UZUME 前端应同时参考两条线：

```text
老 ECHO DSP 页面 / DspChain 控制模型
  用户已经理解 Headroom、SRC、EQ、耳机校正、FIR/房间、声道工具、输出安全。

Roon MUSE / Signal Path
  用户需要看到每一步为什么改变声音、为什么不是 bit-perfect、当前路径是否 safe。
```

这意味着前端可以按模块心智呈现，但后端不能按小模块链执行。UI 展示的是 UZUME fused profile 的不同 section：

```text
UI section: Format / Output Path
profile field: formatPath, source/output container, direct mode, DSD upsampling policy, D2P policy, SDM policy, device capability
runtime: AudioSession format planner + UZUME compiler 选择 pcm_bitperfect / pcm_processed / dsd_direct / dsd_upsampling / d2p_processed / sdm_processed

UI section: Headroom
profile field: gain/headroom policy, auto-headroom preference
runtime: fused macro-kernel 内部 gain section；Safety Metering 反馈 recommended headroom

UI section: EQ
profile field: EQ coefficients
runtime: IIR engine 或 Shared Convolution Engine 的 compiled source

UI section: Stereo Procedural EQ / Crossfeed
profile field: ordered stereo procedural steps, channel scope, crossfeed policy
runtime: gain-matrix / delay / IIR matrix-filter / Shared Convolution Engine 的 compiled source

UI section: SRC / UZUME
profile field: ResamplingProfile，包含 family、phase、apodizing、source/target rate、latency、continuity、fallback、backend preference
runtime: Resampling Engine，必要时与 Shared Convolution Engine 共享 FFT plan 或形成受控子 section；Signal Path 必须显示实时安全等级和 double-resampling risk

UI section: FIR / IR
profile field: IR preflight metadata and prepared coefficients
runtime: Shared Convolution Engine compiled source

UI section: Output Safety
profile field: safety-meter policy, limiter policy
runtime: Safety Metering 负责证明余量是否足够；Limiter 只做最后兜底

UI section: DSD / SDM
profile field: DSD direct preference, DSD upsampling SDM-only preference, D2P decimation profile, SDM modulator profile, target DSD rate, overload policy
runtime: dsd_direct 只走 output bridge；dsd_upsampling 进入 SDM-only plan；d2p_processed 进入 DSD ingress + PCM fused plan；sdm_processed 进入 SDM engine
```

前端布局建议：

1. 保留 `DspPage.tsx` 的工作区入口和老 DSP 模块顺序，降低迁移成本。
2. 把页面标题从“模块链”逐步改成“UZUME Profile / Signal Control”，避免暗示后端是 processor chain。
3. 在每个 section 上显示两层状态：用户控制状态和 UZUME 编译状态。
4. 在顶部放 MUSE 式 Signal Path：Source -> Decode / DSD Ingress -> UZUME / Bypass -> Output。
5. 每个 Signal Path 节点显示状态：Lossless / Processed / Enhanced / Unsafe / Bypassed。
6. 输出设备维度提供 profile binding，参考 MUSE 的 zone 思路。
7. Shared/system output 下明确显示 UZUME SRC 可能 bypass 或不推荐。
8. SRC 面板必须显示 filter family、phase mode、apodizing、sourceRate -> targetRate、group delay、lookahead、pre-roll requirement、realtime safety class、quality rollback 和 short-bridge eligibility。
9. DSD 页面明确区分 Direct、DSD Upsampling / SDM-only、D2P / DSD-to-PCM processed、SDM / DSD-to-SDM processed，并显示每条不可用路径的原因。
10. Headroom 面板必须显示 current / recommended / missing margin；Output Safety 面板必须拆开 Safety Metering 和 Limiter gain reduction。

前端不应该：

- 把 UZUME 画成很多 runtime 小模块串联。
- 用“开了某个 section”暗示它一定独立执行。
- 隐藏 quality rollback 或 random-access short bridge。
- 把 Experimental IR Convolver 写成完整 Room Correction。
- 把 GPU 开关做成唯一主控；用户应该选择 profile，backend 由 Auto/CPU/GPU preference 决定。

新增前端状态字段建议：

```json
{
  "uzume": {
    "active": true,
    "profileName": "Headphone ASIO UZUME",
    "compiled": true,
    "compileStatus": "ready",
    "profileSections": ["format-path", "headroom", "eq", "stereo-procedural", "crossfeed", "src", "fir-pre", "dsd-upsampling", "d2p", "sdm", "safety"],
    "runtimeModel": "fused-macro-kernel",
    "sharedEngines": [
      {
        "engine": "stereo-matrix-filter",
        "sources": ["stereo-procedural-eq", "crossfeed"],
        "backend": "cpu-avx2",
        "splitReason": "iir-crossfeed-before-post-ear-calibration"
      },
      {
        "engine": "shared-convolution",
        "sources": ["fir-eq", "headphone-fir-correction", "room-ir"],
        "backend": "cpu-avx2",
        "splitReason": "none"
      },
      {
        "engine": "resampling",
        "sources": ["src"],
        "backend": "cpu-avx2",
        "splitReason": "none"
      }
    ],
    "backend": "cpu-avx2",
    "mainChainBackend": "cpu-avx2",
    "offloadBackend": "none",
    "callbackRingDepthMs": 180,
    "renderAheadDepthMs": 0,
    "nextTrackPreRollState": "idle",
    "gaplessContinuity": "not-applicable",
    "formatPath": {
      "path": "pcm_processed",
      "sourceContainer": "pcm",
      "outputContainer": "pcm",
      "inputEncoding": "pcm",
      "internalDomain": "multibit-pcm",
      "outputEncoding": "pcm",
      "bitPerfectState": "disabled",
      "directDisabledReason": "uzume_processing_enabled",
      "deviceMode": "asio-exclusive",
      "actualDeviceRate": 705600,
      "availablePaths": ["pcm_bitperfect", "pcm_processed", "sdm_processed"],
      "unavailableReasons": {
        "dsd_direct": "source_is_pcm",
        "dsd_upsampling": "source_is_pcm",
        "d2p_processed": "source_is_pcm",
        "sdm_processed": "sdm_engine_not_ready"
      }
    },
    "resampling": {
      "active": true,
      "profile": "poly_sinc_extended",
      "family": "poly-sinc",
      "phaseMode": "linear",
      "apodizing": "none",
      "sourceRate": 44100,
      "targetRate": 705600,
      "sourceFamily": "44.1k",
      "ratio": "16/1",
      "placement": "target-rate-after-src",
      "groupDelayMs": 68,
      "lookaheadMs": 68,
      "preRollRequirementMs": 2500,
      "rollingRealtimeFactor": 5.4,
      "realtimeSafetyClass": "safe",
      "doubleResamplingRisk": false,
      "qualityRollbackProfile": "poly_sinc_balanced",
      "randomAccessShortBridgeProfile": "poly_sinc_short_bridge",
      "randomAccessShortBridgeEligible": false
    },
    "headroom": {
      "currentDb": -3,
      "recommendedDb": -5,
      "missingDb": 2,
      "reason": "post_dsp_true_peak",
      "sourceStage": "pre-limiter",
      "confidence": "measured",
      "autoHeadroomEnabled": false
    },
    "safetyMeter": {
      "state": "over",
      "maxSamplePeakDbfs": -0.2,
      "maxTruePeakDbtp": 0.8,
      "interSampleOverCount": 14,
      "stageOfMaxPeak": "after-convolution",
      "stageOfMaxTruePeak": "pre-limiter"
    },
    "limiter": {
      "enabled": true,
      "active": true,
      "triggerCount": 37,
      "currentGainReductionDb": 0.6,
      "maxGainReductionDb": 2.4,
      "mode": "safety-soft-limiter"
    },
    "qualityRollbackActive": false,
    "qualityRollbackReason": "none",
    "randomAccessShortBridgeActive": false,
    "randomAccessShortBridgeEligible": false,
    "signalQuality": "processed"
  }
}
```

这让前端保留老 DSP 的易用控制，同时在状态表达上接近 Roon MUSE：用户看到的是可解释 signal path，而不是后端实现细节。

## 不影响资料库和播放核心

UZUME 不能影响 ECHO 核心资料与播放功能。工程上要用硬边界保证，而不是靠约定。

必须遵守：

- Library Core 不依赖 UZUME。
- metadata 扫描不加载 CUDA / FFT heavy runtime。
- 封面提取、歌词、网络元数据不进入 UZUME 进程。
- Renderer 不直接访问 UZUME kernel。
- UZUME worker thread 优先级不能压过 native audio callback。
- GPU 初始化失败不能影响曲库页面和普通播放。
- UZUME 未启用时，不创建重 GPU context。
- UZUME crash 不能拖垮 Electron main；优先考虑 native worker 进程隔离。

推荐进程边界：

```text
Electron main
  AudioSession / planner only

echo-audio-host
  realtime output
  UZUME output bridge
  independent LegacyDspChain backend

uzume-worker
  optional heavy DSP / GPU offload
  crash-isolated
```

如果第一阶段不拆独立进程，也必须至少做到：

- UZUME 初始化 lazy。
- GPU 后端 lazy。
- 失败可禁用。
- 播放恢复到 UZUME CPU fused path、UZUME Poly-Sinc lower-complexity profile 或 legacy non-UZUME rollback path。
- 不让 worker 死锁 audio callback。

## 配置与 Profile

UZUME 配置建议绑定输出设备 profile，而不是全局一把梭：

```json
{
  "uzume": {
    "enabled": false,
    "backendPreference": "gpu_preferred_for_acoustic_noise",
    "acousticNoisePreference": "prefer_gpu_when_waitable",
    "pcmSrcProfile": "poly_sinc_linear",
    "gpuOffload": "auto",
    "realtimeMainChain": "cpu-avx2",
    "continuity": {
      "enabled": true,
      "preRollMinSeconds": 2,
      "preRollMaxSeconds": 15,
      "callbackRingTargetMs": 180,
      "renderAheadTargetSeconds": 12,
      "renderAheadMaxSeconds": 30,
      "coldStartPolicy": "wait_for_full_profile",
      "playlistBoundaryPolicy": "wait_for_full_profile",
      "gaplessBoundaryPolicy": "wait_for_full_profile_no_reset",
      "gpuPrewarmPolicy": "wait_when_possible",
      "randomAccessPolicy": "short_bridge_then_quality_crossfade",
      "randomAccessShortBridgeOnlyFor": "user_random_seek_or_skip",
      "randomAccessShortBridgeProfile": "poly_sinc_short",
      "fullProfileCrossfadeMs": 300,
      "predictiveCacheTracks": 2,
      "gaplessNoReset": true
    },
    "maxLatencyMs": 250,
    "qualityRollbackProfile": "poly_sinc_balanced",
    "dither": "tpdf",
    "sdm": {
      "enabled": false,
      "target": "dsd256",
      "modulator": "sdm5"
    }
  }
}
```

Profile 绑定维度：

- output mode：system / shared / exclusive / ASIO。
- device id。
- PCM max sample rate。
- DSD native / DoP support。
- GPU availability。
- user latency preference。
- acoustic noise preference。
- continuity policy。
- render-ahead cache budget。
- random access policy。

Shared/system output 默认不推荐高阶 UZUME SRC，因为可能被系统 mixer 二次重采样。

连续流相关配置必须有上限和安全默认值。`renderAheadTargetSeconds` 不是 callback buffer，也不能让用户交互延迟相同秒数；它只表示后台已渲染 cache 的目标深度。真正的音频 callback 仍然读取小而稳定的 callback ring。

`randomAccessShortBridgeProfile` 不是通用 fallback。它只能在主播放逻辑明确标记 `user_random_seek_or_skip` 时使用。冷启动、正常 playlist 下一首、gapless 边界、GPU prewarm、render-ahead cache miss 和后台 decode late 都必须走 full profile wait / prewarm / predictive cache，不能用短滤波替代。

`acousticNoisePreference = prefer_gpu_when_waitable` 表示能等 GPU full profile ready 就等 GPU，尤其用于冷启动和 playlist 边界。CPU full-quality path 仍是必须实现的硬实时保底，但不能在 GPU 可等待时抢先播放，避免因为 CPU 满载带来更高风扇噪声。

## 迁移阶段

阶段策略固定为 `contract-first -> end-to-end skeleton -> vertical slices -> realtime hardening`。不要先完成一个庞大的后端再补前端，也不要先做完整前端空壳。每个可听功能都必须按同一切片推进：

```text
schema / profile contract
-> compiler assignment
-> reference backend
-> telemetry
-> thin UI / Signal Path display
-> tests and artifacts
-> realtime AVX2 / GPU optimization
```

实施细节拆到 RPC 文档组：[`docs/uzume-rpc/README.md`](uzume-rpc/README.md)。RPC 是 `Refactor Phase Contract`，用于把每个 phase 的目标、非目标、切片、验收和测试固定下来；第一个 RPC 从当前实现偏移开始收口，而不是从理想架构空降。

### Phase 0：Contract / Legacy Boundary

- 记录当前 SOXR 三档作为 legacy non-UZUME 基线；UZUME profile 不接入 SOXR adapter / fallback。
- 冻结现有 `DspChain` 行为，并抽象为独立 `LegacyDspChain` backend，作为 UZUME 对照和 rollback path。
- 明确 host / output bridge 只能在 UZUME backend 与 `LegacyDspChain` backend 之间选择，不能让 `DspChain` 包住 `UzumeEngine`。
- 把 `dspActive` 语义拆成 format / audio DSP / playback mix。
- `Room Correction` UI 降级为 `Experimental IR Convolver` 的准备；`ConvolutionProcessor` 不作为 UZUME 主实现依赖。
- 记录现有 baseline：CPU、realtime factor、latency、fallback。
- 定义 UZUME fused profile schema：formatPath、gain、EQ、SRC、IR pre、channel、limiter、dither、DSD upsampling policy、D2P policy、future SDM。
- 定义 PCM / DSD / DSD upsampling / D2P / SDM 前后端状态 schema：source/output container、internal domain、direct disabled reason、available/unavailable path reasons、device capability。
- 定义 `StereoProceduralProfile`、Headroom / Safety Metering / Limiter telemetry、shared engine registry、Shared Convolution Engine、`ResamplingProfile` / `ResamplingPlan`、continuity planner / generation id / callback ring / render-ahead cache schema。
- 明确 gapless boundary 与 filter state boundary 的语义差异。

### Phase 1：End-to-End Skeleton / Thin UI

- 新增 `native/uzume` 或等价目录，定义 kernel ABI 和 `ProfileCompiler` API。
- 实现最小 `AudioSession -> ProfileCompiler -> UzumeEngine identity/bypass -> NativeOutputBridge -> telemetry -> frontend Signal Path` 贯通链路。
- 剔除 `DspChain -> UzumeEngine` wrapper route；`DspChain` 只能作为 legacy backend / `LegacyDspChain` 候选，不能承载 UZUME skeleton。
- 本地 multi-stage UZUME PR 只作为资产池评估：CUDA probe、telemetry、tests 可保留；绑定 DspChain route 的部分必须改造或丢弃。
- 实现 formatPath planner skeleton：PCM bit-perfect、PCM processed、DSD direct、DSD upsampling、D2P、SDM 都能得到 `available / unavailable / disabled reason`，但 D2P / SDM 可先不可用。
- RPC-001 当前落地为 `uzumeFormatPathPlan` telemetry：六条 path 都有 `state` 与 `reason`；当前 PCM skeleton 下 DSD/D2P/SDM 仍可报告 `source_is_pcm` / `sdm_engine_not_ready` 等 unavailable reason。
- 实现 UZUME identity / bypass backend，不改变样本；只验证 generation id、status handoff、callback ring 读 committed block。
- 前端先做 thin UI：Format / Output Path、Headroom、SRC、Stereo Procedural、FIR / IR、DSD / SDM、Output Safety 的基础面板和 Signal Path，不实现完整算法编辑器；未真正工作的 UZUME 子控件必须显示 `未实现`，只保留 legacy / compat readout。
- 控件 gating 先跑通：例如 `dsd_direct` 禁用所有改样本 DSP，`dsd_upsampling` 只开放 SDM modulator、headroom、Safety Metering / overload guard。
- Signal Path 显示 formatPath、source/output container、internal domain、direct disabled reason、shared engine assignment placeholder、backend、bit-perfect disabled reason。
- 默认关闭，不影响普通播放、曲库和资料功能。

Phase 1 的完成状态是 `skeleton gate`：前后端路径、状态、禁用原因、fallback 文案可信，但还不宣称任何高质量 DSP 算法完成。

### Phase 2：CPU Reference Vertical Slices

- 实现 scalar / float64 reference fused PCM path。
- 实现 formatPath planner reference：PCM bit-perfect bypass、PCM processed、DSD direct bypass、DSD upsampling SDM-only、DSD upsampling / D2P / SDM unavailable reason，不让 UI 直接拼 runtime graph。
- 覆盖现有 DSP 功能面 reference：headroom/gain、EQ profile、channel profile、limiter policy、ResamplingProfile hook、IR pre hook。
- 覆盖 `StereoProceduralProfile` reference：balance/trim/mute/solo、invert/swap/mono、L/R delay、per-ear PEQ、matrix mix、crossfeed。
- 实现 Safety Metering reference：input、after-headroom、after-EQ、after-convolution、pre-limiter、post-limiter stage peak/RMS/true-peak。
- 实现 recommended headroom reference：profile preflight gain、live true-peak over、limiter reduction 三者取最大。
- 实现 UZUME Poly-Sinc float64 reference SRC：ratio planner、phase accumulator、filter generation、group delay/lookahead report 和 same-rate bypass。
- 实现 compile-time shared engine assignment reference，证明 UI section 只生成参数，不直接拥有 runtime processor。
- 实现 shared convolution reference merge / partition planner：FIR EQ、headphone FIR correction、room IR 的响应合并、serial-reference 对比、sample-rate family、block size、FFT size、partition ladder、tail length、latency report。
- 实现 high-precision FIR / IR / target response resample reference，不允许正式路径使用线性插值重采样响应。
- 生成测试工具和 artifacts：impulse、sweep、near-Nyquist sine、multi-tone、random、null compare、frequency response、phase / group-delay、alias rejection、latency、realtime budget。
- 实现离线连续流 reference：source PCM concat 后统一 SRC/FIR，与逐曲 gapless no-reset 路径对比。
- 定义 Quality First / GPU Wait / Predictive Cache / Random-Access Short Bridge 四种策略的 profile 语义，其中短桥接只允许 `user_random_seek_or_skip`。

Phase 2 的完成状态是 `reference gate`：算法语义、compiler assignment、telemetry、artifact 都可审计，但仍不进入默认播放链路。

### Phase 3：Realtime PCM MVP / Legacy Replacement

Phase 3 是 UZUME 的 `PCM MVP`。MVP 不再作为独立章节维护；它就是 Phase 3 的 exit gate。

- 实现 AVX2 fused PCM macro-kernel，覆盖现有 `DspChain` 的 headroom/gain、EQ、channel、limiter 功能面。
- 将旧 Channel Balance 功能迁移为 `StereoProceduralProfile` 的基础原语；不再把 low/mid/high compensation 当成正式扩展方向。
- 实现 crossfeed 和 per-ear EQ 的 CPU realtime path，优先以 IIR / matrix-filter 形式进入 fused plan。
- 接入 AVX2 UZUME Poly-Sinc realtime SRC；`ResamplingPlan` 必须上报 group delay、lookahead、rolling realtime factor、realtime safety class、double-resampling risk、quality rollback 和 short-bridge 状态。
- 实现 CPU realtime worker、input queue、committed output ring，audio callback 只读 committed block。
- 实现 realtime stage telemetry ring，输出 headroom/safetyMeter/limiter 状态，不在 audio callback 做 JSON。
- Limiter telemetry 必须报告 trigger count、current/max gain reduction、limited frames；不能只报告 protecting boolean。
- 支持 flush / seek / pause / resume / gapless generation id。
- 支持 gapless no-reset：SRC phase、FIR history、overlap history 跨曲目连续。
- 支持 next-track pre-roll：当前曲剩余 `delay + buffer_margin` 进入窗口时启动 N+1 decode / prepare。
- 支持 Random-Access Short Bridge SRC/FIR profile，但只接受主播放逻辑标记的 `user_random_seek_or_skip`，其它场景拒绝短桥接。
- 在可控开关下让 UZUME fused kernel 替代现有 `DspChain`；`LegacyDspChain` 保留为独立 rollback backend。
- quality rollback 只能在 UZUME Poly-Sinc 家族内降级；如退回旧链路，Signal Path 必须显示 UZUME bypass / legacy non-UZUME path。
- 前端 Signal Path 显示 formatPath、shared engine assignment、merged sources、split reason、Resampling family/phase/apodizing/source-target/group delay/realtime safety/double-resampling risk、stereo procedural order、crossfeed matrix-filter、headroom recommendation、safety meter state、limiter gain reduction、callback ring depth、pre-roll/gapless/quality rollback/short bridge 状态。
- 测试 artifacts 证明 CPU reference 与 AVX2 等价，并证明 formatPath planner、PCM processed、Resampling Engine、Stereo Procedural EQ / Crossfeed、Headroom/Safety/Limiter telemetry、gapless concat reference、pre-roll deadline、callback ring、generation invalidation 通过。

Phase 3 不要求完整 production-grade long FIR / partitioned FFT convolution、GPU offload、D2P 或 SDM 正式可用；这些进入后续 phase。

### Phase 4：Shared Convolution Engine / FIR Production

- 实现 IR pre 接口：import、validation、resample/precompute、metadata、prepared coefficient handoff。
- 实现 Shared Convolution Engine：response import/synthesis、response merge、per-channel / stereo FIR routing、sample-rate family planner、partition planner、latency/state owner；advanced matrix FIR routing 只做导入/未来能力预留。
- 实现 UZUME 内部高性能 partitioned FFT convolution，挂在 Shared Convolution Engine 下。
- 接入 direct head + non-uniform FFT tail，但作为 Shared Convolution Engine 的内部 section。
- 显式管理 callback block size、internal FFT block size、hop size、FFT size、tail frames、tail seconds、warm-up frames 和 drain frames。
- 为 44.1k family / 48k family / device custom family 建立独立 FFT plan cache、filter FFT cache 和 block-size compatibility table。
- 支持 FIR EQ + headphone FIR correction + room IR 在兼容时合并为同一 convolution plan。
- 对 sample rate、phase policy、latency、channel routing 不兼容的来源生成 split reason，不允许无解释地拆出多个 convolver。
- 当前 `ConvolutionProcessor` 只保留为 legacy / experimental fallback。
- 8192 taps direct convolution 不能作为正式上限或正式性能目标，只能作为 tiny-IR legacy / diagnostic path。
- 长 FIR / sinc-L profile 必须报告 lookahead、group delay、pre-roll requirement、GPU wait requirement 和 random-access short-bridge eligibility。

### Phase 5：GPU Render-Ahead / cuFFT Offload

- CUDA/cuFFT 后端 experimental。
- 完整 offload：planner、memory pool、worker、async copy、events、telemetry、fallback。
- 实现 GPU render-ahead job queue：current tail、next-track head、gapless album segment、N+1 / N+2 predictive cache。
- 实现 generation-safe commit：目标 callback slot 前完成且 generation 匹配才能进入该 slot；晚到但仍有效的结果可进入后续 cache / boundary / crossfade 候选。
- GPU prewarm / render-ahead cache miss 时不启用短滤波；冷启动、playlist 边界和 gapless 应等待 GPU 或 CPU full profile ready。只有 `user_random_seek_or_skip` 可进入 Random-Access Short Bridge + crossfade。
- 优先支持 Shared Convolution Engine 中最重的 FFT / FIR section，而不是孤立 cuFFT primitive。
- GPU cuFFT plan、filter FFT cache、device scratch 和 pinned staging 必须按 sample-rate family / partition plan / latency class 复用。
- 再支持 polyphase SRC batch path 和 meter reduction。

### Phase 6：DSD / D2P / SDM Paths

- 实现 DSD direct 正式路径：native DSD / DoP 直通，不进入 PCM DSP / SRC / limiter / dither。
- 实现 DSD upsampling SDM-only path：DSD source 到更高 DSD rate，只开放 SDM modulator、headroom、Safety Metering / overload guard。
- 实现 D2P ingress reference：DSD low-pass / decimation 到 multibit PCM internal，并接入 UZUME PCM fused path。
- PCM -> SDM 5th-order。
- overload / ultrasonic noise telemetry。
- DSD256 先行，DSD512/1024 后置。
- DSD direct、DSD upsampling、D2P、SDM processed 状态不可混淆。

### Phase 7：Advanced Backends

- AVX512 优化 FFT-heavy path。
- 自研 GPU kernel 替换实测热点。
- 建立 backend benchmark matrix。
- 支持用户选择 CPU/GPU preference。
- 建立 render-ahead benchmark matrix：不同 profile、采样率、tap 数、cache 深度、随机切歌策略的安全等级。

## 测试门槛

每个 UZUME kernel 必须通过：

- impulse response。
- logarithmic sweep。
- near-Nyquist sine。
- multi-tone。
- silence。
- denormal / NaN / Inf guard。
- random PCM。
- channel mismatch。
- formatPath planner correctness：pcm_bitperfect / pcm_processed / dsd_direct / dsd_upsampling / d2p_processed / sdm_processed。
- PCM bit-perfect bypass does not alter samples test。
- DSD direct path does not enter PCM DSP / SRC / limiter / dither test。
- DSD upsampling only exposes SDM modulator + headroom/safety test。
- DSD upsampling rejects EQ / FIR / crossfeed / ReplayGain / PCM SRC UI / PCM dither test。
- D2P unavailable / enabled state and DSD direct disabled reason test。
- SDM unavailable / experimental state and fallback reason test。
- block boundary split。
- flush / drain。
- seek generation invalidation。
- gapless continuity。
- shared engine assignment correctness。
- stereo procedural ordered-step correctness。
- channel targeting / channel scope correctness。
- matrix mix / mono / swap / invert correctness。
- L/R delay and fractional delay correctness。
- per-ear PEQ pre-crossfeed vs post-crossfeed ordering test。
- crossfeed 2x2 matrix-filter response and delay test。
- crossfeed mono compatibility / center preservation test。
- shared convolution merge vs serial FIR reference。
- FIR EQ + headphone FIR correction + room IR merged-plan null / residual test。
- stage meter peak/RMS/true-peak consistency test。
- recommended headroom calculation test。
- limiter trigger count / gain reduction telemetry test。
- sample-domain limiter must not be reported as true-peak lookahead limiter test。
- ResamplingProfile compile / preflight artifact generation test。
- UZUME Poly-Sinc impulse / sweep / near-Nyquist / multi-tone response test。
- SRC passband ripple / cutoff / transition width / stopband attenuation / alias rejection test。
- SRC phase mode correctness test：linear、minimum、intermediate 必须有可测 phase / group-delay 差异。
- apodizing mode response test：必须证明它改变 ringing/response 目标，而不是高频修复文案。
- SRC group delay / lookahead / latency report test。
- same-rate bypass test：不需要 SRC 时不能偷偷改变 sample grid。
- output device double-resampling risk flag test。
- SRC quality rollback stays inside UZUME Poly-Sinc family test。
- sample-rate family partition plan correctness。
- 44.1k family / 48k family response resample quality test。
- partitioned FFT convolution vs high-precision direct/offline reference。
- block size / FFT size / hop size / tail length report test。
- tail drain / reset / gapless no-reset history test。
- incompatible convolution source split reason test。
- no duplicate convolver / no duplicate FFT plan for compatible sources。
- source PCM concat vs gapless no-reset null / residual test。
- playlist next-track pre-roll deadline test。
- callback ring under CPU-only playback test。
- render-ahead cache hit / miss / evict test。
- stale generation GPU commit rejection。
- user_random_seek_or_skip short-bridge eligibility test。
- cold start / playlist boundary / gapless boundary reject short-bridge test。
- full-profile ready 后 equal-power crossfade test。
- different sample-rate next-track dual-pipeline handoff test。
- CPU reference vs CPU AVX2 null test。
- CPU reference vs CPU AVX512 null test。
- CPU reference vs GPU cuFFT null test。
- fallback injection。
- realtime underrun simulation。
- GPU deadline miss does not block callback simulation。

建议误差门槛先按功能分层：

```text
float64 reference:
  offline truth source

float32 CPU/GPU realtime:
  RMS error and max absolute error bounded by profile
  no systematic drift
  no block boundary discontinuity
  no stale generation commit

SRC:
  passband ripple, stopband attenuation, alias rejection measured
  cutoff and transition width measured
  group delay and lookahead reported in frames and milliseconds
  phase mode correctness measured for linear / minimum / intermediate profiles
  apodizing response measured; not presented as bandwidth restoration
  same-rate bypass measured to preserve sample grid
  source family / exact source rate / exact target rate are explicit
  output device double-resampling risk is reported
  phase accumulator continuity measured for gapless no-reset
  quality rollback remains inside UZUME Poly-Sinc family
  random-access short bridge is rejected outside user_random_seek_or_skip

Convolver:
  impulse alignment, latency, tail correctness measured
  overlap history continuity measured for gapless no-reset
  merged response equals serial reference within profile error bounds
  compatible FIR sources use one shared convolution plan
  incompatible FIR sources explain split reason
  sample-rate family and exact sample rate are explicit
  internal FFT block size is independent from callback block size
  partition plan reports direct head, FFT sizes, hop sizes, tail frames
  8192 taps direct convolution is not a formal quality or length ceiling
  response resample quality measured; no linear interpolation in formal path

Shared Engine Compiler:
  UI sections do not own runtime processors
  engine assignment stable and inspectable
  merge groups and latency owners are reported
  duplicate FFT/convolution plans rejected unless split reason exists

Stereo Procedural EQ:
  ordered steps are respected
  channel scope is respected
  pre-crossfeed and post-crossfeed EQ are not silently reordered
  matrix mix matches reference
  crossfeed H_LL / H_RL / H_LR / H_RR response is measured
  mono compatibility and center image policy are measured
  required headroom is reported

Safety Metering / Limiter:
  sample peak / true peak / inter-sample over are tracked by stage
  peak expansion is attributed to a stage
  headroom recommendation names source stage and reason
  limiter gain reduction and trigger count are separate from clipping risk
  sample-domain safety limiter is not mislabeled as true-peak/lookahead limiter

Format Path:
  PCM bit-perfect, PCM processed, DSD direct, DSD upsampling, D2P, and SDM are separate states
  direct disabled reason is reported when DSP changes DSD content
  unavailable path reasons are reported per device/source/profile
  DSD direct never enters PCM DSP / SRC / limiter / dither
  DSD upsampling exposes only SDM modulator, headroom, safety metering, and overload guard
  DSD upsampling rejects PCM-domain DSP controls and reports disabled reasons
  D2P reports decimation profile and internal PCM rate
  SDM reports modulator profile, target DSD rate, overload margin, ultrasonic noise risk
  PCM dither and SDM noise shaping are not conflated

Continuity:
  callback ring never waits on GPU
  pre-roll completes before track boundary under safe profiles
  random access policy produces audio within configured deadline
  crossfade residual and gain law measured

SDM:
  overload stability, in-band noise, ultrasonic noise profile measured
```

测试输出应生成 artifacts：

- frequency response。
- SRC profile / filter-family report。
- SRC phase / group-delay / latency report。
- SRC alias rejection / passband / stopband report。
- output double-resampling risk report。
- spectrogram。
- null residual。
- latency report。
- realtime factor report。
- callback ring depth report。
- render-ahead depth / cache report。
- pre-roll deadline report。
- format path / direct disabled reason report。
- DSD upsampling SDM-only / disabled-controls report。
- D2P decimation / internal PCM rate report。
- SDM modulator / overload / ultrasonic noise report。
- random-access short-bridge report。
- shared engine assignment report。
- merged response / split reason report。
- backend comparison table。

## 构建建议

当前 `native/audio-host/CMakeLists.txt` 使用 CMake 3.24、JUCE 8、C++17。UZUME 建议沿用 CMake，并把 optional backend 做成开关：

```cmake
option(ECHO_UZUME_ENABLE_AVX2 "Enable UZUME AVX2 kernels" ON)
option(ECHO_UZUME_ENABLE_AVX512 "Enable UZUME AVX512 kernels" OFF)
option(ECHO_UZUME_ENABLE_CUDA "Enable UZUME CUDA/cuFFT kernels" OFF)
option(ECHO_UZUME_ENABLE_MKL "Enable UZUME oneMKL backend" OFF)
option(ECHO_UZUME_ENABLE_IPP "Enable UZUME Intel IPP backend" OFF)
```

构建原则：

- 默认构建不要求 CUDA。
- 默认普通用户包不因缺少 CUDA 失败。
- CUDA 包可以单独 artifact 或 runtime probe。
- AVX2/AVX512 使用运行时 dispatch，不能让 AVX512 binary 在非 AVX512 机器上崩。
- 第三方数学库 license 和分发必须在引入前确认。

## 风险

主要风险和处理：

| 风险 | 处理 |
| --- | --- |
| GPU 初始化慢 | lazy init，播放前 prewarm，可关闭 GPU |
| GPU kernel 抖动导致 underrun | 冷启动和曲目边界优先等待 GPU full profile ready；播放已经开始后 callback 不等 GPU，CPU 主链只作为 full-quality backup，不启用短滤波 |
| render-ahead cache 造成交互延迟 | callback ring 与 render-ahead cache 分层，pause/stop/mute/volume/declick 走 callback-safe urgent controls |
| gapless 边界 reset 滤波状态 | gapless boundary 与 filter state boundary 分离，source PCM concat reference 测试 |
| 不同采样率下一首切换爆音或等待 | 提前准备第二套 pipeline，边界处切换已 commit 输出，只允许短 declick |
| 随机切歌遇到极长 sinc-L 卡顿 | 默认 Quality First + Predictive Cache；只有 `user_random_seek_or_skip` 可用 Random-Access Short Bridge，full profile ready 后 equal-power crossfade |
| shared engine compiler 错误合并参数 | 每个 merge group 必须有 serial reference、null test、latency owner 和 Signal Path 可解释的 merged sources |
| FIR EQ / 耳机校正 / IR 重复创建 convolver | compiler 以 Shared Convolution Engine 为唯一正式卷积入口；兼容来源必须合并，不兼容必须记录 split reason |
| Shared Convolution Engine 退化成 8192 taps demo | 8192 taps direct convolution 只允许 legacy / diagnostic；正式路径必须通过 sample-rate-family partitioned FFT plan、tail report 和 direct/offline reference 测试 |
| callback block size 误导 FFT block size | ConvolutionPartitionPlan 显式区分 callback block、internal FFT block、hop size 和 output ring commit block |
| 采样率族混用导致响应错误 | 44.1k / 48k / custom family 独立 plan cache 和 response resample policy；Signal Path 显示 sample-rate family 和 exact sample rate |
| 过度合并破坏语义 | phase policy、sample rate、channel routing、latency、gapless state 不兼容时只能在同一 shared engine 内生成受控子 section |
| headroom / limiter 状态混成一个红灯 | Headroom、Safety Metering、Limiter 分开上报：推荐余量、true peak/clip history、limiter gain reduction 分别显示 |
| stale GPU block 写回新播放 | 所有 render job / cache / commit 带 generation id，seek/profile/device 变化立即 invalidate |
| CPU/GPU 输出不一致 | reference tests，误差门槛，profile 锁定 |
| AVX512 兼容性 | runtime dispatch，默认关闭到验证充分 |
| 长 FIR 延迟破坏体验 | Signal Path 显示 latency，Safe/Marginal/Unsafe，fallback |
| SRC profile 名称掩盖真实滤波语义 | `ResamplingProfile` 必须显示 family、phase、apodizing、cutoff、transition、attenuation、group delay 和 preflight artifacts |
| internal precision 被误认为 SRC | 文档和 Signal Path 分开显示 precision domain 与 Resampling Engine；same-rate bypass 必须证明 sample grid 未改变 |
| shared/system output 二次重采样 | output planner 标记 double-resampling risk；shared output 下默认不推荐高阶 UZUME SRC |
| minimum-phase / apodizing profile 带来 peak expansion | Safety Metering 记录 peakExpansionDb、stageOfMaxPeak 和 recommended headroom，不让 SRC phase 选择绕过 headroom 反馈 |
| quality rollback 滑回外部 resampler | rollback chain 只能指向 UZUME Poly-Sinc profile；非 UZUME rollback 必须显示 UZUME bypass |
| legacy SOXR 与 UZUME 边界混淆 | SOXR 只作为旧 DecoderPipeline 事实和非 UZUME rollback；UZUME 正式 SRC / quality rollback 均使用 Poly-Sinc 家族 |
| UZUME 被拆成小 DSP 链 | 以 fused profile compiler 和 macro-kernel 为硬边界，禁止以 processor chain 作为主路径 |
| 曲库/播放被拖慢 | 进程/线程隔离，lazy load，资源限额 |
| DSD direct 被误报为可 DSP | `dsd_direct` 下禁用改变样本的 DSP，并显示切到 DSD upsampling、D2P 或 SDM 才能处理 |
| DSD upsampling 被误做成完整 DSP path | `dsd_upsampling` 只开放 SDM modulator、headroom、Safety Metering / overload guard；其它 DSP 控件必须 disabled 并报告原因 |
| D2P 与 SDM 状态混淆 | `formatPath`、internal domain、output container、dither/noise-shaping telemetry 分开上报 |
| DSD 文案过度承诺 | Direct / Processed 明确区分，未完成 SDM 不暴露 |
| Room Correction 命名过度承诺 | 降级为 Experimental IR Convolver；`ConvolutionProcessor` 只保留 pre/legacy 接口 |

## Phase Exit Gates

UZUME 不再维护独立 MVP 清单。可交付状态绑定到 phase 的 exit gate，避免实现计划和验收计划分裂。

Phase 0 exit：`Contract Gate`

- Legacy / UZUME 边界冻结：`LegacyDspChain` 独立，UZUME 不包 legacy processor chain，legacy rollback 显示为 non-UZUME path。
- `formatPath`、fused profile、engine assignment、ResamplingProfile、StereoProceduralProfile、Headroom/Safety/Limiter、Shared Convolution、continuity/cache telemetry schema 定义完成。
- 现有 SOXR、DspChain、ConvolutionProcessor 的角色被记录为 legacy / transitional fact，不进入 UZUME formal path。
- gapless boundary、filter state boundary、quality rollback、random-access short bridge、GPU wait policy 的语义边界明确。

Phase 1 exit：`Skeleton Gate`

- 前后端 skeleton 跑通：AudioSession、ProfileCompiler、UzumeEngine identity/bypass、NativeOutputBridge、telemetry、frontend Signal Path。
- `DspChain -> UzumeEngine` wrapper route 不再是正式路径；legacy 与 UZUME 由 host / output bridge 并列选择。
- 本地 multi-stage UZUME PR 已完成 keep / adapt / drop 分类，且没有把 DspChain route 带入 skeleton gate。
- `formatPath` 覆盖 PCM bit-perfect、PCM processed、DSD direct、DSD upsampling、D2P、SDM 的 available / unavailable / disabled reason。
- 前端 thin UI 能显示基础 section、formatPath plan、runtime/profile/disabled reason 和控件 gating；未实现 section 不暴露假开关，也不宣称高质量 DSP 算法完成。
- 默认关闭，不影响普通播放、曲库和资料功能。

Phase 2 exit：`Reference Gate`

- CPU float64 reference path、formatPath planner、Stereo Procedural EQ / Crossfeed、Headroom / Safety Metering / Limiter、ResamplingProfile、Shared Convolution assignment / planner 全部有 reference 行为。
- 输出 artifacts：frequency response、phase / group-delay、alias rejection、latency、realtime budget、null residual、shared engine assignment report。
- UI section 只作为参数来源，runtime processor ownership 由 compiler assignment 决定。
- 仍默认不进入正式播放链路。

Phase 3 exit：`UZUME PCM MVP`

- AVX2 realtime PCM macro-kernel 可在开关下替代 legacy `DspChain`，并覆盖 headroom/gain、EQ、channel、limiter、Stereo Procedural EQ / Crossfeed、UZUME Poly-Sinc realtime SRC。
- CPU realtime worker、input queue、committed output ring 完成，audio callback 只读 committed block。
- Signal Path / telemetry 显示 formatPath、shared engine assignment、Resampling family/phase/apodizing/source-target/group delay/realtime safety/double-resampling risk、stereo procedural order、crossfeed matrix-filter、headroom recommendation、safety meter state、limiter gain reduction、callback ring depth、pre-roll/gapless/quality rollback/short bridge 状态。
- 完整 flush / seek / pause / resume / gapless generation id；next-track pre-roll 与 Random-Access Short Bridge 策略通过测试。
- 测试 artifacts 证明 CPU reference 与 AVX2 等价，并证明 formatPath planner、PCM processed、Resampling Engine、Stereo Procedural EQ / Crossfeed、Headroom/Safety/Limiter telemetry、gapless concat reference、pre-roll deadline、callback ring、generation invalidation 通过。
- Phase 3 不要求 production-grade long FIR、GPU offload、D2P 或 SDM 正式可用。

Phase 4 exit：`Convolution Production Gate`

- Shared Convolution Engine production path 完成：IR import/preflight、response merge/split reason、sample-rate family planner、partitioned FFT convolution、direct head + non-uniform FFT tail、tail/drain state。
- FIR EQ、headphone FIR correction、room IR 在兼容时合并为同一 convolution plan；不兼容时 Signal Path 必须解释 split reason。
- 8192 taps direct convolution 只保留为 legacy / diagnostic / tiny-IR fallback。

Phase 5 exit：`GPU Render-Ahead Gate`

- CUDA/cuFFT backend、memory pool、pinned buffer、stream/event、render job queue、generation-safe commit、fallback、telemetry 完整。
- GPU 优先 offload Shared Convolution Engine 中 FFT / FIR section，不进入 audio callback。
- GPU cuFFT plan / filter FFT cache 挂在 sample-rate-family partition plan 上，不作为孤立 primitive 或 per-section convolver。
- CPU reference vs GPU null test 和 cache/deadline/rollback telemetry 通过。

Phase 6 exit：`DSD Family Gate`

- DSD direct、DSD upsampling SDM-only、D2P、SDM processed 四种状态不可混淆。
- DSD upsampling 只开放 SDM modulator、headroom、Safety Metering / overload guard。
- D2P ingress、PCM -> SDM 5th-order、overload / ultrasonic noise telemetry、target DSD rate / realtime safety 和 fallback policy 有 reference 或 realtime 实现。

Phase 7 exit：`Advanced Backend Gate`

- AVX512、GPU custom kernel 和 backend benchmark matrix 只在已有 reference / realtime path 稳定后推进。
- 每个 advanced backend 必须有 CPU reference null test、backend feature flag、runtime dispatch、fallback reason 和 Signal Path telemetry。
- 用户可选 CPU/GPU preference 不能绕过 realtime safety、generation-safe commit、callback non-blocking 和 quality rollback 规则。

## 当前 PR 准备状态

本分支记录当前 UZUME 过渡实现状态，并把后续工作收敛到 Phase Exit Gates；它不再定义独立 MVP 清单，也不宣称一次性完成完整 SRC/FIR/SDM/GPU offload。当前只是 fork-backed PR 准备状态，不表示上游 PR 已创建、可合并或完整 UZUME 已可工作：

- 当前操作分支是 `uzume-dspchain-replacement`，当前 tracking `fork/uzume-dspchain-replacement` 作为远端备份；RPC-001 skeleton 收口后的 RPC-002 reference UI / test / 文档推进均在本分支继续追踪。防冲突仍以 upstream `origin/main` 为准，且 fork base 必须保持同步：先运行 `npm run sync:fork-base`，确认 `git rev-list --left-right --count origin/main...fork/main` 为 `0 0`，再确认 `git rev-list --left-right --count origin/main...HEAD` 没有 left-side 落后；如果 fork main 分叉，脚本会失败并要求停下确认，不强推覆盖。
- RPC-001 已剔除 `DspChain -> UzumeEngine` wrapper route：`DspChain.h/.cpp` 不再 include、持有或转发 `UzumeEngine`；后续仍应拆出 / 保留独立 `LegacyDspChain` backend，由 host / output bridge 并列选择 legacy 或 UZUME。
- 当前 native PCM realtime skeleton 由 host 直接持有 `UzumeEngine`；它仍是 `transitional-processor-chain` / `uzume-skeleton-compat`，不是正式 fused macro-kernel，也不是 Poly-Sinc / Shared Convolution / SDM 完成状态。
- 当前 UZUME UI 已替代旧 DSP 页面；未真正实现的 UZUME 子模块（Headroom、SRC、EQ、OPRA、FIR、Matrix、Safety 等）显示 `未实现`，不提供按钮、滑杆或开关。旧 Headroom / EQ / FIR / Matrix / Safety / ECHO-SOXR 状态只作为 legacy / compat readout。
- Host ready / position JSON、`NativeOutputBridge`、`AudioSession`、`AudioStatus`、Signal Path、Professional Status Panel 已透传 UZUME backend/profile/runtime/fallback/CUDA/cuFFT 信息，并新增 `uzumeFormatPathPlan`：`pcm_bitperfect`、`pcm_processed`、`dsd_direct`、`dsd_upsampling`、`d2p_processed`、`sdm_processed` 均有 `state` 与 `reason`。其中 `uzumeBackend` 表示当前真实播放处理 backend，`uzumeGpuCompiled` / `uzumeGpuAvailable` / `uzumeGpuCufftAvailable` 表示 CUDA/cuFFT 能力；只有实际播放 block 走过 CUDA prepared planar multichannel safety-limiter、CUDA safety-limiter 或 adjacent identity stereo matrix+limiter pairs 时才报告 `hybrid-gpu-limiter`，稳定简单 Channel Balance 矩阵（仅首个 stereo pair，额外声道保持原样，含已稳定的 mono mode 矩阵）也实际走过 CUDA 时才报告 `hybrid-gpu-matrix-limiter`，不会把可用 CUDA 误报成完整 GPU profile offload。
- RPC-002 已开始推进 reference vertical slice：新增主进程 `UzumeReferencePlan`，由 `AudioSession` 生成 `uzumeReferencePlan` inspect report，并用 reference planner 产出的六条 `uzumeFormatPathPlan` 替代 RPC-001 skeleton placeholder reason；Professional Status 现在能显示 reference compiler schema/internal domain、active engine assignment、UZUME SRC reference report 和 Shared Convolution planner report。Resampling Reference 已补入离线 windowed-sinc float64 SRC、same-rate exact bypass、rational phase accumulator telemetry、filter contract、deterministic impulse/sweep/logarithmic-sweep/near-Nyquist/multi-tone/seeded-random/silence-preservation/phase-spread/alias-rejection metrics、passband/stopband/cutoff estimates、linear/minimum/intermediate phase-mode artifact、apodizing response artifact、output double-resampling risk artifact、Poly-Sinc-only quality rollback report、scalar float64 realtime budget estimate、same-rate exact-bypass null residual、Poly-Sinc formal validation report 和 high-precision FIR/IR/target response resample reference；Shared Convolution Planner Reference 已补入 FIR EQ / headphone FIR / room IR merge simulation、sample-rate family、callback/internal block、direct head、FFT tail ladder、tail/drain/warm-up、split reason、response preflight peak/DC offset/NaN/Inf/channel mismatch report 和 merged-response vs serial direct FIR null reference artifact；Stereo Procedural / Crossfeed Reference 已补入 trim、mute/solo、invert、swap、mono fold-down、L/R fractional delay、2x2 matrix mix、crossfeed matrix-filter、cross delay、low-pass/head-shadow、mono center preservation 和 per-ear EQ pre/post-crossfeed placement residual；PCM Ingress Guard Reference 已补入 silence、NaN/Inf replacement、denormal zeroing 和 channel/frame mismatch preflight artifact；Gain Staging Reference 已补入 headroom -> ReplayGain -> materialized gain -> output 的顺序、cumulative gain telemetry、clip-risk 和 recommended extra headroom；Headroom / Safety Metering / Limiter Reference 已补入 stage peak/RMS/true-peak estimate/clip count/peak expansion、after-convolution peak attribution、recommended headroom 和 sample-domain limiter gain-reduction telemetry；PCM Output Quantization / Dither Reference 已补入 bit-perfect bypass、float PCM bypass、fixed-point PCM deterministic TPDF / noise-shaped quantization telemetry、PCM dither disables bit-perfect，以及 SDM/DSD 输出拒绝 PCM dither；Gapless Concat Reference 已补入 source PCM concat-before-SRC policy、no-reset continuity residual、reset-per-track SRC boundary residual 和 non-integer ratio cumulative offset；FIR Gapless History Reference 已补入 source PCM concat-before-FIR truth、逐曲 no-reset history residual、reset-per-track residual、tail/drain frames 和 boundary overlap history；Pre-Roll Deadline Reference 已补入 next-track pre-roll required frames、deadline slack、callback ring read-committed-only、render-ahead cache state、stale generation reject 和 dual-pipeline handoff report；CPU Callback Ring Reference 已补入 CPU full-profile producer 写 committed ring、callback 只读 committed frames、ring depth / underrun risk telemetry 和 stale producer write rejection；Render-Ahead Cache Reference 已补入 generation-valid hit commit、late block future-retain、stale hit reject、cache hit/miss/evict 和 callback 不等待 GPU 规则；Callback-Safe Urgent Controls Reference 已补入 pause/stop/mute/volume/declick over committed output、gain envelope / declick report、render-cache preserve，以及 seek/flush/reset/profile/device change generation boundary invalidation；Fallback Injection / Underrun Simulation Reference 已补入 GPU late block 不阻塞 callback、CPU full-profile fallback、controlled silence injection、underrun telemetry 和 short bridge rejection；DSD Family Path / Control Reference 已补入 DSD direct bitstream-only、DSD upsampling SDM-only disabled-controls、D2P decimation/internal PCM rate report、SDM modulator/overload/ultrasonic telemetry 与 PCM dither / SDM noise-shaping 分离；Equal-Power Crossfade Reference 已补入 random-access short bridge 到 full profile 的 gain law、hard-switch residual、peak 和 intent/readiness gate；Continuity Strategy Reference 已补入 Quality First / GPU Wait / Predictive Cache / Random-Access Short Bridge policy decision、full-profile-ready short bridge rejection、stale generation rejection 和 callback-read-committed-output rule。此项仍是离线/只读 reference surface，不进入正式播放热路径；production-grade Shared Convolution DSP、partitioned FFT runtime 和 production serial/null gate 由 RPC-004 `Convolution Production Gate` 承接，不作为 RPC-002 阻塞项。
- RPC-002 本轮继续补 continuity/cache inspect UI：`uzumeReferencePlan.continuity` 汇总 Continuity Strategy、Pre-Roll Deadline、CPU Callback Ring、Render-Ahead Cache 与 Fallback Injection reference report；Signal Path / Professional Status 现在能显示 callback read-committed-only、pre-roll deadline/cache state、ring depth、no GPU wait、fallback source、quality rollback 与 random-access short bridge rejection。此项仍是只读 telemetry surface，不表示 production callback ring、render-ahead cache 或 GPU fallback 已接入播放热路径。
- RPC-002 本轮继续补 expected Continuity / Cache visual-state guard：当 continuity policy 坚持 callback read-committed-only、pre-roll deadline safe、callback ring stable/safe、render-ahead miss 只保留 prior committed output、fallback 为 safe/marginal controlled fallback 且 short bridge 被 underrun protection 拒绝时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；unsafe fallback 仍保留 danger/warning。此项仍是 reference contract 状态，不表示 production callback ring、render-ahead cache writer 或 GPU fallback runtime 已启用。
- RPC-002 本轮继续补 callback-safe urgent controls / equal-power crossfade inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.callbackSafeControls` 与 `uzumeReferencePlan.equalPowerCrossfade`，Signal Path / Professional Status 显示 mute/declick urgent control、render-cache preserve、seek generation boundary invalidation、Random-Access Short Bridge -> full profile equal-power gain law、hard-switch residual 和 gapless-boundary rejection。此项仍是只读 deterministic artifact telemetry，不表示 production callback urgent-control path 或 short-bridge crossfade runtime 已接入。
- RPC-002 本轮继续补 expected Callback-Safe / Crossfade visual-state guard：mute/declick over committed output + seek generation boundary invalidate、random-seek equal-power crossfade accepted + gapless boundary rejected 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 reference contract 状态，不表示 production callback urgent-control path 或 short-bridge crossfade runtime 已接入。
- RPC-002 本轮继续补 SRC rollback inspect UI：Signal Path / Professional Status 现在显示 `UZUME SRC rollback reference`，包含 Poly-Sinc primary profile、balanced/short rollback chain、family lock、legacy fallback boundary 和 Random-Access Short Bridge 非 rollback 边界；这是 reference telemetry，不表示 runtime 已启用 profile 降级。
- RPC-002 本轮继续补 reference bit-perfect inspect UI：Signal Path / Professional Status 现在显示 compiled reference plan 的 `bitPerfectState`、`directDisabledReason`、source/output container、internal domain 与 formatPath，并与 runtime/native `UZUME bit-perfect` 状态分开；这是 reference planner 可解释性，不覆盖正式播放状态。
- RPC-002 本轮继续补 Backend Support Reference inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.backendSupport`，Signal Path / Professional Status 显示 `cpu-float64-reference` 是当前 RPC-002 选中的 deterministic backend、realtime backend 未启用、AVX2/GPU backend 分别留给后续 gate，以及 legacy DSP chain 不能进入 UZUME compiler。此项仍是只读 Reference Gate telemetry，不表示 runtime backend switch 已启用。
- RPC-002 本轮继续补 expected Backend Support visual-state guard：当 backend support report 固定为 reference-only/no-runtime-switch、CPU float64 deterministic reference 可用、AVX2/GPU runtime backend 明确留给后续 gate、legacy DSP chain 被 compiler 阻止且 reasons 完整时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；legacy compiler allowed 或 gate 漂移时仍回 warning。此项仍是 reference backend contract 状态，不表示 runtime backend switch 或 production backend 已启用。
- RPC-002 本轮继续补 Output Device Policy inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.outputDevicePolicy`，Signal Path / Professional Status 显示 output mode、device capability、file/decoder/requested/actual/shared rate、bit-perfect candidate、resampling/mismatch，以及 shared/system mixer risk 或 direct-like device-rate mismatch recommendation。此项仍是只读 Reference Gate telemetry，不改变 output device / mixer policy。
- RPC-002 本轮继续补 direct-like output device mismatch visual-state guard：Signal Path / Professional Status 对 exclusive/direct-like requested rate 与 actual device rate 不一致保持 warning，显示 requested/actual rate、`direct-like-rate-mismatch`、`inspect-device-rate-mismatch` recommendation，并继续显示 `scheduler not-enabled`。此项仍是 reference-only policy telemetry，不表示 output policy 或 production scheduler 已改变。
- RPC-002 本轮继续补 Latency Budget Reference inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.latencyBudget`，Signal Path / Professional Status 把 backend、SRC group delay/lookahead、Shared Convolution latency/direct-head/warm-up/tail/drain、callback block、pre-roll、callback ring depth、render-ahead/cache budget 与 latency owners 汇总成一个 reference-only row/node。此项仍是只读预算摘要，不表示 production scheduler、latency compensation 或 realtime backend 已启用。
- RPC-002 本轮继续补 Readiness Contract Reference inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.readinessContract`，Signal Path / Professional Status 显示 full-profile ready/not-ready、GPU prewarm gate、cache/commit state、render-ahead depth、deadline slack、callback ring status、short-bridge candidate、generation commit rule 与 production scheduler 状态。此项仍是只读 readiness contract，不让 Renderer 控制 timeline，也不表示 production scheduler 已启用。
- RPC-002 本轮继续补 direct-like output / readiness positive visual-state guard：`direct-like-ready` output policy 与 `ready-to-commit` readiness reference 在 Professional Status 标成 good，Signal Path 节点保持 process/non-warning，并继续显示 `scheduler not-enabled`。此项仍是 reference-only 状态，不表示 output policy 或 production scheduler 已改变。
- RPC-002 本轮继续补 Generation Cache Key Reference inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.generationCacheKey`，Signal Path / Professional Status 显示 generation id、timeline scope、request/cache key、profile/device fingerprint、album segment/index、invalidate/preserve 规则、stale commit rule 与 late callback slot rule。此项仍是只读 cache-key contract，不表示 production render-ahead cache writer 已启用。
- RPC-002 本轮继续补 Latency Budget / Generation Cache Key ready visual-state guard：`latencyBudget.state: ready` 与 `generationCacheKey.state: ready` 在 Professional Status 标成 good，Signal Path 节点保持 process/non-warning，同时文案继续显示 `reference-only` 与 `renderer inspect-only`。此项仍是 reference contract 状态，不表示 production scheduler、latency compensation 或 production cache writer 已启用。
- RPC-002 本轮继续补 gapless album-segment generation cache-key guard：gapless reference plan 锁定 `gapless-album-segment`、`album-reference:segment-0:index-1`、segment index 与 `renderer inspect-only`，Signal Path / Professional Status 均显示 album segment/index 且保持 good/process。此项仍是只读 keying telemetry，不表示 production cache writer 已启用。
- RPC-002 本轮继续补 Realtime Budget Summary Reference inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.realtimeBudgetSummary`，Signal Path / Professional Status 显示 realtime factor 在 RPC-002 未实测、scalar float64 SRC 预算、callback ring depth、render-ahead coverage、CPU full-profile fallback，以及 RPC-003 CPU realtime gate / RPC-005 GPU render-ahead gate；Realtime Budget Summary 与 Render-Ahead Cache 的 UI 标题均显式标为 `reference`。此项仍是只读预算摘要，不表示 production realtime backend、production scheduler、production cache writer 或 GPU render-ahead worker 已启用。
- RPC-002 本轮继续补 Artifact Manifest Reference inspect UI：Signal Path / Professional Status 现在显示 `UZUME artifact manifest reference`，按 deterministic / planned / not-applicable 分桶汇总 compiled `artifactPlan`，并列出 source artifact 与 report artifact 清单；manifest formatter 已抽成 shared helper，并用 helper-level unit test 锁定 deterministic 38/38、planned warning flag、not-applicable 非阻塞与 null fallback。此项仍是只读 Reference Gate manifest，不表示 production runtime artifact writer 已启用。
- RPC-002 本轮继续补 reference formatPath plan inspect UI：Signal Path 现在显示 `UZUME reference path plan`，逐条列出 PCM bit-perfect、PCM processed、DSD direct、DSD upsampling、D2P、SDM 的 state/reason，让 direct disabled 和 unavailable path reason 不只停留在 Professional Status。
- RPC-002 本轮继续补 SRC budget inspect UI：Signal Path / Professional Status 现在显示 `UZUME SRC budget reference`，包含 scalar float64 reference backend、estimated multiply-adds、realtime factor 是否未实测、safety class 和 same-rate null residual 状态；这是 artifact telemetry，不表示 realtime SRC 已接入。
- RPC-002 本轮继续补 same-rate bypass SRC budget visual-state guard：Professional Status 现在把 `same-rate-bypass-reference` realtime summary 与 `same-rate-bypass` SRC budget 标成 good，Signal Path popover 对应节点保持 process/non-warning，并显示 exact-bypass null residual；这是 reference-only good/process state，不表示 production realtime SRC backend 已启用。
- RPC-002 本轮继续补 SRC artifact inspect UI：Signal Path / Professional Status 现在显示 `UZUME SRC artifact reference`，包含 passband ripple、stopband attenuation、cutoff/transition estimate、phase group-delay spread、silence residual、multi-tone peak、seeded-random peak 和 deterministic random seed；这是只读 artifact telemetry，不表示 realtime SRC 已接入。
- RPC-002 本轮继续补 SRC formal validation inspect UI：compiled reference plan 现在携带 `poly-sinc-formal-validation-reference` report；Signal Path / Professional Status 现在显示 `UZUME SRC validation reference`，包含 overall 与 passband/stopband/transition/silence/same-rate-null/realtime-budget checks。此项是 Reference Gate telemetry，不表示 runtime SRC gate 已启用。
- RPC-002 本轮继续补 SRC output-risk inspect UI：Signal Path / Professional Status 现在显示 `UZUME SRC output risk reference`，包含 `output-double-resampling-risk-reference` 的 state、reason、requested/actual/shared rate、current legacy resampler、Signal Path tone 和 recommendation。此项仍是只读 reference telemetry，不改变 output device / mixer policy。
- RPC-002 本轮继续补 SRC phase/apodizing inspect UI：Signal Path / Professional Status 现在显示 `UZUME SRC phase/apodizing reference`，包含 linear/minimum/intermediate phase artifact 的 group-delay/spread/residual，以及 apodizing vs rectangular baseline 的 ringing reduction、response residual 和 no-high-frequency-restoration claim。此项仍是 deterministic artifact telemetry，不表示 runtime SRC profile 已启用。
- RPC-002 本轮继续补 expected SRC artifact / phase-apodizing visual-state guard：当 Poly-Sinc formal validation pass、SRC artifact metrics 完整且 exact-silence / seeded-random / passband / stopband / cutoff / transition 有效、phase mode linear/minimum/intermediate 与 apodizing no-high-frequency-restoration claim 对齐时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；offline-reference-only budget 与 output-risk 仍保留 warning。此项仍是 reference contract 状态，不表示 production realtime SRC backend 或 runtime SRC profile 已启用。
- RPC-002 本轮继续补 expected core SRC reference visual-state guard：当 Poly-Sinc reference family、rate/ratio/family、rational phase accumulator、filter contract、group-delay/lookahead ms、formal validation、artifact metrics 与 phase/apodizing artifacts 全部对齐时，Professional Status 的 `UZUME SRC reference` 标成 good，Signal Path 节点保持 process/non-warning；phase accumulator 或 telemetry 漂移时仍回 warning。此项仍是 reference contract 状态，不表示 production realtime SRC backend 已启用。
- RPC-002 本轮继续补 PCM output quantization / dither inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.pcmOutputQuantization`，Signal Path / Professional Status 显示 output sample format、bit-perfect/dither state、deterministic seed、LSB、residual、clip count、SDM noise-shaping separation 和 reasons。此项仍是只读 Reference Gate telemetry，不表示 production output writer、PCM dither gate 或 SDM/noise-shaping runtime 已接入。
- RPC-002 本轮继续补 expected PCM output quantization visual-state guard：fixed-point PCM quantized、deterministic dither seed/LSB present、clip count 为 0 且 residual 有效时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 reference contract 状态，不表示 production output writer 或 dither gate 已启用。
- RPC-002 本轮继续补 PCM ingress guard / gain staging inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.pcmIngressGuard` 与 `uzumeReferencePlan.gainStaging`，Signal Path / Professional Status 显示 expected channel/frame/rectangular state、sanitizer counts、peak、headroom -> ReplayGain -> materialized gain 顺序、cumulative gain、clip risk、recommended extra headroom 和 reasons。此项仍是只读 Reference Gate telemetry，不表示 production ingress sanitizer 或 gain processor 已接入。
- RPC-002 本轮继续补 block boundary / flush-drain inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.blockBoundary` 与 `uzumeReferencePlan.flushDrain`，Signal Path / Professional Status 显示 block size、exact coverage、padding-not-committed、boundary residual、natural EOF drain commit、manual flush tail drop、generation increment/reset 和 reasons。此项仍是只读 Reference Gate telemetry，不表示 production callback block scheduler 或 transport flush/drain runtime 已接入。
- RPC-002 本轮继续补 expected Flush / Drain visual-state guard：natural EOF drain commit + manual flush tail drop/reset 且 residual 为 0 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 reference contract 状态，不表示 production transport drain runtime 已接入。
- RPC-002 本轮继续补 gapless SRC / FIR gapless history inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.gaplessConcat` 与 `uzumeReferencePlan.firGaplessHistory`，Signal Path / Professional Status 显示 source PCM concat-before-SRC/FIR policy、no-reset residual、reset-per-track residual、boundary offset、FIR overlap history、tail/drain 和 reasons。此项仍是只读 deterministic artifact telemetry，不表示 production gapless callback 或 production FIR runtime 已接入。
- RPC-002 本轮继续补 expected Gapless visual-state guard：source PCM concat-before-SRC/FIR 的 no-reset/history residual 为 0，reset-per-track 对照 residual 非 0 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 reference contract 状态，不表示 production gapless callback 或 production FIR runtime 已接入。
- RPC-002 本轮继续补 PEQ/IIR / Channel Scope / Stereo Procedural inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.iirEq`、`uzumeReferencePlan.channelScope` 与 `uzumeReferencePlan.stereoProcedural`，Signal Path / Professional Status 显示 biquad band/order/response/residual、target-channel scope/no-op/invalid-source decisions、stereo procedural trim/delay/routing/matrix/crossfeed-disabled state 和 visual tone。此项仍是只读 Reference Gate telemetry，不表示 production PEQ、channel router 或 crossfeed runtime 已接入。
- RPC-002 本轮继续补 Per-Ear EQ Placement inspect UI：compiled reference plan 现在携带 `uzumeReferencePlan.perEarEqPlacement`，Signal Path / Professional Status 显示 pre-crossfeed EQ / crossfeed matrix-filter / post-crossfeed EQ order contract、placement residual、compiler rule `do-not-reorder-across-crossfeed-without-null-proof` 和 reasons。此项仍是只读 Reference Gate telemetry，不表示 production crossfeed/per-ear EQ runtime 已接入。
- RPC-002 本轮继续补 expected DSP reference visual-state guard：gain staging 顺序/clip budget、PEQ/IIR band/order/residual、Channel Scope targeted-only/out-of-scope exact bypass、Stereo Procedural ordered steps、Per-Ear EQ no-reorder placement rule 全部对齐时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning；clip risk、invalid scope、order/reason 漂移或 placement rule 漂移时仍回 warning。此项仍是 deterministic reference contract 状态，不表示 production PEQ、gain processor、channel router、crossfeed 或 per-ear EQ runtime 已接入。
- RPC-002 本轮继续补 PCM Bit-Perfect Bypass Reference：`pcm_bitperfect` 在 planner direct 条件满足时走 `identity-bypass`，输出 clone 与输入零 residual，并显式禁用 requested sample-changing sections；planner 已给 direct-disabled reason、`pcm_processed` 或 `dsd_direct` 时均不声称 bit-perfect/null。此项仍是离线 reference，不接入播放热路径。
- RPC-002 本轮继续补 PCM bit-perfect positive bypass visual-state guard：Professional Status 把 `bitPerfectState: available` 的 `UZUME reference bit-perfect` 标成 good，Signal Path 对应节点保持 process/non-warning，并显示 direct path available、pcm->pcm、pcm-bypass 与 `pcm_bitperfect`。此项仍是 reference-only identity-bypass 状态，不表示 production output bridge 已改变。
- RPC-002 本轮继续补 PEQ / basic IIR Reference：按 UI band 顺序生成 biquad cascade coefficients、frequency response magnitude/phase 和 processed-vs-bypass residual；disabled band 与 neutral-gain PEQ 走 exact bypass。此项仍是离线 reference，不接入播放热路径。
- RPC-002 本轮继续补 Channel Scope Reference：按 `all` / explicit channels / stereo pair scope 解析目标声道，离线验证 scoped gain/mute/invert/mix-from 只作用于 target channels，out-of-scope channels 保持 exact bypass；invalid scope / source 生成 explainable no-op report。此项仍是离线 reference，不接入播放热路径。
- RPC-002 本轮继续补 Block Boundary Split Reference：按 callback block size 切分 source PCM，验证每个 source frame 只 commit 一次、final block padding 不进入输出、reassembled output 与 source 零 residual，且 block boundary 不引入额外 discontinuity。此项仍是离线 reference，不接入 callback。
- RPC-002 本轮继续补 Flush / Drain Reference：natural EOF commit FIR drain tail 且不递增 generation；manual flush / seek / profile-change 丢弃 pending tail、递增 generation 并要求 render-state reset。此项仍是离线 reference，不接入 callback。
- RPC-002 本轮继续补 Shared Convolution Duplicate Plan Guard / Serial Null inspect UI：compiled reference plan 现在携带 duplicate convolver/FFT guard 与 serial-null report；Signal Path / Professional Status 能显示共享 plan、split reason、per-source duplicate rejection、merged-vs-serial residual 或 split/inactive skip reason。此项仍是 planner/reference，不实现 production convolver 或 production serial-null gate；production-grade Shared Convolution DSP、partitioned FFT runtime 与 production serial-null gate 仍由 RPC-004 承接。
- RPC-002 本轮继续补 expected Shared Convolution planner visual-state guard：当 sources 被 merged/split 完整覆盖、split reason 明确、merged source 与 partition plan 的 sample-rate family/block/FFT/tail/drain 对齐，且 response resample report 覆盖每个 source 时，Professional Status 的 `UZUME convolution reference` 标成 good，Signal Path 节点保持 process/non-warning；split reason、partition projection 或 source coverage 漂移时仍回 warning。此项仍是 planner/reference contract 状态，不表示 production convolver、partitioned FFT runtime 或 production serial-null gate 已启用。
- RPC-002 本轮继续补 expected Shared Convolution duplicate guard visual-state guard：single shared plan、shared sources 复用同一 convolver/FFT plan、split sources 带 explicit split reason，且 duplicate rejection counts 与 rejected list 对齐时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 planner/reference contract 状态，不表示 production convolver 已启用。
- RPC-002 本轮继续补 Shared Convolution serial-null merged visual-state guard：`merged-matches-serial` 且 residual 为 0 的 serial-null reference 在 Professional Status 与 Signal Path 均标成 good；split/inactive skip 仍保持 non-danger muted。此项仍是 reference visual-state guard，不表示 production convolver 或 production serial-null gate 已启用。
- RPC-002 本轮继续补 D2P / SDM unavailable fallback reason：D2P reference engine 未就绪时不进入 PCM DSP、不开放 PCM-domain controls，并报告 `d2p_reference_engine_not_ready`；DSD upsampling / SDM processed 在 SDM reference engine 未就绪时标记 unavailable / experimental、禁用 SDM controls，并报告 `sdm_reference_engine_not_ready`。此项仍是路径/控制 reference，不实现 D2P decimator 或 SDM runtime。
- RPC-002 本轮继续补 DSD Family inspect UI：compiled reference plan 现在可携带 `dsd-family-path-control-reference` report；Signal Path / Professional Status 现在显示 `UZUME DSD family reference`，包含 Direct / DSD upsampling / D2P / SDM 的 state、direct-disabled reason、allowed/disabled controls、D2P decimation/internal PCM rate、SDM telemetry 与 fallback reason。此项仍是只读 reference surface，不实现 D2P/SDM runtime。
- RPC-002 本轮继续补 expected DSD family visual-state guard：当 D2P reference 报告 decimation profile/internal PCM rate、allowed/disabled controls、fallback none 与 SDM separation 对齐时，Professional Status 标成 good，Signal Path 保持 process/non-warning；D2P fallback 或 unavailable 漂移仍回 warning。此项仍是 DSD family reference contract 状态，不表示 D2P/SDM runtime 已启用。
- RPC-002 本轮继续补 response resample inspect UI：Shared Convolution reference report 现在携带 `high-precision-response-resample-policy-reference`；Signal Path / Professional Status 现在显示 `UZUME response resample reference`，包含 FIR/IR response source/target rate family、same-rate exact bypass 或 windowed-sinc float64 reference、linear interpolation rejected 和 filter contract。此项仍是 policy/reference surface，不接入 production convolver。
- RPC-002 本轮继续补 expected response resample visual-state guard：same-rate response exact bypass、cross-family / exact-rate mismatch response 使用 windowed-sinc float64 reference 且拒绝 linear interpolation 时，Professional Status 标成 good，Signal Path 节点保持 process/non-warning。此项仍是 policy/reference contract 状态，不表示 production convolver 已启用。
- RPC-002 本轮继续补 DSD Direct Positive Bypass Reference：native/DoP direct path 在只请求 Safety Metering 时保持 `direct`，不进入 PCM DSP / SRC / limiter / dither，不开放 PCM dither 或 SDM telemetry。此项仍是正向 bypass reference，不实现正式 DSD packetizer。
- RPC-002 本轮继续补 DSD direct positive bypass visual-state guard：Professional Status / Signal Path 现在把 `dsd_direct:direct` 的 `UZUME DSD family reference` 标成 good，显示 direct allowed、only safety-metering allowed、PCM DSP/dither blocked、DoP output encoding 与 bypass reason。此项仍是 reference-only 正向 bypass 状态，不表示正式 DSD packetizer 已启用。
- RPC-002 本轮继续补 SRC Latency Telemetry Reference：Poly-Sinc reference report 同时输出 group delay / lookahead 的 samples 与 milliseconds，Professional Status 的 UZUME SRC row 也显示 ms 读数。此项仍是离线 telemetry/report，不接入 realtime SRC。
- RPC-002 本轮继续补 SRC Silence Preservation Reference artifact：Poly-Sinc deterministic artifact 现在包含 silence stimulus / response、`silenceResidual` 和 formal validation check，证明 sample-rate conversion 不向静音输入引入残留。此项仍是离线 artifact，不接入 realtime SRC。
- RPC-002 本轮继续补 SRC Logarithmic Sweep Reference artifact：Poly-Sinc deterministic artifact 现在单独包含 logarithmic sweep stimulus / response 和 `logSweepPeak` metric，区别于普通 sweep。此项仍是离线 artifact，不接入 realtime SRC。
- RPC-002 本轮继续补 Shared Convolution Response Preflight Reference：IR/FIR import response 离线报告 peak、DC offset、NaN/Inf zeroing、channel mismatch 和 sanitized response；这是 import/preflight reference，不实现 production convolver。
- RPC-002 本轮继续补 PCM After-Convolution Safety Stage Reference：PCM reference 增加离线 direct convolution response stage，Safety Metering 可把 peak expansion / stageOfMaxPeak / stageOfMaxTruePeak 归因到 `after-convolution`，并驱动 recommended headroom。此项仍是 safety telemetry reference，不接入 production convolver。
- RPC-002 本轮继续补 Professional Status reference inspectability：reference assignment 行按 `orderedProfileSections` 显示 active/inactive、merge group、split reason 与 latency owner，并新增 merge groups / latency owners detail row，补齐“Signal Path 能解释每个 UI section engine assignment”的只读状态面证据。
- RPC-002 本轮继续补 expected compiler/assignment visual-state guard：当 schema/telemetry 版本、ordered sections、engine assignment、merge group 与 latency owner 全部对齐时，Professional Status 的 compiler / assignment / merge / latency owner rows 标成 good，Signal Path 节点保持 process/non-warning；缺 assignment、merge group 不对齐或 latency owner 漂移时仍回 warning。此项仍是 compiled reference plan contract 状态，不表示 runtime backend switch 或 production compiler 已启用。
- RPC-002 本轮继续补底部 Signal Path reference nodes：Roon-style popover 现在显示 `UZUME reference compiler`、`Reference assignment`、`Reference merge groups` 与 `Reference latency owners`，覆盖 format-path / PEQ / Shared Convolution / SRC 的 assignment、merge group、split reason 和 latency owner；此项仍是只读 Signal Path telemetry，不开放完整高级 UI。
- RPC-002 本轮继续补底部 Signal Path SRC / convolution reference telemetry：新增 `UZUME SRC reference` 与 `UZUME convolution reference` nodes，显示 SRC family/phase/apodizing/source-target/group delay/lookahead/realtime safety/double-resampling risk、deterministic impulse+sweep+near-Nyquist+phase/group-delay artifact、alias metric，以及 Shared Convolution merged sources/sample-rate family/latency class/block/FFT/tail/drain；此项仍是 reference inspect surface。
- RPC-002 本轮继续补 Headroom / Safety / Limiter 分离状态：Professional Status 新增独立 `UZUME safety meter` 与 `UZUME limiter reference` rows，并把 `UZUME headroom` row 扩展为 gain-reference telemetry；底部 Signal Path 新增对应 reference nodes。测试覆盖 near-limit safety meter 仍保持 sample-domain limiter standby，避免把 meter risk 误报为 limiter active。
- RPC-002 本轮继续补 Signal Path visual-state 审计覆盖：`PlayerBar.test.tsx` 现在锁定 `Reference merge groups`、`Reference latency owners` 与 `UZUME headroom reference` 节点为 process/non-warning，并继续让 Safety Meter / limiter risk 保持 warning；此项只补 UI 状态语义证据，不表示 runtime 控制或 production limiter 已启用。
- `ECHO_UZUME_ENABLE_CUDA` 已作为默认关闭的 CMake / Node build opt-in。默认构建不要求 CUDA；开启后会编译独立 `echo-uzume-cuda-probe` static library，通过 nvcc、CUDA runtime、device probe、cuFFT plan/exec、cuFFT single-block FIR convolution primitive、prepared streaming cuFFT FIR convolution primitive、CUDA safety-limiter kernel、fused gain+limiter kernel、fused stereo matrix+limiter kernel 和不带 limiter 的 stereo matrix kernel 给 Phase 5 GPU Render-Ahead Gate 建立真实编译门。
- 当前 GPU 过渡实现包含 probe / telemetry / fallback 基座、prepared planar multichannel CUDA safety-limiter playback offload、adjacent identity stereo matrix+limiter pair playback offload、稳定简单 Channel Balance 首个 stereo pair matrix playback offload、fused gain+limiter primitive、fused stereo matrix+limiter primitive、不带 limiter 的 stereo matrix primitive、cuFFT R2C/C2R roundtrip primitive，以及 cuFFT FIR primitives：single-block FIR convolution primitive 覆盖 host/device buffer 搬运、kernel launch、clipping risk 回传、cuFFT plan/exec、complex multiply、normalization 和 CPU reference 等价测试；prepared streaming cuFFT FIR convolution primitive 覆盖跨 process 调用 history、reset history、prepared capacity fallback 和两段 block CPU reference 等价测试。
- safety-limiter / planar multichannel safety-limiter / fused gain+limiter / fused stereo matrix+limiter / stereo matrix 已使用 thread-local non-blocking CUDA stream、reusable scratch device buffers 和 reusable pinned host staging buffers，测试覆盖第二次调用复用 scratch / pinned capacity；UZUME playback path 已在 CUDA opt-in 且 backend 可用时优先用 prepare 阶段预分配的 CUDA planar limiter scratch 对真实输出 block 的全部已准备声道做一次 multichannel safety-limiter offload，process 阶段不会为 playback limiter 执行 GPU/pinned allocation；若 planar scratch 不可用、capacity 不足或 backend 不可用，则继续回退到 prepared CUDA stereo matrix+limiter scratch 对 adjacent stereo pairs 做 identity matrix+limiter offload，奇数剩余声道继续用 prepared CUDA safety-limiter scratch，最终仍可回退 CPU limiter；稳定简单 Channel Balance 在 enabled、至少 2ch、无 band compensation、无 delay、无平滑/切换过渡时会使用同一 prepared stereo matrix scratch 对首个 stereo pair 做不带 limiter 的等价矩阵 offload，额外声道保持原样，覆盖普通 stereo、SumToMono、LeftOnly、RightOnly 这些已经稳定且可表示为 2x2 线性矩阵的模式，process 阶段在 capacity 不足时只回退不分配；cuFFT FIR primitives 已使用 thread-local non-blocking CUDA stream、reusable scratch device buffers、reusable pinned host staging buffers 和 same-size cuFFT plan reuse，`UzumeEngine::prepare()` 会预热 max playback block 与 `roomCorrectionMaxTaps` 覆盖范围的 playback cuFFT FIR scratch 和 streaming cuFFT FIR scratch，process 阶段在 FFT capacity 不足时只回退不分配；新增 prepared streaming cuFFT FIR primitive 维护跨调用 host-side input history，可 reset history，并用 history-padded FFT window 输出当前 block 对应区间，为后续 FIR playback worker 做前置。这是后续 playback worker / memory pool 的最小前置形态，但还不是完整 profile 级 GPU offload。
- 当前 GPU 过渡实现仍不宣称已经完成正式播放路径的 cuFFT FIR/SRC offload、完整 Channel Balance offload 或异步 worker 化完整 GPU profile。Streaming cuFFT FIR 目前是独立 primitive，尚未接入 `ConvolutionProcessor::processBlock` 的 room-correction playback 路径；Channel Balance 的 band/delay/transition/smoothing/history 复杂路径、完整 cuFFT worker、event queue、跨 section memory pool、profile 级 FIR/SRC section offload 和 fused profile 级 CPU/GPU null test 仍是后续阶段。

当前验证命令：

```powershell
npm run sync:fork-base
npm run test:audio-engine
$env:ECHO_UZUME_ENABLE_CUDA='ON'; npm run test:audio-engine
npm run typecheck
npx vitest run src/main/audio/UzumeReferencePlan.test.ts
npx vitest run src/main/audio/AudioCore.test.ts
npx vitest run src/renderer/components/player/uzumeReferenceArtifactManifest.test.ts src/renderer/components/player/AudioProfessionalStatusPanel.test.tsx src/renderer/components/player/PlayerBar.test.tsx
npx vitest run src/renderer/pages/DspPage.test.tsx src/renderer/components/player/AudioProfessionalStatusPanel.test.tsx src/renderer/components/player/AudioSettingsDrawer.test.tsx src/renderer/components/player/PlayerBar.test.tsx src/renderer/components/audio/EqPanel.test.tsx src/main/audio/AudioCore.test.ts
npm run build:win:unsigned
nvcc --version
```

已验证结果：

- 默认 audio-engine test 通过，证明普通构建不依赖 CUDA。
- CUDA opt-in audio-engine test 通过，证明 `.cu` probe / prepared safety-limiter playback offload / prepared planar multichannel safety-limiter playback offload / prepared adjacent identity stereo matrix+limiter pair playback offload / prepared stereo matrix playback scratch / prepared playback cuFFT FIR scratch / prepared streaming cuFFT FIR scratch+history / fused gain+limiter / fused stereo matrix+limiter / non-limiter stereo matrix / stable Channel Balance GPU playback matrix（首个 stereo pair，含 stable mono mode matrix，并保留额外声道）/ stream-backed scratch reuse / pinned host staging / cuFFT roundtrip / cuFFT convolution / cuFFT plan reuse 经 nvcc 编译并链接到测试目标；CUDA/cuFFT backend 可用时测试执行 GPU playback limiter、prepared planar multichannel playback limiter、adjacent identity stereo matrix+limiter playback limiter、stable Channel Balance playback matrix、stable mono Channel Balance playback matrix、prepared scratch reuse、prepared planar capacity fallback、prepared stereo matrix capacity fallback、prepared playback cuFFT FIR capacity fallback、prepared streaming cuFFT FIR cross-block history、streaming FIR history reset、engine-level streaming FIR prewarm/reset、streaming FIR capacity fallback、fused gain+limiter、fused stereo matrix+limiter、non-limiter stereo matrix、scratch reuse、pinned host staging、cuFFT roundtrip、cuFFT FIR primitive 和 same-size cuFFT plan reuse，backend 不可用时要求明确 fallback reason。
- TypeScript typecheck 通过。
- `UzumeReferencePlan.test.ts` 97 个测试通过，覆盖 formatPath reference planner、六条 `uzumeFormatPathPlan` key/state/reason stable inspect snapshot、direct-like output device rate mismatch reference telemetry、gapless album-segment generation cache-key reference、compiler assignment inspect report、PCM bit-perfect identity-bypass / planner-disabled rejection / processed-path rejection / DSD direct non-PCM bypass separation、PEQ/basic IIR coefficient+frequency-response artifact / disabled-neutral exact bypass、channel scope target-only processing / invalid scope no-op report、block boundary split exact coverage / final block padding / no introduced discontinuity、natural EOF drain tail / manual flush tail-drop generation reset、DSD direct / D2P 区分、DSD direct safety-meter-only positive bypass、DSD direct bitstream-only / DSD upsampling disabled-controls / D2P decimation+internal PCM / D2P unavailable fallback / SDM unavailable experimental fallback / SDM telemetry+dither separation reference、PCM float64 reference helper、PCM ingress silence / NaN/Inf / denormal / channel mismatch guard、gain staging order / ReplayGain / materialized gain cumulative telemetry、PCM output quantization / deterministic dither / fixed-point vs float vs SDM separation、stage safety telemetry / after-convolution peak expansion attribution / recommended headroom / sample-domain limiter 分离、stereo procedural trim/mute/matrix mix/invert/swap/mono/fractional L/R delay、crossfeed matrix-filter delay/low-pass、mono center preservation、per-ear EQ pre/post-crossfeed placement residual、same-rate SRC exact bypass、windowed-sinc SRC phase accumulator telemetry、SRC group-delay/lookahead milliseconds telemetry、SRC silence preservation artifact、SRC logarithmic sweep artifact、SRC multi-tone / seeded-random artifacts、phase-mode / apodizing / output double-resampling risk / Poly-Sinc-only quality rollback artifacts、high-precision response resample reference、deterministic resampling passband/stopband/realtime-budget/null-residual artifact metrics、Poly-Sinc formal validation report、Shared Convolution compatible merge plan / incompatible split reason / response preflight peak/DC offset/NaN/Inf/channel mismatch report / duplicate convolver+FFT plan guard / merged-response vs serial direct FIR null reference、gapless source PCM concat-before-SRC reference residual / non-integer ratio cumulative offset、FIR gapless no-reset history / reset residual、next-track pre-roll deadline / CPU callback ring / render-ahead cache / dual-pipeline handoff report、render-ahead cache generation-safe hit / late retain / stale reject / evict report、callback-safe mute/volume/declick gain envelope 与 seek/flush/reset generation boundary invalidation、fallback injection / realtime underrun simulation / GPU deadline miss does not block callback、random-access short bridge equal-power crossfade gain-law / residual gate，以及 Quality First / GPU Wait / Predictive Cache / Random-Access Short Bridge 策略 artifact。
- `AudioCore.test.ts` 307 个测试通过，覆盖 UZUME telemetry reset / ready metadata / live telemetry 与 reference plan 挂载。
- `uzumeReferenceArtifactManifest.test.ts`、`AudioProfessionalStatusPanel.test.tsx` 与 `PlayerBar.test.tsx` 共 86 个测试通过，其中 helper-level manifest test 锁定 deterministic 38/38、planned warning flag、not-applicable 非阻塞与 null fallback；visual-state 分析覆盖 UZUME reference badges、Signal Path nodes、detail rows 的 `data-tone`，确认当前 reference UI 是 warning/good/muted/process 语义状态且没有 danger，并锁定 compiler/assignment/merge/latency-owner expected guard 为 Professional Status good、Signal Path process/non-warning；same-rate bypass realtime summary / SRC budget 在 Professional Status 为 good、在 Signal Path 为 process/non-warning；SRC artifact / phase-apodizing expected visual-state guard 锁定 formal validation pass、exact-silence、deterministic random seed、linear/minimum/intermediate phase artifact 与 no-HF-restoration claim 为 Professional Status good、Signal Path process/non-warning，offline budget/output-risk 仍为 warning；continuity/cache expected visual-state guard 锁定 read-committed-only、deadline-safe pre-roll、stable/safe callback ring、render-ahead miss keep-prior-output、marginal controlled fallback 为 Professional Status good、Signal Path process/non-warning，unsafe fallback 仍保留 danger/warning；PCM bit-perfect positive bypass rows/nodes 锁定 `bitPerfectState: available` 为 Professional Status good、Signal Path process/non-warning、direct path available 与 `pcm_bitperfect`；direct-like output / readiness positive rows/nodes 锁定 `direct-like-ready` 与 `ready-to-commit` 为 Professional Status good、Signal Path process/non-warning，且仍显示 scheduler not-enabled；DSD direct positive bypass rows/nodes 锁定 `dsd_direct:direct` 为 good、direct allowed、only safety-metering allowed、PCM DSP/dither blocked 与 DoP output encoding；D2P DSD family expected guard 锁定 decimation profile/internal PCM rate、allowed/disabled controls 与 fallback none 为 Professional Status good、Signal Path process/non-warning，fallback 漂移回 warning；absent-plan guard 覆盖 `uzumeReferencePlan` 缺失时 Professional Status reference rows 保持 muted、Signal Path 不渲染 UZUME reference nodes；UZUME backend support expected guard 锁定 CPU float64 reference、AVX2/GPU 后续 gate、legacy compiler blocked 和完整 reasons 为 Professional Status good、Signal Path process/non-warning，legacy compiler allowed 漂移仍回 warning；UZUME output device policy rows/nodes 覆盖 output mode、device capability、actual/shared rate、shared mixer recommendation 和 warning tone；UZUME latency budget rows/nodes 覆盖 backend、SRC group delay/lookahead、Shared Convolution latency/direct-head/warm-up/tail/drain、callback ring、pre-roll、render-ahead/cache budget、latency owners 和 reference-only scheduler state；UZUME readiness contract rows/nodes 覆盖 full-profile not-ready、GPU prewarm future gate、cache/commit state、deadline slack、callback ring status、short-bridge block、generation current-only commit 和 production scheduler disabled；UZUME generation cache-key rows/nodes 覆盖 generation id、timeline scope、request/cache key、profile/device fingerprint、album segment/index、invalidate/preserve rules、stale commit rejection 和 late-current-generation retain rule；gapless album-segment cache key 在 Professional Status 与 Signal Path 均显示 album segment/index 且保持 good/process；UZUME realtime budget summary reference / render-ahead cache reference rows/nodes 覆盖 realtime factor 未实测、scalar float64 SRC 预算、callback ring/render-ahead margin、CPU full-profile fallback、RPC-003/RPC-005 gate、reference-only cache writer 边界和 warning tone；UZUME artifact manifest rows/nodes 覆盖 deterministic/planned/not-applicable 分桶、source artifact/report artifact 清单、no-planned good/process tone、planned warning tone 和 not-applicable 非阻塞语义；UZUME SRC row 覆盖 group-delay ms、taps/cutoff/alias artifact 文案与 core SRC expected guard，phase accumulator 漂移回 warning；UZUME convolution planner expected guard 锁定 source coverage、split reason、partition plan 与 response resample coverage 为 Professional Status good、Signal Path process/non-warning，split reason 漂移仍回 warning；response resample expected good/process tone、duplicate convolver/FFT guard expected good/process tone、serial-null split/inactive skip reason 与 merged-matches-serial good tone 文案，PCM output quantization / dither row 覆盖 bit-perfect/dither state、seed、LSB、residual、clip count 文案与 expected quantization good/process tone，PCM ingress / gain staging rows 覆盖 sanitizer counts、gain order、cumulative gain 与 headroom 文案，block boundary / flush-drain rows 覆盖 coverage、padding、boundary residual、drain commit、tail drop 和 generation reset 文案，gapless SRC / FIR gapless rows/nodes 覆盖 no-reset residual、reset-per-track residual、boundary offset、FIR overlap history、tail/drain 文案与 expected gapless good/process tone，DSP reference expected guard 锁定 gain staging 顺序/clip budget、PEQ/IIR band/order/residual、Channel Scope targeted-only/out-of-scope exact bypass、Stereo Procedural ordered steps、Per-Ear EQ no-reorder placement rule 为 Professional Status good、Signal Path process/non-warning，invalid scope 漂移仍回 warning，callback-safe urgent controls / equal-power crossfade rows/nodes 覆盖 mute/declick gain ramp、render-cache preserve、seek boundary invalidation、equal-power gain law、hard-switch residual、non-random boundary rejection 文案与 expected callback/crossfade good/process tone。
- 新增 direct-like output device mismatch visual-state guard：Signal Path / Professional Status 对 direct-like/exclusive requested rate 与 actual device rate 不一致保持 warning，显示 requested/actual rate、`direct-like-rate-mismatch`、`inspect-device-rate-mismatch` recommendation，并继续显示 scheduler not-enabled；此项不表示 output policy 或 production scheduler 已改变。
- RPC-001/RPC-002 相关 renderer/main vitest 6 个文件、504 个测试通过，覆盖 DSP 页 `未实现` UI、Signal Path skeleton/reference 文案、Professional Status、AudioSettingsDrawer、EQ panel 和 `uzumeFormatPathPlan` / `uzumeReferencePlan` telemetry。
- `npm run build:win:unsigned` 通过，刷新 `dist/ECHO-NEXT-Setup-26.6.7.exe`、`dist/ECHO-NEXT-Portable-26.6.7.exe` 和 `dist/win-unpacked/ECHO NEXT.exe`。
- 构建中仍有 JUCE、Harfbuzz、CUDA SDK 头文件在 Windows code page 936 下的 C4819 warning；这是第三方头文件编码噪声，不来自本 PR 文档读写。

## 最终建议

UZUME 应该从“重算法的工程边界”开始，而不是从 UI 菜单开始。

推荐顺序是：

```text
Signal Path / telemetry
-> kernel ABI
-> fused profile schema
-> shared engine registry / assignment compiler
-> Shared Convolution Engine reference merge
-> CPU reference fused path
-> AVX2 fused macro-kernel
-> split independent LegacyDspChain backend and select UZUME behind an experimental switch
-> frontend migration based on old DspPage controls and MUSE Signal Path
-> IR pre interface / Shared Convolution Engine CPU FFT section
-> GPU cuFFT offload through Shared Convolution Engine
-> AVX512 / GPU custom
-> SDM / DSD engine
```

这样做可以同时满足两个目标：一方面让 ECHO 拥有真正可发展的高质量 fused DSP/SRC/SDM 引擎；另一方面不伤害现在最重要的东西，也就是曲库资料、播放稳定性、输出状态可信度和默认 bit-perfect 基线。
