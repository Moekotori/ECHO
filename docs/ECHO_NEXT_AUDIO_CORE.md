# ECHO NEXT Audio Core 指南

> **⚠️ 重构进行中（refactor/audio-architecture 分支）**：JUCE-to-libav/miniaudio 迁移尚未完成。本文档已更新为重构后的目标架构（host-centered facade 模式），但部分旧代码路径仍存在。任何改动前先加载 `.skill/echo-audio-architecture-refactor` 对应的 SKILL.md。

Audio Core 负责 ECHO NEXT 的播放、时钟、输出设备、解码、DSP 状态和 HiFi 可解释性。它是播放事实来源，不是 UI 的附属工具，也不是旧 ECHO `AudioEngine.js` 的简单搬运。

这份文档回答三个问题：

1. 播放链路怎么走。
2. 每个模块负责什么。
3. 哪些行为会影响稳定、性能和 bit-perfect 判断。

## 目标

Audio Core 的目标从高到低：

1. 本地文件稳定播放。
2. 播放状态可信，进度不乱跳、不假动。
3. 输出设备、采样率、DSP、错误状态可解释。
4. 播放期间尽量不被扫描、封面、下载、网络任务拖慢。
5. 为 WASAPI Exclusive、ASIO、gapless、automix、DSD、CUE 等能力留清楚边界。

不要为了“功能多”牺牲基础播放。播放链路永远比展示效果、网络补全、下载器、插件更优先。

## 模块总览

```text
Renderer playback UI
  -> window.echo.playback / window.echo.audio
  -> AudioSession
       -> DecoderPipeline / JuceDecodePipeline / DsdDopPipeline
       -> NativePcmHostProcess (facade) -> echo-audio-host daemon
       ->   or NativeOutputBridge (facade re-export -> NativePcmHostProcess)
       ->   or preload HTMLAudio system output
       -> HostBridgeRegistry / DaemonHostProcess (bridge 生命周期)
       -> PlaybackClock
       -> status / diagnostics
```

主要模块：

| 模块 | 责任 |
| --- | --- |
| `AudioSession` | 播放状态机、当前 intent、load/play/pause/seek/stop/next/previous |
| `DecoderPipeline` | FFmpeg 解码、本地文件 PCM 输出、格式探测 |
| `JuceDecodePipeline` | 原生解码路径，作为可控能力而不是默认冒险路径 |
| `DsdDopPipeline` | DSD / DoP 相关处理边界 |
| `NativePcmHostProcess` | echo-audio-host daemon 生命周期、JSON-RPC session 控制、PCM 写入（重构后的实现） |
| `NativeOutputBridge` | facade re-export，导出 `NativePcmHostProcess` 以保持旧 import 路径兼容；不再有独立实现 |
| `HostBridgeRegistry` | active JSON-RPC bridge 和 daemon bridge 的注册/清理 |
| `DaemonHostProcess` | daemon 进程 spawn/stop、stdio fd3/fd4 JSON-RPC 通道建立 |
| `JsonRpcBridge` | daemon JSON-RPC 通信层 |
| `DeviceService` | 输出设备发现、WASAPI/ASIO 能力描述 |
| `PlaybackClock` | 输出侧时钟，不靠 Renderer timer 猜 |
| `EqBridge` | Electron EQ IPC、预设持久化、native 控制 socket |
| `EqStateStore` | EQ 状态存储（重构后的 EqBridge 拆分） |
| `AutomixAnalyzer` / `AutomixPlanner` | 自动混音分析与规划，不在播放热路径乱算 |
| `PlaybackSessionStore` | 播放会话持久化和恢复边界 |
| `AudioLevelMeter` | 电平信息，不能反向影响播放链路 |

## 播放状态机

Audio Core 至少要能表达这些状态：

