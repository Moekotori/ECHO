<div align="center">
  <img src="website/echo-logo.png" width="700" alt="ECHO">

  <h3>ECHO · 面向桌面发烧友的 HiFi 音乐播放器</h3>

  <p>
    Electron + React 构建 · 原生音频链路 · 沉浸式歌词 · MV 联动 · 插件扩展
  </p>

  <p>
    <a href="https://github.com/Moekotori/ECHO/releases/latest">
      <img src="https://img.shields.io/github/v/release/Moekotori/ECHO?style=flat-square&label=Latest%20Release&color=cc8b65" alt="Latest Release">
    </a>
    <a href="https://github.com/Moekotori/ECHO/releases">
      <img src="https://img.shields.io/github/downloads/Moekotori/ECHO/total?style=flat-square&color=6f9db6" alt="Downloads">
    </a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-flat-square&color=9aab89" alt="Platform">
    <img src="https://img.shields.io/badge/Electron-31.x-546f82?style=flat-square" alt="Electron">
    <img src="https://img.shields.io/badge/React-18-5ba7c8?style=flat-square" alt="React">
  </p>

  <p>
    <a href="https://github.com/Moekotori/ECHO/releases/latest"><strong>⬇ 下载最新版本</strong></a>
    &nbsp;·&nbsp;
    <a href="#-快速开始">快速开始</a>
    &nbsp;·&nbsp;
    <a href="#-功能总览">功能总览</a>
    &nbsp;·&nbsp;
    <a href="#-插件开发">插件开发</a>
    &nbsp;·&nbsp;
    <a href="#-listen-together-服务端">联机听歌</a>
  </p>
</div>

---

ECHO 是一款以桌面 HiFi 播放体验为核心的跨平台音乐播放器。它不是把“能播歌”这件事做得刚刚够用，而是把本地音乐库、原生音频输出、歌词呈现、MV 联动、媒体下载和可扩展能力都认真打磨成一套完整的桌面工作流。

如果你在意播放链路、设备切换、歌词细节、桌面沉浸感，或者希望在播放器之上继续做插件与定制化开发，ECHO 想成为一个更有想法的起点。

## 🖼 截图预览

<div align="center">
  <img src="./website/1.png" width="800" alt="ECHO 主界面">
  <br><br>
  <img src="./website/2.png" width="800" alt="ECHO 歌词界面">
  <br><br>
  <img src="./website/3.png" width="800" alt="ECHO MV 模式">
</div>

---

## ✨ 功能总览

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>🎛 HiFi 音频引擎</h4>
      原生音频宿主 <code>echo-audio-host</code> 独立运行，支持 Windows WASAPI 独占模式与 ASIO 设备接入，提供更直接的设备控制链路。内置 16 段参数均衡器与 Preamp，并支持变速播放、交叉淡入淡出、睡眠定时器等播放控制。
    </td>
    <td width="50%" valign="top">
      <h4>🫧 沉浸式歌词体验</h4>
      支持逐行与逐字高亮歌词，自动从 NetEase / LRCLIB 获取歌词，支持翻译、日语罗马音转换，以及可悬浮的桌面歌词窗口。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>🎬 MV 联动</h4>
      播放时可匹配 YouTube / Bilibili MV，支持全屏背景展示、画质切换、偏移校准，并在失败时自动回退，保证主播放流程稳定。
    </td>
    <td valign="top">
      <h4>🫂 Listen Together + DLNA</h4>
      内置 Listen Together WebSocket 服务端示例，支持房间同步播放与鉴权接入，同时支持 DLNA 投流到局域网设备。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>📥 媒体下载与导入</h4>
      支持下载 YouTube、Bilibili、SoundCloud 媒体资源，自动写入元数据与封面，并支持网易云歌单导入与 NCM 转换相关能力。
    </td>
    <td valign="top">
      <h4>🧩 插件与主题系统</h4>
      提供插件清单、主进程入口、渲染进程入口与样式扩展，支持扩展音乐源、歌词源、UI 面板与侧边栏，并配有主题变量体系和主题审计脚本。
    </td>
  </tr>
</table>

### 🪄 特性速览

| 模块 | 能力 |
| --- | --- |
| **音乐库** | 本地音乐库、歌单、播放队列、收藏管理 |
| **播放链路** | WASAPI / ASIO、均衡器、Preamp、交叉淡入淡出、变速播放 |
| **歌词系统** | 逐行 / 逐字高亮、翻译、罗马音、桌面歌词 |
| **媒体能力** | MV 联动、封面与元数据写入、媒体下载、歌单导入 |
| **扩展机制** | 插件系统、主题系统、示例插件 |
| **桌面集成** | Listen Together、DLNA、桌面化工作流 |

---

## 🧭 项目定位

- 面向本地音乐收藏用户，而不只是在线播放场景
- 强调 Windows 下的高质量音频输出与设备切换能力
- 提供歌词、MV、下载、歌单导入、DLNA、同步播放等完整桌面体验
- 内置插件系统与主题能力，适合作为可继续演化的播放器项目基础

---

## 🛠 技术栈

- Electron 31
- React 18
- Vite / electron-vite
- electron-builder
- i18next
- lucide-react
- kuromoji / kuroshiro
- music-metadata
- ffmpeg / youtube-dl-exec
- naudiodon

---

## 🗂 项目结构

