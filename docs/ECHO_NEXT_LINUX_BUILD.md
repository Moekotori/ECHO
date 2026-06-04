# ECHO Next Linux 构建指南

这份文档是 ECHO Next 的 Linux x64 打包、验收和故障定位指南。目标不是“能跑一下命令”，而是把 Linux 包从环境准备、FFmpeg、ALSA、native host、electron-builder 到发布前验收都讲清楚。

当前 Linux 支持属于稳健首阶段：产出 x64 `AppImage` 和 `deb`，应用能启动、能扫描本地曲库、能播放本地 WAV / FLAC / MP3，并且在 Linux shared native output 下提供明确的 ALSA 后端。

> [!IMPORTANT]
> Linux 包必须在 Linux x64 环境中构建。不要在 Windows 上直接交叉打 Linux 包。这个项目的 Linux 包需要 Linux 版 `echo-audio-host`、Linux 版 FFmpeg、Linux 原生开发库和 Linux 打包工具；跨平台硬凑很容易产出“看起来有包、实际上不能播放”的假产物。

## 1. 当前支持边界

### 已支持

- Linux x64 桌面包。
- `AppImage`。
- `deb`。
- Electron 主程序、Renderer、Preload、主进程服务。
- 本地曲库扫描和本地播放主流程。
- Linux 版 `echo-audio-host`。
- Linux shared native output。
- shared backend `Auto`。
- shared backend `ALSA`。
- PipeWire 通过 ALSA compatibility layer 暴露出来的设备路径。
- 独立 Linux 工具目录 `electron-app/tools-linux/`。

### 暂不声明支持

- Linux arm64 / aarch64。
- rpm / snap / Flatpak 正式产物。
- JACK 原生后端。
- PipeWire 原生后端。
- Linux 独占 / bit-perfect 级别 HiFi 后端。
- 从 Windows 直接交叉构建 Linux 包。
- 发行版全矩阵兼容承诺。

### 明确仍是 Windows-only

- WASAPI Exclusive。
- ASIO。
- DirectSound compatibility mode。
- SMTC。
- Windows taskbar thumbnail controls。
- Windows audio service restart。

这些边界要保持清楚。Linux 适配不能影响 Windows 端已有播放链路，也不能把尚未验收的 Linux 能力包装成已完成能力。

## 2. 推荐构建环境

优先级从高到低：

1. 原生 Linux x64。
2. Linux x64 VM。
3. Linux CI runner。
4. WSL2 Ubuntu x64。

WSL2 可以用于构建和基础命令验证，但不建议把 WSL2 当成完整桌面验收环境。音频设备、桌面 session、AppImage 启动行为、FUSE 和 sandbox 细节都可能与真实用户环境不同。

推荐版本：

| 项目 | 建议 |
| --- | --- |
| Node.js | 20 LTS |
| npm | 9 或更高 |
| CPU | x64 |
| C++ | 支持 C++17 |
| CMake | 3.24 或更高更稳妥 |
| Electron | 使用仓库 `package-lock.json` 固定版本 |
| FFmpeg | Linux x64 可执行文件，至少包含 `aresample` |

确认平台：

```bash
uname -a
node -p "process.platform + '/' + process.arch"
```

期望 Node 输出：

```text
linux/x64
```

## 3. Ubuntu / Debian 依赖

基础构建和打包工具：

```bash
sudo apt update
sudo apt install cmake g++ pkg-config fakeroot dpkg rpm binutils
```

JUCE / audio host 相关依赖：

```bash
sudo apt install \
  libasound2-dev libjack-jackd2-dev \
  libfreetype-dev libfontconfig1-dev \
  libx11-dev libxcomposite-dev libxcursor-dev libxext-dev \
  libxinerama-dev libxrandr-dev libxrender-dev
```

桌面运行和 AppImage 验收可能需要：

```bash
sudo apt install libgtk-3-0 libnss3 libxss1 libxtst6 libdrm2 libgbm1
```

