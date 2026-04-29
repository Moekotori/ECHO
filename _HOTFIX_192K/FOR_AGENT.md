# Agent 执行单 —— 给 Codex / Claude Code 看的版本

**前置事实**（不要自作主张去改）：
- C++ patch 已经应用在 `src/main/audio/engine/echo_out.cpp`
- JS patch 已经应用在 `src/main/audio/AudioEngine.js`
- 这两个文件的当前内容就是最终版，不要重新打 patch、不要 reformat、不要改 Linux 端兼容性
- 你的工作只有三件事：备份 → 编译 → 部署。然后停下来等人类做 GUI 步骤、再做最后验证

仓库根目录：`D:\ECHO - 副本 (3) - 副本`（路径含中文和空格，所有 cp / cmake -B 命令都要正确加引号）

---

## 步骤 1：备份现有 .exe

```powershell
$root = "D:\ECHO - 副本 (3) - 副本"
$bk   = "$root\_HOTFIX_192K\backup"
New-Item -Force -ItemType Directory $bk | Out-Null
Copy-Item -Force "$root\electron-app\build\echo-audio-host.exe"          "$bk\echo-audio-host.electron-app.bak.exe"
Copy-Item -Force "$root\dist\win-unpacked\resources\echo-audio-host.exe" "$bk\echo-audio-host.win-unpacked.bak.exe"
```

如果任一源文件不存在就跳过那一行（不要 fail）。

## 步骤 2：检查工具链

```powershell
cmake --version
where cl 2>$null    # 如果空，用 vswhere 找 MSVC：
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath
```

期望：CMake ≥ 3.10，且 vswhere 返回一个非空路径。如果两者任一缺失，**停下来告诉用户**：需要装 Visual Studio 2022 + Desktop development with C++ workload。

## 步骤 3：编译

```powershell
cd "D:\ECHO - 副本 (3) - 副本\src\main\audio\engine"
if (Test-Path build) { Remove-Item -Recurse -Force build }
cmake -S . -B build -A x64
cmake --build build --config Release
```

成功条件：`build\Release\echo-audio-host.exe` 存在。

如果 cmake 失败，**不要乱试方式 B/C**，把完整 stderr 复制出来停下报错，让用户决定。

## 步骤 4：部署到两个运行位置

```powershell
$src = "D:\ECHO - 副本 (3) - 副本\src\main\audio\engine\build\Release\echo-audio-host.exe"
Copy-Item -Force $src "D:\ECHO - 副本 (3) - 副本\electron-app\build\echo-audio-host.exe"
Copy-Item -Force $src "D:\ECHO - 副本 (3) - 副本\dist\win-unpacked\resources\echo-audio-host.exe"
```

## 步骤 5：自检——确认是新二进制

```powershell
& "D:\ECHO - 副本 (3) - 副本\electron-app\build\echo-audio-host.exe" -list 2>&1 | Select-Object -First 5
(Get-Item "D:\ECHO - 副本 (3) - 副本\electron-app\build\echo-audio-host.exe").LastWriteTime
```

第二行的时间应该是几分钟内。如果是几个月前，复制没成功，回步骤 4 检查路径。

## ⚠ 步骤 6：停下来等人类（GUI 操作）

**到这里你不能继续。** 把这段逐字回给用户：

> 二进制已编译并部署到两个位置（`electron-app\build\` 和 `dist\win-unpacked\resources\`），备份在 `_HOTFIX_192K\backup\`。
>
> 现在请你手动做三件事：
> 1. Win+R → `mmsys.cpl` → 找到 TEAC → 双击属性 → 高级 → 默认格式选 **24 位, 192000 Hz** → 应用 → 确定。同一面板下"独占模式"两个勾保持勾选。
> 2. 启动 ECHO，开独占模式，播一首 192kHz 的源文件。
> 3. 看 TEAC 面板和 ECHO 的日志，把日志里 `[echo-audio-host]` 开头那几行复制回来给我。

等用户回复日志再继续。

## 步骤 7：拿到日志后做诊断

期望命中：
```
[echo-audio-host] Ready: sr=192000 hw=192000 ch=2 exclusive=YES
```

照表对：

| sr | hw | 结论 | 行动 |
|----|----|------|------|
| 192000 | 192000 | ✅ 成功 | 询问用户 TEAC 面板是否显示 192；显示则收工，不显示参考 TROUBLESHOOTING.md 第 2 步 |
| 48000 | 48000 | mmsys 没改 | 提醒用户重做步骤 6 第 1 件 |
| 192000 | 48000 | ❌ guard 没触发 | 跑 `findstr /C:"WASAPI exclusive rate mismatch" src\main\audio\engine\echo_out.cpp`，没 hit 说明源码丢了 patch；hit 但没生效说明 build 没真重编 → 步骤 3 加 `--clean-first` 重做 |
| 看到 `Reopen OK` | — | guard 工作正常自动降级到 hw 率 | 提醒用户改 mmsys 拿真 192k |

更细的分支看 `_HOTFIX_192K\TROUBLESHOOTING.md`，**不要重新发明排查路径**。

## 步骤 8：（可选）commit

只在用户明确说"提交"时做：

```powershell
cd "D:\ECHO - 副本 (3) - 副本"
git add src/main/audio/engine/echo_out.cpp src/main/audio/AudioEngine.js
git commit -F _HOTFIX_192K\COMMIT_MESSAGE.txt
```

不要自动 push。

---

## 你不能做的事（红线）

- 不要再修改 `echo_out.cpp` 或 `AudioEngine.js`，patch 已经是最终版
- 不要尝试用 PowerShell 自动改 mmsys 默认格式（注册表/COM 路径都不可靠且容易把用户其他设备弄坏）
- 不要 push 到远端
- 不要清掉 `_HOTFIX_192K/` 目录，这是用户的部署历史
