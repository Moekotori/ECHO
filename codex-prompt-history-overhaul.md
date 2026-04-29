# ECHO 播放历史重写 Prompt

## 背景

ECHO 是一个 Electron + React 桌面 HiFi 播放器，主体在单文件 `src/renderer/src/App.jsx`（巨大单文件，注意 PR 体积）。当前的播放历史功能做得很糟糕，需要**整块重写**。

### 现有实现的位置和问题

**入口**：标题栏右上角一个 `<History />` 小图标按钮（`App.jsx` 第 12749 行附近），点击后翻出一个右侧 drawer（`historyMenuOpen` state，第 1762 行）。

**Drawer 渲染**：第 17977 行附近，**复用了 `lyrics-drawer-panel` 这套样式 class**（`className="lyrics-drawer-panel playback-history-drawer-panel"`），歌词和历史在 CSS 上互相耦合，改一个动另一个。

**数据结构**：

- 状态 `playbackHistory`：`useState`，结构 `[{ path, title, artist, album, playedAt }, ...]`，第 1545 行
- 持久化：localStorage key `nc_playback_history`，加上一个 snapshot 系统
- 派生 `playbackHistoryEntries`：第 10145 行 `useMemo`

**核心问题（重写要解决的）**：

1. **入口隐藏**：藏在标题栏小图标，非一级功能。希望放进左侧 nav-rail（`<div className="nav-rail-section">`，第 13082 行附近），和「歌曲 / 专辑 / 艺人 / 文件夹 / 播放队列 / 歌单」并列成一个一级 `listMode`。**参考 `src/renderer/src/components/QueueSidebarView.jsx` 这个组件——它就是一个已经从抽屉迁进 sidebar 的成功案例，新的历史视图请参照同样的架构。**

2. **历史只显示"当前列表里存在的曲目"**：第 10147 行 `pathToTrack = new Map(parsedPlaylist.map(...))`，导致切换列表后整段历史"消失"。空状态文案里 `historyMissingHint` 那句"Saved history exists, but those tracks are no longer available in the current playlist." 就是在掩盖这个 bug。**新实现里历史必须独立于当前播放列表，曲目不在 `playlist` 里也要显示**——按 path 直接读元数据 / 封面缓存（`albumArtistByName`、`coverCacheRef` 之类已经有的），找不到就回退到 history entry 里存的 title/artist/album 字段。

3. **`jumpToPlaybackHistory` 强依赖 `playlistRef.current`**：第 6653 行，`playlistRef.current.findIndex((track) => track.path === candidatePath)`，找不到就 continue 直到 -1，**静默失败**。新实现里点击一条历史记录应该有明确的两种行为：
   - **"播放"**：如果当前 playlist 不含此曲，就把它**插入 Up Next 队列**或者**单独建一个临时播放上下文**直接放，而不是默默跳过
   - **"跳回历史光标"**：保留原 `jumpToPlaybackHistory` 语义，但限定在当前 playlist 命中时才生效，并且 UI 上和"播放"按钮分开

4. **没有时间分组**：所有条目混在一个长列表里，没有 "Today / Yesterday / Last 7 days / Earlier" 分组。`playedAt` 字段已经存了 timestamp，**直接拿来分组就行**。

5. **没有时间戳显示**：现在只显示 "Most recent" 这种顺序标签，没有实际播放时间。**每条要显示相对时间**（"5 分钟前 / 今天 14:30 / 昨天 / Mon 3:14 PM"）。

6. **没有搜索**：历史攒到几百条根本翻不动。**顶部需要一个 search input，按 title/artist/album 模糊匹配**，复用现有列表搜索的样式。

7. **没有播放次数**：`trackStats[path].playCount` 已经存了，但历史视图里没用。**每条历史右侧应显示该曲累计播放次数**（如 ×7），可点击按播放次数排序。

8. **没法删单条**：现在只能"全部清空"。每条 hover 时应该出一个 ✕ 删除按钮，删除单条历史记录但不影响 trackStats。

9. **没有持久化深度的设置**：历史无限增长。`config` 里加一个 `historyMaxEntries`（默认 1000，可选 200/500/1000/5000/Unlimited），写入时尾部裁掉超额的。

10. **重复条目处理**：现在同一首歌反复播会在历史里出现 N 次。需要一个开关：**"Collapse repeated plays"**（默认开），同一首歌连续多次播放只保留最近一次时间戳但记录 `playCount`，关闭则保留全部。

---

## 任务

### 一、把历史从右上角抽屉迁到左侧 sidebar

**精确改动**：

