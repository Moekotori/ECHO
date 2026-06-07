# RPC-005：GPU Render-Ahead / cuFFT Offload

## 状态

- Phase：5
- Gate：GPU Render-Ahead Gate
- 前置 RPC：RPC-004

## 目标

把 GPU 用作 render-ahead / heavy section offload，而不是在 audio callback 中做实时阻塞计算。

## 非目标

- 不让 GPU 成为唯一 playback path。
- 不在 callback 中 launch CUDA 或创建 cuFFT plan。
- 不用 short bridge 掩盖 GPU prewarm / cache miss。

## 实施切片

### 1. GPU Planner

GPU offload 必须来自 compiled plan：

- offloadable sections
- memory budget
- sample-rate family
- FFT plan cache key
- latency class
- fallback path

### 2. Memory / Stream

必须预创建或复用：

- cuFFT plan
- filter FFT cache
- device scratch
- pinned host staging
- stream / event

### 3. Render Job Queue

Job 类型：

- current tail
- next-track head
- gapless album segment
- N+1 / N+2 predictive cache
- random-access full-profile catch-up

所有 job 必须带 generation id。

### 4. Commit Policy

GPU block 只有在完整、generation 匹配、仍适用于目标 timeline 时才能 commit。晚到但仍有效的 block 可进入后续 cache / boundary / crossfade candidate；stale 或超预算才 retire。

### 5. Telemetry

必须报告：

- GPU ready / not ready
- plan cache hit
- render-ahead depth
- deadline risk
- fallback reason
- stale rejection
- CPU/GPU null-test status

## 验收

- callback 从不等待 GPU。
- GPU failure fallback 到 CPU full-quality path 或 legacy non-UZUME path，并显示 reason。
- CPU reference vs GPU output 通过误差门槛。
- GPU offload 优先服务 Shared Convolution Engine FFT/FIR section。
- Signal Path 显示 backend、render-ahead depth、cache state、quality rollback。

## 必跑测试

```powershell
$env:ECHO_UZUME_ENABLE_CUDA='ON'; npm run test:audio-engine
npm run test:audio-engine
npm run typecheck
```

CUDA 不可用时，测试必须验证 fallback reason，而不是静默跳过关键状态。
