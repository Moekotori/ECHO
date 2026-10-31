# ECHO NEXT Library Core 指南

Library Core 是 ECHO NEXT 的本地曲库核心。它负责把磁盘上的音乐文件变成稳定、可分页、可搜索、可恢复的曲库数据，并保证扫描、封面、网络补全、实时更新等能力不会压垮播放。

这份文档不是用户教程，而是给开发和维护用的工程边界说明。用户侧教程看 [USER_GUIDE.md](./USER_GUIDE.md)。

## 目标

Library Core 要解决旧 ECHO 曲库常见痛点：

1. 启动后不重新解析全库。
2. 大曲库列表和专辑墙不把 Renderer 卡死。
3. 扫描、封面、metadata、网络补全都有缓存和进度。
4. SQLite 是事实来源，而不是 Renderer 内存临时模型。
5. 本地 metadata 优先，网络结果只做弱补全。
6. 删除、移动、重扫、修复都保守，不误删用户文件。
7. 后台任务可取消、可诊断、播放期间可降载。

一句话：Library Core 应该让曲库“可相信、可恢复、可扩展”，而不是让 UI 每次都重新猜一遍。

## 核心边界

Library Core 负责：

- 导入本地文件夹。
- 扫描音频文件。
- 读取 metadata。
- 提取和缓存封面。
- 写入 SQLite。
- 查询歌曲、专辑、艺术家、文件夹、收件箱、收藏、历史、歌单。
- 曲库健康检查。
- watcher 诊断、局部 rescan、move candidate、显式 move repair。
- 网络 metadata / cover 候选和决策。

Library Core 不负责：

- 播放音频。
- 解码 PCM。
- 控制输出设备。
- 计算权威播放位置。
- 渲染列表和封面墙。
- 下载器策略。
- 插件权限模型。
- 自动删除、移动或重命名用户真实音频文件。

Renderer 只能通过 typed preload API 读取分页数据和发起明确操作。SQL、扫描、封面、metadata、album grouping 都留在主进程 Library Core。

## 模块总览

| 模块 | 责任 |
| --- | --- |
| `LibraryService` | IPC facade，组合 store、scan queue、watcher、diagnostics |
| `LibraryStore` | SQLite 读写、migration、事务、分页查询 |
| `ScanJobQueue` | 后台扫描任务、阶段进度、取消、worker 并发 |
| `LibraryScanner` | 文件枚举和音频扩展过滤 |
| `MetadataService` | metadata 读取和字段来源管理 |
| `CoverService` / `CoverCacheManager` | 封面提取、缩略图生成、缓存版本 |
| `AlbumService` | `album_key`、专辑聚合、曲目顺序 |
| `SearchIndexTokens` | 搜索 tokens、中文/日文/罗马音等扩展 |
| `LibraryWatcherService` | 文件变化观察、稳定性判断、诊断、可选自动 rescan |
| `FileIdentityService` | 文件 identity / quick hash 观察 |
| `LibraryMoveCandidateService` | 移动候选诊断 |
| `LibraryMoveRepairService` | 显式 move repair lab |
| `LibraryHealthReport` | 曲库健康和可维护性诊断 |
| `TagWriter` | 受控标签写入 |

worker 边界：

- `MetadataReader`：tag parsing。
- `CoverExtractor`：封面提取和尺寸生成。
- `FileScanner`：目录枚举和 stat。

当前 TypeScript + sharp 实现可以继续用。不要因为边界存在就急着换 Rust / C++，除非 benchmark 或 smoke 证明瓶颈真实存在。

## SQLite 是事实来源

核心表包括：

| 表 | 用途 |
| --- | --- |
| `folders` | 导入根目录、启用状态、扫描时间 |
| `tracks` | 曲目路径、fingerprint、metadata、来源、封面、missing 状态 |
| `albums` | 持久化专辑墙记录 |
| `album_tracks` | 专辑内曲目顺序 |
| `artists` | 艺术家聚合计数 |
| `covers` | 封面缓存路径、hash、版本、来源 |
| `scan_jobs` | 扫描任务状态、阶段、计数、错误 |
| `network_metadata_candidates` | 网络 metadata 候选 |
| `network_metadata_decisions` | 用户/自动决策 |
| `network_cover_candidates` | 网络封面候选 |
| playlists / history / liked | 用户长期行为数据 |