| 状态 | 含义 |
| --- | --- |
| `idle` | 没有当前播放任务 |
| `loading` | 正在准备文件、解码器或输出 |
| `playing` | 输出侧正在播放 |
| `paused` | 已暂停，保留位置 |
| `seeking` | 正在跳转 |
| `buffering` | 等待解码或输出数据 |
| `ended` | 当前曲目自然结束 |
| `stopped` | 用户或系统停止 |
| `error` | 播放失败，需要错误原因 |

状态要求：

- `playing` 必须来自真实播放链路，不是 UI 猜测。
- `paused` 时进度不能继续假动。
- `loading` 失败要保留清楚错误。
- 切歌时旧状态不能覆盖新 intent。
- seek 后进度要和输出侧确认对齐。

如果音频是对的但进度条错，优先查 Renderer 状态合并和播放状态过滤，不要先动解码或输出。

## 播放链路

### 本地文件播放

标准链路：

1. Renderer 通过 `window.echo.playback.playLocalFile(...)` 发起播放。
2. Preload 校验并转发到 typed IPC。
3. `AudioSession` 记录当前 intent。
4. `DecoderPipeline` 探测格式并启动解码。
5. PCM 进入输出路径。
6. `NativePcmHostProcess`（通过 facade）或系统输出路径返回 ready / position / ended / error。
7. `AudioSession` 合并状态并通知 UI。

### 系统输出

Windows 里的“标准输出”在本项目语境中是 `outputMode: 'system'` 的 preload `HTMLAudio` 路径，不等于 WASAPI Shared。

系统输出适合作为默认安全基线：

- 兼容性高。
- 不要求 native host。
- 适合普通用户日常播放。
- 状态能力比 native host 少，需要 UI 诚实表达。

### WASAPI Shared / Exclusive / ASIO

这些属于 native host / native audio path：

- WASAPI Shared：共享系统设备，稳定优先。
- WASAPI Exclusive：独占设备，可能更接近目标采样率，但失败风险更高。
- ASIO：专业声卡路径，依赖驱动和设备状态。

UI 必须区分：

- 请求的输出模式。
- 实际打开的输出模式。
- 文件采样率。
- decoder 输出采样率。
- 请求设备采样率。
- 实际设备采样率。
- 是否存在 mismatch。

不要把 `actualDeviceSampleRate` 当作文件采样率。

## 解码策略

当前解码路径以 FFmpeg 为安全基线：

1. 显式测试/依赖注入路径。
2. `ECHO_FFMPEG_PATH`。
3. `ffmpeg-static`。
4. system `ffmpeg`。

如果全部失败，状态应暴露类似 `ffmpeg_missing` 的明确错误，而不是泛化成“播放失败”。

生产 `echo-audio-host` 在 T12 后不再依赖 JUCE。常规解码以 FFmpeg/libav 路线为稳定基线；任何解码失败都必须 fallback 或给出清楚诊断。

格式支持要诚实：

- MP3 / FLAC / WAV / M4A / OGG 等常规格式优先稳定。
- ALAC、DSD、CUE、视频容器提取音频等能力要有探测和错误边界。
- 不支持或不完整支持时不要伪装成播放链路 bug。

## Native Host

开发期 native host 可来自 ECHO NEXT 自己的构建目录，迁移期允许旧 ECHO fallback，但生产不能依赖 `../ECHO`。

开发同步：

```powershell
npm run sync:audio-host
```

期望开发路径：

```text
ECHO-Next/electron-app/build/echo-audio-host.exe
```

运行时查找顺序应优先：

1. packaged `resourcesPath`。
2. ECHO NEXT app/build 位置。
3. ECHO NEXT `electron-app/build`。
4. `../ECHO` fallback，仅本地迁移使用。

native host 协议要求：

- PCM 数据和控制消息不要混在同一条不清晰通道。
- stdout JSON 事件要稳定。
- stderr 可诊断。
- 子进程退出要能上报原因。
- host 缺失要快速失败，不要挂住播放。

生产打包必须通过 `extraResources` 或等价步骤带上 host。

## 输出时钟

`PlaybackClock` 应以输出侧 frame counter / host position 为准。

不要：