- **新增**：`src/renderer/src/components/HistorySidebarView.jsx`，结构和导出方式**完全对齐 `QueueSidebarView.jsx`**。
- **`App.jsx` 第 13082 行附近 `nav-rail-section`**：在 `listMode === 'queue'` 那个按钮后面加一个 `listMode === 'history'` 的入口：
  ```jsx
  <button
    type="button"
    className={`nav-rail-item ${listMode === 'history' ? 'active' : ''}`}
    onClick={() => handleListMode('history')}
  >
    <History size={16} /> {t('listMode.history', 'History')}
  </button>
  ```
- **`App.jsx` 第 13211 行附近 sidebar 渲染区**：在判断 `listMode === 'queue'` 渲染 `<QueueSidebarView />` 的同位置，加上 `listMode === 'history'` 时渲染 `<HistorySidebarView />`。
- **`App.jsx` 第 13213 行 `browser-topbar-actions`**：把 `listMode === 'history'` 加到「不显示导入/导出工具栏」的判断里（参照 `listMode === 'remoteLibrary' || listMode === 'queue'` 的写法）。
- **删除右上角的 History 按钮**（第 12749 行整段 `<button>`）。
- **删除 `historyMenuOpen` state、`setHistoryMenuOpen`、Escape 键监听 useEffect、整块右侧 drawer JSX（第 17972 行附近 `<>...</>` 整段）**。
- **`handleHistoryMenuBack` / `handleHistoryMenuJump` / `handleHistoryMenuClear` 三个 callback 不要删，重命名成 `handleHistory*` 通用名（去掉 Menu）**，作为 props 传给 `HistorySidebarView`。
- **`playback-history-drawer-*` 这一组 CSS（在 `index.css` 里）整块删除**，新组件用自己独立的 class 命名，**不要再复用 `lyrics-drawer-panel`**。

### 二、重写历史的数据派生

**`App.jsx` 第 10145 行 `playbackHistoryEntries`**——改写：

- 不再依赖 `parsedPlaylist`，改用 `pathToTrackInLibrary = new Map(playlist.map(...))` 但**找不到时不丢弃条目**，只是 `track` 字段为 `undefined`
- 增加分组字段 `bucket: 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier'`（用 `playedAt` 计算）
- 增加 `relativeTime` 字段（"5 min ago" / "Today 14:30" / "Yesterday" / "Mon"）
- 合并 `trackStats[path].playCount`
- 应用 `config.historyCollapseRepeats` 的折叠逻辑

### 三、`HistorySidebarView` 组件功能要求

布局参考 `QueueSidebarView`：

- **顶部 toolbar**：
  - 标题 "Listening history" + 总数
  - 搜索框（debounce 200ms，按 title/artist/album）
  - 排序切换：By time（默认）/ By play count
  - 操作按钮：「Back one step」（原 `goBackInPlaybackHistory`）、「Clear all」（带 confirm）

- **主区域**：分组列表
  - Group header："Today" / "Yesterday" / "This week" / "This month" / "Earlier"
  - 每条 row：
    - 左：封面（24×24，缺失时用首字母占位，参考现有 `AlbumSidebarCard` 的样式）
    - 中：title（粗体）/ artist · album（次要色）
    - 右上：相对时间
    - 右下：×N 播放次数（仅 N>0 时显示）
    - hover 时右侧出现按钮组：[▶ Play] [↶ Jump in playlist]（仅当前 playlist 含此曲时高亮，否则灰显并加 tooltip）[✕ Remove from history]
  - 双击 row = Play
  - 单击 row = 选中（高亮，方便键盘导航）

- **空状态**：
  - 完全没历史："Once you start playing tracks, they'll show up here." + 大图标
  - 搜索无结果："No matches for «XXX»" + clear 按钮

- **键盘**：↑↓ 选中、Enter 播放、Delete 删单条、Cmd/Ctrl+F 聚焦搜索

### 四、新的播放/跳回逻辑

新增两个方法（替代 `jumpToPlaybackHistory` 的隐式行为）：

- **`playFromHistoryEntry(entry)`**：
  - 先尝试 `playlistRef.current.findIndex(t => t.path === entry.path)`
  - 命中 → `setCurrentIndex(idx)` + `setIsPlaying(true)`
  - 未命中 → 调用现有的 "play track outside current playlist" 路径（如果项目里没有，请实现：构造一个临时单曲 context 直接喂给 AudioEngine，或者把这首插到 Up Next 队列首位并跳过去；选择哪种请在实现计划里明确）

- **`jumpToHistoryCursor(historyIndex)`**：保留原 `jumpToPlaybackHistory` 语义，仅供「Jump in playlist」按钮使用，命中失败时给一个 `toast`（项目里有现成 toast 系统就用，没有就先 console.warn）

### 五、配置项

`src/renderer/src/config/defaultConfig.js` 加：

```js
historyMaxEntries: 1000,           // 200 / 500 / 1000 / 5000 / Infinity
historyCollapseRepeats: true,      // 折叠连续重播
historyShowInSidebar: true,        // 兜底开关，万一用户怀念抽屉模式
```

