<p align="center">
  <a href="https://echonext.moe/zh/">
    <img src="https://echonext.moe/assets/product/brand-art-1200.webp" width="880" alt="ECHO NEXT" />
  </a>
</p>

<h1 align="center">ECHO NEXT</h1>

<p align="center">一个认真做本地曲库和桌面音频输出的音乐播放器。</p>

<p align="center">
  <a href="https://echonext.moe/zh/download/">下载</a>
  ·
  <a href="https://echonext.moe/zh/docs/">文档</a>
  ·
  <a href="https://echonext.moe/zh/changelog/">更新日志</a>
  ·
  <a href="https://github.com/Moekotori/ECHO/issues">反馈问题</a>
  ·
  <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/Moekotori/ECHO/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/Moekotori/ECHO/total?style=flat-square&logo=github&label=downloads&color=22c55e" />
  </a>
  <a href="https://github.com/Moekotori/ECHO">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/Moekotori/ECHO?style=flat-square&logo=github&label=stars&color=fbbf24" />
  </a>
</p>

## ECHO 是什么

ECHO 是一款以本地音乐为主的桌面播放器。它会扫描你自己的音乐文件，整理专辑、艺术家、封面和播放列表，也提供歌词、MV、远程曲库和插件等功能。

NEXT:代表Next Generation，初版本的ECHO存在大量不合理...屎山代码..以及完全未注意到性能问题ww

所以干脆不修复了！我们重构不就好了，故新版本取名为ECHO Next



这个项目最初只是想把“管理好自己的音乐、安稳地听完一张专辑”做好。后来接入了 WASAPI、ASIO、DSD、参数均衡器、FIR 和采样率转换，音频链路逐渐成了 ECHO 很重要的一部分。不过它首先仍是一台音乐播放器，不要求用户先学会一堆音频术语才能开始听歌。

目前开发和设备适配仍以 Windows 为主。Linux x64 已经有 AppImage、deb 和 ALSA shared output 的构建路径，但功能边界与 Windows 不完全相同，详见 [Linux 构建指南](./docs/ECHO_NEXT_LINUX_BUILD.md)。（实际上是作者无力开发Linux..又要上班又要上学实在是没空）

