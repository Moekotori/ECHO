<div align="center">

<h1>ECHO</h1>

<p>基于 Electron 与 React 构建的现代化、功能丰富的桌面音乐播放器。</p>

<p>
  <a href="https://github.com/Moekotori/Echoes/releases/latest">
    <img src="https://img.shields.io/github/v/release/Moekotori/Echoes?label=release&color=blue" alt="Latest Release">
  </a>
  <a href="https://github.com/Moekotori/Echoes/releases">
    <img src="https://img.shields.io/github/downloads/Moekotori/Echoes/total?color=brightgreen" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/electron-31.x-47848f" alt="Electron">
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React">
</p>

<p>
  <a href="https://github.com/Moekotori/Echoes/releases/latest">
    <strong>下载最新版本</strong>
  </a>
  &nbsp;&middot;&nbsp;
  <a href="docs/plugin-development.md">插件开发</a>
  &nbsp;&middot;&nbsp;
  <a href="#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B">快速开始</a>
</p>

<pre>
╭────────────────────────────────────────────────────────╮
│  ECHO / 回声播放器                                      │
│  「把本地音乐，调成你喜欢的样子。」                      │
│                                                        │
│  HiFi · 歌词同步 · MV · 一起听 · 插件 · 主题             │
╰────────────────────────────────────────────────────────╯
</pre>

</div>

---

## 目录

