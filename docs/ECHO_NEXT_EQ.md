# ECHO NEXT EQ 指南

ECHO NEXT EQ 是可播放、可解释、可关闭的 HiFi DSP 功能。它的第一原则不是“看起来专业”，而是让用户清楚知道：EQ 何时在改变声音、何时会禁用 bit-perfect、何时可能削波、何时已经真正 bypass。

## 定位

EQ 属于 Audio Core 的 DSP 能力，不属于单纯 UI 装饰。

它应该做到：

- 实时可调。
- 不破坏播放稳定。
- 不在音频回调里做危险操作。
- 清楚影响 bit-perfect。
- 预设可保存、可导入、可回退。
- UI 对新手友好，同时保留专业控制。

它不应该做到：

- 伪装成“音质增强”。
- 默认开启并改变用户声音。
- 把 Flat preset 当作关闭 EQ。
- 为了曲线动画拖慢播放。
- 把 VST、卷积、房间校正、在线预设市场混进第一阶段。

## 功能范围

当前 EQ 核心范围：

- 10-band graphic / parametric hybrid EQ。
- band gain: `-12 dB` 到 `+12 dB`。
- preamp: `-12 dB` 到 `+6 dB`。
- band center frequency: `20 Hz` 到 `20 kHz`。
- fixed Q，当前默认 `1.0`。
- enable / bypass。
- built-in presets。
- user presets。
- curve visualization。
- clipping / headroom warning。
- native realtime DSP hook。

默认频点：

```text
31 Hz, 62 Hz, 125 Hz, 250 Hz, 500 Hz, 1 kHz, 2 kHz, 4 kHz, 8 kHz, 16 kHz
```

后续能力可以加，但不能挤进音频热路径：

- full parametric bands。
- realtime analyzer。
- dynamic EQ。
- auto gain。
- A/B compare persistence。
- per-output profile。
- per-headphone profile。

明确不在当前范围：

- VST host。
- convolution / room correction。
- AutoEQ database。
- network preset marketplace。
- 和歌词、MV、下载器、流媒体强绑定。

## Bit-perfect 规则

只要 EQ 启用，Audio Status 必须表达：

- `eqEnabled = true`
- `dspActive = true`
- `bitPerfectCandidate = false`
- `bitPerfectDisabledReason = eq_enabled`
- UI 显示当前输出不是 bit-perfect

EQ 关闭或 bypass 完成后：

- native processor crossfade 回 dry signal。
- bypass smoothing 到零后不再改变样本。
- 如果没有其他 DSP、重采样、ReplayGain、声道平衡或输出 mismatch，`bitPerfectCandidate` 才可以恢复。

Flat preset 不是 disabled：

- Flat 只是所有 band 为 `0 dB`、preamp 为 `0 dB`。
- 如果 EQ 仍启用，信号依然经过 DSP 链路。
- UI 不能把 Flat 写成 bit-perfect。

## 信号链路

```text
Decoded PCM
  -> optional ReplayGain / gain stage
  -> EQ Processor
       preamp
       band filters
       smoothing
       bypass crossfade
       clipping risk detection
  -> output bridge
```

原则：

- DSP 状态必须进入 audio status。
- UI 控制变化走 control path，不进入 PCM stdin。
- 音频回调只读实时安全参数。
- 预设文件 IO 不进入音频回调。

## Native DSP 结构

相关 native 文件：

- `native/audio-engine/EqTypes.h`
- `native/audio-engine/EqBand.h`
- `native/audio-engine/EqProcessor.h`
- `native/audio-engine/EqProcessor.cpp`
- `native/audio-engine/EqPresetStore.h`
- `native/audio-engine/EqPresetStore.cpp`
- `native/audio-engine/EqMessageProtocol.h`
- `native/audio-engine/EqMessageProtocol.cpp`

`EqProcessor` 负责：

- 每声道 biquad 状态。
- atomic target parameters。
- preamp smoothing。
- band gain smoothing。
- frequency smoothing。
- bypass crossfade。
- clipping risk detection。
- NaN / Inf 防护。

`EqMessageProtocol` 负责：

- 在控制线程解析 JSON-line。
- 校验参数。
- 更新 atomic targets。
- 不在 audio callback 内解析 JSON。

## 实时安全规则

JUCE/native audio callback 禁止：

- 分配大对象。
- 读写 JSON。
- 读写 preset 文件。
- 访问 Electron / React / IPC。
- 等待 mutex。
- 发网络请求。
- 打日志到慢 IO。
- 每个 sample 都重建所有滤波器系数。

参数更新必须：

- clamp 非法值。
- 使用 atomic target。
- gain / preamp 平滑约 `25 ms`。
- bypass crossfade 约 `15 ms`。
- 快速拖动时不输出 NaN / Inf。
- 频率拖动平滑后再重算系数。

## Electron Bridge

Renderer 只通过 `window.echo.eq` 控制 EQ。

命令：

