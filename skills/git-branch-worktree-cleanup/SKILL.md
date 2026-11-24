---
name: git-branch-worktree-cleanup
description: 把一个 git 仓库的本地与远程分支清到「只剩主干」，包括被 worktree 检出的分支。用户说「清理一下分支」「本地分支和 GitHub 上的分支全部删除掉」「把 worktree 清掉」「只留 main」时使用。核心是先量化每个分支相对主干的未合并提交，再识别四个不可逆点（仅远程无本地副本的分支、worktree 里被忽略的独有文件、被进程占用的目录、残留目录里指向主项目的 node_modules 符号链接），备份后才动手，最后用 git ls-remote 直问远端复核。
agent_created: true
user-invocable: true
---

# 分支与 worktree 全量清理

目标：把仓库清到只剩主干分支，且**没有任何不可恢复的丢失**。这是破坏性操作 —— 先扫描、再量化、后动手，不要边看边删。

## 1. 只读扫描（不许跳过）

```bash
git fetch --prune origin
git branch -vv          # 第二列 = worktree 路径
git branch -r
git worktree list
git stash list
git-wt list             # 可选（worktrunk）：一行给出各 worktree 的领先/落后/脏/是否已并入主干
```

⚠️ **每个仓库都要单独 `fetch --prune`，不能只 prune 当前工作区那个。** `git branch -r` 读的是本地
remote-tracking ref，**它会显示远端早已删除的分支**。实测（2026-09-26）：先在前端仓库 prune、后端仓库没
prune，于是后端「有」一条 `origin/ci/restore-plugin-by-model`，量化出来「已完全合并、可删」，等真去
`git push origin --delete` 才报 `remote ref does not exist` —— 远端本来就没有，需要清的只是本地那条陈旧
ref。**判据：报告里凡是「远端有 N 条分支」，必须由 `git ls-remote --heads <remote>` 直问远端确认过**，
`git branch -r` 不算数（§6 同理）。

装了 worktrunk 时 `git-wt list` 比 `git worktree list` 信息量大得多：`_` / `⊂` = 已并入主干（行变暗）、`↑`/`↓` = 领先/落后、`⚑` = 目录名与分支名不符（对**按随机名建目录的工具**恒亮，不是错误）。它只读，可放心跑；但 `git-wt remove` / `git-wt step prune` 是**陷阱**，见 §4.4。

**关键事实**：`git branch -vv` 输出里带 `+` 前缀、第二列是路径的分支，被 worktree 检出。**git 拒绝删除被检出的分支** ⇒ 必须先 `git worktree remove`，否则批量 `-D` 会失败一半。

## 2. 量化未合并提交

对每个非主干分支：

```bash
git rev-list --left-right --count main...<branch>   # 输出「<主干独有> <分支独有>」
```

第二个数 = 该分支独有的未合并提交数。`0` = 已完全合并，可无风险删除。

## 3. 分类处置

| 类型 | 判据 | 处置 |
|---|---|---|
| 已完全合并 | 第二个数为 0 | 直接删 |
| 未合并，但提交只是构建产物/发布清单 | 提交信息形如 `release: <name>（dist + 来源 sha + 清单）`，或改动文件全在 `dist/**` | 可删（产物可重建，且旧发布流程通常已废） |
| 未合并，含真代码 | 有 `feat/` / `fix/` 提交、新增源码文件 | **必须向用户确认**，删前打 tag 兜底 |

判「新增文件是否已在主干」要用机械判据，别读代码猜：

```bash
git cat-file -e main:<path> 2>/dev/null && echo "在主干" || echo "主干没有"
```

## 4. 四个不可逆点（逐个处理）

### 4.1 仅存在于远程的分支

本地无同名分支时，删远程会让提交变成 dangling（只剩 reflog，容易被 GC）。**删前打 tag**：

```bash
git tag archive/<branch-name> origin/<branch-name>
git rev-parse --short archive/<branch-name>    # 记下 sha，写进报告
```

### 4.2 worktree 里被忽略的独有文件

各种工具会给**每个 worktree** 各建一份本地状态/日志/缓存目录 —— 不是符号链接，是各自一份，而且**被 gitignore**（`git status` 里看不见）。删 worktree 会连带删掉**别的 session 的独有日志**。删前先列出来：

```bash
git -C "<worktree>" status --ignored --porcelain     # 被忽略的文件也列出来
find "<worktree>/<被忽略目录>" -type f | wc -l
wc -l "<worktree>/<被忽略目录>/"*.md
```

实测见过某 worktree 侧的一个日志文件 **1097 行**，而主项目同名文件只有 243 行 —— 那是另一个 session 的完整工作日志。备份到**仓外**再删：

```bash
BK="<仓外备份目录>/worktree-ignored-backup-<YYYYMMDD>"
mkdir -p "$BK"
cp -r "<worktree>/<被忽略目录>" "$BK/<worktree 名>"
```

### 4.3 被进程占用的目录

