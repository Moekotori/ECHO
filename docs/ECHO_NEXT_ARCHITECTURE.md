# ECHO NEXT 架构指南

ECHO NEXT 不是旧 ECHO 上继续堆功能的补丁层，而是一套重新拆边界的桌面音乐播放器架构。它的目标很明确：本地曲库可靠、播放链路稳定、HiFi 输出状态可信、Renderer 保持轻量、后台任务不压播放。

这份文档负责说明“系统怎么分层、每层该管什么、不该管什么”。更细的曲库、音频、EQ 和 UI 规则分别看：

- [ECHO_NEXT_LIBRARY_CORE.md](./ECHO_NEXT_LIBRARY_CORE.md)
- [ECHO_NEXT_AUDIO_CORE.md](./ECHO_NEXT_AUDIO_CORE.md)
- [ECHO_NEXT_EQ.md](./ECHO_NEXT_EQ.md)
- [ECHO_NEXT_UI_GUIDE.md](./ECHO_NEXT_UI_GUIDE.md)

## 核心原则

1. 本地播放优先。网络、下载、插件、远程源都不能让本地播放变得不稳定。
2. 主进程管能力，Renderer 管展示，不把重活塞进 UI。
3. 所有跨层调用都走类型化 IPC / preload API，不暴露 Electron 原始能力。
4. 数据库是曲库事实来源，Renderer 不重建全量曲库模型。
5. 音频状态以 Audio Core 为准，Renderer 不猜权威播放位置。
6. 高风险能力必须有边界、诊断和回退路径。
7. 文档、代码和 UI 文案都要诚实，不伪装 bit-perfect、不夸大网络匹配。

## 总体分层

```text
Renderer UI
  pages, components, routes, stores, visual state
        |
Typed Preload Bridge
  window.echo.* typed APIs
        |
Electron Main Process
  IPC, app lifecycle, windows, service composition
        |
        +-- Library Core
        |     SQLite, scans, metadata, covers, search, playlists
        |
        +-- Audio Core
        |     playback session, decoder, output bridge, devices, clock
        |
        +-- Native Hosts
        |     WASAPI, ASIO, EQ, SMTC, native DSP / output helpers
        |
        +-- Experience Services
              lyrics, MV, streaming, downloads, plugins, remote sources
```

每层只做自己的事。跨层拿不到的数据，不应该靠绕过边界解决；应该补一个明确、可测试的 API。

## Layer 1: Electron Shell

Electron Shell 负责桌面应用外壳：

- app 生命周期。
- 主窗口、辅助窗口、桌面歌词窗口、迷你播放器窗口。
- 窗口状态、退出清理、崩溃报告。
- 托盘、全局快捷键、系统媒体控制、自动更新等系统集成。
- IPC 注册和服务组合。
- 打包资源路径和 native host 查找。

它不应该包含：

- 曲库扫描。
- metadata 解析。
- 封面提取。
- 音频解码。
- 播放队列算法。
- 歌词 / MV 匹配算法。
- 下载器内部流程。
- 数据库重查询和大对象处理。

`src/main/index.ts` 应保持薄：初始化 app、注册 IPC、启动服务、处理退出。只要这个文件开始出现大量业务 if/else，就是架构走偏的信号。

## Layer 2: Typed Preload Bridge

Preload 是唯一允许 Renderer 调用主进程能力的桥：

- 暴露 `window.echo.library`、`window.echo.playback`、`window.echo.audio`、`window.echo.eq` 等分组 API。
- 每个方法背后是明确的 IPC channel。
- 输入输出用共享类型定义。
- Renderer 只拿到批准过的能力。

允许：

- `ipcRenderer.invoke` 的类型化包装。
- 只读状态查询。
- 用户动作命令。
- 事件订阅和取消订阅。

禁止：

- 暴露 raw `ipcRenderer`。
- 暴露 Node.js fs/path/process。
- 在 preload 做业务逻辑。
- 在 preload 解析音频、扫描文件、处理封面。
- 把任意 IPC channel 透传给 Renderer。

Preload 的稳定性很重要，因为它是安全边界。新增 API 时要同时考虑旧 Renderer、测试、类型、错误返回和权限范围。

## Layer 3: Renderer UI

Renderer 负责展示和交互：

