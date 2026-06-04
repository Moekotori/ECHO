<p align="center">
  <img src="./logo.png" alt="ECHO NEXT" width="520" />
</p>

<h1 align="center">ECHO NEXT</h1>

<p align="center">
  <strong>面向本地曲库、HiFi 输出和长期维护的开源桌面音乐播放器</strong>
</p>

<p align="center">
  <a href="./README_EN.md">English README</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="https://github.com/moekotori/echo/releases/latest">Latest Release</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="https://afdian.com/a/echonext">爱发电</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#项目架构">项目架构</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="https://qm.qq.com/q/OdpngxJU86">QQ 群聊</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="https://discord.gg/g7v4WMRq3K">Discord</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#快速开始">快速开始</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="./docs/USER_GUIDE.md">用户教程</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="./docs/USER_GUIDE.md#plugins-插件">插件教程</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="./docs/ECHO_NEXT_PLUGINS.md">插件制作</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="./docs/ECHO_NEXT_LINUX_BUILD.md">Linux 构建指南</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#开发与构建">开发与构建</a>
</p>

<p align="center"><strong>反馈问题请礼貌 一股爹味跟我说话死全家</strong></p>

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/moekotori/echo?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/github/stars/moekotori/echo?style=flat-square&logo=github" alt="GitHub stars" />
  <img src="https://img.shields.io/github/downloads/moekotori/echo/total?style=flat-square&logo=github" alt="GitHub downloads" />
  <img src="https://img.shields.io/badge/Electron-37.x-47848f?style=flat-square" alt="Electron 37" />
  <img src="https://img.shields.io/badge/React-18.2-61dafb?style=flat-square" alt="React 18.2" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
</p>

<p align="center">
  <img src="./docs/img.png" alt="ECHO NEXT interface preview" width="100%" />
</p>

> [!TIP]
> Debug 小提示：遇到设备或播放异常，先到 **设置 > 播放** 打开 **低负载播放模式**；反馈问题时请到 **设置 > 关于 > 打开控制台**，复制报错或导出日志。若只有某一首歌异常，请先换其他歌曲确认，单曲问题通常更可能来自文件本身。第三方音频驱动/包装层导致的问题不作为有效 issue 受理。
> 更新优先级：**音频稳定性 > HiFi > 杂项功能 > 流媒体**。

---

## 项目定位

ECHO NEXT 是 ECHO 系列的下一代桌面音乐播放器工程。它不是旧版本的简单换皮，而是围绕本地曲库、播放稳定性、原生音频输出、歌词、MV、远程来源、插件和桌面集成重新拆分架构边界。

项目优先级很明确：本地播放可靠，音频链路稳定，大曲库不卡顿，用户数据安全，网络能力只作为补全和扩展，不把播放器变成依赖在线平台的壳。

> [!IMPORTANT]
> ECHO NEXT 的核心仍然是本地音乐播放器。反馈问题请尽量提供可复现步骤、系统环境、版本、截图、日志和你实际操作的路径。
> 任何绕过会员、版权、平台限制或违反 DMCA 的功能请求都不会被接受。
> 情绪化表达、无复现依据的指责、针对个人审美或使用偏好的争论，也不会作为有效 issue 处理。

## 项目架构

ECHO NEXT 不是纯网页播放器。React 只负责界面和交互呈现，真正的曲库、播放、系统集成和原生音频输出由桌面后端与原生模块分层完成。

| 层 | 主要职责 |
| --- | --- |
| React Renderer | 页面、列表、歌词、MV、设置和播放器控制界面 |
| Preload / IPC Bridge | 在渲染层和主进程之间暴露受控 API，隔离 Node / 原生权限 |
| Electron Main Services | 窗口生命周期、曲库扫描、SQLite、缓存、元数据、插件、远程来源和诊断 |
| Native Audio Host | WASAPI Shared / Exclusive、ASIO、设备状态、低延迟输出和播放恢复边界 |

