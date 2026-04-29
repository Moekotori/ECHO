# Codex Prompt：为 ECHO 实现"手机遥控 Web 端"

---

## 一、项目背景（请你先读这部分,再开工）

ECHO 是一个基于 **Electron 31 + React 18 + electron-vite** 的桌面音乐播放器(Windows 为主,macOS/Linux 兼容)。代码风格使用 ESM(`import` 而非 `require`)。请严格遵循仓库现有的架构和命名约定,不要引入新的设计系统、新的状态管理库或新的打包工具。

### 关键架构事实(请先实际打开这些文件确认,不要凭空假设)

- **主进程入口**:`src/main/index.js`(超过 3000 行,所有 IPC handler 都在这里注册,模式为 `ipcMain.handle('namespace:action', async (_, payload) => { ... })`)
- **预加载桥接**:`src/preload/index.js`,通过 `contextBridge.exposeInMainWorld('api', {...})` 把方法暴露到渲染进程的 `window.api`
- **渲染进程根**:`src/renderer/src/App.jsx`,播放器状态是核心(`isPlaying`、`currentIndex`、`playlist`、`volume`、`playbackRate`、`playbackHistory`、`view` 等),通过 `useState` 持有
- **UI 设计系统**:`src/renderer/src/components/ui/`(`UiButton` 支持 `variant: primary | secondary | danger`,`size: sm | md | compact`;还有 `UiIconButton`、`UiPanel`)。**所有新增的桌面端 UI 必须复用这套组件**,不要自己写新的按钮样式
- **Drawer 模式**:已有的功能面板(`ListenTogetherDrawer.jsx`、`CastReceiveDrawer.jsx`、`PluginManagerDrawer.jsx`、`AudioSettingsDrawer.jsx` 等)是"右侧抽屉"形态,**新功能也用同样的 Drawer 模式**
- **可参考的 WS 服务实现**:`server/listen-together/index.js`(express + `ws` 库,端口 8787,消息协议 `{type, payload}` JSON 双向通信,`broadcastRoom` 广播模式)。**手机遥控的 WS 服务请遵循同样的消息协议风格**
- **持久化**:用现成的 `appState:get` / `appState:set` IPC,不要自己写 JSON 文件读写
- **i18n**:仓库支持 en / zh / ja 三种语言,所有用户可见的字符串必须走现有的 i18n 系统
- **主题**:全 CSS 变量驱动,新增样式必须使用 `var(--xxx)`,不要硬编码颜色
- **已有依赖**:`axios`、`ws`、`express`(在 server 子项目里)、`qrcode`(若没有就 npm install,但优先复用)、`lucide-react` 图标

---

## 二、任务目标

为 ECHO **新增"手机遥控"功能**:在桌面 ECHO 主进程内启动一个**本地 HTTP + WebSocket 服务**,手机用浏览器扫描桌面端展示的二维码即可打开一个**响应式 PWA 风格 Web App**,作为遥控器控制桌面 ECHO 的播放。

**注意:服务必须运行在桌面 Electron 主进程内**(类似 `server/listen-together` 的代码风格,但不依赖那个独立 server,要嵌进主进程)。**不需要**把信令转发到任何云端 —— 走同一局域网即可。

---

## 三、功能清单(MUST HAVE,缺一不可)

### A. 桌面端(Electron 内)

1. **本地遥控服务**:
   - 在主进程启动一个 HTTP + WS 服务,默认端口 18888(可配置,被占用时自动 +1 直到找到可用端口)
   - 仅监听本机所有 IPv4(包括 LAN IP),**不暴露到公网**
   - HTTP 服务返回手机端 Web App 的静态资源(HTML/CSS/JS,打包后 inline 在一个文件里最佳,避免 MIME 配置麻烦)
   - WS 路径 `/remote-ws`,JSON 消息协议:`{type, payload}`,沿用 `listen-together` 风格
2. **配对与鉴权**:
   - 启动服务时生成 6 位短 token(数字),写入 URL query(如 `http://192.168.1.x:18888/?t=482917`)
   - 桌面端"遥控设置抽屉"里展示**二维码**(用 `qrcode` 包生成 dataURL)+ 明文 URL 文本(便于手动输入)+ 一键复制
   - 手机端首次连接 WS 必须带 token,token 错误立即断开并返回 `auth_failed`
   - 桌面端显示"已连接设备列表"(手机 UA 简化展示,可手动踢下线)
   - 用户可以一键"重新生成 token"作废所有现有连接