`historyMaxEntries` 在 `setPlaybackHistory` 写入路径上做尾部裁切（找出现在写入的位置，加 `.slice(-config.historyMaxEntries)`）。

### 六、i18n

`src/renderer/src/locales/{en,zh,ja}.json` 都要加新 key（zh 的翻译用日常用词，不要机翻腔）：

```
listMode.history
history.searchPlaceholder
history.sortByTime
history.sortByPlayCount
history.bucket.today
history.bucket.yesterday
history.bucket.thisWeek
history.bucket.thisMonth
history.bucket.earlier
history.actionPlay
history.actionJump
history.actionJumpDisabled    // tooltip when track not in current playlist
history.actionRemove
history.relative.justNow
history.relative.minutesAgo   // {{count}} 分钟前
history.relative.hoursAgo
history.relative.yesterdayAt  // 昨天 {{time}}
history.empty.noHistory
history.empty.noSearchMatch
history.confirmClear
```

`empty.historyEmpty` / `player.playbackHistory` / `player.backHistory` / `player.clearHistory` / `player.historyDrawerHint` / `player.historyDrawerEmptyHint` / `player.historyMissingHint` / `player.historyMostRecent` / `player.historyCountLabel` / `player.recentTracks` 这些**旧 key 整块删除**。

### 七、CSS

在 `src/renderer/src/index.css` 里：

- **删除** `playback-history-drawer-*` 这一组所有 class（grep 一下整块删干净）
- **新增** `history-sidebar-*` 一组 class，独立命名，不要 piggyback 其他组件的样式
- 风格视觉跟 `QueueSidebarView` 对齐（同样的圆角、间距、hover 反馈）

---

## 架构约定（必须遵守）

- **单文件 `App.jsx` 已经超大，新代码写进 `HistorySidebarView.jsx`，App.jsx 只做接线**（state、handler、props）
- 不要引入新依赖，dnd-kit / lucide-react / react-i18next 这些都已有
- 错误处理风格、注释风格、命名风格都参考 `QueueSidebarView.jsx`
- 不要碰 `AudioEngine.js`
- 不要碰 `playbackHistoryRef.current` 写入路径上的 normalize 逻辑（`normalizePlaybackHistoryEntry`、`remapPlaybackHistoryEntries`、`pickInitialPersistedValue`），那一块运转是好的
- 持久化继续用现有的 localStorage `nc_playback_history` + snapshot 系统，**不改存储 schema**，只改读出来后的派生和渲染

---

## 验收标准

实现完毕后请确认：

1. 标题栏右上角的 History 图标按钮**已删除**
2. 左侧 nav-rail 里多了 "History" 一级入口，点进去切换 `listMode === 'history'`，整个 sidebar 区域被 `HistorySidebarView` 接管，**和 Queue 视觉一致**
3. 历史条目按 Today / Yesterday / This week / This month / Earlier 分组显示
4. 每条显示封面、标题、艺人、相对时间、播放次数（>0 时）
5. **切换 listMode 到 albums/artists/playlists 后再切回 history，所有历史条目仍在**（这是当前的核心 bug）
6. 历史里曲目不在当前 playlist 时，「Play」按钮仍能播放成功，「Jump in playlist」按钮灰显
7. 搜索框 200ms debounce，按 title/artist/album 模糊匹配
8. 排序切换 By time / By play count 都生效
9. hover 出 Play / Jump / Remove 三个按钮，单条删除只影响 history 不影响 trackStats
10. `config.historyMaxEntries` 写入裁切生效，`historyCollapseRepeats` 折叠生效
11. zh/en/ja 三语言文案完整，没有 fallback 英文混进中文界面
12. `index.css` 里 `playback-history-drawer-*` class **完全清理干净**，`lyrics-drawer-panel` 不再被历史复用
13. 键盘 ↑↓/Enter/Delete/Cmd+F 都工作
14. 关掉 `config.historyShowInSidebar` 时入口和视图都消失（兜底开关）

---

## 我希望你怎么做

1. **先不要写代码**，先回我一份实现计划：
   - 文件改动清单（新建哪些、删哪些、改哪些行号区间）
   - "曲目不在当前 playlist 时如何 Play"——你打算用临时 context 还是 Up Next 注入，给我两种方案的取舍
   - 任何对现有代码逻辑还不清楚的点，列出来我贴给你
2. 计划我确认后，**按以下顺序分批写代码**，每批写完停下让我 review：
   - 批 1：`HistorySidebarView.jsx` 新组件 + i18n key
   - 批 2：`App.jsx` 接线（新 listMode、新 handler、删旧 drawer/按钮）
   - 批 3：`index.css` 清理 + 新样式
   - 批 4：`defaultConfig.js` 新配置项 + 写入裁切逻辑
3. 代码风格、注释风格、命名严格对齐 `QueueSidebarView.jsx`

开始吧。
