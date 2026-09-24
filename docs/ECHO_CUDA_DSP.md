# ECHO Native CUDA DSP

## 数据面所有权

CUDA FIR 位于 `echo-audio-host` 进程内部，由 `NativePlaybackPipeline` 持有。
Renderer 和 Electron Main 只发送 FIR 计划、taps 与 `computeBackend` 意图，并展示 host 返回的真实状态。

旧的 `echo-src-cuda-worker` 不再进入 Windows 打包或播放数据面。新路径不会把 PCM
序列化成 JSON，也不会为每个音频块创建进程或重新分配全部 GPU 资源。

## 实现

- `NativeFirProcessor` 是 CPU/CUDA FIR 的共同选择边界。
- CPU 后端仍使用 `echo::EchoSrcProcessor`，作为可靠回退和数值参考。
- `CudaFirProcessor` 在配置时选择可用 NVIDIA GPU，并创建持久化 CUDA stream。
- 多级 polyphase FIR 在 GPU 上连续执行，中间级不回传 CPU。
- taps、phase offsets、delay 和每级 FIR history 常驻显存。
- 输入/输出使用可复用的页锁定 staging buffer。
- 每块只同步当前 stream，不使用全设备 `cudaDeviceSynchronize()`。
- seek、session begin、gapless continuation 和 DSP reconfigure 会重置 GPU FIR history。
- 初始化失败会在播放前切换 CPU；运行时失败会切换 CPU 并通过
  `native_cuda_dsp_runtime_failure:*` 上报，绝不把 CPU 执行伪装成 CUDA。

SDM 路径中的高开销多级 FIR oversampling 可使用同一个 CUDA 后端；具有逐样本递归依赖的
SDM modulator 仍保留在 CPU，以避免用仅一至两个 GPU thread 执行串行反馈环路。

## 构建

普通本地构建在缺少 CUDA Toolkit 时允许编译 CPU fallback：

```powershell
npm run build:audio-host
```

Windows release/unsigned 打包要求 CUDA Toolkit，缺少 `nvcc` 时会 fail-closed：

```powershell
npm run build:audio-host:release
```

构建脚本会检测 `CUDA_PATH`、`CUDAToolkit_ROOT` 或默认安装目录。CUDA runtime 静态链接进
`echo-audio-host.exe`，发行包无需单独携带 `cudart*.dll`。

当前 fat binary 包含 Turing、Ampere、Ada 与 Blackwell 桌面架构：
`sm_75 / sm_86 / sm_89 / sm_120`。

## 验证

```powershell
$env:CMAKE_BUILD_PARALLEL_LEVEL='1'
npm run build:audio-host:release
cmake --build out/native/audio-host --config Release --target echo-audio-engine-tests --parallel 1
ctest --test-dir out/native/audio-host -C Release --output-on-failure
npm run smoke:audio-host
```

`echo-native-playback-pipeline-tests` 会比较 CPU 与 CUDA 的多级、跨块 FIR 输出；CUDA
可用时还必须报告实际设备名。真机播放验收仍需覆盖 pause/seek/resume、输出模式切换、
高 taps filter、AutoMix 双 deck 与 PCM-to-SDM。