如果 AppImage 报 FUSE 相关错误，按发行版安装对应 FUSE 运行时。例如 Ubuntu 新版本可能需要：

```bash
sudo apt install libfuse2
```

不同发行版包名可能不同，但核心依赖类别不变：

- C++ 编译链。
- CMake。
- pkg-config。
- ALSA 开发库。
- X11 开发库。
- fontconfig / freetype。
- electron-builder 打包需要的 dpkg / fakeroot / rpm / binutils。

## 4. 获取代码和安装 Node 依赖

新环境从零开始：

```bash
git clone https://github.com/moekotori/echo.git
cd echo
npm ci
```

开发机已有仓库时：

```bash
git pull
npm ci
```

不要把 Windows 下的 `node_modules` 拷到 Linux。这个项目包含 native dependency，Linux 构建需要在当前 Linux 环境里重新安装或重建。

`build:linux` 会自动执行：

```bash
npm run rebuild:native
```

它会让 `better-sqlite3` 等 native dependency 匹配当前 Electron ABI。

## 5. Linux 工具目录

Linux 包使用独立工具目录：

```text
electron-app/tools-linux/
  README.md
  ffmpeg
  ffmpeg-manifest.json
  yt-dlp
```

打包后会复制到：

```text
dist/linux-unpacked/resources/tools/
```

要求：

| 文件 | 是否必须 | 作用 |
| --- | --- | --- |
| `ffmpeg` | 必须 | 解码、探测和音频处理工具链的一部分 |
| `ffmpeg-manifest.json` | 必须 | 记录 FFmpeg 版本、hash、必需 filter 和许可证信息 |
| `yt-dlp` | 可选 | 下载和部分 streaming helper |
| `README.md` | 已在仓库 | 说明目录用途 |

`yt-dlp` 缺失不应该阻断本地曲库扫描、本地播放和 Linux 包构建。它只会让下载/部分流媒体提取能力不可用。

## 6. 准备 FFmpeg

### 6.1 放置 Linux x64 FFmpeg

示例：

```bash
mkdir -p electron-app/tools-linux
cp /path/to/linux/ffmpeg electron-app/tools-linux/ffmpeg
chmod +x electron-app/tools-linux/ffmpeg
```

确认它不是 Windows 二进制：

```bash
file electron-app/tools-linux/ffmpeg
electron-app/tools-linux/ffmpeg -hide_banner -version
```

`file` 输出应该能看出 ELF / Linux x86-64。不要放 `.exe`。

### 6.2 可选放置 yt-dlp

```bash
cp /path/to/yt-dlp electron-app/tools-linux/yt-dlp
chmod +x electron-app/tools-linux/yt-dlp
```

如果没有 `yt-dlp`，可以跳过。

### 6.3 更新 manifest

当前模板在：

