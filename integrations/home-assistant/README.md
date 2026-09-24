# ECHO NEXT for Home Assistant

这个目录提供 ECHO NEXT 的 Home Assistant 自定义集成。它把 ECHO 映射为原生
`media_player`，但不会在 Home Assistant 中复制播放引擎或推测播放状态。

## 前置条件

1. Home Assistant 已配置 MQTT integration。
2. ECHO 与 Home Assistant 连接到同一个可信 MQTT broker。
3. ECHO“设置 → 集成 → MQTT 智能家居联动”已经启用。
4. 记下 ECHO MQTT 面板中的 `deviceId` 和 Topic 前缀。

## 手动安装

将：

```text
integrations/home-assistant/custom_components/echo_next
```

完整复制到 Home Assistant 配置目录：

```text
<HA config>/custom_components/echo_next
```

然后：

1. 重启 Home Assistant。
2. 打开“设置 → 设备与服务 → 添加集成”。
3. 搜索 `ECHO NEXT`。
4. 填入 ECHO 显示的设备 ID、Topic 前缀和想在 HA 中显示的设备名称。

## 原生 media_player 能力

- 实时播放 / 暂停 / 缓冲 / 空闲状态。
- 当前曲目、艺术家、专辑和时长。
- 播放进度。
- 音量读取与设置。
- 播放、暂停、停止、上一首、下一首、Seek。
- MQTT / ECHO 离线时实体自动变为 unavailable。

所有属性来自 ECHO 发布的 host-owned snapshot。实体属性只读内存，不在属性 getter 中发起网络请求。

## 命令确认

Home Assistant 不做 optimistic playback：

1. 集成为每次服务调用生成唯一 `requestId`。
2. 发布到 `echo/<deviceId>/command`。
3. 等待 `echo/<deviceId>/result/<clientId>/<requestId>`。
4. 只有收到 `ok: true` 才完成服务调用。
5. ECHO 拒绝、离线或八秒超时会在 Home Assistant 中返回失败。

## 安全边界

- 只使用 Home Assistant 已配置的 MQTT broker，不保存第二份 broker 密码。
- 不订阅文件路径、账号 Token、Cookie、封面文件或原始媒体。
- 建议 broker ACL 仅允许这个 Home Assistant 用户读取 `echo/<deviceId>/state`、
  `event`、`availability`、对应 `result`，并写入 `command`。
- 不要把 broker 或 ECHO Link 端口直接暴露到公网。

## 本地测试

不需要安装完整 Home Assistant：

```powershell
python -m unittest discover -s integrations/home-assistant/tests -p "test_*.py"
```

这组测试覆盖协议校验、命令/回执关联、拒绝结果、断线失败、不可用保护和订阅清理。
完整实机验收仍需真实 Home Assistant + Mosquitto 环境。
