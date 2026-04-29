# ECHO Cast-Out 功能实现 Prompt（投送到数播）

## 背景

我在做一个叫 ECHO 的 Electron + React HiFi 桌面播放器，技术栈：

- **主进程**：Electron + Node，音频核心是 `src/main/audio/AudioEngine.js`，FFmpeg 解码 → 自研 AudioProcessor → PortAudio / WASAPI 独占 / ASIO 输出
- **渲染进程**：React (`src/renderer/src/App.jsx`)
- **既有 cast 相关代码**（**只有"接"，没有"发"**）：
  - `src/main/cast/AirplayRaopReceiver.js` — AirPlay RAOP 接收端，依赖 `@lox-audioserver/node-libraop`（这个原生模块**同时含有 sender 和 receiver 实现**，目前我只用了 receiver 一半）
  - `src/main/cast/DlnaMediaRenderer.js` — DLNA MediaRenderer（被投送方），用了 SSDP + UPnP SOAP + 本地 HTTP，写得比较干净可以参考风格
- **既有特色功能**：等功率自动混音 (automix / crossfade)、gapless、参数 EQ、ASIO/WASAPI 独占、回放增益
- **既有 IPC 习惯**：`src/preload/index.js` 暴露 `window.api.xxx`，主进程在 `src/main/index.js` 注册 IPC handler

---

## 任务

为 ECHO 实现**把音乐投送给数播（network audio player / streamer）**的能力。目标用户是 HiFi 玩家，他们家里的设备包括 Eversolo / HiFi Rose / Cayin / FiiO / Bluesound / Cambridge Audio / NAD / Marantz / Denon 等，**核心诉求是 bit-perfect 24/192**。

---

## 优先级（请严格按 P0 → P1 → P2 顺序实现）

### P0：UPnP/DLNA + OpenHome 控制端（必做）

**这是覆盖率最高、唯一能 24/192 比特完美的路径，是这个任务的主菜。**

需要 ECHO 同时扮演两个角色：

1. **本地 HTTP Media Server**：
   - 把当前播放曲目暴露为一个 HTTP URL，数播自己来 GET
   - 必须支持 HTTP Range 请求（数播会发 Range 头来 seek）
   - 提供两种模式：
     - **直通模式（默认）**：URL 直指原文件（FLAC/WAV/DSF/APE/...），完全 bit-perfect
     - **转码兜底模式**：当数播不支持原格式时，用 ffmpeg 实时转 FLAC/WAV PCM。决策依据：先在投送前 probe 数播的 `GetProtocolInfo`，根据返回的 supported MIME 列表判断
   - 封面图也需要临时通过 HTTP 暴露一个 URL（不要塞 base64，很多数播不认）

2. **Control Point**：
   - **发现层**：发 SSDP M-SEARCH 扫 `urn:schemas-upnp-org:device:MediaRenderer:1` 和 `urn:linn-co-uk:device:Source:1`（OpenHome），解析返回的 LOCATION 拿 device descriptor
   - **控制层（DLNA AVTransport）**：SOAP 调用 `SetAVTransportURI` + `Play` + `Pause` + `Stop` + `Seek` + `SetVolume`，每次切歌都要重新 SetAVTransportURI
   - **控制层（OpenHome 增强）**：检测到设备支持 OpenHome 时，用 OpenHome `Playlist` service 把整个队列一次推过去，由 renderer 内部 gapless 衔接（这是为了让 ECHO 的 gapless 在投送时不失效）
   - **状态反馈**：用 GENA event subscription 拿播放进度/状态，UI 显示以数播回报为准
   - **DIDL-Lite 元数据**：标题、艺术家、专辑、封面 URL、duration、`contentFeatures.dlna.org` 必须给齐，否则数播屏幕上会一片空白
   - **DSD 处理**：DSD 走 DoP 时要包成 24-bit WAV，sample rate 改 176.4/352.8 kHz，content-type 用 `audio/L24`

**实现栈建议**：
- 发现层：自己写 UDP M-SEARCH 或用 `node-ssdp`
- SOAP：直接 `fetch` + 模板字符串够用，UPnP 的 SOAP 极简
- HTTP server：Node 原生 `http` 模块，参考 `DlnaMediaRenderer.js` 已有的 HTTP 写法
- 不要引入重型 UPnP 库（如 `peer-upnp`），保持依赖干净

### P1：AirPlay sender（顺手做）

`@lox-audioserver/node-libraop` 这个原生模块**已经在依赖里了**，它本身含 sender 实现，工程量很小。

- 用 mDNS/Bonjour 扫 `_raop._tcp.local` / `_airplay._tcp.local` 服务
- 上限 16-bit / 44.1kHz / ALAC，UI 要明确标"AirPlay 16/44，非比特完美"
- 这是便利性补充，不是 HiFi 主路径

### P2：Chromecast sender（可选，看时间）

Node 有 `castv2-client`，上限 24/96。如果 P0/P1 做完还有余力再做。

### 明确**不做**的