重要索引：

- `folders(path)`
- `tracks(path)`
- `tracks(folder_id)`
- `tracks(title)`
- `tracks(artist)`
- `tracks(album)`
- `albums(album_key)`
- `album_tracks(album_id)`
- `album_tracks(track_id)`
- `covers(id)`

migration 规则：

- 可重复执行。
- 新表用 `CREATE TABLE IF NOT EXISTS`。
- 新索引用 `CREATE INDEX IF NOT EXISTS`。
- 旧表补列必须用 `PRAGMA table_info(...)` 检查后 guarded `ALTER TABLE ... ADD COLUMN ...`。
- 不要以为 `CREATE TABLE IF NOT EXISTS` 会修好旧表缺列。

## 扫描流程

标准 full scan：

1. `library.scanFolder(folderId)` 创建 `scan_jobs` row 并立即返回。
2. `ScanJobQueue` 在后台执行。
3. `discovering`：枚举音频文件，记录 path、size、mtime。
4. `checking_cache`：用 `path + size_bytes + mtime_ms` 对比 SQLite。
5. unchanged 文件跳过 metadata 和 cover worker。
6. `reading_metadata`：新/变更文件读取 embedded metadata。
7. `extracting_covers`：新/变更文件提取封面并生成缓存尺寸。
8. `writing_database`：事务写入 tracks、covers、scan 状态。
9. `grouping_albums`：刷新 albums、album_tracks、artists。
10. scan job 进入 `finished`、`failed` 或 `cancelled`。

单文件 worker warning / error 写入 `scan_jobs.errors_json`，不默认导致整轮扫描失败。

删除策略：

- full scan 发现文件消失时，标记 `missing = 1`。
- 列表 API 默认过滤 missing track。
- 历史、歌单等长期记录尽量保留引用。
- Library Core 永远不直接删除用户真实音频文件。

## 增量缓存

增量 key：

```text
path
size_bytes
mtime_ms
```

三者相同就信任 SQLite 中已有 metadata 和 cover links。

这解决两个问题：

- 启动不需要重扫全库。
- 重扫时 unchanged 文件接近 100% skip。

注意：

- 这个 key 是路径中心模型，不是文件 identity 模型。
- 移动文件会表现为旧 path missing + 新 path added。
- move repair 是后续显式流程，不是扫描时偷偷修。

## Metadata 优先级

字段来源优先级：

1. manual
2. embedded
3. sidecar/info
4. folder inference
5. network completion
6. filename fallback

网络补全是弱来源：

- 只补缺失或低可信字段。
- 不覆盖 manual。
- 不覆盖 embedded。
- 不覆盖 sidecar。
- 不覆盖 folder_structure。
- 先写候选和决策，不直接把网络当事实。

`field_sources_json` 应记录 title、artist、album、albumArtist、trackNo、discNo、year、genre、duration、codec、sampleRate、bitDepth、bitrate 等字段来源。

filename fallback 只填最后还没有可信来源的字段。有效 embedded title / artist / album 不能被文件名猜测覆盖。

## Cover 优先级

封面来源优先级：

1. manual cover
2. embedded cover
3. 同文件夹 `cover` / `folder` / `front` 图片
4. network cover
5. generated default cover

网络封面只在本地封面是 default，且 embedded cover 状态为 missing 或 error 时考虑。

封面缓存尺寸：

| 字段 | 用途 |
| --- | --- |
| `thumb_path` | 约 96x96，列表行 |
| `album_path` | 约 320x320，专辑墙 |
| `large_path` | 最大约 768x768，详情/Now Playing |
| `original_ref` | 原始来源引用，按需访问 |

Renderer 列表和专辑墙只拿 `coverThumb` protocol URL。不要返回 `largePath`、`originalRef`、base64 或完整二进制。

图片加载规则：

- 列表用 `loading="lazy"`。
- 图片用 `decoding="async"`。
- 滚动时不请求 large / original。
- Renderer 不生成封面衍生图。

## Album Grouping

`album_key` 基于归一化后的：

- `albumArtist || artist`
- `album`
- `year`

规则：

