# UZUME RPC 文档索引

本文档组使用 `RPC = Refactor Phase Contract`。它不是新的宏大设计文档，也不是逐行任务清单；它把 `ECHO_NEXT_UZUME_DSP_REFACTOR.md` 中的 phase gate 拆成可执行、可评审、可测试的实施契约。

粒度原则：

- 必须指出当前状态、目标状态、非目标、实施切片、验收测试。
- 必须能指导代码修改，不能只写“实现高质量引擎”这类空话。
- 不提前规定尚未验证的内部算法细节，例如具体 FFT partition ladder 数值、最终 UI 视觉布局或 GPU kernel 微结构。
- 每个 RPC 都必须能独立评审，但只能在前置 RPC 的 exit gate 通过后进入下一阶段。

## RPC 顺序

| RPC | Phase | 目标 |
| --- | --- | --- |
| [RPC-001](RPC-001-current-drift-to-skeleton.md) | Phase 0-1 | 上游冲突收口，并从当前偏移进入 Contract / Skeleton Gate |
| [RPC-002](RPC-002-reference-vertical-slices.md) | Phase 2 | 建立 CPU reference vertical slices |
| [RPC-003](RPC-003-realtime-pcm-mvp.md) | Phase 3 | 达到 UZUME PCM MVP exit gate |
| [RPC-004](RPC-004-convolution-production.md) | Phase 4 | Shared Convolution Engine production 化 |
| [RPC-005](RPC-005-gpu-render-ahead.md) | Phase 5 | GPU render-ahead / cuFFT offload |
| [RPC-006](RPC-006-dsd-family-paths.md) | Phase 6 | DSD direct / DSD upsampling / D2P / SDM path |
| [RPC-007](RPC-007-advanced-backends.md) | Phase 7 | AVX512 / GPU custom / backend benchmark |

## 通用实施规则

每个功能按同一顺序推进：

```text
schema / profile contract
-> compiler assignment
-> reference backend
-> telemetry
-> thin UI / Signal Path display
-> tests and artifacts
-> realtime AVX2 / GPU optimization
```

任何实现如果只能在代码里工作、但 Signal Path 无法解释，都不能通过对应 RPC。任何前端控件如果不能映射到 profile contract 和 compiler assignment，也不能进入正式 UI。