所以 ECHO NEXT 的前端不是完整产品本身，而是桌面服务和原生播放能力的可视化控制面。完整架构说明见 [docs/ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md)。

## 音频输出建议

ECHO NEXT 会持续改善原生音频输出的稳定性，但不鼓励迷信“接口名称”。真正决定声音表现的核心仍然是 DAC / 声卡 / 耳放 / 耳机等硬件本身，而不是播放器里是否显示 ASIO 或独占。

- **ASIO**：优先使用设备原厂 ASIO 驱动。ASIO4ALL、FlexASIO、Voicemeeter 等第三方 ASIO 包装层行为不可控，通常也不会让不支持原生 ASIO 的设备获得真正音质提升；仅由此类包装层引起的问题，后续不作为专项维护方向。
- **WASAPI Exclusive**：更适合外置 DAC、USB 声卡和专业音频接口。电脑耳机孔、笔记本 3.5mm 或主板集成声卡通常没有必要强行开启独占，系统输出或 WASAPI Shared 往往更稳定省心。

## 适合谁

| 你想要 | ECHO NEXT 的侧重点 |
| --- | --- |
| 管理自己的本地音乐文件 | 文件夹扫描、SQLite 曲库、标签读取、封面缓存、专辑聚合 |
| 在 Windows 上认真调输出 | 系统输出、WASAPI、ASIO、EQ、采样率状态、bit-perfect 提示 |
| 大曲库下界面仍然稳 | 歌曲列表、专辑墙和封面加载尽量分页、缓存、虚拟化 |
| 歌词、MV、封面和元数据可控 | 自动匹配辅助，手动选择、来源优先级和本地缓存更重要 |
| 想扩展但不想破坏主程序 | 插件、远程库、下载器、流媒体和网络元数据都放在受控边界里 |

## 核心能力

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>本地曲库</strong><br />
      导入文件夹、歌曲列表、专辑墙、艺术家、收件箱、收藏、历史、播放列表、重复歌曲筛选、标签编辑。
    </td>
    <td width="33%" valign="top">
      <strong>稳定播放</strong><br />
      播放队列、底部播放器、系统媒体控制、输出设备状态、播放诊断、错误提示和恢复边界。
    </td>
    <td width="33%" valign="top">
      <strong>HiFi 输出</strong><br />
      WASAPI Shared、WASAPI Exclusive、ASIO、EQ、Preamp、ReplayGain、采样率状态和 bit-perfect 提示。
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <strong>歌词与 MV</strong><br />
      本地歌词、在线候选、翻译、罗马音、日文假名增强、歌词偏移、MV 匹配、质量选择和外部播放边界。
    </td>
    <td width="33%" valign="top">
      <strong>网络扩展</strong><br />
      WebDAV、Jellyfin、Emby、SMB、SSHFS、Subsonic、流媒体搜索、下载器、网络代理和远程后台任务。
    </td>
    <td width="33%" valign="top">
      <strong>维护诊断</strong><br />
      插件权限、日志、崩溃恢复、曲库健康、缓存迁移、设置备份、危险操作确认。
    </td>
  </tr>
</table>

## 快速开始

### 获取发布版

