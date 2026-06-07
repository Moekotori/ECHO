# RPC-006：DSD Direct / DSD Upsampling / D2P / SDM

## 状态

- Phase：6
- Gate：DSD Family Gate
- 前置 RPC：RPC-003；DSD upsampling / SDM realtime quality 依赖后续实现成熟度

## 目标

建立 DSD family 的四条可解释路径：

- `dsd_direct`
- `dsd_upsampling`
- `d2p_processed`
- `sdm_processed`

它们必须在 UI、backend、telemetry 和 tests 中分开。

继承 RPC-001：当前只提供六条 path 的 skeleton plan 与 unavailable / disabled reason。RPC-006 必须实现真实 DSD direct / DSD upsampling / D2P / SDM planner，不能把 `source_is_pcm`、`sdm_engine_not_ready` 等 placeholder reason 当成 DSD family 完成。

## 非目标

- 不默认开启 DSD1024。
- 不把 DSD upsampling 做成完整 PCM-domain DSP path。
- 不把 PCM dither 和 SDM noise shaping 混成一个 UI 状态。

## Path Contract

### DSD Direct

- native DSD / DoP output
- 不进入 PCM DSP / SRC / limiter / dither
- 改样本 DSP 控件全部 disabled

### DSD Upsampling

- DSD source -> higher-rate DSD output
- 只开放 SDM modulator、headroom、Safety Metering / overload guard
- 禁用 EQ、FIR、crossfeed、ReplayGain、channel matrix、PCM SRC UI、PCM dither

### D2P

- DSD -> low-pass / decimation -> multibit PCM internal
- 进入 UZUME PCM domain
- 输出 PCM，可使用 PCM dither / output quantization

### SDM Processed

- PCM 或 D2P internal -> optional modulator-rate preparation -> SDM modulator
- 输出 DSD native / DoP
- 显示 overload、ultrasonic noise、target DSD rate、realtime safety

## 实施切片

1. formatPath planner 完整区分四条 DSD path。
2. DSD direct 先完成 transport-safe bypass。
3. DSD upsampling 先完成 SDM-only skeleton 与 disabled controls。
4. D2P ingress reference：low-pass / decimation 到 multibit PCM internal。
5. PCM -> SDM 5th-order reference。
6. telemetry：overload margin、ultrasonic noise risk、fallback reason。

## 验收

- DSD direct 不进入 PCM DSP。
- DSD upsampling 只暴露 SDM modulator + headroom/safety。
- D2P 和 SDM processed 的 internal domain / output container 不混淆。
- Signal Path 能解释 DSD direct disabled reason。
- SDM unavailable / experimental 状态诚实显示。
- RPC-001 的 skeleton unavailable reason 已被真实 DSD family planner reason 替换，并且 UI 不展示未实现的可操作 DSD 子控件。

## 必跑测试

```powershell
npm run test:audio-engine
npm run typecheck
```

DSD fixture 可以先使用 synthetic test vectors；正式音频兼容性测试后置。
