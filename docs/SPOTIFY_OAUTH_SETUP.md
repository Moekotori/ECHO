# Spotify OAuth 配置教程

ECHO 不内置公共 Spotify Client ID。每个用户需要准备自己的 Spotify Developer App，然后把 Client ID 填到 ECHO。

## 需要准备

- Spotify Premium 账号。
- 可访问 Spotify Developer Dashboard。
- 只需要 Client ID，不要填写、保存或分享 Client Secret。
- ECHO 设置页显示的 Redirect URI，默认是：

```text
http://127.0.0.1:43879/spotify/callback
```

## 创建 Spotify App

1. 打开 <https://developer.spotify.com/dashboard>。
2. 登录你的 Spotify 账号。
3. 创建一个 App。
4. 在 App 的 Settings 里找到 Client ID。
5. 在 Redirect URIs 里添加 ECHO 显示的 Redirect URI。
6. 保存设置。

## 在 ECHO 里填写

1. 打开 ECHO 设置。
2. 进入 `集成`。
3. 找到 `Spotify OAuth 配置`。
4. 填入 Spotify Dashboard 里的 `Client ID`。
5. `Redirect URI` 保持和 Spotify Dashboard 里注册的一致。
6. 点击 `保存 Spotify 配置`。
7. 回到 Spotify 账号卡片，点击登录。

登录会打开系统默认浏览器。如果浏览器里已经登录 Spotify，通常不需要再输入密码。

## Development Mode 限制

新建 Spotify App 通常处于 Development Mode。这个模式有几个限制：

- App 拥有者需要 Premium。
- 只有被加入该 App 用户名单的 Spotify 账号可以正常使用 API。
- 未加入用户名单时，用户可能能完成登录，但后续请求会失败，常见错误是 `The user is not registered for this application`。

如果只是自己使用，创建自己的 App 后用自己的账号登录即可。  
如果要给少量测试用户使用，需要在 Spotify Dashboard 的 Users Management 里添加他们的 Spotify 邮箱。  
如果要公开给大量用户，需要申请 Spotify Extended Quota。

## 常见问题

### The user is not registered for this application

当前登录的 Spotify 账号没有被加入这个 Client ID 对应 App 的用户名单。

处理方式：

- 用自己的 Spotify App Client ID 登录。
- 或让 App 拥有者在 Spotify Dashboard > Users Management 添加你的 Spotify 邮箱。

### INVALID_CLIENT: Invalid redirect URI

ECHO 里的 Redirect URI 和 Spotify Dashboard 里注册的不一致。

处理方式：

- 两边必须完全一致。
- 建议直接使用默认值：`http://127.0.0.1:43879/spotify/callback`。

### Spotify Premium or regional permission is required

可能原因：

- 当前 Spotify 账号不是 Premium。
- 当前地区不能播放该内容。
- Spotify Connect / Web Playback SDK 当前不可用。

### 能不能下载 Spotify 音频

不能。ECHO 的 Spotify 接入只走官方 OAuth、Web API、Web Playback SDK / Spotify Connect，不提供可下载音频 URL，也不会进入 ECHO native audio 解码路径。

## 参考

- <https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow>
- <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>
- <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>