- 用 Renderer `setInterval` 当权威进度。
- 用解码速度推断实际播放位置。
- 用 UI 乐观状态覆盖输出侧错误。

可以：

- UI 做轻量补间显示，但必须能被真实状态纠正。
- 高频 position 事件节流。
- 只让播放栏局部订阅，避免全局重渲染。

## DSP、EQ 和 bit-perfect

任何 DSP 都会改变音频信号。包括：

- EQ。
- Preamp。
- ReplayGain。
- 变速 / time stretch。
- Crossfade / automix。
- 重采样。
- 声道平衡。

EQ 开启时 Audio Status 必须表达：

- `dspActive = true`
- `bitPerfectCandidate = false`
- `bitPerfectDisabledReason = eq_enabled`
- warnings 包含 EQ 影响 bit-perfect 的提示

Flat preset 不等于关闭 EQ。只要信号仍经过 DSP 链路，就不能宣称 bit-perfect。

## ReplayGain 和音量

ReplayGain 是响度处理，不是文件修改。

要求：

- UI 明确 ReplayGain 会改变输出响度。
- bit-perfect 判断要考虑 ReplayGain。
- Preamp / volume / gain 不能导致 clipping 不可见。
- 需要 headroom warning 时要以可解释方式展示。

## Gapless 和 Automix

Gapless 与 Automix 都不能破坏基础播放：

- Gapless 关注相邻曲目预加载和无缝切换。
- Automix 关注淡入淡出、节拍/能量/尾段分析和过渡计划。
- 分析任务不能在播放热路径临时重算。
- 大量分析应后台排队，并在播放期间降载。

任何自动过渡都必须能关闭，并且不能影响用户手动切歌的响应。

## 错误分类

播放错误至少要能区分：

| 类别 | 例子 |
| --- | --- |
| 文件错误 | 文件不存在、权限不足、路径不可访问 |
| 解码错误 | 格式不支持、FFmpeg 缺失、探测失败 |
| 输出错误 | 设备打不开、独占失败、ASIO driver 失败 |
| 采样率错误 | 请求采样率不支持、实际设备采样率不符 |
| native host 错误 | host 缺失、协议错误、子进程退出 |
| 用户操作冲突 | 快速切歌、seek 时旧任务返回 |
| 系统状态 | 设备拔出、系统音量/静音、睡眠恢复 |

错误要进入诊断，同时 UI 给出下一步。例如“切回 System 输出再试”、“检查设备是否被其他应用独占”、“确认 FFmpeg 是否可用”。

## 与 Library Core 的关系

Library Core 提供曲目路径、trackId、metadata、封面等信息。Audio Core 只关心播放所需输入：

- filePath。
- trackId。
- 输出选项。
- 可选的队列上下文。

Audio Core 不直接扫描曲库、不修复 metadata、不写 album grouping、不处理封面。

播放历史可以由播放事件触发写入，但要通过明确服务边界，不要让 audio 模块到处写 library 表。

## 与 Renderer 的契约

Renderer 可以：

- 发播放命令。
- 显示播放状态。
- 显示输出设备。
- 显示错误和诊断。
- 调整用户设置。

Renderer 不可以：

- 解码文件。
- 直接写 PCM。
- 直接控制 native host 子进程。
- 自己计算权威播放位置。
- 因播放 tick 重渲染 SongsPage / AlbumsPage 等大列表。

状态推送成熟后，应优先使用 `playback:onStatus` / `audio:onStatus` 这类事件，并对 position 做节流。

## 开发验收

窄测试优先：

| 改动 | 建议验证 |
| --- | --- |
| 状态机 | `AudioCore.test.ts` 或对应 session 测试 |
| 解码路径 | libav / FFmpeg / native 格式探测相关测试 |
| native bridge | host smoke 或 `NativePcmHostProcess` / facade 测试 |
| EQ / DSP | `EqBridge` + native audio-engine 测试 |
| Automix | analyzer / planner 单元测试 |
| 输出设备 | `DeviceService` / Windows audio service 相关测试 |
| UI 状态 | 播放栏相关 renderer 测试 |

