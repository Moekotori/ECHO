<p align="center">
  <img src="./build-resources/icons/logo.png" alt="ECHO NEXT" width="520" />
</p>

<h1 align="center">ECHO Developers</h1>

<p align="center">
  <strong>ECHO NEXT 开发者文档入口：本地开发、音频链路、构建打包、验证策略与贡献边界</strong>
</p>

<p align="center">
  <a href="./README_EN.md">English README</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#当前开发重点">当前开发重点</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#快速开始">快速开始</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#构建依赖">构建依赖</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#常用命令">常用命令</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#架构边界">架构边界</a>
  <span>&nbsp;|&nbsp;</span>
  <a href="#相关文档">相关文档</a>
</p>

---

## 项目说明

ECHO NEXT 是 ECHO 系列的下一代桌面音乐播放器工程。这个仓库面向开发、调试、打包和贡献协作，不是产品营销页，也不是用户手册入口。用户安装、功能说明和排障请看 [ECHO NEXT 官方文档](https://echonext.moe/zh/docs/) 或 [docs/USER_GUIDE.md](./docs/USER_GUIDE.md)。

README 只保留开发者做事需要的内容：如何启动、改哪里、怎么构建、怎样验证、哪些边界不能碰。开发目标优先级是本地播放稳定、曲库可靠、音频链路清晰、用户数据安全、功能边界可维护。跨模块改动、大型 PR、数据库迁移、播放链路、原生宿主、打包发布、授权 / 完整性 / Pro 权益相关改动，请先告知维护者再开始大规模实现。

## 当前开发重点

| 方向 | 当前重点 |
| --- | --- |
| 播放稳定性 | Audio Core 是播放事实来源；状态、进度、输出设备、fallback 和错误原因都必须可解释。音频架构重构进行中：host-centered facade 迁移，详见 [skill](./.skill/echo-audio-architecture-refactor/SKILL.md)。 |
| 音频 / DSP | ECHO SRC、EQ、ReplayGain、PCM dither、声道处理和安全限制都要诚实标记 bit-perfect 影响。 |
| 可恶但重要的 SDM | 我们正在做 PCM -> SDM / DSD64-DSD512、DSD passthrough、DoP / ASIO Native DSD、CPU / CUDA 计算与 fallback 解释。它是高风险实验链路：设备或输出模式不满足条件时必须明确回落 PCM，不允许 UI 或状态假装 SDM 已生效。 |
| 曲库与数据 | 扫描、元数据、封面、播放列表、远程来源和导入流程要保护用户数据；迁移必须有兼容和回滚思路。 |
| 构建发布 | dev/base 包允许安全增量复用；release 包必须保持完整性签名、授权检查和 Pro / 付费能力 fail-closed。 |

## 技术栈

| 方向 | 当前选择 |
| --- | --- |
| 桌面内核 | Electron 42.x |
| 构建框架 | electron-vite 5.x、Vite 7.x |
| 界面 | React 18.2、TypeScript 5.x |
| 打包 | electron-builder 26.x、NSIS、portable、AppImage、deb |
| 曲库 | SQLite、better-sqlite3、native scanner、metadata worker |
| 音频 | HTML Audio fallback、Native Audio Host、WASAPI Shared / Exclusive、ASIO、DSD / DoP |
| DSP / HiFi | ECHO SRC、PCM dither、ECHO SDM / DSD、CPU / CUDA 实验计算 |
| 扩展 | 插件 SDK、远程来源、网络元数据、下载器、局域网播放能力 |

版本号以 [package.json](./package.json) 和 [package-lock.json](./package-lock.json) 为准；如果文档与锁文件冲突，请优先相信锁文件并提交文档修正。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `src/renderer` | React 页面、组件、状态和界面交互 |
| `src/preload` | 渲染层可访问的类型化桥接 API |
| `src/main` | Electron 主进程、IPC、服务层、曲库、播放、设置和系统集成 |
| `src/shared` | 主进程、预加载和渲染层共用的类型、常量和纯工具 |
| `electron-app` | 原生宿主、构建产物、FFmpeg 工具链和打包资源 |
| `native` | 原生模块与宿主相关源码 |
| `scripts` | 构建、校验、修复、打包、烟测和维护脚本 |
| `docs` | 架构、曲库、音频、插件、Linux 构建和 UI 文档 |
| `build-resources` | 图标、安装包资源和构建资源 |

## 架构边界

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
        |     AudioSession, decoder pipeline, output bridge, DSD / SDM / SRC state
        |
        +-- Native Hosts
        |     echo-audio-host, echo-src-cuda-worker, WASAPI, ASIO, EQ, SMTC helper
        |
        +-- Experience Services
              lyrics, MV, streaming, downloads, plugins, remote sources
```

Renderer 只负责交互和展示，不直接扫描目录、不生成封面、不解析音频文件、不计算权威播放进度。主进程通过类型化 IPC 暴露受控能力，重任务进入 Library Core、Audio Core、原生宿主或独立服务。

完整架构说明见 [docs/ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md)。

## 构建依赖

通用依赖：

| 依赖 | 推荐版本 / 要求 |
| --- | --- |
| Node.js | 22.23.1 LTS（`.nvmrc`、`.node-version` 和 Volta 已固定；最低 22.23） |
| npm | 10.8.2（由 `package.json#packageManager` 固定） |
| Git | 2.x |
| Python | 3.x，供部分 native 依赖构建链使用 |
| C++ 编译链 | 支持 C++17 |
| CMake | 3.24 或更高更稳妥 |
| Electron | 使用 `package-lock.json` 固定版本，不要手动升级 |

平台依赖：

| 平台 | 需要准备 |
| --- | --- |
| Windows 构建工具 | Visual Studio 2022 Desktop development with C++ |
| Windows 打包工具 | NSIS 由 electron-builder 流程处理；FFmpeg 和 yt-dlp 由 Windows 构建脚本按 manifest 自动准备 |
| Linux 构建工具 | CMake、g++、pkg-config、fakeroot、dpkg、rpm、binutils |
| Linux 音频 / 桌面依赖 | ALSA、JACK、X11、fontconfig、freetype、GTK / NSS / XSS / XTest / DRM / GBM 等运行库 |
| Linux FFmpeg | x64 可执行文件，至少包含 `aresample`；完整说明见 [Linux 构建指南](./docs/ECHO_NEXT_LINUX_BUILD.md) |

Ubuntu / Debian 常用依赖：

```bash
sudo apt update
sudo apt install cmake g++ pkg-config fakeroot dpkg rpm binutils
sudo apt install libasound2-dev libjack-jackd2-dev libfreetype-dev libfontconfig1-dev
sudo apt install libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev
sudo apt install libgtk-3-0 libnss3 libxss1 libxtst6 libdrm2 libgbm1
```

## 中国大陆镜像源

中国大陆开发者建议先使用项目内置的一键配置，减少 `npm ci`、Electron 和 electron-builder 下载失败：

```powershell
npm run setup -- --mirror
```

该命令会检查工具链，配置 npmmirror 的 npm、Electron 和 electron-builder 源，并在当前终端立即完成依赖安装；持久环境变量会供之后打开的 PowerShell 使用。

也可以手动配置当前终端：

```powershell
npm config set registry https://registry.npmmirror.com
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm ci
```

如果需要长期生效，可以把上述环境变量配置到本机用户环境变量里。请使用个人或系统级配置，不要把 `.npmrc`、代理地址、账号令牌或私有镜像凭据提交到仓库。

## 快速开始

Windows 开发者第一次构建建议按以下顺序执行：

```powershell
git clone https://github.com/Moekotori/ECHODev.git
cd ECHODev
npm run setup -- --mirror  # 中国大陆网络；其他地区使用 npm run setup
npm run dev
```

`npm run setup` 会先检查 Node.js、npm、Python、CMake、Visual Studio C++ 工具链和 Windows SDK，再严格按照 `package-lock.json` 安装依赖。缺少系统工具时会停止并给出安装命令；安装后重新打开终端，再运行一次即可。`--mirror` 会同时配置并立即使用中国大陆下载镜像。

非 Windows 或已准备好依赖的开发者可以直接执行：

```bash
npm run setup
npm run dev
```

如果 Electron runtime 下载不完整，`npm run dev` 可能报 `Error: Electron uninstall`。先修复 Electron，再重新启动：

```bash
npm run repair:electron
npx electron --version
npm run dev
```

如果需要同时构建音频宿主和 Windows SMTC 宿主：

```bash
npm run dev:full
```

`npm run dev` 默认会做安全的增量前置检查：better-sqlite3 ABI、AirPlay RAOP native backend 和 audio host 都会在已验证且文件未变化时快速跳过。

## 多设备协同开发

- 每台电脑都使用仓库声明的 Node/npm 版本。nvm、fnm、asdf 可读取 `.nvmrc` 或 `.node-version`；Volta 会直接读取 `package.json`。
- 新电脑或 `package-lock.json`、工具链版本变化后运行 `npm run setup`。普通源码同步后直接运行 `npm run dev`，增量检查会复用本机仍然有效的原生产物。
- 只通过 Git 同步源码、配置和 `package-lock.json`。不要在电脑之间复制 `node_modules`、`out`、`dist`、`build`、`.echo-local`、私钥或 `.env`；原生模块必须在各设备本地按对应 ABI 构建。
- 日常依赖安装使用 `npm ci`，不要随手使用 `npm install` 改写 lockfile。确实升级依赖时，将 `package.json` 与 `package-lock.json` 放在同一个提交中。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run setup` | 检查工具链并按 lockfile 初始化当前电脑；中国大陆可追加 `-- --mirror` |
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run dev:full` | 构建音频宿主和 SMTC 宿主后启动开发环境 |
| `npm run repair:electron` | 重新安装 / 修复 Electron runtime |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行 Vitest 测试 |
| `npm run build` | 类型检查并构建主进程、预加载和渲染进程 |
| `npm run prepare:win-ffmpeg` | 按 manifest 下载并校验 Windows 打包所需的 FFmpeg |
| `npm run prepare:win-ytdlp` | 按 manifest 下载并校验 Windows 流媒体播放所需的 yt-dlp |
| `npm run verify:ffmpeg` | 检查 FFmpeg 工具链 |
| `npm run build:audio-host` | 构建音频宿主 |
| `npm run build:src-cuda-worker` | 构建 ECHO SRC CUDA worker |
| `npm run build:smtc-host` | 构建 Windows SMTC 宿主 |
| `npm run build:native-scanner` | 构建 native scanner |
| `npm run ensure:src-cuda-worker` | CUDA worker 增量检查，产物未过期则跳过 |
| `npm run ensure:smtc-host` | Windows SMTC 宿主增量检查，产物未过期则跳过 |
| `npm run ensure:native-scanner` | native scanner 增量检查，产物未过期则跳过 |
| `npm run smoke:audio-host` | 音频宿主烟测 |
| `npm run smoke:dsd-direct` | DSD / DoP / Native DSD 直出链路烟测 |
| `npm run smoke:smtc-host` | Windows SMTC 宿主烟测 |
| `npm run build:win` | 构建 Windows base/dev 安装包和便携版 |
| `npm run build:win:dir` | 快速构建 Windows unpacked 目录包，跳过 NSIS / portable 压缩 |
| `npm run build:win:dir:quick` | 更快的本地 unpacked 目录包，跳过 TypeScript 全量检查 |
| `npm run build:win:release` | 构建带 Windows Authenticode 签名的发布包 |
| `npm run build:linux` | 在 Linux x64 环境构建 Linux 包 |

## 构建流程

开发启动：

```bash
npm ci
npm run dev
```

普通编译验证：

```bash
npm run typecheck
npm run build
```

Windows base/dev 打包：

```bash
npm run build:win
```

`npm run build:win` 使用安全增量检查复用未过期的 audio host、SMTC host、native scanner 和 CUDA worker 产物。项目不再使用额外的 package integrity 私钥，换机后无需迁移或重新生成 ECHO 打包密钥。

如果只需要本机验证打包后的 resources / asar / 主程序结构，优先用更快的目录包：

```bash
npm run build:win:dir
```

`build:win:dir` 会生成 `dist/win-unpacked`，跳过 NSIS 安装包和 portable 压缩，适合本地反复验证。

如果你刚跑过 `npm run typecheck`，或者只是验证打包资源变化，可以用：

```bash
npm run build:win:dir:quick
```

这个命令跳过 TypeScript 全量检查，只适合本地快速迭代；提交前或发布前仍应跑 `npm run typecheck`、`npm run build:win` 或对应的 release 构建。

发布 Windows 包时使用 `npm run build:win:release`。正式发布仍必须配置 Windows 代码签名证书，并将证书发布者名称写入 `ECHO_WINDOWS_PUBLISHER_NAME`。release 构建会把该名称固定到 `app-update.yml`，随后验证安装包、便携版和解包主程序的 Authenticode 状态；任一产物未签名、签名无效或发布者不匹配都会直接失败。`build:win` / `build:win:unsigned` 仍保留用于本地开发验证。

Linux 打包：

```bash
npm ci
npm run verify:ffmpeg
npm run build:linux
```

Linux x64 打包细节见 [docs/ECHO_NEXT_LINUX_BUILD.md](./docs/ECHO_NEXT_LINUX_BUILD.md)。

## Nix / Flake

项目提供 Nix flake，用于 Linux 上的开发 shell、构建 derivation 和 nixpkgs overlay：

| 命令 | 用途 |
| --- | --- |
| `nix develop` | 进入开发 shell（Node 22、CMake、ALSA、GTK3、Electron 等） |
| `nix build` | 使用 nixpkgs Electron 构建 ECHO NEXT，产物在 `result/` |
| `nix run` | 直接运行构建产物 |
| `nix flake check` | 验证 flake outputs |

`LICENSE` 是 source-available 非 OSS 许可，Nix 构建需要显式允许 unfree：

```bash
NIXPKGS_ALLOW_UNFREE=1 nix build --impure .#echo-next
```

## 验证策略

不要为了小改动低效率跑全量测试。按改动范围选择最小有效验证：

| 改动范围 | 推荐验证 |
| --- | --- |
| README / docs | 检查内容和 diff |
| TypeScript / IPC 类型 | `npm run typecheck` |
| Renderer 逻辑 | 相关 Vitest 或 focused manual check |
| 主进程服务 | `npm run typecheck` 加对应服务的 focused check |
| 曲库 / SQLite | 相关 library 测试或最小复现脚本 |
| 音频宿主 | `npm run build:audio-host`、`npm run smoke:audio-host` |
| ECHO SRC / CUDA worker | `npm run build:src-cuda-worker` 加 Audio Core focused 测试 |
| SDM / DSD / ASIO Native | Audio Core focused 测试、`npm run smoke:dsd-direct`，必要时加真实 DAC / ASIO 设备烟测 |
| SMTC 宿主 | `npm run build:smtc-host`、`npm run smoke:smtc-host` |
| FFmpeg / yt-dlp / 打包资源 | `npm run prepare:win-ffmpeg`、`npm run prepare:win-ytdlp`、`npm run verify:ffmpeg` |
| Windows 打包 | `npm run build:win` |
| Linux 打包 | `npm run build:linux` |

## 安全边界

不要移除、绕过、mock、短路或削弱认证、授权、许可证校验、权益检查、订阅检查、下载鉴权或反滥用逻辑。音频组件仍会按清单校验文件大小和 SHA-256，防止损坏文件被安装。

涉及 SDM、DSD、ASIO Native、CUDA worker 或音频热路径的改动也按高风险处理：默认关闭、失败可见、fallback 可解释，不要为了“看起来生效”牺牲播放稳定性或设备安全。

不要提交私钥、令牌、账号密码、真实用户数据、本机绝对路径或私有部署信息。

## 贡献规则

| 类型 | 规则 |
| --- | --- |
| 小修复 | 可以直接提 PR，说明改动范围和验证结果 |
| 大型 PR | 先通过 issue、讨论区或维护者联系方式说明目标、范围和风险 |
| 跨模块重构 | 先沟通边界，不要一次性混入无关格式化或清理 |
| UI 大改 | 说明影响页面、交互变化和回归验证 |
| 数据库迁移 | 说明兼容策略、备份 / 回滚风险和测试方式 |
| 播放链路 / 原生宿主 | 说明设备、格式、输出模式和烟测结果 |
| SDM / DSD / CUDA 音频链路 | 说明设备能力、输出模式、目标 DSD 档位、fallback 行为和 focused 验证 |
| 授权 / 完整性 / Pro 权益 | 先读 maintainer notes，保持 fail-closed |

## 相关文档

| 文档 | 内容 |
| --- | --- |
| [docs/ECHO_NEXT_ARCHITECTURE.md](./docs/ECHO_NEXT_ARCHITECTURE.md) | 总体架构 |
| [docs/ECHO_NEXT_LIBRARY_CORE.md](./docs/ECHO_NEXT_LIBRARY_CORE.md) | 曲库核心 |
| [docs/ECHO_NEXT_AUDIO_CORE.md](./docs/ECHO_NEXT_AUDIO_CORE.md) | 音频核心 |
| [docs/ECHO_NEXT_NATIVE_AUDIO_PIPELINE.md](./docs/ECHO_NEXT_NATIVE_AUDIO_PIPELINE.md) | Native 音频数据面迁移、DSP 所有权与多人协作边界 |
| [docs/ECHO_NEXT_EQ.md](./docs/ECHO_NEXT_EQ.md) | EQ 与 DSP 边界 |
| [docs/ECHO_NEXT_PLUGINS.md](./docs/ECHO_NEXT_PLUGINS.md) | 插件制作指南 |
| [docs/plugin-sdk/ForAIReadme.md](./docs/plugin-sdk/ForAIReadme.md) | 给 AI 读取的插件编写规则和检查清单 |
| [docs/ECHO_NEXT_NETWORK_METADATA.md](./docs/ECHO_NEXT_NETWORK_METADATA.md) | 网络元数据补全 |
| [docs/ECHO_NEXT_LINUX_BUILD.md](./docs/ECHO_NEXT_LINUX_BUILD.md) | Linux 构建 |
| [docs/ECHO_NEXT_UI_GUIDE.md](./docs/ECHO_NEXT_UI_GUIDE.md) | UI 指南 |
| [flake.nix](./flake.nix) | Nix flake：开发 shell、构建和 overlay |
| [docs/security/entitlement-maintainer-notes.md](./docs/security/entitlement-maintainer-notes.md) | 权益、完整性和付费能力维护说明 |

## License

ECHO NEXT is source-available under the [ECHO NEXT Source-Available License](./LICENSE). The license permits personal review, learning, and local builds, but prohibits cracks, bypassing entitlement or integrity checks, and unauthorized redistribution of modified builds.
