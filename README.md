<div align="center">

<img src="2.png" alt="ECHO Banner" width="100%" />

<br />

# 🎵 ECHO

### *The Bit-Perfect Bridge to Your Sonic Multiverse*

**一款现代化、功能丰富的高保真桌面音乐播放器**
*A modern, feature-rich HiFi desktop music player built with Electron & React*

<br />

[![Release](https://img.shields.io/github/v/release/Moekotori/ECHO?style=for-the-badge&color=8B5CF6&logo=github&logoColor=white)](https://github.com/Moekotori/ECHO/releases)
[![Stars](https://img.shields.io/github/stars/Moekotori/ECHO?style=for-the-badge&color=FFD700&logo=apachespark&logoColor=white)](https://github.com/Moekotori/ECHO/stargazers)
[![Downloads](https://img.shields.io/github/downloads/Moekotori/ECHO/total?style=for-the-badge&color=00D9FF&logo=icloud&logoColor=white)](https://github.com/Moekotori/ECHO/releases)
[![Issues](https://img.shields.io/github/issues/Moekotori/ECHO?style=for-the-badge&color=FF6B6B&logo=target&logoColor=white)](https://github.com/Moekotori/ECHO/issues)
[![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

<br />

![Electron](https://img.shields.io/badge/Electron-31.x-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/electron--vite-9333EA?style=flat-square&logo=vite&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![C](https://img.shields.io/badge/C-Audio_Engine-A8B9CC?style=flat-square&logo=c&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-WASAPI-0078D4?style=flat-square&logo=windows&logoColor=white)

<br />

[**📥 Download**](https://github.com/Moekotori/ECHO/releases) ·
[**📖 Docs**](./docs) ·
[**🔌 Plugins**](./plugin%20development) ·
[**🐛 Report Bug**](https://github.com/Moekotori/ECHO/issues) ·
[**✨ Request Feature**](https://github.com/Moekotori/ECHO/issues)

</div>

---

## ✨ 项目简介 · Overview

> **ECHO** 不只是一个播放器,它是一座连接你与音乐宇宙的「位完美」之桥。
> 从硬件级的 WASAPI 独占输出,到逐字卡拉 OK 歌词;从一键匹配 MV 到与好友实时共听 —— ECHO 让每一段声波都纯净如初,每一次聆听都不再孤单。

ECHO is a cross-platform desktop music player engineered for audiophiles and music lovers alike. With a native C-based audio host running out-of-process, bit-perfect Windows output via WASAPI Exclusive Mode, synchronized karaoke lyrics, automatic MV matching, room-based co-listening, and a sandboxed plugin system — ECHO turns your desktop into a true sonic multiverse.

---

## 🚀 核心特性 · Features

<table>
<tr>
<td width="50%" valign="top">

### 🎧 HiFi 音频引擎
- 🔊 **WASAPI 独占模式** — Windows 位完美输出
- ⚙️ **out-of-process 原生音频宿主** — C 语言编写,稳定零卡顿
- 🎚️ **参数化均衡器** — 多段 EQ 实时调音
- 🌊 高采样率 / 高位深无损支持

### 🎤 同步歌词系统
- 📝 **LRC 标准歌词** + 逐字卡拉 OK 模式
- 🎵 **网易云音乐歌词自动抓取**
- 🇯🇵 **日文罗马音转换** (Kuroshiro 驱动)
- 🌐 多语言界面:English / 简体中文 / 日本語

### 📺 音乐视频 (MV)
- 🎬 自动匹配 **YouTube / Bilibili** MV
- 📊 多清晰度选择
- 🔁 音画同步播放

</td>
<td width="50%" valign="top">

### 👥 共听房间 · Listen Together
- 🌐 基于 **WebSocket** 的房间式共听
- 📡 **DLNA 投屏**到家中智能设备
- 👫 与朋友隔空同步每一拍

### ⬇️ 媒体下载
- 🎯 支持 YouTube / Bilibili / SoundCloud
- 🏷️ 自动写入元数据与封面
- 🔄 NCM 格式无损转换

### 🔌 插件系统
- 🧩 **沙箱化插件**:音乐源 / 歌词源 / UI 面板
- 📦 详尽插件开发文档
- 🛡️ 权限隔离,安全可控

### 🎨 主题 & 体验
- 🖌️ **CSS 变量主题编辑器**(可导入导出)
- 🎮 Discord Rich Presence
- 🚀 **electron-updater** OTA 自动更新

</td>
</tr>
</table>

---

## 🛠️ 技术栈 · Tech Stack

<div align="center">

| 模块 | 技术 |
|:---:|:---:|
| 🖥️ **桌面框架** | ![Electron](https://img.shields.io/badge/Electron-31.x-47848F?logo=electron&logoColor=white) |
| ⚛️ **前端 UI** | ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black) ![lucide](https://img.shields.io/badge/lucide--react-F56565?logo=lucide&logoColor=white) |
| ⚡ **构建工具** | ![Vite](https://img.shields.io/badge/electron--vite-9333EA?logo=vite&logoColor=white) |
| 🔊 **原生音频** | ![C](https://img.shields.io/badge/C-61.6%25-A8B9CC?logo=c&logoColor=white) ![naudiodon](https://img.shields.io/badge/naudiodon-native-orange) |
| 🎞️ **媒体处理** | ![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white) ![yt-dlp](https://img.shields.io/badge/yt--dlp-red) |
| 📊 **元数据** | ![music-metadata](https://img.shields.io/badge/music--metadata-blue) |
| 🇯🇵 **日文转换** | ![Kuroshiro](https://img.shields.io/badge/Kuroshiro-pink) |

</div>

---

## 📦 安装 · Installation

### 🎁 直接下载 (推荐)

前往 [**Releases 页面**](https://github.com/Moekotori/ECHO/releases) 下载最新版本的安装包。

```bash
# 当前最新版本
v1.3.4
```

### 🔧 从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/Moekotori/ECHO.git
cd ECHO

# 2. 安装依赖
npm install

# 3. 开发模式运行
npm run dev

# 4. 打包构建
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
```

> 💡 **Tip**: 首次启动会自动下载 FFmpeg / yt-dlp 等依赖,请保持网络畅通。

---

## 📂 项目结构 · Structure

```
ECHO/
├── 📁 src/                    # React 前端源码
├── 📁 electron-app/           # Electron 主进程
├── 📁 server/listen-together/ # 共听 WebSocket 服务
├── 📁 plugin development/     # 插件开发文档与示例
├── 📁 examples/               # 示例插件
├── 📁 scripts/                # 构建与工具脚本
├── 📁 docs/                   # 项目文档
├── 📁 website/                # 官方站点
├── 📁 artifacts/              # 构建产物
├── 📁 test/unit/              # 单元测试
├── ⚙️  electron.vite.config.mjs
└── 📦 package.json
```

---

## 🔌 插件开发 · Plugin Development

ECHO 提供了完整的沙箱化插件 API,支持扩展:

- 🎵 **音乐源 (Music Source)** — 接入第三方曲库
- 📝 **歌词源 (Lyrics Provider)** — 自定义歌词来源
- 🖼️ **UI 面板 (UI Panel)** — 注入自定义界面

详细文档请见 [`plugin development/`](./plugin%20development) 目录,示例插件位于 [`examples/`](./examples)。

---

## 🤝 贡献 · Contributing

欢迎所有形式的贡献!无论是 Bug 反馈、功能建议、文档改进还是代码 PR。

```bash
# Fork → Branch → Commit → Push → PR
git checkout -b feature/AmazingFeature
git commit -m '✨ Add some AmazingFeature'
git push origin feature/AmazingFeature
```

提交 Issue 之前,请先搜索是否已有相同问题。

---

## 📜 开源协议 · License

本项目基于 **MIT License** 开源协议发布。详见 [LICENSE](LICENSE) 文件。

---

## 💖 致谢 · Acknowledgements

感谢以下开源项目让 ECHO 成为可能:

[Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [electron-vite](https://electron-vite.org/) · [naudiodon](https://github.com/streamich/naudiodon) · [Kuroshiro](https://github.com/hexenq/kuroshiro) · [music-metadata](https://github.com/Borewit/music-metadata) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [FFmpeg](https://ffmpeg.org/) · [lucide-react](https://lucide.dev/)

以及网易云音乐歌词 API、Bilibili 与 YouTube 的开放生态。

---

<div align="center">

### ⭐ 如果你喜欢 ECHO,请给我们一个 Star!

[![Star History Chart](https://api.star-history.com/svg?repos=Moekotori/ECHO&type=Date)](https://star-history.com/#Moekotori/ECHO&Date)

<br />

**Made with 🎵 and ❤️ by [@Moekotori](https://github.com/Moekotori)**

*Listen Bit-Perfect. Listen Together. Listen as ECHO.*

</div>