真实音频 smoke 建议：

1. 准备 44.1 kHz FLAC、48 kHz FLAC、96 kHz FLAC、MP3。
2. 先用 `System` 输出确认能播。
3. 再测 WASAPI Shared。
4. 再测 Exclusive / ASIO。
5. 切歌、暂停、seek、结束事件都看一次。
6. 对比 `fileSampleRate`、`decoderOutputSampleRate`、`requestedOutputSampleRate`、`actualDeviceSampleRate`。
7. 开启 EQ / ReplayGain 后确认 bit-perfect 状态变更。

不要因为改了文案或小 UI 就跑重音频测试。也不要因为改了音频热路径只跑静态检查。

## 性能红线

Audio Core 不允许：

- 播放期间被全库扫描直接抢占。
- 解码输出中等待 Renderer。
- native audio callback 里做文件 IO、JSON、锁等待。
- 快速切歌时旧任务覆盖新任务。
- 每 500 ms 让大页面全量重渲染。
- 播放失败时无限重试拉高 CPU。
- 输出设备异常时卡死主进程。

## 一句话标准

Audio Core 的每个改动都要让“能不能播、播到哪里、从哪里输出、有没有改声音、为什么失败”更清楚。只要一个改动让这些问题更难回答，就应该先停下来拆清楚。

## 重构进度（refactor/audio-architecture）

JUCE-to-libav/miniaudio 迁移进行中。已完成：

- `NativeOutputBridge` 单体拆分为 facade re-export，真正实现在 `NativePcmHostProcess`
- daemon 进程管理拆到 `DaemonHostProcess`，bridge 注册拆到 `HostBridgeRegistry`，RPC 通信拆到 `JsonRpcBridge`
- `EqBridge` 拆分为 `EqBridge` + `EqStateStore`
- 渲染层 JUCE 输出/解码 toggle 已移除，仅保留 native-direct 控制
- 已删除 JUCE-era 测试（ECNP framed 协议、`-framed-stdin`/`-juce-output` CLI 参数、JUCE 设备命名）

未完成 / 待核对：

- daemon spawn 仍硬编码 5 个音频参数（`-sr -ch -buffer -fifo-ms -prebuffer-ms`），目标是迁移到 session-time JSON-RPC 配置，实现"无音频启动参数 daemon"
- native host `main.cpp` 构造时用 CLI 参数打开设备，需改为延迟打开（spawn 时不 open，收到 `session.begin` 再 open）
- per-play host 路径（`NativePcmHostProcess.start`）仍用 20+ 个 CLI 参数，后续逐步退役为 daemon 路径
- `JuceDecodePipeline` 和 `EqBridge` 从 origin/main 恢复，是 theirs `AudioSession` 的依赖；最终需要评估是否合并到 libav 路径
- 旧 `EqBridge.test.ts` 和 `JuceDecodePipeline.test.ts` 覆盖度待核对

## 新增 Backend 步骤

同类后端必须共享抽象。新增一个 backend 时：

1. 找到同类 backend 的 interface / base contract。如果没有，先定义它，不要直接抄现有 backend 改 flag。
2. 新增 class 实现 interface，显式 lifecycle（`initialize/open/start/stop/close/dispose`）。
3. 在 factory / selection 边界注册新 backend。**不要**在 AudioSession 业务逻辑里加 `if/else` 分支。
4. 如果 host 侧需要新参数，在 `NativeOutputStartOptions` 里加 typed 字段，不要塞到 args 数组里。
5. 补 backend 特有的测试，并确保 facade re-export 路径不回归。
6. 如果新 backend 引入了新 IPC 通道，在 `HostBridgeRegistry` 注册，并补 `HostBridgeCharacterization.test.ts`。

反模式：复制现有 backend 路径改几个 flag；在 AudioSession 里散布 `if (backendImpl === 'xxx')` 检查；让 renderer 知道 backend 实现细节。