- 页面路由。
- 列表、表格、封面墙、设置面板。
- 播放栏和用户操作。
- 轻量状态管理。
- 空状态、加载状态、错误状态。
- i18n 文案。

Renderer 不负责：

- 扫描目录。
- 解析标签。
- 生成封面缓存。
- 维护全量 album grouping。
- 解码音频。
- 计算权威播放时钟。
- 直接写 SQLite。
- 调用 Electron / Node 原始 API。

Renderer 的性能边界：

- 大曲库必须分页或虚拟化。
- 播放进度不能推动全 App 重渲染。
- 列表只拿缩略图 URL，不拿大封面或 base64。
- 搜索输入要 debounce。
- 页面切换不能阻塞音频链路。

## Layer 4: Library Core

Library Core 是本地曲库事实来源，位于 `src/main/library`。

它负责：

- 文件夹导入和扫描。
- metadata 读取。
- 封面提取和缓存。
- SQLite 读写。
- 专辑、艺术家、搜索索引、收件箱、收藏、历史、歌单。
- 曲库健康、诊断、move candidate、受控 repair。
- 大曲库分页查询。

它不负责：

- 音频播放。
- 解码和输出设备控制。
- Renderer 布局。
- 下载器策略。
- 插件 UI。
- 直接删除用户真实音频文件。

架构要求：

- SQLite 是事实来源。
- 扫描任务后台运行、可取消、有进度。
- unchanged 文件按 `path + size_bytes + mtime_ms` 跳过。
- 写入走事务。
- 查询走分页。
- 网络补全是弱来源，不覆盖高可信本地/手动字段。

## Layer 5: Audio Core

Audio Core 是播放事实来源，位于 `src/main/audio`。

它负责：

- 当前播放会话。
- load / play / pause / seek / stop / next / previous。
- 解码管线。
- native output bridge。
- 输出设备列表和模式。
- 输出侧时钟。
- 播放错误、恢复和诊断。
- EQ、ReplayGain、DSP 状态对 bit-perfect 的影响。

它不负责：

- 曲库扫描。
- 专辑聚合。
- UI 状态合并。
- 网络歌词 / MV。
- 下载任务。

音频链路的核心要求：

- Renderer 不猜进度。
- 输出侧状态要可解释。
- 系统输出、WASAPI Shared、WASAPI Exclusive、ASIO 的含义不能混淆。
- DSP 开启时必须明确不是 bit-perfect。
- 背景任务不能压播放。

## Layer 6: Native Hosts

Native hosts 承担 Electron/Node 不适合直接做的事情：

- WASAPI / ASIO 输出。
- 低延迟 PCM 写入。
- EQ / DSP 实时处理。
- SMTC 等系统媒体集成辅助能力。

要求：

- native host 的路径查找和打包必须可诊断。
- 开发 fallback 不能变成生产依赖。
- stdout/stderr 协议要稳定。
- 音频回调里不能做文件 IO、JSON 解析、锁等待、Electron IPC。
- native 崩溃不能直接拖垮整个应用，主进程要能记录并给出可理解错误。

## Layer 7: Experience Services

体验服务包括歌词、MV、流媒体、下载、远程源、插件、网络元数据等。

它们的共同边界：

- 服务本地播放体验，而不是取代本地曲库。
- 默认不要在播放期间抢 CPU、磁盘、网络。
- 网络失败不能影响本地播放。
- 自动匹配结果要可解释、可手动修正。
- 高权限能力必须显式授权。

典型例子：

- 歌词匹配可以提供候选，但不能伪装成绝对正确。
- MV 播放失败要区分匹配、编码、平台、外部播放器 fallback。
- 下载器要说明阶段：解析、下载、提取、导入。
- 插件要隔离权限、日志和错误。

## 数据流

### 曲库数据

```text
Folder / File
  -> LibraryScanner
  -> MetadataService / CoverService
  -> LibraryStore(SQLite)
  -> typed IPC
  -> Renderer paged view
```

Renderer 拿到的是展示所需数据，不拿扫描细节、不拿全量库、不拿原始封面。

### 播放数据

```text
User action
  -> Renderer command
  -> preload playback API
  -> AudioSession
  -> DecoderPipeline
  -> NativeOutputBridge / system output
  -> playback/audio status
  -> Renderer playback UI
```

播放栏渲染状态来自 Audio Core 返回的状态。进度、采样率、输出设备、DSP、错误都要可追溯。

### 设置数据

