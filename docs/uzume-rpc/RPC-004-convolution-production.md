# RPC-004：Shared Convolution Engine Production

## 状态

- Phase：4
- Gate：Convolution Production Gate
- 前置 RPC：RPC-003

## 目标

把 FIR EQ、耳机 FIR 校正、room IR、可兼容 long-tail response 统一到 Shared Convolution Engine。`ConvolutionProcessor` 只保留为 legacy / diagnostic / tiny-IR fallback。

## 非目标

- 不要求 GPU offload。
- 不要求 advanced matrix FIR 默认开放。
- 不要求 sinc-L extreme profile 默认可用。

## 实施切片

### 1. IR Preflight

IR import 必须生成：

- sample rate
- channel layout
- length / tail seconds
- gain / peak risk
- phase policy
- resample requirement
- validation error

### 2. Response Merge

兼容来源必须合并：

- FIR EQ
- headphone FIR correction
- room IR

不兼容时必须给出 split reason：

- sample rate mismatch
- phase policy mismatch
- channel routing mismatch
- latency class mismatch
- state / continuity mismatch

### 3. Partition Planner

必须显式区分：

- callback block size
- internal FFT block size
- hop size
- direct head taps
- FFT tail sizes
- warm-up frames
- drain frames
- tail seconds

### 4. Runtime

Production path 使用 partitioned FFT convolution。8192 taps direct convolution 不能作为正式上限，只能作为 fallback / diagnostic。

## 验收

- Shared Convolution Engine report 能解释 merge group、split reason、latency owner。
- merged response 与 serial reference 在误差门槛内一致。
- gapless no-reset history 通过。
- callback block size 改变不破坏 internal FFT plan 语义。
- Signal Path 显示 block/FFT/tail plan。

## 必跑测试

```powershell
npm run test:audio-engine
npm run typecheck
```

必须新增 offline direct/reference comparison tests。