```text
electron-app/tools-linux/ffmpeg-manifest.json
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `name` | 工具名，通常是 `ffmpeg` |
| `version` | `ffmpeg -hide_banner -version` 输出里能匹配到的片段 |
| `source` | 本地或 CI 准备方式说明 |
| `sourceUrl` | 精确来源 URL，能填就填 |
| `downloadPage` | 下载页 |
| `artifact` | 仓库内 artifact 路径，应为 `electron-app/tools-linux/ffmpeg` |
| `sha256` | 当前 FFmpeg 文件的 SHA256 |
| `requiresSoxr` | 是否要求 `--enable-libsoxr` |
| `requiredFilters` | 必须存在的 FFmpeg filters，目前至少 `aresample` |
| `licenseFamily` | 许可证族，当前模板为 `GPLv3` |

计算 hash：

```bash
sha256sum electron-app/tools-linux/ffmpeg
```

检查 filters：

```bash
electron-app/tools-linux/ffmpeg -hide_banner -filters | grep aresample
```

检查 soxr：

```bash
electron-app/tools-linux/ffmpeg -hide_banner -version | grep enable-libsoxr
```

当前仓库模板里 `requiresSoxr` 是 `true`。如果你准备的 FFmpeg 没有 `--enable-libsoxr`，`npm run verify:ffmpeg` 会失败。此时有两个选择：

- 换一个带 `--enable-libsoxr` 的 FFmpeg。
- 如果当前发布目标不要求 soxr，把 manifest 里的 `requiresSoxr` 改成 `false`，但要明确这是发布策略变化。

### 6.4 验证 FFmpeg

```bash
npm run verify:ffmpeg
```

在 Linux 上，这条命令默认检查：

```text
electron-app/tools-linux/ffmpeg-manifest.json
```

如果要显式指定：

```bash
ECHO_FFMPEG_MANIFEST=electron-app/tools-linux/ffmpeg-manifest.json npm run verify:ffmpeg
```

通过时会看到类似：

```text
[verify:ffmpeg] OK ... sha256=...
```

## 7. audio host 和 ALSA

Linux shared native output 由 `echo-audio-host` 提供。构建入口：

```bash
npm run build:audio-host
```

相关源码和配置：

```text
native/audio-host/CMakeLists.txt
native/audio-host/src/main.cpp
native/audio-host/tests/audio_engine_tests.cpp
scripts/build-audio-host.mjs
```

Linux 平台构建特点：

- `ECHO_ENABLE_ASIO` 默认 `OFF`。
- 非 Windows 平台启用 `JUCE_ALSA=1`。
- 非 Windows 平台禁用 `JUCE_JACK=0`。
- CMake 会 `find_package(ALSA REQUIRED)`。
- 生成文件是 `electron-app/build/echo-audio-host`，没有 `.exe`。
- 构建完成后脚本会给 Linux host 设置可执行权限。

手动确认：

```bash
npm run build:audio-host
file electron-app/build/echo-audio-host
test -x electron-app/build/echo-audio-host
```

### ALSA backend 行为

应用层的 shared backend 有两种 Linux 重点路径：

- `Auto`：让 native host 根据当前设备枚举选择可用 shared backend。
- `ALSA`：只选择 ALSA 类型设备，用于明确验证 ALSA 链路。

PipeWire 系统通常通过 ALSA compatibility layer 暴露设备，所以很多现代发行版也可以走 ALSA 路径。但文档和发布说明里仍应写“ALSA 路径”，不要把 PipeWire 原生支持写成已完成。

## 8. 推荐构建流程

从干净 Linux x64 环境开始：

```bash
npm ci
npm run verify:ffmpeg
npm run test:audio-engine
npm run build:linux
```

如果只是重复打包，并且依赖和工具链没有变化：

```bash
npm run verify:ffmpeg
npm run build:linux
```

如果正在排查 audio host：

```bash
npm run build:audio-host
npm run test:audio-engine
```

如果只想先确认前端/主进程能编译：

```bash
npm run build
```

## 9. `build:linux` 做了什么

`package.json` 中：

```text
npm run build:linux
```

实际执行：

```text
node scripts/build-linux.mjs
```

脚本会按顺序做这些事：

1. 检查 `process.platform === "linux"`。
2. 检查 `process.arch === "x64"`。
3. 检查 `electron-app/tools-linux/ffmpeg` 存在且可执行。
4. 执行 `npm run rebuild:native`。
5. 执行 `npm run verify:ffmpeg`。
6. 执行 `npm run build:audio-host`。
7. 检查 `electron-app/build/echo-audio-host` 存在且可执行。
8. 执行 `npm run build`。
9. 执行 `electron-builder --linux`。
10. 检查打包后的 `resources/echo-audio-host`。
11. 检查打包后的 `resources/tools/ffmpeg`。
12. 如果源码目录有 `yt-dlp`，检查打包后的 `resources/tools/yt-dlp`。
13. 检查 `dist/` 下是否有 `.AppImage`。
14. 检查 `dist/` 下是否有 `.deb`。

只要其中任一步失败，脚本会停止。不要跳过失败继续发布。

## 10. electron-builder Linux 配置

Linux 配置在 `package.json` 的 `build.linux`：

```text
build.linux.icon = software.png
build.linux.target = AppImage x64 + deb x64
build.linux.category = AudioVideo
```

Linux extra resources：

```text
electron-app/build/echo-audio-host -> resources/echo-audio-host
electron-app/tools-linux -> resources/tools
```

也就是说，Linux 包里的 audio host 和 FFmpeg 都不是从 Windows 资源目录拿的。

预期产物：

```text
dist/linux-unpacked/resources/echo-audio-host
dist/linux-unpacked/resources/tools/ffmpeg
dist/*.AppImage
dist/*.deb
```

如果存在 `yt-dlp`：

```text
dist/linux-unpacked/resources/tools/yt-dlp
```

产包后检查权限：

```bash
test -x dist/linux-unpacked/resources/echo-audio-host
test -x dist/linux-unpacked/resources/tools/ffmpeg
test ! -f dist/linux-unpacked/resources/tools/yt-dlp || test -x dist/linux-unpacked/resources/tools/yt-dlp
```

## 11. 本地启动和桌面验收

### AppImage

```bash
chmod +x dist/*.AppImage
./dist/*.AppImage
```

### deb

```bash
sudo apt install ./dist/*.deb
```

安装后从桌面启动器或命令行启动。

### 最小验收

用小曲库验收，不要一上来导入超大库：

1. 启动应用。
2. 首次启动能进入主界面。
3. 导入一个小型本地音乐文件夹。
4. Songs 页面能显示歌曲。
5. Albums 页面能显示基本专辑信息。
6. 播放 WAV。
7. 播放 FLAC。
8. 播放 MP3。
9. 暂停、继续、上一首、下一首正常。
10. 切换曲目不会提前结束。
11. 进度不会异常跳动。

### Linux 输出验收

按顺序验收：

1. `System` 输出播放一首歌。
2. `Shared` + `Auto` 播放一首歌。
3. `Shared` + `ALSA` 播放一首歌。
4. 在 `ALSA` 下切换曲目。
5. 在 `ALSA` 下暂停 / 继续。
6. 在 `ALSA` 下拖动进度。
7. 打开播放诊断或专业状态面板，确认 output mode / backend 与选择一致。

### Linux 能力边界验收

确认 Linux 上不要出现错误可用的 Windows-only 能力：

- WASAPI Exclusive 不应作为 Linux 可用输出能力出现。
- ASIO 不应作为 Linux 可用输出能力出现。
- DirectSound 不应作为 Linux 可用 shared backend 出现。
- SMTC 相关能力不应被当作 Linux 桌面集成能力。

如果 UI 上能看到某些灰掉或说明性质的 Windows-only 文案，要确认它不会被误认为 Linux 可用路径。

## 12. 建议验收矩阵

发布前至少覆盖：

| 维度 | 最小要求 |
| --- | --- |
| 包格式 | AppImage、deb |
| 音频格式 | WAV、FLAC、MP3 |
| 输出模式 | System、Shared + Auto、Shared + ALSA |
| 曲库 | 小曲库导入和基础浏览 |
| 播放控制 | 播放、暂停、继续、切歌、拖动进度 |
| 平台隔离 | Windows-only 输出不在 Linux 上误暴露 |

有条件时增加：

| 维度 | 建议 |
| --- | --- |
| 发行版 | Ubuntu LTS、Debian stable、Fedora 或 Arch 派生环境 |
| 音频服务 | PulseAudio、PipeWire with ALSA compatibility |
| 设备 | 内置声卡、USB DAC、蓝牙输出 |
| 时间 | 连续播放 30 分钟以上 |
| 曲库 | 中型曲库扫描后播放 |

不要把所有压力混在一轮里。先确认播放，再确认扫描，再确认长时间稳定性。这样出现问题时更好定位。

## 13. 常见失败和处理

### 13.1 在 Windows 上运行 `build:linux`

现象：

```text
[build:linux] Linux packages must be built on Linux x64.
```

处理：

- 切到 Linux x64。
- 使用 WSL2 / VM / CI runner。
- 不要绕过脚本的平台检查。

### 13.2 架构不是 x64

现象：

```text
[build:linux] Linux packaging currently supports x64 only.
```

处理：

- 换 x64 runner。
- arm64 支持要另做构建链、依赖、产物和验收，不要直接复用 x64 文档。

### 13.3 找不到 Linux FFmpeg

现象：

```text
[build:linux] Missing Linux ffmpeg
```

处理：

```bash
ls -l electron-app/tools-linux/ffmpeg
file electron-app/tools-linux/ffmpeg
chmod +x electron-app/tools-linux/ffmpeg
```

确认它是 Linux ELF x86-64 文件。

### 13.4 FFmpeg 不可执行

现象：

```text
[build:linux] Linux ffmpeg is not executable
```

处理：

```bash
chmod +x electron-app/tools-linux/ffmpeg
```

如果是在 CI artifact 解压后丢失权限，也要在 CI 里显式 `chmod +x`。

### 13.5 manifest hash 不匹配

现象：

```text
[verify:ffmpeg] SHA256 mismatch
```

处理：

```bash
sha256sum electron-app/tools-linux/ffmpeg
```

把 manifest 的 `sha256` 更新为当前文件 hash。注意：如果 FFmpeg 来源不可信，先换可信二进制，不要为了过校验直接改 hash。

### 13.6 manifest 版本不匹配

现象：

```text
[verify:ffmpeg] Version output does not contain "..."
```

处理：

```bash
electron-app/tools-linux/ffmpeg -hide_banner -version
```

把 manifest 的 `version` 改成输出中真实存在的稳定片段。

### 13.7 缺少 `aresample`

现象：

```text
[verify:ffmpeg] Required FFmpeg filter is missing: aresample
```

处理：

- 换带 `aresample` 的 FFmpeg。
- 不建议移除 `requiredFilters` 来绕过，因为音频链路依赖重采样能力。

### 13.8 缺少 `libsoxr`

现象：

```text
[verify:ffmpeg] FFmpeg build configuration does not include --enable-libsoxr
```

处理：

- 使用带 `--enable-libsoxr` 的 FFmpeg。
- 或在确认发布策略允许后，把 `requiresSoxr` 改成 `false`。

### 13.9 `npm ci` 失败

处理：

- 确认 Node.js 是 20 LTS。
- 删除当前 Linux 环境的 `node_modules` 后重新 `npm ci`。
- 不要复用 Windows `node_modules`。
- 如果是网络问题，先处理 npm registry / proxy，不要改业务代码。

### 13.10 native module ABI 问题

可能表现为 `better-sqlite3` 加载失败或 Electron ABI 不匹配。

处理：

```bash
npm run rebuild:native
```

然后重新：

```bash
npm run build:linux
```

### 13.11 audio host 编译失败

现象：

```text
[build:audio-host] Failed to build JUCE audio host.
```

优先检查：

```bash
cmake --version
g++ --version
pkg-config --modversion alsa
```

再确认依赖：

```bash
sudo apt install cmake g++ pkg-config libasound2-dev libfreetype-dev libfontconfig1-dev
```

如果日志里是 JUCE 拉取失败，先处理网络或 CMake FetchContent 缓存，不要先改 audio host 代码。

### 13.12 electron-builder 没产出 AppImage / deb

检查：

```bash
ls -la dist
```

确认 `package.json` 里的 Linux target 仍包含：

```text
AppImage x64
deb x64
```

如果只缺某一种包，优先看 electron-builder 输出，不要直接改构建脚本绕过检查。

### 13.13 AppImage 启动失败

先执行：

```bash
chmod +x dist/*.AppImage
./dist/*.AppImage
```

FUSE 相关问题按发行版安装 FUSE runtime。临时分析可用：

```bash
./dist/*.AppImage --appimage-extract
```

但发布验收仍要回到标准 AppImage 启动路径。

### 13.14 deb 安装失败

执行：

```bash
sudo apt install ./dist/*.deb
```

保留 apt 输出。常见方向：

- 目标系统依赖缺失。
- deb metadata 不适配目标发行版。
- 本机已有旧安装残留。

不要用强制安装掩盖依赖问题作为发布验收结论。

### 13.15 Linux 下没有声音

先分层确认：

1. 系统播放器是否有声音。
2. ECHO `System` 输出是否有声音。
3. ECHO `Shared + Auto` 是否有声音。
4. ECHO `Shared + ALSA` 是否有声音。
5. 只有某个文件无声，还是所有格式无声。
6. 只有某个设备无声，还是所有设备无声。

可用系统命令辅助：

```bash
aplay -l
pactl info
```

如果 `System` 正常但 `ALSA` 不正常，优先看 ALSA 设备枚举和 audio host 日志。如果所有输出都不正常，先看系统音频服务和应用启动日志。

## 14. CI 示例流程

CI runner 要是 Linux x64。最小流程：

```bash
npm ci
chmod +x electron-app/tools-linux/ffmpeg
test ! -f electron-app/tools-linux/yt-dlp || chmod +x electron-app/tools-linux/yt-dlp
npm run verify:ffmpeg
npm run test:audio-engine
npm run build:linux
```

CI 可以缓存：

- npm cache。
- Electron 下载缓存。
- FFmpeg artifact。
- CMake 下载缓存。

不要跨平台缓存：

- Windows `node_modules`。
- Windows native module build output。
- Windows `electron-app/build/echo-audio-host.exe`。
- Windows `electron-app/tools/`。

CI 构建通过只说明包能产出，不说明真实桌面音频已经验收。发布前仍要做 Linux 桌面手动验收。

## 15. 发布前检查清单

产物：

- `dist/*.AppImage` 存在。
- `dist/*.deb` 存在。
- `dist/linux-unpacked/resources/echo-audio-host` 存在。
- `dist/linux-unpacked/resources/echo-audio-host` 可执行。
- `dist/linux-unpacked/resources/tools/ffmpeg` 存在。
- `dist/linux-unpacked/resources/tools/ffmpeg` 可执行。
- 如果带 `yt-dlp`，打包后也存在且可执行。

基础应用：

- AppImage 能启动。
- deb 安装后能启动。
- 首次启动能进入主界面。
- 小曲库能导入。
- Songs / Albums 基础显示正常。

播放：

- WAV 可播放。
- FLAC 可播放。
- MP3 可播放。
- 暂停 / 继续正常。
- 切歌正常。
- 拖动进度正常。
- 没有明显提前结束。
- 没有明显异常跳进度。

输出：

- `System` 可播放。
- `Shared + Auto` 可播放。
- `Shared + ALSA` 可播放。
- 诊断状态显示和实际输出选择一致。

平台边界：

- WASAPI Exclusive 没有作为 Linux 可用能力出现。
- ASIO 没有作为 Linux 可用能力出现。
- DirectSound 没有作为 Linux 可用 shared backend 出现。
- Windows SMTC 相关能力没有被当作 Linux 能力。

发布说明：

- 标明 Linux 当前是 x64。
- 标明包格式是 AppImage / deb。
- 标明 ALSA 是当前明确支持的 shared native backend。
- 不承诺 JACK / PipeWire native / Linux exclusive HiFi，除非后续已经真实实现并验收。

## 16. 维护原则

Linux 构建和 ALSA 支持后续继续按低风险方式推进：

- 构建链问题先定位环境和脚本，不要先动播放核心。
- FFmpeg 问题先看 manifest、hash、filter、权限和二进制来源。
- ALSA 问题先看设备枚举、backend 选择和 audio host 日志。
- 新增 Linux backend 要保持 Windows 行为隔离。
- 发布前优先做小曲库和播放链路验收，再做大曲库压力。
- 任何可能影响播放稳定性的改动，都要有针对性验证，不能只凭构建通过判断。