3. **遥控控制项 → 主进程必须能落到 App.jsx 的播放器状态**:
   - 播放 / 暂停 / 上一首 / 下一首
   - seek 到指定秒
   - 音量调节(0–100)+ 静音切换
   - 播放模式切换(顺序 / 单曲循环 / 列表循环 / 随机)
   - 收藏 / 取消收藏当前曲目
   - 调节播放速度(0.5x – 2.0x)
   - 切换 EQ 预设(读取现有预设列表)
   - 关闭 / 显示桌面歌词(复用现有 IPC)
4. **桌面端 → 手机端实时推送**:
   - 当前曲目元数据(title、artist、album、duration、cover dataURL 或 cover URL)
   - 播放状态(isPlaying、positionSec、playbackRate、volume、isMuted、playMode)
   - 当前 LRC 行(逐行,带高亮的当前行 index)+ 上一行 + 下一行(三行视图最丝滑)
   - 队列(可选:仅在用户在手机端打开"队列"页时按需请求,避免常驻推送大数据)
5. **设置入口**:
   - 在 `Settings` 抽屉(找一下现有的 settings drawer)里新增"手机遥控"分区
   - 开关:启用 / 停用服务
   - 端口号显示(只读 + 一键复制)
   - 二维码展示按钮 → 弹出新 Drawer
   - 已连接设备列表
   - 高级:允许"无 token 局域网模式"(默认关闭,打开有警告)
6. **桌面端 → 手机端的 IPC 新增 channel**(命名建议):
   - `remote:start` / `remote:stop` / `remote:status` / `remote:rotateToken` / `remote:listClients` / `remote:kickClient`
   - 主进程**主动**通过 `mainWindow.webContents.send('remote:command', {...})` 把手机的指令转发到渲染进程,渲染进程已有的播放函数响应它

### B. 手机端 Web App(单文件 HTML 最理想)

7. **必须是响应式 PWA 风格**,iOS Safari / Android Chrome / 微信内置浏览器都能流畅运行(微信内置浏览器有 WS 限制,要做降级提示)
8. **三个底部 Tab**:
   - **Now Playing**(默认):大封面、歌曲名、艺人、进度条(可拖拽 seek)、播放控制(上一首 / 播放暂停 / 下一首)、音量滑条、收藏心、播放模式按钮、播放速度按钮
   - **Lyrics**:沉浸式歌词全屏,自动滚动,当前行高亮(参考 Apple Music / 网易云的现代设计语言)
   - **Settings**:连接状态、断开按钮、深色 / 浅色模式切换(默认跟随系统)、语言(en/zh/ja)
9. **UI 设计要求**(关键,别糊弄):
   - 极简 + 大触控目标(所有可点击区域 ≥ 44x44pt,符合 iOS HIG)
   - 配色用 CSS 变量(深色模式默认),封面 dominant color 提取作为背景模糊渐变(canvas 取色或简单的 `backdrop-filter: blur(40px)`)
   - 进度条用原生 `<input type="range">` 改造,**不要**用第三方组件库
   - 控制按钮使用 SVG 内联图标(参考 Lucide 风格,自己写 inline SVG 即可,不要引外部 CDN)
   - 切 Tab 用 CSS transform 平滑过渡,不要白屏
   - 横屏 / 竖屏都要正常
   - **iOS Safari 注意点**:`100vh` 在 iOS 不准,改用 `100dvh` 或 JS 测量;音量滑条在 iOS Web 不能控制设备音量,本遥控的滑条只控制桌面端音量(没问题);进度条拖拽时禁止页面滚动
   - **安卓注意点**:状态栏沉浸,`viewport-fit=cover`
10. **网络韧性**:
    - WS 断线自动重连(指数退避,最大 30s,最大 10 次后停止并提示)
    - 网络切换 / 锁屏后回来要能自动复连
    - 控制指令本地立即"乐观更新",收到服务端 ack 后回滚或确认
11. **离线降级**:Service Worker 缓存静态资源,手机端断网时仍可打开页面(显示"已断开"状态)

---

## 四、必须遵守的工程约束

