# Codex Prompt：将"播放队列"升级成侧边栏全功能面板

---

## ⚠️ 最重要的事(请先读三遍)

**这个功能已经存在,不是从零开发!** 仓库里已经有完整的队列状态管理、拖拽排序、持久化、拖入接收 —— 当前只是被做成了一个 `max-height: 86px` 的迷你预览条,用户根本看不见。**你的任务是把现有实现升级成侧边栏完整面板,绝对不要重新造轮子,绝对不要新增 state 字段或 DataTransfer 协议。**

如果你写代码时新增了 `queue` / `playQueue` / `myQueue` 任何新名字的 state,**说明你没读现有代码,请回去重读**。现有名字就是 `upNextQueue`,沿用。

---

## 一、必须先读的文件 + 必须确认的现状

请你实际打开下面这些文件,在回复开头列出"我读了 XX,确认了 XX"清单。**不读不写代码**。

### 文件清单

- `src/renderer/src/App.jsx` —— 重点关注:
  - 第 482 行附近 `normalizeUpNextQueue` 函数
  - 第 559 行附近 `UpNextQueueSortableItem` 组件(已存在的可拖拽列表项)
  - 第 1485 行 `useState(upNextQueue)` 初始化
  - 第 1502 行 `queuePlaybackEnabled` 开关
  - 第 1818 行 `upNextQueueRef`
  - 第 1889 行 `queueDragOver` 状态
  - 第 1762、1764 行 `upNextQueueStoreHydratedRef` / `queuePlaybackStoreHydratedRef`
  - 第 2210 行 `upNextPathSet`
  - 第 2350-2353 行队列持久化逻辑
  - 第 9700-9740 行 `handleQueueDragOver` / `handleQueueDragLeave` / `handleQueueDrop`(完整的拖入接收实现)
  - 第 13223-13230 行歌曲行的 `onDragStart`(看现有曲目怎么对外发出拖拽数据)
  - 第 13742 行 `data-track-path`(已有的歌曲行属性)
  - 第 204-205 行 `SIDEBAR_ROW_HEIGHT = 75` 和 `SIDEBAR_DETAIL_ROW_HEIGHT = 75`
  - `<SortableContext>` 和 `<DndContext>` 在 App.jsx 里已经包过了,搜一下确认
- `src/renderer/src/index.css` —— 第 2211-2310 行 `.queue-preview-*` 全套样式
- `src/renderer/src/styles/echo-track-list.css` —— 现有歌曲行的样式来源,**新队列面板要复用这里的样式变量和类名思路**(`.playlist-virtual-list` 等)
- `src/renderer/src/i18n/index.js` —— 找现有的 `queue.*` 或 `upNext.*` key,新增 key 必须用同一命名空间

### 必须在脑子里建立的事实清单

读完后请在回复里逐条列出:

1. 已存在的 state:`upNextQueue`(数组),每项形如 `{ path: string, track: { info: { title, artist, album }, ... } }`
2. 已存在的持久化 key:appState `'upNextQueue'`、localStorage `'nc_up_next_queue'`
3. 已存在的拖拽数据格式:`dataTransfer.setData('application/x-echo-track-path', path)`(歌曲行设置)
4. 已存在的接收逻辑:`handleQueueDrop` 已经会从 `playlistRef.current` 找出 track 加入队列
5. 已存在的可排序组件:`UpNextQueueSortableItem`(用 `@dnd-kit/sortable` 的 `useSortable`,以 `item.path` 为 id)
6. 已存在的开关:`queuePlaybackEnabled`(控制是否优先播队列)
7. 现有侧边栏歌曲行高:75px(`SIDEBAR_ROW_HEIGHT` 和 `SIDEBAR_DETAIL_ROW_HEIGHT` 都是 75)
8. 现有侧边栏列表用了**虚拟滚动**(搜 `tracksForSidebarListFiltered`、`visibleSidebarRange`),队列面板**也必须**用类似的虚拟滚动(队列可能上千首)

