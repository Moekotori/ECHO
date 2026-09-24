# ECHO Link v2（Basic）协议

ECHO Link v2 是 ECHO 的免费局域网联动协议。它提供脱敏播放状态、实时事件和七种基础播放动作。它不提供曲库读取、队列编辑、媒体/封面串流、跨设备 handoff、云中继或公网访问；这些能力仍属于 ECHO Link Pro / v1 或后续协议。

## 安全边界

- Basic 默认关闭，必须由用户在 ECHO 设置页主动启用并发起配对。
- HTTP gateway 默认使用 TCP `26789`，只接受 loopback、RFC1918 和 link-local 来源。
- v2 不提供 TLS，也不应通过路由器端口转发、反向代理或公网隧道暴露。安全模型是用户主动配对的可信局域网。
- 配对二维码中的 secret 仅存活两分钟。新建、取消、成功或超时都会令旧凭证失效。
- access token 是 256-bit bearer token，只在配对成功响应中返回一次。ECHO 只持久化 SHA-256 hash，不保存 token 明文或配对 secret。
- 不要把 access token 放入 URL、日志、诊断、崩溃报告或截图。浏览器 `EventSource` 应使用短期 ticket。
- 撤销客户端会立即使 token 失效，并关闭该客户端当前的 SSE 连接。

## 发现与配对

ECHO 通过 `_echo-link._tcp.local` 发布 mDNS/DNS-SD 服务。TXT 字段包括：

| 字段 | 示例 | 说明 |
|---|---|---|
| `name` | `PC ECHO` | 用户可识别的设备名 |
| `deviceId` | `pc-abcd...` | ECHO 设备 ID |
| `version` | `1` | 保留给 v1 发现客户端的兼容字段 |
| `versions` | `1,2` 或 `2` | 当前 gateway 支持的协议版本 |
| `auth` | `pairing` | v2 可配对；不会包含 secret 或 token |
| `apiPath` | `/echo-link/v2` | v2 API 根路径 |

设置页生成：

```text
echo://pair?version=2&host=192.168.1.20&port=26789&pairingId=...&secret=...
```

客户端解析 URI 后交换凭证：

```http
POST /echo-link/v2/pair
Content-Type: application/json

{
  "pairingId": "...",
  "secret": "...",
  "clientName": "Living Room Remote",
  "platform": "node"
}
```

成功返回 `201`。`accessToken` 只会出现这一次，客户端应存入操作系统安全存储。

```json
{
  "apiVersion": 2,
  "clientId": "client-...",
  "accessToken": "...",
  "scopes": ["status:read", "events:read", "playback:control"],
  "apiBaseUrl": "http://192.168.1.20:26789/echo-link/v2"
}
```

第一波固定授予上述三个 scope，暂不支持客户端选择。

### 内置 Mobile Remote

启用 ECHO Link Basic 后，gateway 同时提供：

```text
GET /echo-link/v2/remote
```

设置页二维码默认打开这个同源手机遥控页。一次性 `echo://pair` URI 被编码在网页 URL 的 fragment 中：

```text
http://192.168.1.20:26789/echo-link/v2/remote#pair=echo%3A%2F%2Fpair...
```

- fragment 不会进入 HTTP 请求、服务端访问日志或 `Referer`。
- 页面解析凭证后立即通过 `history.replaceState` 清除 fragment。
- 配对成功后 bearer token 只保存在浏览器 IndexedDB；页面不使用第三方脚本、字体或分析服务。
- 页面与 v2 API 同源，使用 bearer 请求状态、当前封面和动作，并通过 60 秒 ticket 建立 EventSource。
- token 被撤销或失效时，页面会清除本机凭证并要求重新扫码。
- 设置页仍提供原始 `echo://pair` URI 复制能力，供原生或第三方兼容客户端使用。

Mobile Remote 只展示 Basic 安全快照、当前歌曲封面并提供基础播放动作，不读取曲库、队列、文件路径或媒体流。当前封面通过受鉴权的同源接口返回图片字节；页面不会获得本地路径或上游封面 URL。

## 鉴权与通用错误

除配对外，请发送：

```http
Authorization: Bearer <accessToken>
```

JSON body 最大 16 KiB。统一错误格式为：

```json
{
  "error": {
    "code": "invalid_volume",
    "message": "invalid_volume",
    "requestId": "optional-client-request-id"
  }
}
```