- 同 album + 同 albumArtist 合并。
- 同 album + 不同 albumArtist 不合并。
- 缺失 albumArtist 时用 folder path 做弱分隔。
- 空/unknown album 不合并成一个巨大的 Unknown Album。
- albums 和 album_tracks 持久化，不在 Renderer 内存临时重组。

专辑聚合可能很重，所以要注意：

- 普通列表查询不能顺手全量 regroup。
- tag edit、watcher rescan、move repair 等写 track 后可通过 grouping refresh queue 合并。
- 播放期间应延迟和合并昂贵 regroup。

## 搜索和排序

搜索应服务真实曲库使用：

- title、artist、album。
- 中文变体。
- 日文罗马音 / kana 辅助 tokens。
- 文件名 fallback。
- genre、year 等可扩展字段。

原则：

- 搜索 tokens 写入或缓存，不在 render 时临时全库计算。
- 搜索输入 debounce。
- 查询分页。
- 排序字段白名单。
- 不把网络候选未确认内容当成本地事实优先展示。

## API 和 UI 数据流

Preload 暴露 typed API，例如：

- `library.addFolder(path)`
- `library.getFolders()`
- `library.removeFolder(folderId)`
- `library.scanFolder(folderId)`
- `library.getScanStatus(jobId)`
- `library.cancelScan(jobId)`
- `library.getTracks({ page, pageSize, search, sort })`
- `library.getAlbums({ page, pageSize, search, sort })`
- `library.getAlbumTracks(albumId, { page, pageSize })`
- `library.getSummary()`
- `library.getDiagnostics()`

UI 规则：

- `SongsPage` 读取分页 tracks，建议 `pageSize = 100`。
- `AlbumsPage` 读取分页 albums，建议 `pageSize = 60`。
- 专辑墙先读第一页，滚动接近底部再追加。
- 不要循环请求所有页。
- 不要把全曲库放进 Renderer state。
- `TrackRow` 保持 memoized。
- 播放状态只更新当前必要行，不让 position tick 重渲染整页。

导入流程：

- `library.chooseFolder()` 由 main 打开系统目录选择。
- `Folders` 是常规文件夹管理页面。
- `Import Folder` 是聚焦导入页面，可复用 `LibraryFoldersPanel`。
- 重复导入同一路径应幂等，变成 rescan。
- scan 完成后发 `library:changed`，让 Songs / Albums 通过已有 reload path 刷新。

Library Core 不是文件管理器，不复制、不移动、不重命名、不删除真实音频文件。

## Watcher Phase 0: 观察层

`LibraryWatcherService` 初始是低风险观察层：

- 默认不启动。
- 只在显式 feature flag 或调用方开启时 start。
- 观察已导入本地文件夹。
- 过滤可扫描音频扩展。
- 忽略临时文件、隐藏文件、封面图片、数据库 sidecar。
- 对事件做 debounce 和 coalesce。
- 最多保留约 100 条近期内存诊断事件。

Phase 0 不做：

- 不调用 scan。
- 不写 tracks / albums / history。
- 不标记 missing。
- 不碰 AudioSession / DecoderPipeline / playback IPC。

文件稳定性判断：

- 能 stat 时等待 size / mtime 连续两次稳定。
- 记录 `stableForMs`。
- 不稳定事件只做诊断，不假装可扫描。

## Local Rescan Phase 1 / 1.5

Phase 1 增加安全入口：

- `LibraryService.rescanPaths(folderId, paths, options)`
- `ScanJobQueue.scanPaths(folder, paths, options)`

约束：

- 路径必须在已导入 folder 内。
- 去重。
- batch 上限 1000。
- 忽略 missing file、directory、非音频、隐藏文件、临时文件。
- 复用 full scan 的 cache、metadata、cover、upsert、cancel、concurrency、scan-job 状态。

局部 rescan 不做：

- 不调用 `markTracksMissingFromFolder`。
- delete/unlink 不能立即标记 missing。
- 不识别 rename。
- 不修 move。
- 不更新播放 path。
- 不碰播放历史。
- 不碰 AudioSession / DecoderPipeline / playback IPC。

Phase 1.5 把 stable watcher `add` / `change` 事件接到 `rescanPaths`，但仍然：