---

## 二、用户的真实需求

把现有的"迷你队列预览"(86px 高的小条)**升级成与侧边栏歌曲列表完全一致视觉的完整面板**,挂在侧边栏里(或作为侧边栏的一个 Tab/视图),并补全专业播放器应有的全套队列操作。

---

## 三、必做功能清单

### A. 视觉与位置

1. **位置**:在侧边栏歌曲列表区域**新增一个"队列"视图模式**(和现有 `listMode` 切换:`library` / `playlists` / `albums` / **`queue`**),通过侧边栏顶部 Tab 或切换按钮进入。**不要**做成弹窗、抽屉、popover —— 用户要的就是常驻侧栏。
2. **行视觉与歌曲列表完全一致**:
   - 行高 = `SIDEBAR_ROW_HEIGHT`(75px)
   - 字体、颜色、间距、悬停效果、hover 显示按钮的逻辑全部复用 `echo-track-list.css` 里现有的歌曲行样式
   - 队列项内部布局:左侧拖动手柄 → 序号 → 封面缩略图 → (标题 / 艺人) → 时长 → 右侧操作按钮(移除 / 跳到此处)
   - 不要单独写新的 `.queue-row-xxx` 样式,**继承**或 `@extend` 现有的歌曲行 class
3. **当前播放高亮**:正在播放的曲目在队列里有明显高亮(用现有歌曲列表的 active class)
4. **空状态**:无队列时显示一个友好空状态:大图标 + "Drag songs here to queue" + 国际化文案
5. **顶部头部栏**:
   - 标题 "Up Next" / "播放队列" / "再生キュー"
   - 总数:`12 tracks · 47 min`
   - 操作按钮:Clear All(清空)、Save as Playlist(保存为歌单,复用现有 `userPlaylists` API)、Shuffle Queue(打乱当前队列顺序)、Toggle Queue Playback(队列优先开关,绑 `queuePlaybackEnabled`)

### B. 拖拽(已有基础,补全场景)

6. **从侧边栏歌曲列表拖入队列**:沿用现有 `application/x-echo-track-path` 协议。**不要**新发明拖拽 key。
7. **支持多选拖拽**:用户可以 Ctrl/Shift 多选歌曲后整批拖入。多选歌曲时 `dataTransfer.setData('application/x-echo-track-paths', JSON.stringify(paths))`(注意是复数 `paths`),队列接收方两种 key 都支持。
8. **从歌单/专辑/艺人详情拖入**:任何显示歌曲行的地方都要能拖到队列。审计所有歌曲行,确保都设置了 `draggable` + `onDragStart` 的 path 数据。
9. **队列内拖拽排序**:已有 `UpNextQueueSortableItem`,继续用,但要确认在新的全尺寸面板下手柄区域仍然好抓(放大 hit area)。
10. **拖出队列删除**:把队列项拖到队列面板**外**,自动从队列移除(macOS Music 的设计)。
11. **拖入位置预览**:拖动时显示一条插入指示线(`@dnd-kit` 已支持,确保启用),让用户看到会插入到第几位。
12. **拖拽视觉反馈**:`queueDragOver` 为 true 时,整个面板边框高亮 + 半透明 accent 背景叠加。

### C. 操作(每项都必须有)

13. **点击行 → 立即播放该曲并消耗到该位置**(后续自动续播队列剩余项)
14. **悬停显示按钮**:移除(×)、置顶("Play Next")
15. **右键菜单**:Play Now / Play Next / Move to Top / Move to Bottom / Remove / Remove Above / Remove Below / Clear Queue / Save as Playlist
16. **键盘**:列表 focus 时 Delete = 移除选中项,↑↓ 选择,Enter 播放,Ctrl+A 全选,Ctrl+Z 撤销最近一次移除/清空操作
17. **撤销栈**:最近 5 次移除/清空操作可撤销(纯 React state,不持久化),底部 toast 提示 "Removed 'Song'. [Undo]"