如果你只是想使用 ECHO，直接去[官方下载页](https://echonext.moe/zh/download/)或 [GitHub Releases](https://github.com/Moekotori/ECHO/releases/latest) 即可。这个仓库主要用于查看源码、本地构建、提交问题和参与开发。

## 主要功能

- 本地曲库：文件夹扫描、标签和封面读取、专辑与艺术家视图、收藏、历史记录、播放列表、重复曲目检查。
- 播放体验：播放队列、无缝播放、淡入淡出、ReplayGain、CUE、桌面歌词、沉浸播放页和系统媒体控制。
- 音频输出：System、WASAPI Shared、WASAPI Exclusive、厂商 ASIO、DoP，以及实验性的 ASIO Native DSD。
- DSP：参数均衡器、前级与余量管理、OPRA 耳机校正、FIR 卷积、声道增益、平衡、PCM/SDM升频、延迟和 Mono。
- 采样率转换：ECHO SRC 支持多个 PCM 倍率和质量策略；符合条件时可以使用 CUDA worker，并明确显示实际运行路径和回退状态。
- 远程与外部设备：WebDAV、SMB、Jellyfin、Emby、Subsonic/Navidrome、DLNA/UPnP、AirPlay 和 HQPlayer。不同服务与设备的兼容性会有差异。这里最推荐使用Subsonic！
- 日常维护：曲库诊断、缓存迁移、设置备份、日志和崩溃恢复。
- 还有一些吧啦吧啦的内容就不多赘述了，总之我们应该是功能最全的播放器~

虽然功能不少，但每条链路都确保了可靠性！尤其是 ASIO、DSD、HQPlayer、AirPlay 和远程来源，最终表现取决于驱动、DAC、网络与服务端。遇到问题时，先退回 System 或 WASAPI Shared，再逐项开启高级功能，通常更容易定位原因。

## 音频链路

ECHO 会尽量把声音实际经过的路径显示出来，而不是只给一个“HiFi 已开启”的开关。

```text
音乐文件或远程来源
        ↓
      解码为 PCM
        ↓
ReplayGain / EQ / FIR / 声道工具
        ↓
 ECHO SRC（按需启用）
        ↓
System / WASAPI / ASIO / HQPlayer
        ↓
       输出设备
```

关闭 DSP 和采样率转换后，ECHO 会尽量走直接输出路径；开启 EQ、FIR、ReplayGain、声道处理或 SRC 后，PCM 数据已经被处理，界面也不应再把它标成 bit-perfect。软件里的输出模式只是链路的一部分，DAC 最终收到什么格式，仍要结合驱动和设备状态判断。

ECHO SRC 是已经接入的 PCM 采样率转换链路。ECHO SDM 则仍属于研发预览，用于探索 PCM 到 Sigma-Delta Modulation 的实时处理，不代表所有设备都能使用，也不等同于原生 DSD 文件直出。

<p align="center">
  <img src="https://echonext.moe/assets/product/dsp-center-eq.webp" width="49%" alt="ECHO NEXT 参数均衡器" />
  <img src="https://echonext.moe/assets/product/dsp-center-fir.webp" width="49%" alt="ECHO NEXT FIR 房间校正" />
</p>

相关文档：

- [DSP 入门](https://echonext.moe/zh/docs/audio-output/dsp-beginner/)
- [参数均衡器](https://echonext.moe/zh/docs/audio-output/eq/)
- [ECHO SRC 与 PCM 升频](https://echonext.moe/zh/docs/audio-output/upsampling/)
- [DSD 播放](https://echonext.moe/zh/docs/audio-output/dsd/)
- [WASAPI Exclusive 与 ASIO](https://echonext.moe/zh/docs/audio-output/asio-vs-exclusive/)

## 本地开发

项目使用 Electron、React、TypeScript 和 SQLite。Windows 端还包含若干 C++ 原生组件，用来处理音频输出、曲库扫描、SMTC 和任务栏控制。

准备好 Node.js 和 npm 后：

```bash
git clone https://github.com/Moekotori/ECHO.git
cd ECHO
npm ci
npm run dev
```

`npm ci` 会安装依赖并处理 Electron 原生模块。第一次执行 `npm run dev` 时，脚本还会检查音频 host、AirPlay helper 和任务栏 host；缺少本机构建环境或下载依赖时，会在这里给出错误。

日常常用命令：

```bash
npm run typecheck       # TypeScript 检查
npm test                # Vitest 测试
npm run build           # 构建 Electron 应用
npm run build:win       # Windows 安装包与便携版
npm run build:linux     # Linux x64 构建，只能在 Linux 上执行
```

音频和原生组件有自己的构建与 smoke 命令，修改相关代码前请先看 [Audio Core 文档](./docs/ECHO_NEXT_AUDIO_CORE.md) 和 [项目架构说明](./docs/ECHO_NEXT_ARCHITECTURE.md)。完整 Windows 打包还需要 FFmpeg、原生编译工具及对应的资源文件，不能只以 Renderer 构建通过作为发布依据。

## 目录

```text
src/main/       Electron 主进程、数据库、播放服务和系统集成
src/preload/    Renderer 与主进程之间的受控桥接
src/renderer/   React 界面
src/shared/     进程间共享的类型和工具
native/         音频 host、扫描器、SMTC、CUDA worker 等原生组件
scripts/        构建、检查、打包和 smoke 脚本
docs/           用户、架构、音频、插件和平台文档
```

## 提交问题和参与开发

发现问题时，请先确认版本并搜索已有 Issue。新 Issue 最好附上：

- ECHO 版本和安装来源；
- Windows 或 Linux 版本；
- 能稳定复现的操作步骤；
- 预期结果和实际结果；
- 必要的日志、截图或录屏。

日志里可能包含本机路径、账号信息或远程服务地址，上传前请先检查并删除敏感内容。

代码贡献请先开 Issue 说明要解决的问题。小而清楚的 PR 更容易确认行为和合并；大型 PR 不会直接合并，请先沟通并拆成可独立审查的改动。开发、设计、测试和文档方面的长期协作可以查看 [ECHO Developer Plan](https://echonext.moe/zh/developer/)。

## 关于重新开源

ECHO 曾经因为维护者持续受到骚扰、仓库遭到破坏而关闭源码。现在项目重新开源，是因为我们仍然愿意让大家了解、使用和帮助改进它。

这里不打算把那段经历写成宣传故事，只希望使用代码的人尊重作者、许可证和其他参与者。善意的反馈、认真写清楚的问题，以及范围明确的修复，都很欢迎。

ECHO NEXT 采用 [GNU Lesser General Public License v3.0](./LICENSE)，对应 SPDX 标识 `LGPL-3.0-only`。你可以依照许可证使用、修改和分发代码；分发修改版本或组合软件时，请同时遵守 LGPL 对源码、许可证声明、重新链接能力等方面的要求。仓库中的第三方组件和素材仍按各自的许可证授权。

## 近期说明

ECHO 正在准备上架 Steam。在 **2026 年 8 月 15 日前**购入 ECHO Pro，可免费获得 Steam CD Key，并加入贡献者名单；周边赠送需要自行支付邮费。具体内容和后续变动以[爱发电页面](https://www.ifdian.net/a/echonext)为准。

功能建议可以提交到 [ECHO 许愿池](https://docs.qq.com/form/page/DYkt1UVNuaEpHcFB5)，普通问题与缺陷请继续使用 GitHub Issues。

---

ECHO 还在持续开发。谢谢每一个认真听歌、认真反馈问题的人。