- 默认关闭。
- 需要显式开启 live updates 或开发 flag。
- pending paths in-memory。
- debounce。
- 同 path 去重。
- 上限 1000，超限写 diagnostics。
- 如果已有 scan job，延迟合并，不并发乱跑。

`unlink`、delete-like、rename、unknown 事件在 Phase 1.5 仍是 diagnostics-only。

## File Identity Phase 2

Phase 2 给 `tracks` 增加观察字段：

- `file_identity`
- `file_identity_source`
- `quick_hash`
- `quick_hash_version`
- `identity_status`
- `identity_updated_at`
- `identity_error`

这些字段是诊断和未来用途，不改变当前 path-centric 模型。

规则：

- POSIX 可用 `stat.dev + stat.ino`。
- Windows 当前可报告 `unsupported`，不要为此仓促引入高风险 native 依赖。
- `quick_hash` 是 size + bounded head/tail read，不是完整内容 hash。
- identity error 不导致 scan 失败。
- unchanged 文件可低成本 backfill identity。

Phase 2 不做 move repair、不 merge track、不改 path、不删文件、不碰播放链路。

## Move Candidate Phase 3

Phase 3 通过 `library.getMoveCandidates()` 和 diagnostics 暴露候选：

- 比较 missing old rows 和 active new rows。
- 使用 `file_identity` / `quick_hash` / size / duration / metadata。
- 返回 capped list，默认不超过 100。

它只诊断，不自动修：

- 不更新 `tracks.path`。
- 不 merge rows。
- 不 delete rows。
- 不标记 missing。
- 不改 playlist/history/lyrics/cover references。
- 不碰 AudioSession / DecoderPipeline / playback IPC。

置信规则：

- trusted `file_identity` 双方一致才可 high confidence。
- `unsupported` / `error` identity 不能 high confidence。
- `quick_hash` 只是候选信号，不能单独作为强身份。
- 多对一 / 一对多必须标记 ambiguous，不自动提升。

## Move Repair Lab

Move Repair Lab 是开发者显式操作路径：

- 默认隐藏或关闭。
- dry-run 先行。
- apply 默认不可用。
- 必须 dry-run 成功且无 blocker。
- 拒绝 ambiguous 和 low confidence candidate。
- apply 前确认。
- 不删除真实音频文件。
- 不自动运行。

这不是普通用户的自动修复功能。未来若做用户可见修复，也必须保留同样的 dry-run 和确认原则。

## Live Library Updates

`Live Library Updates` 是真实使用路径，但默认关闭。

开启后：

- app startup 启动 watcher。
- 只监听已导入本地文件夹。
- stable add/change 音频事件进入 auto rescan。
- rescan 完成后发 `library:changed`。
- Songs / Albums / Artists / Folders 通过现有 reload path 刷新。

仍然不做：

- 不跑 full-library scan 响应单个 watcher event。
- 不碰 AudioSession。
- 不碰 DecoderPipeline。
- 不碰 playback IPC。
- 不改 playlists / lyrics / playback history。

删除事件单独由 `Live Library Auto Hide Deleted` 控制：

- 默认关闭。
- 只有 live updates 开启时有效。
- 只把同 folder 内精确 path 标记 `missing = 1`。
- 不删磁盘文件。
- 不做 move repair。
- 不 merge track。

## Grouping Refresh Queue

以下操作可能需要刷新 album / artist grouping：

- tag edit。
- watcher add/change rescan。
- delete/missing update。
- move repair lab writes。
- imported single-file writes。
- maintenance cleanup。

要求：

- 合并多次请求。
- 播放 loading/playing 时延迟昂贵 rebuild。
- 记录 diagnostics。
- `library.refreshAlbumGrouping()` 保留显式立即 rebuild 能力。

诊断字段示例：

- `groupingRefreshQueued`
- `lastGroupingRefreshDurationMs`
- `lastGroupingRefreshAt`
- `groupingRefreshDelayedForPlaybackCount`
- `lastGroupingRefreshError`

## Diagnostics

`library.getDiagnostics()` 可以返回：

- counts。
- last scan counters。
- last paged query timings。
- database path / size。
- cover cache path / size。
- cover cache version。
- watcher 状态。
- pending auto-rescan 状态。
- move candidates。
- grouping refresh 状态。