### D. 智能行为

18. **"Play Next" vs "Play Later"**:在歌曲行右键菜单分别提供 "Play Next"(插到队列首位)和 "Add to Queue"(追加末尾),区分两种意图(Apple Music 标配)
19. **去重提示**:拖入已在队列里的曲目时,顶部短暂 toast 提示 "Already in queue",不重复添加
20. **当前曲消耗**:每首播完后从队列头部移除(已有逻辑就保留),如果用户开启了"Repeat Queue",消耗后追加到末尾
21. **队列与播放列表的关系**:队列**优先**于 `playlist`(`queuePlaybackEnabled` 为 true 时),队列空了自动回到 `playlist` 的下一首
22. **跨会话恢复**:已有持久化,**不要破坏**;同时把 "queue position cursor"(用户上次播到队列第几个)也持久化,启动时恢复

### E. 性能

23. **虚拟滚动**:队列项数 > 50 时启用虚拟滚动,逻辑参考现有 `tracksForSidebarListFiltered` + `visibleSidebarRange`(那一套是写好的样板)
24. **拖拽时只重绘当前移动的项**:`@dnd-kit` 默认就是,确认 `UpNextQueueSortableItem` 用了 `memo`(它已经用了,保持)
25. **持久化节流**:队列变化已有 `RENDERER_PERSIST_DEBOUNCE_MS = 600` 保护,确认新增的操作走同一个 debounce 通道,不要每次点击都写盘

---

## 四、绝对不要做的事

- **不要新增重复的 state**(`queue`、`playQueue`、`upNext`、`myQueue`、`nextTracks` 都不许出现)。沿用 `upNextQueue`。
- **不要新增第二套 DataTransfer 协议**。沿用 `application/x-echo-track-path`(单)和新增 `application/x-echo-track-paths`(多,复数),仅此两个。
- **不要把队列做成弹窗、Drawer、Popover 或浮动面板**。用户明确要求"在侧边栏里(大小和歌曲列表一样)"。
- **不要新增重型依赖**。`@dnd-kit/core` 和 `@dnd-kit/sortable` 已经在用,继续用。
- **不要复制粘贴现有歌曲行 CSS 写一份新的"queue-row"**。复用 / 继承,样式一致。
- **不要把现有 `queue-preview-*` mini 预览删除**(可能在小屏布局有用),**只是把侧栏队列视图建成新组件**。如果你确认 mini 预览完全无用了,可以删,但要在最终回复里明确说明。
- **不要在主进程做任何改动**。这是纯渲染端的功能。
- **不要破坏现有 `migration`**:`upNextQueue` 数据结构如果要扩展(比如加 `addedAt` 时间戳),**只增不改**,且加迁移逻辑。
- **不要用 `localStorage` 直接读写**绕过现有持久化层。所有持久化都走 `appState:get/set` + `nc_up_next_queue` 这套现成机制。

---

## 五、UI 设计要求(细节)

- 视觉风格 100% 对齐现有侧边栏歌曲列表(`echo-track-list.css`)
- 头部栏的按钮使用现有 `UiButton` / `UiIconButton`(`src/renderer/src/components/ui/`)
- 图标用 `lucide-react`(已经在用):`ListMusic`、`Trash2`、`Save`、`Shuffle`、`X`、`GripVertical`、`Play`、`ChevronUp`、`ChevronDown`
- 颜色全部 `var(--xxx)` CSS 变量驱动,**不要硬编码**
- 拖入指示线:`2px solid var(--accent-pink)`,带 0.25 透明度的同色发光
- 空状态插画:简单的 inline SVG 即可(不要外部资源),线性图标风格,大小 80x80,半透明
- 暗色 / 浅色主题都正常

---

## 六、i18n 必加的 key(都用 `queue.*` 命名空间)

