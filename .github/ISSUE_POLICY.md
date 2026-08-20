# ECHO Issue 规范

提 Issue 前先读完这一页。下面几条仍然适用，但**自动关闭故意留得很保守**，避免把正常 bug 误关掉。

1. **提 Issue 前请先给本仓库点公开 Star。** 检测不到公开 Star 时会自动关闭；若你只是隐藏了 Star 列表，评论说明即可。
2. **无权反馈流媒体问题。** 只有明显在要第三方平台登录 / 解析 / 下载时才会自动关闭。随口提到网易云、本地文件来源等，不会关。
3. **禁止许愿奇葩功能，也不要骂人。** 自动关闭只打明确辱骂；离谱许愿由维护者人工处理。

漏勾选模板、没写完整、语气一般，都**不会**因此自动关闭。被误关的 Issue 不会锁评论，维护者可以重开。

维护者、有写权限的协作者不受这条自动关闭约束。打上 `policy-exempt` 也会跳过。

## 必须先 Star

- 先点仓库右上角 Star，再开 Issue。
- Star 必须是公开的。如果开了 Private starring / 隐藏 Star 列表，检查会当成没点，Issue 仍会被关。
- 关掉后再去补 Star 不会自动重开。请 Star 之后用正确模板重新开一个。

## 流媒体相关

ECHO Community 是本地优先的播放器。下面这些**明确在要平台能力**的内容会自动关闭：

- 请支持 / 登录 / 解析 / 下载 网易云、QQ 音乐、Spotify、YouTube Music 等
- yt-dlp、歌单下载、导入 Cookie

只是说「歌是从网易云下到本地的，本地播放有问题」，不会自动关。

这些**不算**流媒体，可以正常开 Issue：

- 本地文件、曲库、扫描、标签、封面、歌词、桌面体验
- WASAPI / ASIO / DSP / SRC / SDM / DSD
- 用户自己的 WebDAV / SMB / Jellyfin / Emby / Subsonic / Navidrome / 网盘

## 找茬和奇葩许愿

明确辱骂（例如骂项目是垃圾软件、对维护者人身攻击）会自动关闭。

阴阳怪气、离谱许愿、空喊「希望支持某功能」由维护者人工看，不当做关键词一律关闭。

作者吃软不吃硬：带着复现步骤、日志和正常语气来，会认真看。

## 还要遵守的提交方式

- 尽量使用「错误报告」或「功能请求」模板。
- 尽量勾选规范确认项，但不勾选不会自动关。
- 先确认最新版本、文档和已有 Issue。
- 不要提交账号、令牌、Cookie、本机隐私路径或其他敏感信息。

## 自动关闭后怎么办

| 原因 | 你该做什么 |
| :--- | :--- |
| 没公开 Star | 公开 Star 后重开；若已 Star 只是隐藏列表，直接评论 |
| 明确的流媒体功能请求 | 不要再开。本地播放问题请评论说明来源 |
| 明确辱骂 | 换正常语气后重开 |

被规范关闭的 Issue 会加 `policy-closed` 标签，**不会锁定评论**。误判时请留言，或请维护者加上 `policy-exempt` 后重开。

英文说明见 [English](#issue-policy)。

---

## Issue Policy

The bot is conservative to avoid false positives:

1. **Star this repository publicly before opening an issue.** Hidden star lists can look like “not starred”; comment and a maintainer can reopen.
2. **Clear third-party streaming feature requests are not accepted.** Saying a local file came from NetEase is not enough to close.
3. **Clear abuse is closed.** Bizarre wishes are handled by humans, not keyword bans.

Missing checkboxes do not auto-close. Closed issues are not locked.

Maintainers and collaborators with write access are exempt. Add `policy-exempt` to skip the bot.

Local files, library, lyrics, WASAPI / ASIO / DSP, and user-owned remote libraries (WebDAV, Jellyfin, Navidrome, and similar) stay in scope.
