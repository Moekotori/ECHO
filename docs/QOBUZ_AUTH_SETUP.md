# Qobuz 认证配置教程

ECHO 通过 `user_auth_token` 接入 Qobuz API，不内置公共凭据。每个用户需要从 Qobuz 网页端获取自己的 token，粘贴到 ECHO 设置中。

## 需要准备

- Qobuz Studio 或 Sublime 订阅（免费账户不支持串流播放）。
- 可访问 play.qobuz.com。
- 一个已登录 Qobuz 的浏览器。

## 获取 user_auth_token

1. 浏览器打开 <https://play.qobuz.com>，登录你的 Qobuz 账号。
2. 播放任意一首歌曲（这一步必须——token 仅在播放请求中出现）。
3. 按 `F12` 打开开发者工具，切换到 `Network`（网络）面板。
4. 在筛选框中输入 `getFileUrl` 或 `track`。
5. 点击任意一个 `track` 或 `fileUrl` 请求。
6. 在右侧 `Headers`（请求标头）中找到 `X-User-Auth-Token`。
7. 右键复制其值（一长串字符串）。

## 在 ECHO 里填写

1. 打开 ECHO 设置 → `集成` → 找到 `Qobuz` 卡片。
2. 将复制的 `X-User-Auth-Token` 粘贴到输入框中。
3. 点击 `验证并登录`。
4. 系统会自动提取 `app_id` 和 `app_secret`（从 Qobuz web bundle 中解析）。
5. 认证成功后，卡片显示已连接及订阅等级。

## 凭据存储

- `user_auth_token`、`app_id`、`app_secret` 加密存储在 `accounts.json` 中。
- 重启 ECHO 后自动恢复，无需重新输入。
- Token 约 30 天过期，过期后需要重新获取并粘贴。（未验证）


## 常见问题

### 验证失败：Token 验证失败

可能原因：
- Token 已过期（约 30 天），重新从浏览器获取。
- 网络无法访问 `api.qobuz.com`，检查代理设置。
- Token 复制不完整，确保复制了完整的值。

### Qobuz 免费账户不支持串流播放

当前 Qobuz 账户不是 Studio 或 Sublime 订阅。免费账户不提供 API 串流能力，请升级订阅。

### 无法自动获取 app_id

可能原因：
- 网络无法访问 `play.qobuz.com`，检查代理设置。
- Qobuz 更新了网页结构，暂不支持自动提取。

处理方式：在 qobuz-dl 目录运行 `qobuz-dl -r` 手动获取。

### Streaming 页面仍然显示未登录

认证成功后，设置页显示已连接但 Streaming 页显示未登录。切换到其他页面再切回 Streaming，或等待最多 30 秒（provider 列表缓存过期）。

### 能不能下载 Qobuz 音频

当前下载功能受 ECHO Pro 权益门控。Qobuz 下载服务的代码已就绪，待开放后即可使用。

## 参考

- <https://play.qobuz.com>
- 本项目 `qobuz-dl/` 目录中的 Qobuz 下载器工具及文档