```
queue.title              → "Up Next" / "播放队列" / "再生キュー"
queue.empty.title        → "Queue is empty"
queue.empty.hint         → "Drag songs here, or right-click any track and choose 'Add to Queue'"
queue.totalCount         → "{{count}} tracks · {{duration}}"
queue.actions.clear      → "Clear"
queue.actions.shuffle    → "Shuffle"
queue.actions.saveAs     → "Save as Playlist"
queue.actions.toggle     → "Use Queue"
queue.contextMenu.playNow      → "Play Now"
queue.contextMenu.playNext     → "Play Next"
queue.contextMenu.addToQueue   → "Add to Queue"
queue.contextMenu.moveTop      → "Move to Top"
queue.contextMenu.moveBottom   → "Move to Bottom"
queue.contextMenu.remove       → "Remove"
queue.contextMenu.removeAbove  → "Remove all above"
queue.contextMenu.removeBelow  → "Remove all below"
queue.toast.removed      → "Removed '{{title}}'"
queue.toast.alreadyIn    → "Already in queue"
queue.toast.cleared      → "Cleared {{count}} tracks"
queue.toast.undo         → "Undo"
queue.toast.savedAs      → "Saved as playlist '{{name}}'"
```

英文 / 简体中文 / 日语三套都要写。

---

## 七、验收标准(逐条勾,自测后提交)

- [ ] 侧边栏顶部多了一个"队列"视图入口(图标 + 文字),点击后侧栏切到队列视图
- [ ] 队列每行高度、字体、间距与歌曲列表行**完全一致**(两图叠加比对像素级一致)
- [ ] 从歌曲列表拖一首歌到队列面板,松手后队列里出现该曲,顶部计数 +1
- [ ] 拖入时整个面板有明显高亮反馈,松手后反馈消失
- [ ] 拖入时面板内显示插入位置指示线(拖到列表中间能看到精确位置)
- [ ] 队列内任意两项可上下拖动重排
- [ ] 把队列项拖出面板外,自动移除
- [ ] 多选 5 首歌一起拖入,5 首一起进队列
- [ ] 重复拖入同一首,顶部 toast 提示"Already in queue"且不重复
- [ ] 点击队列任意项立即播放该曲,后续自动接着播队列剩余
- [ ] 右键队列项,弹出完整菜单,所有项都可点且功能正确
- [ ] 移除一项后,底部出现 "Removed 'X'. [Undo]" toast,点 Undo 恢复
- [ ] 清空队列,toast 也能撤销
- [ ] Ctrl+Z 在队列 focus 时撤销最近操作
- [ ] 头部"保存为歌单"按钮,弹出命名输入,保存后在歌单列表能看到
- [ ] 头部"打乱"按钮,队列顺序打乱,但**当前正在播放的曲不变**(只打乱后续)
- [ ] 关闭 / 重开应用,队列内容、当前位置、queuePlaybackEnabled 状态完全恢复
- [ ] 队列 1000 首时滚动流畅(60fps),无明显卡顿
- [ ] 中 / 英 / 日三语切换无遗漏字符串
- [ ] 暗色 + 浅色主题都正常
- [ ] 拖拽时鼠标光标显示正确(`grab` / `grabbing`)
- [ ] 队列项的封面缩略图能正确显示(如歌曲行有缩略图,队列项也要有)

---

## 八、交付清单

最终回复请给出:

1. **现状确认清单**(读了哪些文件,确认了哪些事实,见第一节末尾要求)
2. 修改 / 新增文件路径列表
3. 新组件完整代码(预期是新增 `src/renderer/src/components/QueueSidebarView.jsx`)
4. App.jsx 关键 diff(`listMode` 新增 `'queue'` 分支、入口按钮、删除/保留 mini 预览的决定)
5. CSS 变更(主要在 `echo-track-list.css` 复用 + 少量队列特定样式)
6. i18n 文件 diff(三语 key 完整)
7. 自测报告(逐条对照第七节验收标准)

---

请先列"现状确认清单",再开始写代码。**任何未读代码就开始假设的行为视为不合格**。开始干活。
