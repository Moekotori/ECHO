<div align="center">
  <img src="website/echo-logo.png" width="680" alt="ECHO">
</div>

# ECHO

ECHO 是一款以桌面 HiFi 播放体验为核心的跨平台音乐播放器，使用 Electron + React 构建，并围绕本地音乐库、原生音频输出、沉浸式歌词、MV 联动、插件扩展和同步播放做了较深的桌面能力整合。

项目目标不是做一个“能播歌”的通用播放器，而是做一个更偏发烧友与桌面重度用户场景的音乐工作台：更好的本地库体验、更直接的音频链路控制、更完整的歌词与媒体信息展示，以及更强的可扩展性。

## 项目定位

- 面向本地音乐收藏用户，而不只是在线播放场景
- 强调 Windows 下的高质量音频输出与设备切换能力
- 提供桌面歌词、MV、下载、歌单导入、DLNA、Listen Together 等完整桌面功能
- 内置插件系统与主题能力，便于二次开发和个性化扩展

## 核心能力

### 1. 音频与播放链路

- 原生音频宿主 `echo-audio-host` 独立运行，减少 Electron 主进程直接承担底层音频细节
- 支持 Windows WASAPI 独占模式与 ASIO 设备接入
- 提供 16 段参数均衡器与 Preamp
- 支持变速播放、交叉淡入淡出、睡眠定时器等播放控制
- 支持 FLAC、DSD、MP3、AAC 等常见音频格式

### 2. 歌词与沉浸式桌面体验

- 支持逐行歌词与逐字高亮效果
- 自动从 NetEase / LRCLIB 获取歌词
- 支持歌词翻译、日语罗马音转换
- 提供可悬浮的桌面歌词窗口

### 3. MV 与媒体联动

- 可在播放时匹配 YouTube / Bilibili MV
- 支持全屏背景展示、画质切换、偏移校准
- 在失败时自动回退，保证主播放流程稳定

### 4. 媒体下载与导入

- 支持下载 YouTube、Bilibili、SoundCloud 媒体资源
- 自动写入元数据与封面
- 支持网易云歌单导入
- 内置 NCM 转换相关能力

### 5. 联机与投放

- 内置 Listen Together WebSocket 服务端示例
- 支持房间同步播放与鉴权接入
- 支持 DLNA 投流到局域网设备

### 6. 扩展能力

- 提供插件清单、主进程入口、渲染进程入口与样式扩展
- 支持扩展音乐源、歌词源、UI 面板与侧边栏
- 提供主题变量体系与主题审计脚本

## 截图预览

<div align="center">
  <img src="./website/1.png" width="800" alt="ECHO 主界面">
  <br><br>
  <img src="./website/2.png" width="800" alt="ECHO 歌词界面">
  <br><br>
  <img src="./website/3.png" width="800" alt="ECHO MV 模式">
</div>

## 技术栈

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

## 目录结构

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

## 环境要求

| 依赖 | 版本建议 |
| --- | --- |
| Node.js | >= 18，推荐 20 LTS |
| npm | >= 9 |
| 操作系统 | 开发建议 Windows，构建脚本兼容 macOS / Linux |

说明：

- 仓库根目录包含 `.npmrc`，适合中国大陆网络环境
- 安装依赖时会在 `postinstall` 阶段自动处理原生模块依赖
- 若修改了原生音频相关部分，建议额外执行一次 `npm run build:audio-host`

## 快速开始

```bash
git clone https://github.com/Moekotori/ECHO.git
cd ECHO
npm install
npm run dev
```

开发模式启动后会运行 Electron + Vite 热更新环境。

## 常用命令

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

## 构建与发布

项目使用 `electron-builder` 进行桌面应用打包。

- 应用名：`ECHO`
- 默认输出目录：`dist/`
- Windows 安装包命名格式：`ECHO-Setup-${version}.exe`
- Release 构建会额外产出自动更新所需的元数据文件

与发布相关的关键配置位于 [package.json](./package.json) 的 `build` 字段中。

## Listen Together 服务端

仓库内提供了轻量的 WebSocket 服务端实现，适合本地测试或自托管部署：

```bash
cd server/listen-together
npm install
npm start
```

如果需要生产部署，可参考：

- [server/listen-together/DEPLOY_FROM_ZERO_ZH.md](./server/listen-together/DEPLOY_FROM_ZERO_ZH.md)

## 插件开发

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

## 测试与质量保障

当前仓库已经包含一部分 Node 原生测试，命令如下：

```bash
npm run test:unit
```

另外还提供：

- `npm run verify:release` 用于发布前检查关键资源与构建输出
- `npm run theme:audit` 用于审查主题变量与样式一致性

如果你提交了播放器链路、歌词解析、主题系统或发布流程相关修改，建议至少补一轮本地验证。

## 适合贡献的方向

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

## 常见问题

### 为什么强调 WASAPI 独占 / ASIO？

因为 ECHO 的目标之一是尽量减少系统混音链路对输出的影响，为本地高质量播放场景提供更直接的设备控制能力。最终效果仍会受到硬件、驱动与系统配置影响。

### 项目更偏向在线流媒体还是本地音乐库？

更偏本地音乐库与桌面播放场景，但也提供歌词抓取、MV 联动、媒体下载等增强能力。

### 插件系统适合做什么？

适合扩展音乐源、歌词源、侧边面板、工具能力，或者把一些偏实验性的功能放到插件层进行迭代。

### 可以直接用于生产发布吗？

项目已经具备完整的桌面应用结构与发布脚本，但如果你要长期维护公开发行版本，仍建议补充更系统的测试、CI 和发布审查流程。

## 致谢

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

由 [Moekotori](https://github.com/Moekotori) 持续构建与打磨。