主要错误码：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `invalid_json`, `request_body_required`, `invalid_request_id`, `invalid_seek_position`, `invalid_volume`, `unsupported_playback_action` | 请求参数无效 |
| 401 | `unauthorized`, `invalid_or_expired_pairing`, `invalid_or_expired_event_ticket` | 凭证无效或过期 |
| 403 | `insufficient_scope`, `lan_only` | scope 不足或请求不来自局域网 |
| 404 | `echo_link_basic_disabled`, `artwork_not_found`, `not_found` | Basic 已关闭、当前封面不可用或路径不存在 |
| 409 | `paired_client_limit_reached`, `playback_action_unavailable` | 客户端上限或当前播放上下文无法执行动作 |
| 413 | `request_body_too_large` | JSON 超过 16 KiB |
| 429 | `pairing_rate_limited`, `playback_action_rate_limited`, `event_connection_limit_reached` | 触发限流 |
| 503 | `main_window_unavailable`, `main_window_playback_controller_unavailable` | 主窗口控制面不可用 |
| 504 | `main_window_playback_command_timeout` | 控制等待超过 15 秒 |

## 状态

```http
GET /echo-link/v2/status
Authorization: Bearer <accessToken>
```

需要 `status:read`。响应包含设备信息、能力列表和脱敏播放快照。不会出现文件路径、host 内部状态、解码器细节、token 或 pairing secret。

## 当前封面

```http
GET /echo-link/v2/artwork/current
Authorization: Bearer <accessToken>
```

需要 `status:read`。成功时返回当前歌曲封面的图片字节和对应 `Content-Type`；当前歌曲没有可用封面时返回 `404 artwork_not_found`。接口只解析 EventHub 当前快照指向的封面，限制图片类型、10 MiB 大小和远端读取超时，不接受客户端提供任意文件路径或 URL。

该接口只服务当前播放视图，不是曲库封面 API，也不提供封面 URL、任意媒体读取或批量访问能力。

## 播放动作

```http
POST /echo-link/v2/actions/playback
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "requestId": "8b231c2b-...", "action": "next" }
```

需要 `playback:control`。每个请求都必须带最多 64 字符的 `requestId`；允许字符为字母、数字、点、下划线、冒号和连字符。同一客户端五分钟内重复提交同一 ID，会得到第一次执行的结果，不会再次切歌。

动作判别联合体：

```ts
type PlaybackAction =
  | { requestId: string; action: 'play' | 'pause' | 'stop' | 'previous' | 'next' }
  | { requestId: string; action: 'seek'; positionMs: number }
  | { requestId: string; action: 'setVolume'; volume: number }; // 0..1
```

动作由主窗口现有的 provider-aware 控制器执行。Connect、Spotify 和本地播放继续使用各自原有控制面；v2 不会绕过它们直接操作 AudioSession。

## 实时事件

原生 HTTP 客户端可以直接使用 bearer token 连接 `/events`。浏览器 `EventSource` 不能设置 Authorization header，应先取得 60 秒 ticket：

```http
POST /echo-link/v2/events/ticket
Authorization: Bearer <accessToken>
```

返回：

```json
{
  "ticket": "...",
  "eventsUrl": "/echo-link/v2/events?ticket=...",
  "expiresAt": "2026-07-17T12:00:00.000Z"
}
```

ticket 绑定客户端和来源 IP。它只用于建立 SSE，不是 access token。SSE 连接：

```http
GET /echo-link/v2/events?ticket=...
Accept: text/event-stream
```

- 首包总是完整 `snapshot`。
- 后续事件类型为 `playback.state.changed`、`playback.track.changed`、`playback.progress.changed`、`playback.volume.changed`、`playback.output.changed`。
- envelope 字段为 `version`、`id`、`type`、`occurredAt`、`snapshot`。
- 每 15 秒发送 SSE comment heartbeat。
- 不提供历史回放。断线后获取新 ticket、重新连接，并以新的首包 snapshot 重新同步。
- 每个客户端最多四条并发 SSE。

## CORS、限流与兼容性

- v2 支持 `OPTIONS` 预检，允许 `Authorization` 和 `Content-Type`。
- 配对失败/尝试按来源 IP 限流；播放动作按客户端限流。
- v1 与 v2 共用端口和 mDNS owner，但启用状态彼此独立。关闭 Basic 不会关闭正在使用的 v1，反之亦然。
- v1 的 Pro gate、全局 token、URL、曲库、队列、媒体和 web control 行为保持不变。

最小 Node 参考实现见 [`examples/echo-link-v2-client.mjs`](../examples/echo-link-v2-client.mjs)。