它不能：

- 触发扫描。
- 返回全量 track list。
- 返回 full cover payload。
- 读取大文件。
- 影响播放链路。

Diagnostics 是证据，不是副作用入口。

## Native SQLite / better-sqlite3

Library Core 使用 `better-sqlite3`。它是 native Node/Electron 模块，ABI 必须匹配运行环境。

注意：

- Electron desktop runtime ABI 和系统 `node.exe` ABI 不同。
- ABI 不匹配会导致 `NODE_MODULE_VERSION ...` 错误。
- `npm run dev` 会先 rebuild native。
- Vitest 运行在 Node ABI 下，需要测试前保证 Node ABI。
- 测试后可能需要恢复 Electron ABI。

缓存位置：

```text
node_modules/.echo-native-cache
```

常见判断：

- 文档或纯 UI 改动不需要碰 native ABI。
- 窄测试可用环境变量跳过 native ABI 噪音时，要区分环境问题和真实回归。
- Browser-only Vite preview 没有 Electron main、preload bridge、native SQLite，不能代表曲库功能。

## Benchmark 和性能预算

目标：

- startup 不扫描全库。
- `getTracks` first page 目标低于 200 ms。
- `getAlbums` first page 目标低于 300 ms。
- unchanged scan skip rate 接近 100%。
- cover thumbs 扫描时生成，不在 UI scroll 时生成。
- album wall 从 `albums` 表读取。
- list API 不返回 full cover。
- scan backgrounded and cancellable。
- metadata / cover worker 有并发限制。
- album wall 渲染不能让 CPU 长期高占用。

`npm run benchmark:library` 可生成 fake tracks / albums 验证：

- SQLite insertion。
- album grouping。
- track / album first page。
- album page 10。
- coverThumb payload length。
- forbidden cover payload。
- unchanged scan skip。
- memory。
- database size。

不要用小样本“看起来没卡”证明大曲库没问题。

## UI 验收路径

常见页面责任：

- `SongsPage`：分页歌曲、搜索、播放、右键、当前 track 高亮。
- `AlbumsPage`：分页专辑墙、懒加载、专辑详情。
- `FoldersPage`：导入根目录、扫描、取消、移除。
- `InboxPage`：新导入内容。
- `Settings > Library`：诊断、Live Updates、Library Lab。

手动测试 Live Library / Move Lab：

1. `npm run dev`。
2. 打开 Settings > Library。
3. 启用 Library Watcher。
4. Start Watcher。
5. 启用 Auto Rescan for add/change。
6. 复制一首歌到测试库。
7. Refresh Diagnostics，确认 triggered rescan 增加。
8. 移动一首已扫描歌曲。
9. 跑一次 full scan，让旧 path missing。
10. Refresh Move Candidates。
11. 选择 candidate。
12. Dry Run Selected Move。
13. dry run 通过后 Apply，并确认。
14. 确认库里只剩正确 track row，playlist/history 仍可解析。

这套测试只适合测试库，不要拿真实大库直接做 repair lab。

## 开发检查清单

改 Library Core 前先问：

1. 会不会触发全库扫描或全库查询。
2. 会不会在 Renderer 持有过多数据。
3. 会不会播放期间跑重任务。
4. 会不会覆盖 manual / embedded metadata。
5. 会不会删除或移动真实文件。
6. migration 是否兼容旧库。
7. 诊断是否足够定位失败。
8. 是否需要取消和并发限制。

改完后按范围验证：

| 改动 | 建议验证 |
| --- | --- |
| 纯文档 | diff 检查 |
| SQL/migration | 对应 store / migration 窄测试 |
| scan pipeline | `ScanJobQueue` / `LibraryCore` 测试 |
| metadata / cover | 对应 service 测试 |
| watcher / rescan | watcher / grouping refresh 测试 |
| move candidate / repair | candidate / repair 测试 |
| UI 页面 | 对应 renderer 页测试或手动打开 |
| 大曲库性能 | `benchmark:library` 或目标 smoke |

## 一句话标准

Library Core 的好改动应该让曲库更可信、更快、更容易恢复，同时不打扰播放。任何自动删除、自动合并、全量重算、Renderer 全量持有、播放期间重任务，都要先证明它安全，否则不要做。