```text
src/
  main/                 Electron 主进程
    audio/              音频引擎、原生桥接、VST / ASIO 相关
    cast/               DLNA / 投流能力
    plugins/            插件管理与沙箱
    utils/              主进程工具模块
  preload/              contextBridge IPC 暴露层
  renderer/src/         React 渲染层
    components/         UI 组件与功能抽屉
    config/             默认配置
    locales/            国际化资源
    plugins/            渲染层插件接入
    utils/              前端工具函数
  shared/               主进程 / 渲染层共享逻辑

server/
  listen-together/      联机听歌服务端

examples/               示例插件
docs/                   开发与发布文档
scripts/                构建、审计、发布辅助脚本
website/                官网静态资源
```

---

## 🚀 快速开始

| 依赖 | 建议版本 |
| --- | --- |
| Node.js | `>= 18`，推荐 `20 LTS` |
| npm | `>= 9` |
| 操作系统 | 开发建议 Windows，构建脚本兼容 macOS / Linux |

提示：

- 仓库根目录包含 `.npmrc`，更适合中国大陆网络环境
- 安装依赖时会在 `postinstall` 阶段自动处理原生模块依赖
- 如果修改了音频宿主相关内容，建议额外执行一次 `npm run build:audio-host`

```bash
git clone https://github.com/Moekotori/ECHO.git
cd ECHO
npm install
npm run dev
```

开发模式启动后会运行 Electron + Vite 热更新环境。

---

## 📦 常用命令

```bash
npm run dev                # 本地开发
npm run build              # 构建前端与 Electron 产物
npm run build:win          # Windows 构建
npm run build:win:release  # Windows 发布包
npm run build:mac          # macOS 构建
npm run build:linux        # Linux 构建
npm run test:unit          # 单元测试
npm run verify:release     # 发布前校验
npm run theme:audit        # 主题变量审计
npm run build:audio-host   # 重建原生音频宿主
```

正式发布前，建议完整走一遍 [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md)。

---

## 🏗 构建与发布

项目使用 `electron-builder` 进行桌面应用打包。

- 应用名：`ECHO`
- 默认输出目录：`dist/`
- Windows 安装包命名格式：`ECHO-Setup-${version}.exe`
- Release 构建会额外产出自动更新所需的元数据文件

与发布相关的关键配置位于 [package.json](./package.json) 的 `build` 字段中。

---

## 🎧 Listen Together 服务端

仓库内提供了轻量的 WebSocket 服务端实现，适合本地测试或自托管部署：

```bash
cd server/listen-together
npm install
npm start
```

如果需要生产部署，可参考：

- [server/listen-together/DEPLOY_FROM_ZERO_ZH.md](./server/listen-together/DEPLOY_FROM_ZERO_ZH.md)

---

## 🧩 插件开发

ECHO 的插件目录通常至少包含一个 `plugin.json` 清单文件，可按需增加主进程入口、渲染层入口与样式文件。

```text
my-plugin/
  plugin.json
  main.js
  renderer.js
  styles.css
```

插件可扩展的方向包括：

- 音乐源 / 歌词源接入
- 主进程能力扩展
- 渲染层功能面板与侧边栏
- 插件私有存储

文档与示例：

- [docs/plugin-development.md](./docs/plugin-development.md)
- [examples/](./examples/)
- [plugin development/](./plugin%20development/)

---

## ✅ 测试与质量保障

当前仓库已经包含一部分 Node 原生测试：

```bash
npm run test:unit
```

另外还提供：

- `npm run verify:release` 用于发布前检查关键资源与构建输出
- `npm run theme:audit` 用于审查主题变量与样式一致性

如果你提交了播放器链路、歌词解析、主题系统或发布流程相关修改，建议至少补一轮本地验证。

---

## 🤝 参与贡献

欢迎继续完善以下方向：

- 音频链路稳定性与设备兼容性
- 歌词质量与多语言体验
- 媒体下载与元数据写入
- 插件生态与示例插件
- UI 细节、可访问性与性能优化
- macOS / Linux 平台适配

提交前建议：

1. 基于最新 `main` 创建分支。
2. 运行 `npm run test:unit`。
3. 如涉及样式或主题，运行 `npm run theme:audit`。
4. 在 PR 中说明变更内容、动机和验证方式。

---

## ❓ 常见问题

### 为什么强调 WASAPI 独占 / ASIO？

因为 ECHO 的目标之一是尽量减少系统混音链路对输出的影响，为本地高质量播放场景提供更直接的设备控制能力。最终效果仍会受到硬件、驱动与系统配置影响。

### 项目更偏向在线流媒体还是本地音乐库？

更偏本地音乐库与桌面播放场景，但也提供歌词抓取、MV 联动、媒体下载等增强能力。

### 插件系统适合做什么？

适合扩展音乐源、歌词源、侧边面板、工具能力，或者把一些偏实验性的功能放到插件层进行迭代。

### 可以直接用于生产发布吗？

项目已经具备完整的桌面应用结构与发布脚本，但如果你要长期维护公开发行版本，仍建议补充更系统的测试、CI 和发布审查流程。

---

## 💛 Special Thanks

ECHO 建立在这些优秀项目之上：

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [electron-vite](https://electron-vite.org/)
- [naudiodon](https://github.com/Streampunk/naudiodon)
- [Kuroshiro](https://kuroshiro.org/)
- [music-metadata](https://github.com/borewit/music-metadata)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://ffmpeg.org/)
- [lucide-react](https://lucide.dev/)

---

<div align="center">
  <sub>Made with ♪ by <a href="https://github.com/Moekotori">Moekotori</a></sub>
</div>