- **不要**引入 React Native、Capacitor、Vue、Svelte、Tailwind 等新框架。手机端 Web App 用**原生 HTML + CSS + 原生 JS**(无构建步骤),最终产物是一个 `mobile-remote.html`(或拆 3 个文件 html/css/js,但必须能被 Express 直接 serve)
- **不要**改动现有 `server/listen-together` 的代码,本功能是独立的
- **不要**在主进程 require 不必要的重型依赖
- **不要**把端口暴露到 `0.0.0.0` 以外的接口(就是说不要 NAT 打洞 / 不要 UPnP)
- 复用 `qrcode`、`ws`、`express` —— 如需安装请加到 `package.json` 的 `dependencies`,并在 `package.json` 的 `electron-builder` 配置里检查是否需要 unpack
- 所有用户可见字符串走 i18n,key 用 `remote.xxx` 命名空间
- 桌面端新增的 React 组件命名为 `PhoneRemoteDrawer.jsx`,放 `src/renderer/src/components/`
- 主进程新增模块放 `src/main/remote/PhoneRemoteServer.js`(注意 `src/main/remote/` 这个目录已存在,放 SubsonicClient/WebDavClient,新文件并列即可)
- 提交前用仓库现有的 `npm run lint` 和 `npm run format` 检查通过

---

## 五、安全要求(不要跳过)

- token 必须是 6 位纯数字,服务端用常量时间比较防 timing attack
- WS 鉴权失败必须立即关闭连接,记录到日志(用现有的 `logLine.js`)
- HTTP 路由对 `/remote-ws` 之外的所有路径,如果没有有效 token,必须 403
- **绝不**把 token 写入 `localStorage` 或长期持久化(token 是会话级的)
- 每个 WS 连接维持心跳(15s ping/pong),60s 无响应视为掉线
- 同时连接的客户端数量上限 8 个,超过拒绝
- 手机端不得通过 WS 收到任何文件路径、Cookie、token 等敏感信息

---

## 六、验收标准(请在自我测试后逐条确认)

- [ ] 在 Settings → 手机遥控 中开启服务,二维码立即显示,扫码用 iPhone Safari 打开能正常进入 Now Playing 页
- [ ] 手机端按播放暂停,桌面端立即响应(端到端延迟 < 200ms 局域网)
- [ ] 桌面端切歌,手机端封面 / 标题 / 歌词在 500ms 内更新
- [ ] 手机端拖拽进度条,桌面端 seek 准确,且手机端进度回弹自然(无抖动)
- [ ] 关掉手机 WiFi 再开,WS 自动重连,无需用户手动操作
- [ ] 安卓 Chrome、iOS Safari、微信内置浏览器三种环境都能进入页面(微信里 WS 不可用要明确提示用 Safari/Chrome 打开)
- [ ] 横屏 / 竖屏切换 UI 不破
- [ ] 中 / 英 / 日三语切换正常
- [ ] 关闭服务后所有 WS 立即断开,端口释放
- [ ] 重新生成 token 后,旧手机端立即断开
- [ ] 长时间运行(2 小时)无内存泄漏(主进程 RSS 增长 < 50MB)
- [ ] 在 Windows 防火墙首次提示时桌面端有友好提示告知用户允许"专用网络"

---

## 七、不要做的事(避免 scope creep)

- 不要做"手机端反向控制桌面端的一起听房间"
- 不要做手机端账号系统
- 不要做手机端推送通知
- 不要做手机端音频播放(本功能纯粹是遥控器,不是流式播放)
- 不要把 mobile-remote.html 做成 SPA 框架,保持单页几个 section + Tab 切换即可
- 不要写过度抽象的 manager class,代码风格保持和 `server/listen-together/index.js` 类似的简洁实用风

---

## 八、交付清单

请在最终回复里给出:

1. 新增 / 修改的所有文件路径列表
2. 主进程关键代码片段(`PhoneRemoteServer.js` 完整内容、IPC handler 注册、`PhoneRemoteDrawer.jsx` 完整内容、`mobile-remote.html` 完整内容)
3. 自测说明(怎么本地试)
4. 一段简短的 README 节选,可以追加到根 README.md 的 Feature Highlights 里(中英对照)

---

请先在回复开头列出"我读了这些文件确认以下事实"的清单(至少包括 `src/main/index.js`、`src/preload/index.js`、`src/renderer/src/App.jsx`、`src/renderer/src/components/ListenTogetherDrawer.jsx`、`src/renderer/src/components/ui/UiButton.jsx`、`server/listen-together/index.js`),再开始编码。**不要凭空假设 API 形状,看了再写**。

开始干活。