- `eq:get-state`
- `eq:set-enabled`
- `eq:set-band-gain`
- `eq:set-band-frequency`
- `eq:set-preamp`
- `eq:set-preset`
- `eq:reset`
- `eq:list-presets`
- `eq:save-preset`
- `eq:import-preset`
- `eq:export-preset`
- `eq:delete-preset`

Renderer 不能：

- 直接访问音频 buffer。
- 直接控制 native socket。
- 直接写 preset 文件。
- 自己决定 bit-perfect 状态。

控制消息示例：

```json
{ "type": "eq:set-band-gain", "band": 3, "gainDb": 2.5 }
```

```json
{ "type": "eq:set-band-frequency", "band": 3, "frequencyHz": 360 }
```

状态示例：

```json
{
  "type": "eq:state",
  "enabled": true,
  "preampDb": -3,
  "bands": [
    { "frequencyHz": 31, "gainDb": 0, "q": 1 }
  ],
  "dspActive": true,
  "bitPerfectCandidate": false,
  "bitPerfectDisabledReason": "eq_enabled"
}
```

## Preset 格式

```json
{
  "id": "bass-boost",
  "name": "Bass Boost",
  "preampDb": -2,
  "bands": [
    { "frequencyHz": 31, "gainDb": 4, "q": 1 }
  ],
  "createdAt": "built-in",
  "updatedAt": "built-in",
  "readonly": true
}
```

内置预设建议：

- Flat
- Bass Boost
- Vocal Clear
- Treble Sparkle
- Loudness
- Night
- Headphone Warm
- Anime / J-Pop
- Rock
- Classical

规则：

- Built-in preset 只读。
- User preset 存在 Electron `userData`。
- 读取时校验字段、范围、band 数量。
- malformed preset 不能让设置页白屏。
- 导入同 id preset 时生成新 id，不静默覆盖本地调音。
- 删除用户 preset 后要 fallback 到安全状态。

## UI 结构

EQ UI 应该分层：

### Simple

给普通用户：

- 总开关。
- preset selector。
- preamp。
- headroom / clipping warning。
- reset。
- bit-perfect 影响提示。

### Pro

给高级用户：

- curve view。
- draggable band nodes。
- 频率 / 增益精确输入。
- selected band 控制。
- A/B 对比。
- undo / redo。
- preset save / import / export / delete。

### 状态提示

必须可见：

- EQ 是否启用。
- 当前是否 bypass。
- 当前是否影响 bit-perfect。
- 是否有 clipping risk。
- 当前 preset 是否已修改但未保存。

不要把复杂解释塞满页面。普通用户只需要知道“现在声音有没有被改、风险是什么、怎么关掉”。

## 曲线交互

曲线交互要稳：

- 拖动时节流发送。
- release 时发送准确最终值。
- band 节点尺寸稳定。
- tooltip 显示频率和增益。
- 不能因为快速拖动导致 UI 卡顿或 native 参数爆炸。
- 键盘/输入框也能精确调整。

曲线只是控制视图，不是事实来源。事实来源是 EQ state。

## Headroom 和削波

高增益 EQ 可能导致 clipping。

UI 应该：

- 在风险出现时提示降低 preamp。
- 不要自动偷偷改用户 preset，除非明确启用 auto gain。
- 区分“可能削波”和“已经检测到削波风险”。
- 夜间、低音增强等 preset 默认保留合理 preamp。

## 稳定性验收

Native DSP 测试应覆盖：

- disabled EQ 完全返回 dry input。
- Flat preset 启用时数值透明，但状态仍报告 DSP active。
- 高增益后 bypass crossfade 完成能回到 dry output。
- 快速 gain / frequency / preamp 改动不输出 NaN / Inf。
- 频率 clamp 在 `20 Hz` 和 `20 kHz` 边界稳定。
- steady-state 不每 sample 重算所有 biquad。

TypeScript / Renderer 测试应覆盖：

- `EqBridge` 输入校验。
- preset 持久化。
- malformed preset fallback。
- UI 开关和 preset 操作。
- 曲线编辑、undo/redo、A/B。
- EQ 或 channel balance 开启时 bit-perfect 状态禁用。
- headroom / clipping-risk telemetry。

可用入口：

```text
npm run test:audio-engine
```

只改文档不需要跑这些测试；改 native DSP 或 bridge 时才跑对应窄测试。

## 和其它音频功能的关系

EQ 与这些能力都可能共同影响 bit-perfect：

- ReplayGain。
- Preamp。
- Volume。
- Channel balance。
- Resampling。
- Speed / pitch。
- Crossfade / automix。

Audio Status 需要合并原因，不要只显示最后一个原因。UI 可以做简化展示，但诊断里要能看到完整原因列表。

## 一句话标准

ECHO NEXT 的 EQ 应该让声音调整更可控，而不是让声音链路更神秘。只要 EQ 开启，用户就应该清楚知道它改变了信号；只要 EQ 关闭，系统就应该真正回到不处理样本的路径。
