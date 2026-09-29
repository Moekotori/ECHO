# ECHO MQTT / Home Assistant / Node-RED 联动

## 当前能力

ECHO 的 MQTT adapter 运行在主进程，并严格复用统一联动底座：

```text
Audio Host truth
  -> IntegrationEventHub
  -> MqttIntegrationAdapter
  -> MQTT broker

MQTT command
  -> MqttIntegrationAdapter
  -> IntegrationActionRouter
  -> provider-aware PlaybackCommandController
```

MQTT adapter 不直接订阅 `AudioSession`，不操作 native Audio Host，也不读取媒体文件。

设置入口位于“设置 → 集成 → MQTT 智能家居联动”。功能默认关闭。

## Broker 设置

支持：

- `mqtt://`
- `mqtts://`
- `ws://`
- `wss://`
- MQTT v5
- 用户名和密码认证
- Home Assistant MQTT Device Discovery

Broker URL 不允许内嵌用户名或密码。密码单独保存在
`mqtt-credentials.json` 的 Electron `safeStorage` 加密信封中；如果当前系统安全存储不可用，
ECHO 会拒绝保存密码，不会退化成明文或 Base64。

建议为 ECHO 创建单独的 broker 用户，并通过 ACL 只允许访问：

```text
echo/<deviceId>/#
homeassistant/device/<deviceId>/config
homeassistant/status
```

## Topic 契约

默认根 topic：

```text
echo/<deviceId>
```

完整 topic：

```text
echo/<deviceId>/state
echo/<deviceId>/event
echo/<deviceId>/command
echo/<deviceId>/result/<clientId>/<requestId>
echo/<deviceId>/availability
```

### state

保留消息。新订阅者可以立即取得当前播放快照。

```json
{
  "version": 1,
  "revision": 18,
  "observedAt": "2026-07-28T01:20:00.000Z",
  "state": "playing",
  "track": {
    "id": "track-1",
    "title": "Example",
    "artist": "Artist",
    "album": "Album",
    "albumArtist": "Artist"
  },
  "positionMs": 42000,
  "durationMs": 180000,
  "volume": 0.5,
  "output": {
    "mode": "shared",
    "deviceName": "Speakers",
    "backend": "wasapi"
  }
}
```

不会包含：

- `artworkUrl`
- 本地文件路径
- provider access token
- Cookie / Authorization
- 原始音频或封面

### event

非保留消息，结构为 `IntegrationEventEnvelopeV1` 的安全映射。事件类型包括：

- `snapshot`
- `playback.state.changed`
- `playback.track.changed`
- `playback.progress.changed`
- `playback.volume.changed`
- `playback.output.changed`

### command

命令必须是 JSON、`version` 必须为 `1`，并同时携带稳定的客户端身份和本次请求 ID：

```json
{
  "version": 1,
  "clientId": "node-red-living-room",
  "requestId": "scene-evening-0001",
  "action": "play"
}
```

支持动作：

```json
{ "version": 1, "clientId": "node-red", "requestId": "1", "action": "play" }
{ "version": 1, "clientId": "node-red", "requestId": "2", "action": "pause" }
{ "version": 1, "clientId": "node-red", "requestId": "3", "action": "stop" }
{ "version": 1, "clientId": "node-red", "requestId": "4", "action": "previous" }
{ "version": 1, "clientId": "node-red", "requestId": "5", "action": "next" }
{ "version": 1, "clientId": "node-red", "requestId": "6", "action": "seek", "positionMs": 60000 }
{ "version": 1, "clientId": "node-red", "requestId": "7", "action": "setVolume", "volume": 0.35 }
{ "version": 1, "clientId": "node-red", "requestId": "8", "action": "setPlaybackOrder", "mode": "shuffle" }
```

`requestId` 在同一 `clientId` 下五分钟内去重。默认每个客户端十秒最多接受 20 条命令。

### result

每条命令都会发布关联结果：

```json
{
  "version": 1,
  "requestId": "scene-evening-0001",
  "clientId": "node-red-living-room",
  "ok": true,
  "completedAt": "2026-07-28T01:20:01.000Z"
}
```

失败时 `ok` 为 `false`，并带稳定错误码，例如：

- `duplicate_request_id`
- `command_rate_limited`
- `invalid_volume`
- `unsupported_playback_action`

### availability

保留消息，值为 `online` 或 `offline`。MQTT Last Will 会在 ECHO 异常断线时发布 `offline`。

## Home Assistant

截至 Home Assistant 2026.7，官方 MQTT Discovery 支持列表不包含 `media_player`：

- https://www.home-assistant.io/integrations/mqtt/
- https://www.home-assistant.io/integrations/button.mqtt/
- https://www.home-assistant.io/integrations/number.mqtt/
- https://www.home-assistant.io/integrations/sensor.mqtt/

因此当前 adapter 使用官方支持的 Device Discovery，在一个 ECHO 设备下创建：

- 播放状态 sensor
- 正在播放 sensor
- 音量 number
- 播放 / 暂停 / 停止 / 上一首 / 下一首 button

Discovery 配置是保留消息。adapter 也订阅 `homeassistant/status`，Home Assistant 启动并发布
`online` 后会重新发送 Discovery 和最新状态。

原生单一 `media_player` 自定义集成已经放在：

```text
integrations/home-assistant/custom_components/echo_next
```

它仍然复用本文定义的 MQTT topic，不改变 ECHO 的 Audio Host / EventHub / ActionRouter 边界。
状态属性只映射 ECHO 的 retained snapshot；播放控制会等待关联的 `result` 回执，不做 optimistic
成功推断。安装步骤见 `integrations/home-assistant/README.md`。

## Node-RED

Node-RED 使用内置 MQTT Input / MQTT Output 节点即可：

1. MQTT Input 订阅 `echo/<deviceId>/event` 或 `echo/<deviceId>/state`。
2. Function 节点根据场景生成包含 `version`、`clientId`、唯一 `requestId` 和 `action` 的 JSON。
3. MQTT Output 发布到 `echo/<deviceId>/command`。
4. 另一个 MQTT Input 订阅 `echo/<deviceId>/result/+/+`，确认动作是否完成。

Node-RED 官方 MQTT broker 连接说明：
https://cookbook.nodered.org/mqtt/connect-to-broker

## 实机验收

只做 focused 验证，不运行 native audio-host 全量测试：

1. 在可信局域网启动 Mosquitto。
2. ECHO 设置中填写 broker、独立用户名和密码，保存后启用 MQTT。
3. 确认状态为“已连接”，订阅 `echo/<deviceId>/#`。
4. 播放本地、Spotify、Connect 各一首，确认 state/event 不出现文件路径或 token。
5. 从 Node-RED 发送 play、pause、next、seek、setVolume，确认 result 与 ECHO 实际行为一致。
6. 重复同一 `clientId + requestId`，确认返回 `duplicate_request_id` 且不重复执行。
7. 启用 Home Assistant Discovery，确认一个 ECHO 设备及其 sensor/number/button 全部出现。
8. 重启 Home Assistant，确认 birth 消息触发 Discovery 与状态重发。
9. 关闭 ECHO 或断网，确认 availability 变为 `offline`。
10. 安装 ECHO NEXT 自定义集成，确认出现一个原生 `media_player`。
11. 从 HA 调用播放、暂停、停止、上下首、Seek、音量，确认服务调用等待 ECHO result。
12. 临时关闭 ECHO MQTT，确认 HA 实体变为 unavailable 且控制调用明确失败。
