# 回家后的部署步骤（傻瓜版）

代码已经改好并通过 Linux 端 g++ 语法编译。你需要在自己 Windows 机器上重新编译一次 native host (`echo-audio-host.exe`)，把它替换到两个位置。

## 一次性准备（如果以前没跑过 native host 的本地编译）

确认机器上有：
- Visual Studio 2022（Community 即可），勾选 **Desktop development with C++** workload
- 安装时勾上 **Windows 10/11 SDK** 和 **MSVC v143**
- CMake（VS 自带；命令行也可装独立的）

如果你以前 build 过 dist 包就肯定都有，跳过这一步。

## 编译 echo-audio-host.exe（任选一种）

### 方式 A：用现有的 VS 解决方案（最快）

仓库里 `out\echo-audio-host-build\echo-audio-host.sln` 已经存在。

1. 双击打开 `out\echo-audio-host-build\echo-audio-host.sln`
2. 顶部把 **Debug** 改成 **Release**，平台选 **x64**
3. 菜单 → Build → Build Solution（或快捷键 Ctrl+Shift+B）
4. 产物在 `out\echo-audio-host-build\Release\echo-audio-host.exe`

### 方式 B：纯命令行 CMake（在 PowerShell 里跑）

```powershell
cd "D:\ECHO - 副本 (3) - 副本\src\main\audio\engine"
cmake -S . -B build -A x64
cmake --build build --config Release
# 产物：build\Release\echo-audio-host.exe
```

### 方式 C：直接整包重打

```powershell
cd "D:\ECHO - 副本 (3) - 副本"
npm run build:win
```

如果你只是想自测不打整包，A 或 B 更快。

## 把新 .exe 替换到运行位置（关键！）

无论用哪种方式编出来的，都要复制到这两个地方：

```powershell
# 把 <SRC> 替换为你编出来的 echo-audio-host.exe 的路径
copy <SRC> "D:\ECHO - 副本 (3) - 副本\electron-app\build\echo-audio-host.exe"
copy <SRC> "D:\ECHO - 副本 (3) - 副本\dist\win-unpacked\resources\echo-audio-host.exe"
```

`electron-app\build\` 是 dev 模式跑时用的；`dist\win-unpacked\resources\` 是已打包版本用的。NativeAudioBridge.js 的 `resolveHostBinary` 会按这个顺序找。

## 改 mmsys 默认格式（必做）

新版本会**诚实地按 mmsys 默认格式输出**。要真出 192k：

1. Win+R → `mmsys.cpl` → 回车
2. 找到你的 TEAC（设为默认设备）
3. 双击进属性 → 高级
4. 默认格式下拉 → **24 位, 192000 Hz (Studio Quality)**
5. 应用 → 确定
6. （建议）"独占模式"下面两个勾保持勾选

## 验证（连上 TEAC 试播）

启动 ECHO，开独占，播一首确认是 192k 的文件。

期望看到：
- TEAC 面板显示：**192**
- ECHO UI 显示：output 192kHz、bit-perfect 亮
- 后台 log 出现：`[echo-audio-host] Ready: sr=192000 hw=192000 ch=2 exclusive=YES`

如果看到这一行，说明硬件和应用侧采样率一致，没有隐藏 SRC，是真 hi-res 直通。

如果只看到 `sr=48000`，看下一份 `TROUBLESHOOTING.md`。

## 出错时的回滚

代码改了的两个文件：
- `src\main\audio\engine\echo_out.cpp`
- `src\main\audio\AudioEngine.js`

如果你用 git：
```powershell
cd "D:\ECHO - 副本 (3) - 副本"
git diff src/main/audio/engine/echo_out.cpp src/main/audio/AudioEngine.js   # 看 patch
git checkout -- src/main/audio/engine/echo_out.cpp src/main/audio/AudioEngine.js   # 回滚
```

老的 `echo-audio-host.exe` 备份建议在 build 前先拷一份到 `_HOTFIX_192K\backup\`。

## commit 一把（可选）

```powershell
cd "D:\ECHO - 副本 (3) - 副本"
git add src/main/audio/engine/echo_out.cpp src/main/audio/AudioEngine.js
git commit -F _HOTFIX_192K\COMMIT_MESSAGE.txt
```
