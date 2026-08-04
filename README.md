<p align="center">
  <a href="https://echonext.moe/zh/">
    <img src="https://echonext.moe/assets/product/brand-art-1200.webp" width="880" alt="ECHO NEXT" />
  </a>
</p>

<h1 align="center">ECHO NEXT</h1>

<p align="center">
  <strong>为本地音乐而生的桌面播放器</strong><br />
  专注曲库管理、稳定播放、HiFi 输出与长期使用体验
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-actively%20maintained-7c5cff?style=flat-square" />
  <img alt="Development" src="https://img.shields.io/badge/development-reopening%20source-22c55e?style=flat-square" />
  <img alt="Focus" src="https://img.shields.io/badge/focus-local%20music%20%26%20HiFi-0ea5e9?style=flat-square" />
</p>

<p align="center">
  <a href="https://github.com/Moekotori/ECHO/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/Moekotori/ECHO/total?style=flat-square&logo=github&label=downloads&color=22c55e" />
  </a>
  <a href="https://github.com/Moekotori/ECHO">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/Moekotori/ECHO?style=flat-square&logo=github&label=stars&color=fbbf24" />
  </a>
</p>

<p align="center">
  <a href="./README_EN.md">English</a>
  ·
  <a href="https://echonext.moe/zh/">官方网站</a>
  ·
  <a href="https://echonext.moe/zh/download/">下载 ECHO NEXT</a>
  ·
  <a href="https://echonext.moe/zh/docs/">使用文档</a>
  ·
  <a href="https://echonext.moe/zh/changelog/">更新日志</a>
  ·
  <a href="https://github.com/Moekotori/ECHO/issues">问题反馈</a>
</p>

---

## 关于 ECHO 重新开源

前段时间，我们曾迫不得已将 ECHO 闭源。

在此之前，项目维护者遭到某位用户持续数月的辱骂与精神压迫，仓库也曾两次遭到破坏。与此同时，甚至有人指责我们开源是为了“骗钱”。这些事情让我们非常心寒，也让原本单纯的开源与分享变成了沉重的负担，因此我们一度选择关闭源码，保护项目和维护者。

但现在，我们改变主意了。

我们仍然相信开源、分享和社区的价值，也不希望少数人的恶意让所有真正喜欢 ECHO、愿意使用和共同建设它的人失去参与的机会。因此，**ECHO 将重新面向大家开源**。源码、开发文档和贡献方式会逐步整理并恢复到公开仓库。

### 给开发者的话

欢迎开发者参考、学习和借鉴 ECHO 的设计思路与实现。如果 ECHO 对你的项目有所帮助，我们希望你能在项目、文档或相关页面中注明来源并提及 ECHO。即使没有注明，我们现实中也很难逐一追究，但对来源的尊重会让开源社区变得更好。具体使用、复制和分发仍请遵守仓库中的许可证。

同时请注意：**任何大型 PR 都不会被合并。** 如果你希望参与贡献，请先通过 Issue 沟通，并将改动拆分成范围清晰、容易审查和验证的小型 PR。

感谢每一位善意使用、认真反馈、帮助测试和参与贡献的朋友。希望这一次，我们可以一起让 ECHO 走得更远。

## ECHO 即将上架 Steam

ECHO 要上架 Steam 啦！

在 **2026 年 8 月 15 日前**购入 ECHO Pro，可享受以下权益：

- 免费获得 Steam CD Key；
- 加入 ECHO 贡献者名单；
- 支付邮费即可获赠 ECHO 周边。

