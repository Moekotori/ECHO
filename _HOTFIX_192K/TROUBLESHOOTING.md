# 排查清单 —— 新版编出来了，但 DAC 还是 48k

跟着流程走，每一步都有具体诊断命令和"看到什么意味着什么"。

---

## 第 0 步：确认新二进制真的在跑

新版 `echo-audio-host.exe` 启动时会打印 `Ready: sr=… hw=… …`（多了个 `hw=` 字段）。老版本只有 `sr=…`。

```powershell
cd "D:\ECHO - 副本 (3) - 副本\electron-app\build"
.\echo-audio-host.exe -list      # 不需要看输出，只要它没崩
```

更直接的判断：

```powershell
cd "D:\ECHO - 副本 (3) - 副本"
# 找两个位置的 .exe 修改时间，必须都是你刚才 build 出来的时间
dir electron-app\build\echo-audio-host.exe
dir dist\win-unpacked\resources\echo-audio-host.exe
```

**如果时间是几个月前**：你忘了拷贝（或拷错位置）。回 REBUILD_STEPS.md 第 3 步。

---

## 第 1 步：查日志里那行 Ready

启动 ECHO 播一首 192k 文件，开独占。然后找 ECHO 的日志（`%APPDATA%\echoes\logs\` 或 app 内置 log 面板）里的：

```
[echo-audio-host] Ready: sr=??? hw=??? ch=2 exclusive=YES
```

照下表对：

| sr=     | hw=     | 含义                                                                 |
|---------|---------|----------------------------------------------------------------------|
| 192000  | 192000  | ✅ 真 hi-res 直通。如果 DAC 还显示 48k，问题不在软件，看第 2 步。      |
| 48000   | 48000   | mmsys 还是 48k。回 REBUILD_STEPS 改默认格式。                         |
| 192000  | 48000   | ❌ 我的 guard 没触发。代码或编译有问题，看第 3 步。                   |
| 192000  | （没有） | 老二进制还在跑。回第 0 步。                                           |
| —       | —       | 看到 `WASAPI exclusive rate mismatch: app=… hw=…. Reopening …` 后跟 `Reopen OK: app=48000 hw=48000` —— guard 工作正常，自动降级到了 48k。改 mmsys 即可拿到 192k。 |

---

## 第 2 步：sr=192000 hw=192000 但 DAC 还是 48k

软件这边已经是干净的 192k 出 USB。问题在更下游。

a. **检查 USB Audio Class 切换**  
TEAC 部分型号背面有 UAC1/UAC2 拨杆，UAC1 上限 96k 且很多实现下强制 48k。拨到 UAC2。

b. **检查 TEAC 驱动**  
设备管理器 → 声音、视频和游戏控制器 → 找 TEAC → 右键属性 → 驱动程序 → 提供商如果是 **Microsoft**，是 Windows 自带类驱动，部分 TEAC 在它下面会被钉低。装 TEAC 官方 Thesycon 驱动重试。

c. **换 USB 口**  
插到机箱后面直连主板的 USB 2.0/3.0 口（不要走 hub），避免 USB 选择性挂起降速。

d. **查 USB 选择性挂起**  
控制面板 → 电源选项 → 当前计划 → 更改高级电源设置 → USB 设置 → USB 选择性挂起 → 禁用。

---

## 第 3 步：sr=192000 hw=48000（不应该出现，但万一）

说明我的 guard 没生效。

```powershell
cd "D:\ECHO - 副本 (3) - 副本"
# 确认源码里 guard 还在
findstr /C:"WASAPI exclusive rate mismatch" src\main\audio\engine\echo_out.cpp
findstr /C:"hardwareSampleRate" src\main\audio\engine\echo_out.cpp
```

两条都应该 hit。如果都没 hit，git 改动可能被 stash / revert 了，重新应用 patch 或从 `_HOTFIX_192K\` 里看 diff 恢复。

如果源码里有但行为没生效：可能是 build 没真重编。删干净 build 缓存再来一遍：

```powershell
cd "D:\ECHO - 副本 (3) - 副本\src\main\audio\engine"
rmdir /s /q build
cmake -S . -B build -A x64
cmake --build build --config Release --clean-first
```

然后重新拷贝到两个运行位置。

---

## 第 4 步：ASIO 模式下还是 48k

ASIO 现在会调 `ASIOSetSampleRate`。如果 TEAC ASIO 拒绝，会在 stderr 看到：

```
[echo-audio-host] ASIO driver does not advertise 192000 Hz; reading current rate.
```

或：

```
[echo-audio-host] ASIOSetSampleRate(192000) refused by driver; reading current rate.
```

或：

```
[echo-audio-host] ASIO rate adjusted by driver: requested=192000 actual=44100
```

应对：
1. 打开 TEAC ASIO 控制面板（开始菜单搜 "TEAC ASIO" 或 "Thesycon"），把采样率切到 192000，应用，关闭。
2. 重启 ECHO 再播。某些 TEAC 驱动只接受在播放停止时切换。
3. 如果驱动确实不支持 192k 在 ASIO 下，回退到 WASAPI 独占 + mmsys 设 192k。

---

## 第 5 步：日志里看到 "exit_code_-4"

新增的退出码 -4 = "bit-perfect not achievable"。意思是：guard 触发后的二次 reopen 仍然没把硬件率对齐——非常罕见，通常只在驱动行为异常时出现。

应对：
1. 截图 ECHO 日志整段发给我（或自己看）
2. 临时绕过：关独占，用共享模式听（牺牲 bit-perfect 但能放）
3. 检查 mmsys.cpl 里 TEAC 是否被 Windows 空间音效（Windows Sonic / Dolby Atmos）接管 → 关掉空间音效

---

## 终极参考：查应用侧/硬件侧的真相

如果想直接看一眼当前 WASAPI 设备的 mmsys 默认格式（绕过应用层），PowerShell 跑：

```powershell
# 列设备 mix format（注：这个只对共享模式有意义；独占看 PKEY_AudioEngine_DeviceFormat）
[System.Reflection.Assembly]::LoadWithPartialName("PresentationCore") | Out-Null
# 简单版：直接看 mmsys 面板
control mmsys.cpl,,1
```

或用第三方工具 **MMDeviceTester / Audio Device Management** 看每个设备的所有支持格式。

---

## 如果以上都试过还是 48k

收集这些信息：
1. ECHO 日志里 `[echo-audio-host]` 开头的所有行（开播到稳定播放）
2. `[AudioEngine] Play: …` 那一行
3. `[AudioEngine] Native output sample-rate adjusted: …` 如果有
4. mmsys.cpl → TEAC → 高级 → 默认格式 当前值（截图）
5. 设备管理器里 TEAC 驱动的提供商和版本（截图）
6. TEAC 型号 + 你用的接线方式（USB / 同轴 / 光纤）+ 是否经过任何 hub

带这些找我（或回这条对话）。