- [概览](#%E6%A6%82%E8%A7%88)
- [核心亮点](#%E6%A0%B8%E5%BF%83%E4%BA%AE%E7%82%B9)
- [更多功能](#%E6%9B%B4%E5%A4%9A%E5%8A%9F%E8%83%BD)
- [环境要求](#%E7%8E%AF%E5%A2%83%E8%A6%81%E6%B1%82)
- [快速开始](#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B)
- [构建打包](#%E6%9E%84%E5%BB%BA%E6%89%93%E5%8C%85)
- [一起听（Listen Together）服务器](#%E4%B8%80%E8%B5%B7%E5%90%AClisten-together%E6%9C%8D%E5%8A%A1%E5%99%A8)
- [插件开发](#%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91)
- [项目结构](#%E9%A1%B9%E7%9B%AE%E7%BB%93%E6%9E%84)
- [常见问题](#%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98)
- [路线图](#%E8%B7%AF%E7%BA%BF%E5%9B%BE)
- [参与贡献](#%E5%8F%82%E4%B8%8E%E8%B4%A1%E7%8C%AE)
- [致谢](#%E8%87%B4%E8%B0%A2)

---

## 概览

ECHO 是一款跨平台桌面音乐播放器，强调音质、可扩展性与干净的聆听体验。它提供原生音频管线以实现高保真本地播放，内置歌词系统，支持通过 YouTube 与 Bilibili 播放 MV，并提供插件架构用于扩展核心能力。

---

## 核心亮点

<details>
  <summary><b>能力面板（点我展开）</b></summary>
  <br>
  <table>
    <tr>
      <td><b>类型</b></td>
      <td>桌面音乐播放器（Electron）</td>
    </tr>
    <tr>
      <td><b>主属性</b></td>
      <td>音质 / 可扩展 / 沉浸式歌词</td>
    </tr>
    <tr>
      <td><b>特性</b></td>
      <td>HiFi 引擎、MV、一起听、插件、主题、自动更新</td>
    </tr>
  </table>
</details>

<br>

<table>
  <tr>
    <td valign="top" width="50%">
      <b>HiFi 音频引擎</b><br>
      通过独立进程的原生音频宿主（<code>echo-audio-host</code>）实现低延迟、高保真播放。Windows 支持 WASAPI 独占模式以获得比特完美输出。带前级（Pre-amp）的参数均衡器实时生效。
    </td>
    <td valign="top" width="50%">
      <b>同步歌词</b><br>
      支持 LRC 逐行与逐词（卡拉 OK）高亮。支持网易云歌词自动获取与手动候选搜索。通过 Kuroshiro 进行日语罗马音转换。提供桌面悬浮歌词窗口。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>MV 播放</b><br>
      播放音乐时可自动匹配并播放 YouTube 或 Bilibili MV。支持清晰度选择、直链播放与全屏“MV 作为背景”模式。
    </td>
    <td valign="top">
      <b>一起听</b><br>
      基于自托管 WebSocket 服务器的房间同步听歌。可选 Token 鉴权。支持 DLNA 投放到局域网渲染设备。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>媒体下载</b><br>
      支持从 YouTube、Bilibili、SoundCloud 下载音频。支持导入网易云歌单。自动写入元数据与封面。
    </td>
    <td valign="top">
      <b>插件系统</b><br>
      通过沙箱化插件 API 提供一等扩展能力。插件可提供音乐源、歌词提供方、UI 面板等扩展。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>主题</b><br>
      基于 CSS 变量的完整主题引擎，内置主题编辑器。支持主题导入/导出/审计等工具链。
    </td>
    <td valign="top">
      <b>自动更新</b><br>
      基于 GitHub Releases，使用 <code>electron-updater</code> 实现 OTA 更新。后台下载并提示重启；也可在设置中手动检查更新。
    </td>
  </tr>
</table>

---

## 更多功能

把它当作你的「日常听歌装备栏」也没问题：

- **曲库 / 播放**：本地曲库管理（拖拽扫描文件夹）、专辑视图（按封面聚合）、用户歌单、喜欢、播放队列
- **音频 / 输出**：变速播放并保持音高、不中断切换音频输出设备
- **格式 / 元数据**：内置转换器支持 NCM 格式转换
- **社交 / 分享**：Discord Rich Presence 集成、分享卡片图片导出
- **稳定性 / 可观测**：崩溃上报与应用内日志查看器
- **语言**：英文 / 简体中文 / 日文 UI（i18n）

---

## 环境要求

| Dependency | Version                           |
| ---------- | --------------------------------- |
| Node.js    | >= 18                             |
| npm        | >= 9                              |
| Electron   | 31.x (managed by devDependencies) |

> Windows 是主要的开发与测试平台。macOS 与 Linux 也支持构建，但不会持续进行回归验证。

---

## 快速开始

> 咒语很短，跑起来很快。(*`・ω・)ﾉ

### 1. 克隆仓库

```bash
git clone https://github.com/Moekotori/Echoes.git
cd Echoes
```

### 2. 安装依赖

```bash
npm install
```

原生模块（`naudiodon`）会在 `postinstall` 钩子中通过 `electron-builder install-app-deps` 自动编译。

### 3. 启动开发环境

```bash
npm run dev
```

该命令会通过 `electron-vite` 启动 Electron 应用并启用热重载。

---

## 构建打包

> 需要发行包时，再念下面这些。

### Windows

```bash
npm run build:win
```

将在 `dist/` 下生成可分发的 NSIS 安装包。

### Windows（包含自动更新产物的 Release）

```bash
npm run build:win:release
```

输出到 `release/`，包含 `electron-updater` 所需的 `.blockmap` 与 `latest.yml`。

### macOS

```bash
npm run build:mac
```

### Linux

```bash
npm run build:linux
```

---

## 一起听（Listen Together）服务器

可选服务器用于提供同步听歌房间能力。

```bash
cd server/listen-together
npm install
PORT=8787 npm start
```

生产环境（Nginx 反代 + PM2）部署请参考 [`server/listen-together/DEPLOY_FROM_ZERO_ZH.md`](server/listen-together/DEPLOY_FROM_ZERO_ZH.md)。

---

## 插件开发

插件放置于用户的插件目录，并在启动时加载。每个插件是一个文件夹，包含 `plugin.json` 清单文件，以及可选的 `main.js`（Node.js 沙箱）、`renderer.js`、`styles.css` 等文件。

完整 API 参考与清单规范请见 [`docs/plugin-development.md`](docs/plugin-development.md)。

示例插件位于 [`examples/`](examples/)。

---

## 项目结构

```
src/
  main/           # Electron main process (IPC, audio engine, plugins, cast)
    audio/        # Native audio bridge and AudioEngine wrapper
    cast/         # DLNA renderer
    plugins/      # Plugin manager, sandbox, storage
  preload/        # Context bridge exposing APIs to renderer
  renderer/
    src/
      components/ # Reusable UI components
      locales/    # i18n translation files (en, zh, ja)
      styles/     # Global styles and theme variables
      App.jsx     # Root application component
server/
  listen-together/  # WebSocket-based co-listening server
scripts/            # Build and maintenance scripts
docs/               # Developer documentation
examples/           # Example plugins
```

---

## 参与贡献

欢迎把你觉得“应该更好用”的部分写进来：

1. Fork 本仓库并创建功能分支（feature branch）。
2. 保持风格一致（`npm run lint` 与 `npm run format`）。
3. 提交 Pull Request：说明你改了什么、为什么改、怎么验证。

---

## 常见问题

**Q: 为什么强调 “HiFi / WASAPI 独占”？**

A: 目标是尽可能绕开系统混音带来的重采样与音量干预，在 Windows 上以更“干净”的链路输出（能否比特完美也取决于设备与系统设置）。

**Q: 歌词从哪里来？支持卡拉 OK 逐词吗？**

A: 支持 LRC 逐行与逐词（卡拉 OK）高亮；支持网易云歌词自动获取与候选搜索；也支持本地 LRC。

**Q: “一起听”需要什么？**

A: 需要你自建 WebSocket 服务器（见下方“一起听服务器”），然后在客户端里加入房间即可同步。

**Q: 插件能做什么？**

A: 可以扩展音乐源、歌词提供方、UI 面板等（见「插件开发」文档）。

---

## 路线图

> 这是一个用于 README 展示的基础模板：你可以把“计划/进行中/已完成”改成符合项目节奏的内容。

- [ ] 补充用户向文档：常用设置、音频输出建议、歌词匹配技巧
- [ ] 扩充插件示例与开发指引（更完整的模板/脚手架）

---

## 致谢

ECHO 使用了以下开源项目：

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [electron-vite](https://electron-vite.org/)
- [naudiodon](https://github.com/Streampunk/naudiodon)
- [Kuroshiro](https://kuroshiro.org/)
- [music-metadata](https://github.com/borewit/music-metadata)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://ffmpeg.org/)
- [lucide-react](https://lucide.dev/)
