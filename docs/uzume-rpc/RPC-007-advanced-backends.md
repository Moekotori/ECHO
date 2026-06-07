# RPC-007：Advanced Backends

## 状态

- Phase：7
- Gate：Advanced Backend Gate
- 前置 RPC：RPC-003、RPC-004、RPC-005；具体 backend 依赖对应 reference path

## 目标

在 reference / realtime / GPU render-ahead 基础稳定后，再推进 AVX512、GPU custom kernel 和 benchmark matrix。

## 非目标

- 不用 advanced backend 修补基础语义缺失。
- 不让用户手动 backend preference 绕过 safety / latency / generation rules。
- 不在没有 reference null test 时开放 production backend。

## 实施切片

### 1. Runtime Dispatch

每个 backend 必须有：

- feature detection
- compile flag
- runtime dispatch
- fallback reason
- telemetry

### 2. Benchmark Matrix

覆盖：

- profile
- source / target sample rate
- channel count
- FIR length / partition plan
- render-ahead depth
- random access policy
- thermal / acoustic preference if measurable

### 3. Backend Equivalence

每个 backend 必须有 CPU reference comparison：

- max abs error
- RMS error
- no systematic drift
- no block-boundary discontinuity
- no stale generation commit

## 验收

- AVX512 默认不破坏非 AVX512 机器。
- GPU custom kernel 有 fallback 和 null test。
- Signal Path 能显示 backend choice、fallback reason、safety class。
- 用户选择 CPU/GPU preference 只影响 planner preference，不覆盖 realtime safety。