普通用户优先从 [GitHub Releases](https://github.com/moekotori/echo/releases/latest) 下载。Windows 用户通常选择安装包或便携版；Linux 用户可以选择 AppImage 或 deb 包，具体取决于发布版本提供的构建产物。

首次启动后，建议先导入一个较小的音乐文件夹确认扫描、封面、播放和歌词入口正常，再导入完整曲库。

### 推荐上手路线

| 阶段 | 做什么 |
| --- | --- |
| 1 | 导入一个小音乐文件夹 |
| 2 | 在 `Songs`、`Albums`、`Inbox` 检查歌曲、封面、专辑聚合 |
| 3 | 试用播放、收藏、加入队列、加入歌单、右键菜单 |
| 4 | 调整歌词、MV、EQ、输出设备和外观 |
| 5 | 需要时再启用远程来源、流媒体、下载器和插件 |

完整教程见 [docs/USER_GUIDE.md](./docs/USER_GUIDE.md)。

## 页面速查

| 页面 | 用途 |
| --- | --- |
| `Songs` | 全曲库浏览、搜索、排序、批量选择、标签编辑、重复歌曲筛选 |
| `Albums` | 专辑墙、专辑详情、整张播放、专辑封面和标签整理 |
| `Artists` | 按艺术家浏览歌曲和专辑 |
| `Folders` | 管理本地导入目录和扫描状态 |
| `Inbox` | 查看新扫描进入曲库的歌曲 |
| `Queue` | 管理临时播放顺序 |
| `Liked` | 快速收藏常听歌曲 |
| `History` | 找回最近播放内容 |
| `Playlists` | 管理长期歌单 |
| `Lyrics` | 沉浸式歌词和播放页 |
| `Streaming` | 在线搜索、试听、发现候选 |
| `Downloads` | URL 下载、搜索下载、导入曲库 |
| `Cloud / Remote` | 远程来源和远程库索引 |
| `Connect` | DLNA、AirPlay 等局域网播放能力 |
| `Plugins` | 本地插件、权限、日志、导入导出 |
| `Settings` | 播放、歌词、MV、EQ、外观、曲库、集成、诊断和危险操作 |

## ECHO NEXT 和 ECHO 的区别

ECHO 是上一代完整播放器，重点是把本地播放、歌词、MV、下载、插件、投屏和共听等体验集中在一个桌面应用里。

ECHO NEXT 更像一次底层重建。它把曲库、音频、Renderer、Preload、主进程、原生宿主和系统集成分层，避免在旧代码上继续堆功能。对用户来说，它追求更稳定的大曲库体验、更清晰的 HiFi 输出状态、更可靠的设置和更容易维护的功能边界。

如果你想要成熟功能集合，可以关注 ECHO；如果你更关心下一代架构、性能、Linux 适配和后续 HiFi 能力，ECHO NEXT 是新的主线。

## 开发与构建

开发环境推荐：

| 依赖 | 推荐版本 |
| --- | --- |
| Node.js | 20 LTS |
| npm | 9 或更高 |
| Windows 构建工具 | Visual Studio 2022 Desktop development with C++ |
| Linux 构建工具 | CMake、g++、pkg-config、fakeroot、dpkg、rpm、binutils 和音频相关依赖 |

```bash
git clone https://github.com/moekotori/echo.git
cd echo
npm install
npm run dev
```

如果你需要同时构建音频宿主和 Windows SMTC 宿主：

```bash
npm run dev:full
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run dev:full` | 构建音频宿主和 SMTC 宿主后启动开发环境 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行 Vitest 测试 |
| `npm run build` | 类型检查并构建主进程、预加载和渲染进程 |
| `npm run build:win` | 构建 Windows 安装包和便携版 |
| `npm run build:linux` | 在 Linux x64 环境构建 Linux 包 |
| `npm run verify:ffmpeg` | 检查 FFmpeg 工具链 |
| `npm run smoke:audio-host` | 音频宿主烟测 |
| `npm run smoke:smtc-host` | Windows SMTC 宿主烟测 |

文档改动通常只需要检查内容和格式；播放、数据库、扫描、音频宿主、SMTC、打包等改动再按对应范围做 focused check。

## 架构概览

```text
React Renderer
  pages, components, virtual lists, settings, player controls
        |
Typed Preload Bridge
        |
Electron Main Process
  IPC, windows, lifecycle, services, system integration
        |
        +-- Library Core
        |     SQLite, scans, metadata, covers, folders, playlists
        |
        +-- Audio Core
        |     AudioSession, decoder pipeline, output bridge, device state
        |
        +-- Native Hosts
        |     echo-audio-host, WASAPI, ASIO, EQ, SMTC helper
        |
        +-- Experience Services
              lyrics, MV, streaming, downloads, plugins, remote sources
```

Renderer 只负责交互和展示，不直接扫描目录、不生成封面、不解析音频文件、不计算权威播放进度。主进程通过类型化 IPC 暴露受控能力，重任务进入 Library Core、Audio Core、原生宿主或独立服务。

## 算法致敬

ECHO NEXT 不是算法竞赛项目，但很多体验都离不开 ACM / ICPC 那类经典算法思想。这里记录项目实际用到或直接借鉴的部分，也向这些朴素但可靠的算法致敬。

| 场景 | 使用到的算法思想 |
| --- | --- |
| 歌词、封面和网络元数据匹配 | N-gram / Sørensen-Dice 相似度、Token overlap / Jaccard 思路、加权评分、阈值判定 |
| 歌词候选自动选择 | 多字段打分、版本标签冲突检测、时长差分、风险分层和优先级排序 |
| 重复歌曲识别 | 字符串归一化、哈希桶 / 分组键、近似时长聚类、版本标记冲突过滤 |
| 大曲库扫描和远程后台任务 | 队列调度、分块处理、去重集合、限流并发、优先级排序和让出事件循环 |
| 本地曲库查询与缓存 | SQLite 索引、增量快照、缓存键、分页和虚拟化列表 |

也特别致敬 KMP、Trie、AC 自动机、动态规划、图搜索、并查集、堆和最短路这些经典算法训练。即使它们不一定都以教科书形态出现在代码里，工程里的“快、稳、边界清楚”，很多都来自这些基础训练。

## 反馈规范

有效反馈应包含：系统版本、ECHO NEXT 版本、安装版或开发模式、问题页面、复现步骤、预期行为、实际行为、截图、日志或诊断报告。如果是播放问题，请附上输出模式、设备、音频格式，以及是否只影响某些文件。

不接受绕过会员、版权、平台限制或 DRM 的请求。不接受没有复现路径的情绪化否定，也不接受与本地播放器核心方向无关的大型平台接入要求。

## 相关文档

| 文档 | 内容 |
| --- | --- |
| [USER_GUIDE.md](./docs/USER_GUIDE.md) | 用户教程和功能说明 |
| [ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md) | 总体架构 |
| [ECHO_NEXT_LIBRARY_CORE.md](./docs/ECHO_NEXT_LIBRARY_CORE.md) | 曲库核心 |
| [ECHO_NEXT_AUDIO_CORE.md](./docs/ECHO_NEXT_AUDIO_CORE.md) | 音频核心 |
| [ECHO_NEXT_EQ.md](./docs/ECHO_NEXT_EQ.md) | EQ 与 DSP 边界 |
| [ECHO_NEXT_PLUGINS.md](./docs/ECHO_NEXT_PLUGINS.md) | 插件制作指南，从零创建、启用、调试和发布插件 |
| [plugin-sdk/ForAIReadme.md](./docs/plugin-sdk/ForAIReadme.md) | 给 AI 读取的插件编写规则和检查清单 |
| [ECHO_NEXT_NETWORK_METADATA.md](./docs/ECHO_NEXT_NETWORK_METADATA.md) | 网络元数据补全 |
| [ECHO_NEXT_LINUX_BUILD.md](./docs/ECHO_NEXT_LINUX_BUILD.md) | Linux 构建 |
| [ECHO_NEXT_UI_GUIDE.md](./docs/ECHO_NEXT_UI_GUIDE.md) | UI 指南 |

## English Summary

ECHO NEXT is an open-source desktop music player focused on local libraries, stable playback, HiFi-oriented output, lyrics, MV, remote sources, plugins, and maintainable Electron architecture.

The project prioritizes local ownership and playback stability over online-platform dependency. See [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) for the full Chinese user guide.
