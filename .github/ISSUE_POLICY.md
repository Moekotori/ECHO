# ECHO Issue 规范

提 Issue 前先读完这一页。下面三条是硬规则，**不遵守会自动关闭，并且不会回复**。

1. **提 Issue 前必须先给本仓库点 Star**，而且必须公开可见。
2. **无权反馈流媒体问题。** 第三方音乐平台相关内容不回复，Issue 会直接关掉。
3. **禁止许愿奇葩功能。** 找茬、嘲讽、发泄、离谱许愿不回复，Issue 会直接关掉。

维护者、有写权限的协作者不受这条自动关闭约束。

## 必须先 Star

- 先点仓库右上角 Star，再开 Issue。
- Star 必须是公开的。如果开了 Private starring / 隐藏 Star 列表，检查会当成没点，Issue 仍会被关。
- 关掉后再去补 Star 不会自动重开。请 Star 之后用正确模板重新开一个。

## 流媒体相关一律关闭

ECHO Community 是本地优先的播放器。下面这些内容会被当成流媒体相关并自动关闭：

- 网易云、QQ 音乐、酷狗、酷我、汽水、咪咕、Spotify、YouTube / YouTube Music、SoundCloud、Tidal、Qobuz、Apple Music、Deezer、Bilibili / B 站等平台的搜索、登录、Cookie、解析、在线播放或下载
- yt-dlp、歌单下载、扫码登录、导入 Cookie、绕过平台限制
- 要求回复、支持或讨论上述能力

这些**不算**流媒体，可以正常开 Issue：

- 本地文件、曲库、扫描、标签、封面、歌词、桌面体验
- WASAPI / ASIO / DSP / SRC / SDM / DSD
- 用户自己的 WebDAV / SMB / Jellyfin / Emby / Subsonic / Navidrome / 网盘

## 找茬和奇葩许愿一律关闭

下面这些会被当成找茬或离谱许愿并自动关闭：

- 人身攻击、辱骂、阴阳怪气、纯发泄
- 空喊“垃圾 / 骗子 / 骗钱 / 割韭菜 / 一眼 AI”，没有可复现的问题
- 为骂而骂、为抬杠而抬杠，而不是报告缺陷或提出可执行的功能请求
- 和 ECHO 主线无关的奇葩许愿、整活需求、纯玩梗功能请求

作者吃软不吃硬：带着复现步骤、日志和正常语气来，会认真看。用喷人的语气来，Issue 会被关掉，也不会回复。

## 还要遵守的提交方式

- 使用「错误报告」或「功能请求」模板，中英文都可以。
- 不要删改规范确认项。
- 提交前把模板里的规范复选框勾上。
- 先确认最新版本、文档和已有 Issue。
- 不要提交账号、令牌、Cookie、本机隐私路径或其他敏感信息。

## 自动关闭后怎么办

| 原因 | 你该做什么 |
| :--- | :--- |
| 没公开 Star | 公开 Star 后，用正确模板重开 |
| 流媒体相关 | 不要再开。这类内容不会被回复 |
| 找茬 / 语气不当 | 不要再开。冷静后如有真实缺陷，用正常语气重开 |
| 没用规定模板 | 换错误报告或功能请求模板重开 |

被规范关闭的 Issue 会加 `policy-closed` 标签并锁定评论。

英文说明见 [English](#issue-policy)。

---

## Issue Policy

Issues that break these rules are closed automatically and will not receive a reply:

1. **Star this repository publicly before opening an issue.**
2. **Streaming / third-party music-platform topics are not accepted.**
3. **Bizarre feature wishes, nitpicking, mockery, and venting are not answered.**

Maintainers and collaborators with write access are exempt.

Stars must be public. Hidden star lists fail the check. Fixing a closed issue will not reopen it; open a new one with the correct template after you comply.

Local files, library, lyrics, WASAPI / ASIO / DSP, and user-owned remote libraries (WebDAV, Jellyfin, Navidrome, and similar) are in scope. NetEase, QQ Music, Spotify, YouTube, yt-dlp, cookie import, QR login, and playlist ripping are not.
