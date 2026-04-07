# Git 实用教程（面向本仓库日常开发）

面向：**Windows + PowerShell**、在 **`E:\4.1 vaild`** 开发 [Echoes](https://github.com/Moekotori/Echoes)、用 **Git 当备份**、偶尔需要和 **GitHub 上的 `main`** 对齐。不要求背命令，按场景查即可。

---

## 1. 先建立五个概念

| 概念 | 一句话 |
|------|--------|
| **工作区** | 你磁盘上能改动的那些文件。 |
| **暂存区（索引）** | `git add` 之后，准备写进下一次提交的那份快照。 |
| **提交（commit）** | 在**本地**打上的一个「版本点」，带说明文字，可回退、可对比。 |
| **分支（branch）** | 一条提交线的一个名字；默认常用 **`main`**。 |
| **远程（remote）** | 一般指 **GitHub** 上的同名仓库；默认叫 **`origin`**。 |

把代码推到 GitHub = **本地提交 + `push`**，云端就多一份备份，换电脑可以 `clone` 或 `pull` 拉回来。

---

## 2. 每天最常用的命令

在项目根目录 **`E:\4.1 vaild`** 打开终端执行。

### 看看现在什么情况

```powershell
git status
```

- **working tree clean**：当前没有未提交的改动（所以你再 `git commit` 会提示 *nothing to commit*）。
- **Changes not staged**：改动了文件，还没 `add`。
- **Untracked files**：新文件，Git 还没管；若不应进仓库，检查 `.gitignore`。

### 保存一版到本地（备份一步）

```powershell
git add -A
git commit -m "简短说明这次改了什么"
```

- `-A`：把删除、新增、修改都纳入暂存（在常见单人项目里够用）。
- 若 `commit` 说 **nothing to commit**：要么真的没改，要么改的文件被 **忽略**，要么改在**别的目录**了。

### 推到 GitHub（云端备份）

```powershell
git push origin main
```

第一次在本机关联远程后，以后多数情况 **`git push`** 即可（已设置上游时）。

---

## 3. 和 GitHub 同步：先拉再推

别人（或你在另一台电脑）在 GitHub 上推了新提交时，你这边要先对齐再推送：

```powershell
git fetch origin
git pull origin main
```

- **`fetch`**：只把远程信息拉下来，不自动改你当前文件。
- **`pull`**：一般是 **fetch + 合并** 到当前分支，让你本地包含远程新提交。

若提示 **diverged**（分叉）：本地和远程从某一点起**各自都有新提交**，需要 **合并（merge）** 或 **变基（rebase）** 二选一，并可能**解决冲突**（同一行两边都改了）。这是正常现象，不是坏了。

**稳妥做法（适合不熟 rebase 时）：**

```powershell
git fetch origin
git merge origin/main
```

解决冲突 → `git add` 相关文件 → `git commit` → `git push`。

---

## 4. 分支：你该看哪些

```powershell
git branch          # 本地分支，* 表示当前
git branch -r       # 远程分支
git branch -a       # 全部
```

本仓库常见：**`main`**（主开发线），远程可能还有 **`origin/release/v1.1.0`** 这类**发版/维护线**。日常开发在 **`main`** 即可；发版流程若团队有约定，再按约定切分支。

删除**远程**上不要的分支（确认名字再删）：

```powershell
git push origin --delete 分支名
```

---

## 5. 你的使用场景：和「手动备份文件夹」对比

| 做法 | 说明 |
|------|------|
| **复制整个项目到别处** | 容易换路径，Cursor 对话不跟过去；不推荐当唯一备份。 |
| **`git commit` + `git push`** | 历史清晰、体积小；**同一目录持续开发**，对话与习惯都稳定。 |
| **重要结论写进 `docs/`** | 新会话、新机器靠文档和代码，不靠聊天记忆。 |

---

## 6. 常见现象：为什么 `nothing to commit, working tree clean`

- 上一次已经提交过了，**没有新 diff**。
- 文件改在 **被 `.gitignore` 忽略** 的路径里（例如某些构建产物、本地配置）。
- 改在**另一个克隆目录**里，当前终端不在那个目录。

用 **`git status`** 和 **`git diff`** 自查。

---

## 7. 慎用命令（避免误伤）

| 命令 | 风险 |
|------|------|
| `git reset --hard` | 丢弃未提交改动，**找不回来**。 |
| `git push --force` / `--force-with-lease` | 改写远程历史，**可能影响他人**； solo 仓库也要确认再执行。 |

删除历史里某一个「叫 backup 的提交」属于**改写历史**，一般比「保留历史、以后写好提交说明」更麻烦；若必须做，建议先搜「interactive rebase」并备份分支。

---

## 8. 速查表（复制用）

```powershell
git status                    # 当前状态
git log --oneline -10         # 最近 10 条提交
git remote -v                 # 远程地址（应对 Moekotori/Echoes）
git fetch origin
git pull origin main          # 与远程 main 对齐（可能有合并）
git add -A
git commit -m "说明"
git push origin main
```

---

## 9. 与本仓库的关联

- 远程示例：`https://github.com/Moekotori/Echoes.git`（以你 `git remote -v` 为准）。
- 忽略大目录与构建产物：见仓库根目录 **`.gitignore`**；减少误提交、也减轻体积。

有具体报错（冲突、diverged、鉴权失败）时，把**完整终端输出**贴出来，比凭记忆猜更准确。