```text
Renderer settings UI
  -> typed settings IPC
  -> AppSettings / service-specific store
  -> merge defaults / migrate
  -> service applies change
```

旧配置缺字段不能导致白屏。新增设置时必须设计默认值和兼容路径。

## IPC 规则

新增 IPC 前先问：

1. 这个能力属于哪个域。
2. 输入能否被严格校验。
3. 返回值是否会变得过大。
4. 是否会暴露路径、token、内部错误等敏感信息。
5. 是否会让 Renderer 绕过服务边界。
6. 是否需要事件订阅而不是轮询。
7. 是否会在播放期间触发重任务。

规则：

- channel 名按域分组。
- handler 不做大段业务，转给 service。
- 错误返回要稳定，不泄漏不必要内部细节。
- 高频状态需要节流或局部订阅。
- 事件要能取消订阅。

## 数据库和持久化

SQLite 存：

- folders。
- tracks。
- albums / album_tracks。
- artists。
- covers。
- scan_jobs。
- playlists。
- playback history。
- settings / feature state。
- network metadata candidates / decisions。

数据库规则：

- migration 可重复。
- 老表补列用显式 `PRAGMA table_info` + guarded `ALTER TABLE`。
- 不靠 `CREATE TABLE IF NOT EXISTS` 解决旧 schema 缺字段。
- 查询要分页。
- 大写入要事务。
- UI 列表 API 不返回大 blob。
- 诊断 API 不触发扫描。

## 后台任务

后台任务包括扫描、封面生成、网络补全、下载、远程索引、重建专辑聚合、分析任务等。

统一要求：

- 可取消。
- 可观察。
- 有并发限制。
- 播放期间能降载或延后。
- 失败不应拖垮主流程。
- 进度要分阶段，而不是只有百分比。
- 任务结果写库时要小心事务和旧状态。

不要在用户播放时顺手跑全量远程索引、全量封面重建、全量 album regroup，除非用户明确触发并且 UI 已说明影响。

## 错误和诊断

错误要分层记录：

- Renderer console / runtime error。
- IPC handler error。
- Library scan job warnings/errors。
- AudioSession / DecoderPipeline / NativeOutputBridge errors。
- native host stderr/stdout protocol errors。
- database migration / query errors。
- network provider errors。

用户可见错误要讲下一步。开发诊断要保留证据。

错误不要混淆：

- 文件不存在。
- 格式不支持。
- FFmpeg 缺失。
- native host 缺失。
- 设备打不开。
- 网络超时。
- 数据库迁移失败。
- 插件权限不足。

## 安全边界

ECHO NEXT 处理本地文件、网络、插件和系统音频设备，默认要保守。

要求：

- Renderer 不拿 raw fs。
- 插件权限最小化。
- 下载和网络源不绕过平台、版权、DRM 限制。
- 删除真实文件必须明确确认。
- 清空索引和删除文件要区分。
- token、密码、cookie 不进入普通日志。
- 诊断导出要避免带出敏感路径以外的凭据。

## 性能边界

架构层面的红线：

- 启动不扫描全库。
- Renderer 不持有全量曲库。
- 播放 tick 不驱动全局渲染。
- 列表不返回大封面。
- scan / download / network job 有并发限制。
- 播放期间重任务延后或降载。
- native ABI / host 缺失要快速失败并给出诊断，不要卡住启动。

## 开发检查清单

新增功能前：

1. 它属于哪个域：library、audio、renderer、plugin、network 还是 settings。
2. 是否需要新 IPC，还是复用已有 service API。
3. 是否会影响播放期间 CPU、磁盘、网络。
4. 是否需要数据库 migration。
5. 是否兼容旧设置和旧库。
6. 是否要写诊断。
7. 是否有高风险操作确认。
8. 是否需要 i18n。

提交前：

1. 改动是否只在应有层内。
2. 是否让 Renderer 拿到了不该拿的数据。
3. 是否引入了全量查询或全量渲染。
4. 是否改变音频链路默认行为。
5. 是否能解释失败状态。
6. 是否给了最小必要测试。

## 一句话标准

好的 ECHO NEXT 架构改动应该让边界更清楚、播放更稳、诊断更容易、Renderer 更轻。任何把重任务塞回 UI、把网络能力压过本地播放、或把音频状态变得不可解释的改动，都应该停下来重新拆。