外部工具自己的 worktree 目录（`.<工具名>/worktrees/` 一类）可能被它持有 ⇒ 删除报 `Permission denied`。**不要绕过、不要强删**，留着并写进报告。

### 4.4 只凭 git 状态判「可删」的工具会绕过 4.2

`git-wt remove` / `git-wt step prune`（worktrunk）判「可删」**只看 git** 的脏/合并状态，而**被 gitignore 的文件不算脏**。所以一个**只含被忽略文件**的 worktree，在它眼里是「干净」的，会**无警告直接移走**。这不是它一家的毛病：**任何只看 git 状态的清理入口都有同一个盲区** —— 判据要落在「它有没有读 `--ignored`」，不是落在工具名上。

实测（2026-09-26，worktrunk v0.79.0）：新建 worktree 后放入一个被 gitignore 的日志文件 → `git status` 为空 → `git-wt remove -y` **exit 0 直接成功**，全程没有任何提示。（对照：同一个 worktree 放一个 `?? dirty.txt` 会被拒并指名文件 ⇒ 未跟踪文件算脏，**被忽略的文件不算**。）

兜底：整个目录树（含被忽略的文件）落在 `.git/wt/trash/<分支>-<id>/`，可找回。⚠️ 但没有清理入口，**会累积**（实测两个裸 checkout 已 29 MB；带 `node_modules` 的更大），且没人会想起来去找。

⇒ **清 worktree 一律用 §5 的顺序，不要用 `git-wt remove` / `git-wt step prune`**；`git-wt list` 只当只读盘点。

### 4.5 worktree 残留目录里的 `node_modules` 是符号链接 —— 递归删除会毁掉主项目

`git worktree remove` 只删 git 跟踪的内容，**被忽略的 `node_modules` 留下**。而它**不是目录，是指向别处的
符号链接**（2026-09-26 实测：某工具建的 worktree 里 `node_modules` → **主项目的 `node_modules`** 绝对路径）。

⚠️ 对这些残留目录用 `rm -rf` / 递归删除会**穿透符号链接**，把主项目的 `node_modules` 一起删掉 —— 一个
「清理残留」的动作会打坏正在用的开发环境。判据（删任何 worktree 残留目录前必跑）：

```bash
ls -la "<残留目录>"                 # node_modules 一列显示 lrwxrwxrwx 就是链接
readlink -f "<残留目录>/node_modules"  # 打印真实目标；是主项目路径就绝对不要递归删
```

处置：**只报不动**。真要清，只删链接本身（`rm <link>`，不带 `-r`），**不要** `rm -rf <残留目录>`；目标是
主项目时干脆留着 —— 空目录 + 一个符号链接，占用为 0，危害远小于误删主项目依赖。

⚠️ 同一目录下还可能有**从未出现在 `git worktree list` 里的**孤儿残留（此前某次清理只摘了注册表、没删磁盘）
—— 别以为「注册表干净 = 磁盘干净」，`ls` 一次残留根目录。

## 5. 执行顺序（顺序错了会失败）

1. 备份（4.1 打 tag + 4.2 复制被忽略文件）
2. `git worktree remove <path>`（有 ignored 文件时加 `--force`）
3. `git branch -D <branch>`（未合并的必须用 `-D`）
4. `git push origin --delete <b1> <b2> ...`（可一次传多个）

⚠️ `git worktree remove` 若因 `Permission denied` 失败，它**已经把该 worktree 从注册表摘掉了**；此时再 `--force` 会报 `fatal: '<path>' is not a working tree` —— 这不是新错误，是已摘除。目录残留用 `rmdir` 清空壳，清不掉就报告。

## 6. 独立通道复核

不要用本地 `git branch -r` 验证远程（可能有缓存）。直问远端：

```bash
git ls-remote --heads origin     # 期望只剩 refs/heads/main
git branch -a
git worktree list
git tag -l 'archive/*'
```

## 7. 交付前必须报告的三件事

- 删了哪些分支（**本地 / 远程分开列**）
- **不可逆点的处置**：tag 名与 sha、被忽略文件的备份路径、残留目录
- **未动的边界**：`stash` 是否是该 WIP 的唯一副本、主工作树有无未提交内容

## 反面清单

- 不要没查 worktree 就批量 `git branch -D`（会失败一半，且报错难懂）
- 不要把「已合并」当成「没价值」的判据 —— 仅存在于远程的分支即使已合并，也要先看本地有没有副本
- 不要用 `rm -rf` 清残留：**残留里的 `node_modules` 是指向主项目的符号链接，递归删会毁掉主项目依赖（§4.5）**
- 空目录清不掉就直接报告，**不要换姿势硬删**（2026-09-26 实测：一个残留空目录被别的进程持有，删除报「另一个程序正在使用此文件」）
- 不要因为用户说「都做完了」就跳过量化 —— 「做完了」不等于「分支已合并」
- 不要用 `git-wt remove` / `git-wt step prune` 清 worktree —— 它只看 git，被忽略的文件不算脏，会静默移走别的 session 的日志（§4.4）