购买地址：[爱发电 ECHO NEXT](https://www.ifdian.net/a/echonext)

大家想要什么功能，也欢迎填写 [ECHO 许愿池](https://docs.qq.com/form/page/DYkt1UVNuaEpHcFB5)，告诉我们你的想法。

---

## 认识 ECHO NEXT

ECHO NEXT 是面向本地大曲库、原生音频输出和专业 DSP 打造的桌面音乐播放器。它不是在线音乐平台的桌面套壳，也不满足于“文件能响”：从扫描、标签、封面和播放队列，到 PCM、DSP、设备选择与输出状态，每一层都围绕长期持有自己的音乐收藏而设计。

| LOCAL LIBRARY | DSP CENTER | NATIVE OUTPUT |
| :--- | :--- | :--- |
| 文件夹扫描、SQLite 曲库、标签、封面、专辑墙与播放列表 | 参数 EQ、Headroom、FIR、OPRA、声道工具与输出安全 | WASAPI Shared / Exclusive、ASIO、DSD / DoP 与 HQPlayer |

> [!IMPORTANT]
> ECHO NEXT 已决定重新开源。源码、协作说明与许可安排会逐步恢复到公开仓库；在相关内容正式发布前，请仍以仓库当前文件和许可证为准。

## ECHO Audio Engine

ECHO NEXT 不把高级音频能力藏在一个“音质增强”开关后面。当前输入、处理模块、采样率变化、输出模式、设备状态、bit-perfect 候选状态和 fallback 原因都应该能被用户看见。

```text
LOCAL FILE / REMOTE SOURCE
            |
         DECODE
            |
           PCM
            |
 ReplayGain / Headroom / EQ / FIR / Channel Tools
            |
   ECHO SRC or ECHO SDM when explicitly enabled
            |
 WASAPI Shared / Exclusive / ASIO / HQPlayer
            |
           DAC
```

高级处理可以逐层开启，也可以完整旁路。想调音时，ECHO 告诉你声音经过了什么；想验证原始输出时，ECHO 尽量回到清晰的 native direct path。

## DSP Center

DSP Center 不是几个孤立的 EQ 滑杆，而是一张可读、可调、可关闭的数字信号工作台。

<p align="center">
  <img src="https://echonext.moe/assets/product/dsp-center-eq.webp" width="49%" alt="ECHO NEXT DSP Center 参数 EQ" />
  <img src="https://echonext.moe/assets/product/dsp-center-headphone.webp" width="49%" alt="ECHO NEXT DSP Center OPRA 耳机校正" />
</p>

<p align="center">
  <img src="https://echonext.moe/assets/product/dsp-center-fir.webp" width="49%" alt="ECHO NEXT DSP Center FIR 房间校正" />
  <img src="https://echonext.moe/assets/product/dsp-center-channel.webp" width="49%" alt="ECHO NEXT DSP Center 声道工具" />
</p>

| 模块 | 能力 |
| :--- | :--- |
| Parametric EQ | Simple 模式快速塑造 Bass、Vocal、Air、Warm；Pro 模式保留频率、增益、Q 值与 Preamp 精调 |
| Headroom / Output Safety | Auto Gain、前级余量、削波风险和输出安全状态进入同一套工作流 |
| OPRA Headphone Correction | 按品牌和型号选择耳机校正曲线，并保留 A/B 与旁路判断 |
| FIR / Room Correction | 导入 IR，管理 Trim、延迟和卷积处理前后的安全余量 |
| Channel Tools | 左右声道增益、平衡、延迟差、Mono 与声道交换 |
| APO Import / Export | 连接已有 Equalizer APO 配置与 ECHO 的 DSP 工作流 |

只要 EQ、FIR、ReplayGain、声道工具或重采样真正参与处理，状态就会明确离开 bit-perfect 候选路径。关闭并完成 bypass 后，在没有其他处理或输出 mismatch 的前提下，才会恢复候选状态。这里没有“开着 DSP 却假装直通”的模糊空间。

[阅读 DSP 新手教程](https://echonext.moe/zh/docs/audio-output/dsp-beginner/) · [阅读 EQ 指南](https://echonext.moe/zh/docs/audio-output/eq/)

## PCM 与 ECHO SRC

ECHO SRC 是当前已经提供的本机 PCM 采样率转换链路。它按照 44.1 kHz 与 48 kHz 两个采样率家族规划目标，不把所有音频粗暴塞进同一个固定输出格式。

```text
PCM INPUT
    |
ECHO FIR / SAMPLE RATE CONVERSION
    |
2x PCM / 4x PCM / 8x Ultra
    |
WASAPI EXCLUSIVE or OFFICIAL ASIO
    |
DAC
```

| 维度 | ECHO SRC |
| :--- | :--- |
| 倍率 | 2x PCM、4x PCM、8x Ultra；源采样率已经达到目标时可以旁路 |
| 质量策略 | Balanced、Transparent、Low latency |
| 滤波与精度 | 普通模式提供可靠起点，高级模式开放 Filter、Quality Ladder、Dither 与 Noise Shaping |
| 计算路径 | CPU 为基础路径，支持在条件满足时尝试 CUDA，并显示 active / fallback 状态 |
| 状态反馈 | 显示源采样率、目标采样率、引擎、质量策略、精度与当前路径 |
| 输出要求 | 验证升频时使用 WASAPI Exclusive 或 DAC 厂商官方 ASIO，并由真实 DAC 状态确认结果 |

升频会重新计算 PCM 采样点，因此不是严格 bit-perfect。它不会创造源文件里不存在的信息，也不是“倍率越高就越高级”；真正有价值的是算法、算力、驱动、DAC 和整条链路能够长期稳定地工作。

[了解 ECHO SRC 与安全升频](https://echonext.moe/zh/docs/audio-output/upsampling/)

## SDM 与 ECHO Audio Lab

> [!NOTE]
> ECHO SDM 当前属于研发预览。它是独立于 PCM 升频和原生 DSD 直出的实验链路，不应被理解为所有设备上默认可用的正式能力。

ECHO SDM 探索的是从 PCM 到 Sigma-Delta Modulation 的完整处理路径：

```text
PCM INPUT
    |
OVERSAMPLING / FIR
    |
SIGMA-DELTA MODULATION
    |
NOISE SHAPING
    |
DSD / SDM OUTPUT FOR A SUPPORTED DAC
```

这条链路组合过采样、滤波、调制与噪声整形，并探索 CPU / CUDA 计算路径。设计重点不是让界面亮起一个更大的数字，而是让设备匹配、实时状态、失败原因和安全回退保持可见。基础 PCM 播放不稳定时，高级链路应当关闭；设备或驱动不满足条件时，不会把 fallback 伪装成 SDM 已生效。

[查看 ECHO Pro 技术预览](https://echonext.moe/zh/pro/)

## PCM、SRC、SDM 与 DSD，不是一回事

| 路径 | 输入 | 发生了什么 | 输出目标 |
| :--- | :--- | :--- | :--- |
| Native PCM | PCM | 不启用额外 DSP 时尽量保持直接输出 | PCM DAC path |
| ECHO SRC | PCM | FIR 与采样率转换，生成新的 PCM 采样点 | 更高采样率 PCM |
| ECHO SDM | PCM | 过采样、滤波、Sigma-Delta 调制与噪声整形 | 支持设备上的 DSD / SDM，研发预览 |
| DSD Direct | DSF / DFF | 通过 DoP 封装或厂商官方 ASIO Native DSD 传输 | DAC 的 DSD 接收路径 |

ECHO NEXT 会把这四条路径分开表达。PCM 升频不冒充 DSD，PCM→SDM 不冒充原生 DSD 文件直出，界面显示 ASIO 也不等于 DAC 一定收到了 Native DSD。

## 原生输出与设备链路

| 输出方式 | 适合场景 | 边界 |
| :--- | :--- | :--- |
| System / WASAPI Shared | 日常稳定播放、蓝牙、系统混音与快速排障 | 最兼容，但最终格式可能由系统混音器决定 |
| WASAPI Exclusive | 绕开共享混音、按曲目或 DSP 目标打开 DAC | 设备会被独占，更依赖驱动和 DAC 能力 |
| ASIO | 厂商官方驱动、专业声卡、低延迟与 Native DSD 场景 | 不把 ASIO4ALL 等包装层等同于厂商原生能力 |
| DSD over PCM | 让支持 DoP 的 DAC 从 PCM 外观帧中还原 DSD | 链路不能对承载数据做音量、混音或重采样 |
| ASIO Native DSD | 向明确支持的 DAC 传递原生 DSD | 属于实验能力，需要厂商官方驱动与严格音量安全 |
| HQPlayer | 将曲库和播放控制交给 ECHO，高阶滤波与调制交给专用引擎 | 实际能力取决于 HQPlayer、NAA、DAC 与网络链路 |

DSD 播放时，数字音量、EQ、ReplayGain 和普通 PCM DSP 会破坏直出目标。ECHO 因此强调满刻度数字音量、DAC 或前级控制实际响度、官方驱动、真实设备指示和明确回退，而不是只看软件里有没有“DSD”三个字。

[阅读 DSD 播放教程](https://echonext.moe/zh/docs/audio-output/dsd/) · [比较 WASAPI Exclusive 与 ASIO](https://echonext.moe/zh/docs/audio-output/asio-vs-exclusive/)

## 音频之外，仍然是一台完整的音乐播放器

| 能力层 | 功能范围 |
| :--- | :--- |
| 本地曲库 | 文件夹导入、SQLite 曲库、标签读取、封面缓存、专辑、艺术家、收藏、历史、播放列表与重复歌曲筛选 |
| 歌词与 MV | 本地与在线候选、翻译、罗马音、歌词偏移、桌面歌词、沉浸播放页与 MV 匹配 |
| 远程来源 | WebDAV、SMB、Jellyfin、Emby、Subsonic、Navidrome 与受控的远程索引和播放 |
| 插件扩展 | 插件、下载器、网络元数据与后台任务运行在清晰的权限和诊断边界内 |
| 长期维护 | 日志、崩溃恢复、曲库健康、缓存迁移、设置备份和危险操作确认 |

## 快速入口

| 你想要…… | 前往 |
| :--- | :--- |
| 获取最新稳定版本 | [官方下载页](https://echonext.moe/zh/download/) · [GitHub Releases](https://github.com/Moekotori/ECHO/releases/latest) |
| 第一次使用 ECHO NEXT | [使用文档](https://echonext.moe/zh/docs/) |
| 了解最近发生了什么 | [更新日志](https://echonext.moe/zh/changelog/) |
| 报告问题或提出建议 | [GitHub Issues](https://github.com/Moekotori/ECHO/issues) |
| 支持项目长期开发 | [ECHO Pro](https://www.ifdian.net/a/echonext) |
| 提交你期待的新功能 | [ECHO 许愿池](https://docs.qq.com/form/page/DYkt1UVNuaEpHcFB5) |
| 参与更深入的项目协作 | [ECHO Developer Plan](https://echonext.moe/zh/developer/) |

## 我们仍在持续更新

维护工作的重点会围绕真实使用体验持续推进：

- **曲库体验**：改善本地扫描、元数据、封面、管理与大曲库浏览体验；
- **播放稳定性**：继续处理播放链路、输出设备兼容和异常恢复问题；
- **音频能力**：打磨设备选择、HiFi 输出、DSP 与相关状态反馈；
- **桌面体验**：完善歌词、MV、系统媒体控制、界面细节和性能表现；
- **生态与服务**：继续维护插件、远程来源、Connect 与相关扩展能力；
- **长期维护**：根据用户反馈修复问题，并持续整理产品边界和维护节奏。

具体功能、发布时间和支持平台以[正式更新日志](https://echonext.moe/zh/changelog/)与发布说明为准。

## ECHO Pro

ECHO Pro 是面向长期支持者的进阶计划。你的支持会帮助 ECHO NEXT 持续维护、迭代和扩展，并用于支撑基础设施、测试设备、设计与长期开发投入。

Pro 权益、实验功能和可用范围可能随版本调整，请以官方页面显示的信息为准。

<p align="center">
  <a href="https://www.ifdian.net/a/echonext"><strong>支持 ECHO NEXT · 了解 ECHO Pro →</strong></a>
</p>

## ECHO Developer Plan

Developer Plan 面向愿意长期、认真参与 ECHO NEXT 建设的协作者。它不只招募代码贡献者：开发、设计、测试、文档、社区反馈和产品体验都可以成为参与方向。

| 方向 | 可以参与的内容 |
| :--- | :--- |
| 前端 / 交互 | 播放器界面、曲库、歌词、MV、设置与体验打磨 |
| 桌面 / 工程 | 桌面集成、数据管理、诊断、稳定性与平台适配 |
| 原生 / 音频 | 音频输出、设备兼容、性能、播放稳定性与验证 |
| 美术 / 视觉 | UI 视觉、图标、插画、动效与品牌素材 |
| 测试 / 文档 | 问题复现、版本验证、教程、反馈整理与文档维护 |

申请时建议准备 GitHub ID、联系方式、擅长方向，以及能够体现经验的项目或作品。参与资格会结合实际协作投入定期评估。

<p align="center">
  <a href="https://echonext.moe/zh/developer/"><strong>查看 Developer Plan 与申请方式 →</strong></a>
</p>

## 反馈问题

如果你遇到异常，请先确认正在使用最新版本，再通过 [GitHub Issues](https://github.com/Moekotori/ECHO/issues) 提交反馈。信息越完整，问题通常越容易被定位：

- ECHO NEXT 版本与下载渠道；
- 操作系统版本和设备信息；
- 清晰、可重复的操作步骤；
- 预期结果与实际结果；
- 必要的截图、日志或录屏。

提交前请移除账号、令牌、本机隐私路径和其他敏感信息。功能建议也欢迎通过 Issues 提出，但是否实现及具体排期以维护计划为准。

## License

在新的开源许可与源码正式发布前，本仓库当前材料仍受 [ECHO NEXT Source-Available License](./LICENSE) 约束；第三方材料仍遵循各自的许可条款。请在使用、转载或分发前阅读完整条款。

---

<p align="center">
  感谢每一位仍在使用、测试、反馈和支持 ECHO NEXT 的朋友。<br />
  <strong>项目会以新的方式，继续向前。</strong>
</p>