- **Roon Ready (RAAT)** — 闭源 SDK，需要商业授权，开源项目拿不到
- **Spotify Connect / Tidal Connect / Qobuz Connect** — 必须流媒体平台官方授权
- **HEOS / MusicCast / BluOS** — 单一品牌私有 API，性价比太低

---

## 关键工程决策（请实现时遵守）

### 1. 投送时本机播放怎么处理

UI 给用户三种模式选择，**默认用"接管模式"**：

- **接管模式**（默认）：投送时本机静音/暂停，所有控制走数播。最 HiFi。
- **同步模式**（v2 再做）：本机和数播同时放，需要 NTP 对齐 buffer，本期不实现，UI 上灰掉
- **遥控模式**：本机不出声，纯当遥控器 + 曲库浏览。这是发烧友最常用的模式

### 2. EQ / Automix / Replay Gain 在投送时如何处理

**默认全部走直通（bit-perfect），关掉所有处理**。

- 用户必须显式打开"投送时也启用 ECHO 处理"开关，才会启用 EQ/automix/RG
- 一旦启用处理，必须先解码 → 处理 → 重编码 FLAC → 再 HTTP 推送（破坏比特完美，但功能完整）
- UI 上要明确显示当前信号路径："Bit-Perfect" 或 "Processed (FLAC re-encode)"，这个对发烧用户是关键卖点

### 3. Gapless / Automix 在投送时

- 走纯 DLNA：gapless/automix **失效**，每次切歌之间会有几百 ms 间隙，可以接受但要在 UI 提示
- 走 OpenHome Playlist：gapless 由 renderer 端实现，**ECHO 自己的 automix crossfade 不能再生效**（因为是本机渲染）。把 `crossfadeStateRef` 那套逻辑在投送模式下短路掉

### 4. 已有架构约定（必须遵守）

- 不要改动 `AirplayRaopReceiver.js` 和 `DlnaMediaRenderer.js`（接收端逻辑），新建 sender 模块和它们解耦
- 建议新文件：
  - `src/main/cast/UpnpSender.js`（DLNA + OpenHome 控制端）
  - `src/main/cast/UpnpDiscovery.js`（SSDP 发现 + device parse）
  - `src/main/cast/CastHttpServer.js`（本地 HTTP 流出 + 封面）
  - `src/main/cast/AirplaySender.js`（P1）
  - `src/renderer/src/components/CastSendDrawer.jsx`（UI，参考已有的 `CastReceiveDrawer.jsx` 的结构和样式）
- IPC 约定：在 `src/preload/index.js` 加 `window.api.castSendXxx`，主进程在 `src/main/index.js` 注册对应 handler，命名风格和已有的 `audioCancelAutomix` 等保持一致
- 多语言：`src/renderer/src/locales/{en,zh,ja}.json` 同步加 key
- 不要碰 `AudioEngine.js` 的核心解码/输出管线，只在它上面加一个"取流接口"（给 HTTP server 用）

### 5. 多网卡 IP 选择

参考 `DlnaMediaRenderer.js` 里 `getBestLanIPv4()` 和 `scoreLanCandidate()` 的写法，**复用这套逻辑**，避免虚拟网卡（VMware / WSL / Tailscale 等）让 LOCATION 不可达。

### 6. 错误兜底

- 数播返回 5xx / SOAP fault → UI 上显示具体错误（如 "Renderer rejected MIME audio/x-ape"），并自动尝试转码兜底
- 网络断开 → 自动 retry 3 次，超时回到本机播放
- 投送中切歌如果数播没回 ACK → 5 秒超时后强制 SetAVTransportURI

---

## 验收标准

实现后请确认：

1. 在局域网内开 Eversolo / HiFi Rose / 任意支持 DLNA 的设备，ECHO 能扫到并显示在投送列表
2. 选中后点投送，FLAC 24/192 文件能 bit-perfect 推过去（数播屏幕显示 24bit/192kHz）
3. 切歌、暂停、seek、音量从 ECHO 控制都能同步到数播
4. 数播屏幕上显示曲目封面、标题、艺术家
5. 支持 OpenHome 的设备（如 Bluesound）切歌之间无缝
6. 用户开关 EQ 时，UI 上的"信号路径"指示能正确切换 "Bit-Perfect" / "Processed"
7. AirPlay sender 能扫到 HomePod / 支持 AirPlay 的数播，上限 16/44 标注清楚
8. 投送时本机引擎正确静音（接管/遥控模式），不会同时双声道出声
9. 切换网卡 / VPN 接入 Tailscale 时不会因为虚拟网卡导致投送失败

---

## 我希望你怎么做

请按这个顺序回我：

1. **先不要写代码**，先列出你的实现计划：模块拆分、新增的 IPC channel 名字、UI 改动点、第三方依赖增减
2. 列清楚你对哪些点还有疑问 / 需要我提供更多上下文（比如想看 AudioEngine 的某段、想看现有 IPC 注册模式等），我会贴给你
3. 计划我确认后，**按 P0 → P1 顺序分批写代码**，每批写完先停下让我 review，不要一口气全写完
4. 代码风格跟现有 `DlnaMediaRenderer.js` 保持一致（注释中文 OK、错误处理用 try/catch + logLine、避免引入重型框架）

开始吧。
