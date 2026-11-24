# 按需参考

原入口的详细分支与历史案例；先核对当前环境，历史命令不是无条件执行步骤。

## 第 2 步：推送（本机必须后台跑）

```bash
git -c credential.helper='!gh auth git-credential' push origin main
```

- **非交互环境下 `git push` 常需要显式凭据**：例如 `credential.helper` 只有 GCM 的 `helper-selector` 时，
  非交互下解析不出凭据。
- **耗时随增量走，不是固定的 7 分钟**：197 文件 / +9771 −1108 → **6 分 55 秒**；
  1 个文件 / +9 行 → **3 秒**（2026-09-20 实测）。所以「快」不构成异常，
  但也别按「一定很久」去规划——**照旧后台跑，别猜**。
  前台超时必被截断或转后台；直接后台执行并等待完成回执。
- **「没有输出」不等于「卡死」**：推送过程无进度输出是正常的，
  不要因为沉默就重推（重推会撞 already up-to-date 或制造混乱）。
  成功的样子是 `5f98f0e..a40d7e2  main -> main`。

## 第 3 步：核对 CI（唯一有意义的结论）

### ⚠️ `gh` 按 cwd 解析仓库 —— 有 `upstream` 远端时会解析到**上游**

2026-09-29 实测（本地分叉仓 `upstream-app`：`origin` = `<account-a>/upstream-app`、`upstream` = `<org>/upstream-app`）：
不带 `--repo` 的 `gh run list` 列的是**上游**的 run；`gh run list --workflow production-build.yml`
直接 404，报错里写着 `repos/<org>/upstream-app/actions/...` —— 而这次推送的 run 在 `<account-a>/upstream-app` 里。
症状是「**推完看不到本次 run**」，极易误判成「workflow 没触发 / Actions 被额度锁死」。

**判据：所有 `gh run` / `gh workflow` / `gh release` 命令一律显式带 `--repo <owner>/<repo>`。**
⚠️ `gh repo view --repo …`、`gh release list --repo …` 这类**本来就显式**的调用不受影响 ——
所以「可见性 / 预发布查询是对的」**不能**证明「run 查询也对」。分叉仓库（有 `upstream`）必踩。

```bash
gh run list --repo <owner>/<repo> --limit 3 --json databaseId,status,conclusion,displayTitle
```

- **判据是 `conclusion` 字段，不是 push 的输出。** 等它从 `in_progress` 变 `completed`。
- **不要用 `gh run watch <id> | tail -40` 判断状态** —— 管道缓冲会把行攒住，
  实测 7 分钟一个字都不回显。要看结论走 `gh run list --json`。
- **要「等它跑完再拿结论」，用「后台 `gh run watch` + 跑完读一次 `--json`」**：

  ```bash
  gh run watch <id> >/dev/null 2>&1; gh run view <id> --json status,conclusion --jq '"\(.status) \(.conclusion)"'
  ```

  整条丢进后台任务，完成时一次性拿到结论 —— 比反复 `gh run list` 轮询省事，
  也不踩上面那条管道缓冲（`watch` 的 stdout 直接丢掉，只读最后那次 `view`）。
  实测（2026-09-20，`static` + `test(1..4)` 五个 job）**约 1 分 50 秒**。
- **刚 push 完 `gh run list` 可能还没登记那一笔**：先等待数秒再查，
  否则会读到**上一条** run 的结论而误判成本次的。
- 红了就定位到步骤：`gh run view <id>`（看哪个 ✓/X）→ `gh run view <id> --log-failed`。
- **看最新 commit 的结论**，不要被历史 commit 的 failure 带偏 ——
  每个 commit 有自己的 check run，旧的红不代表现在的 tip 是红的。
- **`cancelled` 既不是红也不是绿，别把它记成任何一种**：`verify.yml` 这类带
  `concurrency` + `cancel-in-progress` 的工作流，会在**下一次 push 时掐掉正在跑的那次**。
  2026-09-20 实测：连推两笔（`008d795` → `0b55b0b`），前一笔的结论就是 `cancelled`。
  **判据是最新 tip 的结论**；被掐掉那笔的内容包含在 tip 里，tip 绿就算过。
  反过来，如果 tip 也被掐掉了（后面还有更新的 push），那就还没有结论，继续等。
- **⚠️ `cancelled` 的第二种成因：改了 `concurrency` 之后，job 把同 run 的兄弟 job 掐了。**
  2026-09-22 实测（代价是当天多推一次）：把发布 job 并进 `verify.yml`、并发从工作流级改成
  **job 级**之后，`test` 的分组写成 `verify-test-<ref>` —— 而 job 级 concurrency 是按
  「**job 实例**」加锁的，矩阵的每一片都是独立实例 ⇒ 四片共用同一个组 + `cancel-in-progress: true`
  ⇒ **同一 run 内互相取消**，只剩最后启动的那片活着（实测 `test(1)(2)(3)` 各在 1 秒内 `cancelled`，
  只有 `test(4)` 跑完）⇒ `test` 整体 `cancelled` ⇒ 下游 `release` 因 `needs` 不满足被**跳过**
  ⇒ **一次都没发布**。（工作流级 concurrency 没这个问题：它锁的是 run，不是 job 实例。）
  **判据：凡是改过 `concurrency`，必须看 `gh run view <id> --json jobs` 的逐 job 结论 ——
  矩阵 job 的每一片都要 `success`。** 只读总 `conclusion` 只能得到 `cancelled`，看不出根因。
  修法：分组带上分片号（`group: …-${{ matrix.shard }}`；`matrix` 在 job 级 concurrency 里可用，
  见 docs「Context availability」表：`jobs.<job_id>.concurrency` 允许
  `github, needs, strategy, matrix, inputs, vars`）。
- **本机拿不到 job 日志时不要反复重试**：`gh run view <id> --log` 走的是
  `results-receiver.actions.githubusercontent.com`，在部分网络下**直接 EOF**。
  `--log-failed` 同样走它。这时能拿到的只有 `conclusion` 与 job/step 名字，
  **如实把「日志取不到」写进报告**，不要用结论反推失败原因。
- **但「全红且秒级失败」通常不需要日志 —— 注解就够了**：`gh run view <id>`（**不带 `--log`**）
  的输出里有 `ANNOTATIONS` 段，它就是失败原因。2026-09-21 实测：push 后 5 个 job 全红，
  `--json jobs` 显示每个 job **2–3 秒**就结束（`起=…止=…` 差 2s），注解为
  `The job was not started because recent account payments have failed or your spending limit needs to be increased`
  ⇒ **job 根本没启动，是 Actions 额度/计费问题，不是代码**。判据是「秒级 + 注解」这一对；
  这时**不要去查代码**，也不要因为红就回滚。同形状还有「私有仓 Free 档额度用尽」。
  **额度恢复前每次 push 都会产出一个红 run，如实报「红但非代码」。**

### `conclusion: success` 不等于「那一步跑了」

**`success` 只说明这个 job 没失败。** 一个步骤被 `if:` 跳过、或者你改的 workflow 根本没被
GitHub 读成新的步骤，结论一样是绿的 —— 这和第 0 步「命令跑完了 ≠ 构建成功」是同一个形状。

**改动过 `.github/workflows/` 时，判据是 job 的步骤清单：**

```bash
gh run view --job=<job-id>          # 列步骤，每步带 ✓
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

2026-09-20 实测：新加的「文档脚本表与 scripts/ 一致」在 `static` 里**确实出现且 ✓**，
才敢写「门禁已进 CI」；只看 `conclusion: success` 是证明不了这一点的。

**顺带一条计费判据**：加步骤到**已有 job** 里不改档位（墙钟只涨 1–2s，仍落在同一个
「向上取整到分钟」的档），**新开一个 job 才会多一档**。所以「这条门禁该进 CI 吗」的答案
通常是「加进现有的静态 job」。

### 走 CI 通道时，「发布回执」就在 release job 的日志里

不用等 `deploy/production-release.json` 被人工补写 —— 回执是发布脚本自己打的：

```bash
gh run view --job=<release-job-id> --log > /tmp/release-job.log
grep -n '##\[group\]' /tmp/release-job.log     # 先拿步骤边界，再 sed -n 取回执那一段
```

⚠️ **别按步骤名 / 关键词 grep 去定位回执**。日志每行前缀是 `<job>\t<step>\t<ts>Z `，
2026-09-25 实测 `grep -iE "deploy|released|entry|commit|sha|pages"` **一条都没命中**，
看上去像「日志取不到」，其实 730 行全在。先 `grep '##\[group\]'` 看步骤表，再按行号取。

回执里的 `previous.id` / `previous.url` 就是**上一版 canonical deployment**。拿它跟
`deploy/production-release.json` 里记的 `production` 对一次账，能一眼看出中间有没有
**漏记的部署**（2026-09-25 实测：正好接上 ⇒ 零漏记）。回执本身也含
`sourceCommit` / `production.id` / `preview.id` / 三条 `checks`，是「这次真的发了哪一版」的一手读数。

### 发布记录冻结了：从 run 回执反推补齐（2026-09-27 实测）

`deploy/production-release.json` 这类「当前正式版本」记录是**覆盖式**的。一旦有人立了
「回执的 `previous.id` ≠ 文件里记的 `production.id` 时宁可不写也不覆盖」这种规矩，它就会
**永久冻结** —— 2026-09-25 起实测冻了 **16 次**部署。**这条规矩是错的**：缺口常常只在
「记录」里、不在「事实」里。先证明事实连续，再照常覆盖。

**第一步：列出区间内全部 run，只看 `release` 这一个 job。**

```bash
gh run list --limit 60 --json databaseId,headSha,createdAt \
  --jq '.[] | "\(.databaseId)\t\(.createdAt)\t\(.headSha[0:7])"'

# ⚠️ 判据是 release 这**一个 job** 的 conclusion，不是 run 的总 conclusion ——
#    「success + release skipped」（纯文档提交）与「success + release success」（真部署）
#    在 run 的总 conclusion 上**完全分不开**
gh run view <id> --json jobs --jq '[.jobs[]|select(.name=="release")|.conclusion]|join(",")'
```

**第二步：对 `release: success` 的 run，抓回执里的两个 id。**

```bash
gh run view <id> --log | grep -A2 '"previous": {'   | grep -oE '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}' | tail -1
gh run view <id> --log | grep -A2 '"production": {' | grep -oE '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}' | tail -1
```

`tail -1` 不能省：脚本在 `record()` 里打**两次**回执（中途一次、`finally` 一次）。

**第三步（这一步才是判据）：逐位验证连续性。**

> 每行的 `previous.id` 必须**逐位等于**上一行的 `production.id`。

链一旦从头到尾接上（本例 `f4bd21d7`(`b89931d`) → … → `160729bf`(`ec88c63`) → `3081fbd3`(`e290e54`)），
就**证明了中间没有漏掉的部署** —— 任何一次漏掉的部署都会把某行的 `previous` 断开。
「缺口」于是被证明只存在于记录里 ⇒ **可以放心覆盖**。

**⚠️ 三个坑**：
1. **别指望外部平台 API 一定可用**：平台 token 过期时（如 `/user/tokens/verify` 回
   `code 1000 Invalid API Token`）列不出部署列表，可从 CI 回执反推。
2. **发布脚本可能强读该文件的固定字段**：例如 `scripts/pages-release.mjs` 读 `migrationLegacy.url`，
   并把 `migrationLegacy.entryAsset` / `.entrySha256` 与回执**逐字比对**
   （不一致即断言失败、整个 release 红）⇒ **覆盖时无关基线块一个字都别动**。
3. **补记录的提交本身不该再产一次部署**：先确认 `changes` job 的排除集里有这个路径
   （如 `deploy/production-release.json` 在列），推完仍要读 `--json jobs` 确认 `release: skipped`。

## 第 4 步：盘点「还有什么没推」

`main` 之外常有多个本地分支。**「无上游」不等于「漏推」**，要按性质分类：

```bash
# 哪些分支的 tip 已经进了 origin/main
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  if git merge-base --is-ancestor "$b" origin/main 2>/dev/null; then echo "已并入: $b"; else echo "未并入: $b ($(git rev-list --count origin/main..$b) 个独有提交)"; fi
done
git stash list                            # 悬空的 stash 也要报出来
```

- **部署打包分支 / 原型分支「未并入」是正常状态** —— 它们含 `dist/` 产物、常删测试文件，
  刻意与 main 分叉，不该推。
- **要新建一个发布/打包分支之前，先查有没有人为同一个 source commit 已经打过包了**：

  ```bash
  # ⚠️ 必须用 `--format` 取**纯分支名**。`git branch --list` 会给「已在 worktree 里检出」的分支
  #    加 `+ ` 前缀，拼进 `$b` 会让 `git show` 失败 → **整列静默返回空**，看起来像「没有任何包」，
  #    而那正是这一步要防的重复发布。2026-09-21 实测：10 个发布分支全部命中这个形状
  #    （都带 source-commit.txt，却全显示为空）。
  git branch --list "*<通道前缀>*" --format='%(refname:short)' | while read b; do
    printf "%-48s %s\n" "$b" "$(git show "$b:<记录来源提交的那个文件>" 2>/dev/null || echo '(无此文件)')"
  done
  ```

  2026-09-20 实测：同一份源码 `33cd9dd` 被**两个 agent 各打了一个发布包**，
  两次发布都 success、都覆盖了一次部署。两个产物逐字节相同（内容寻址的 hash 挡了一下），
  所以线上没坏 —— **但回滚目标被多推了一格，而回执本来就拿不到**。
  **这类通道通常带 `cancel-in-progress: false`：两次会串行跑完，不会互相打断，
  因此也不会互相报警。** 第二个包只能自己先看一眼，撞上了先问，不要闷头再打一个。

  **重复包的机械判据**（比看分支名可靠）：把所有通道分支的 `source-commit.txt` 排一次序，
  出现两次的那个 commit 就是被重复打包的：

  ```bash
  for b in $(git for-each-ref --format='%(refname:short)' refs/heads/ | grep '<通道前缀>'); do
    printf '%s %s\n' "$(git show $b:deploy/source-commit.txt 2>/dev/null | head -1)" "$b"
  done | sort
  ```

  2026-09-20 复核：`home-status-entry` 与 `status-line` 的 source-commit **都是 `33cd9ddba`**
  —— 记忆里那条「同一份源码被打两个包」被机械复现了。

### 「未并入」不是「该删」——清理前必须先查文档

用户说「都处理一下」时，最容易犯的错是顺手删掉这些分支。**判「未并入」只是一个事实，
不是「该删」的结论。** 实测过两种「看起来像垃圾、实际是机制」的形状：

| 形状 | 判据 |
|---|---|
| **发布通道** | 分支带 `dist/` + `deploy/source-commit.txt`，文档写明「推去的是**另一个仓库**」→ 与 main 分叉是设计 |
| **证据链** | 分支被文档以 commit hash 引用（如 `docs/archive/*.md` 里的 `[N7]` 引用 `f7e7aec`）→ 删了引用会悬空 |

固定动作：**先 grep 文档里有没有这个分支名 / 它的角色**，再决定动手。

```bash
grep -rn "<branch-name>" docs/ *.md        # 文档里有没有它的位置
git show <branch>:deploy/source-commit.txt  # 是不是发布载体
git -C <worktree> status --short            # 发布工作树是否干净
```

### stash 的安全收口（要「可恢复」，不是「导出就算」）

```bash
# 1. 导出（含未跟踪，保险）
git stash show --include-untracked -p "stash@{0}" > <备份>.patch
grep -c "^diff --git" <备份>.patch          # 对得上 git stash show --stat 的文件数

# 2. 验证「能还原」—— 在 stash 的基准提交上试应用，验完移除
BASE=$(git rev-parse "stash@{0}^1")
git worktree add --detach /tmp/verify "$BASE"
git -C /tmp/verify apply --check <备份>.patch
git worktree remove --force /tmp/verify

# 3. 丢弃 + 留恢复说明（写明 stash 提交号、基准提交、为何判定已过期）
git stash drop "stash@{0}"
```

**判据是「备份能还原」，不是「备份文件非空」。** 反向试算失败是正常的（工作区本就没有那些改动），
真正的验证是正向应用在基准提交上通过。**别自行 apply 他方 agent 的 stash** ——
先给证据说明它是否已被主线取代（例：它要删的文件在 main 上仍存在、且之后还被主动维护过）。

## 第 3.5 步：远端 CI 通道整条死掉时，上线改走**本机直发**

上面的第 3 步假定远端 CI 能跑。**当额度用尽（第 3 步那条「秒级全红 + 注解」的形状）时，
远端通道整条是死的**，但「上线」这件事仍然要做，而且不需要 Actions。

⚠️ **这是项目专属的操作配方，不是通用步骤**：它依赖该项目自己的发布脚本、本机凭据和发布记录格式。
**命令序列以项目文档为准**（实例：见 `docs/reference/FRONTEND-CUTOVER.md` 的「本机直发通道」节，
含「发布脚本会追加 `[vars]`，不还原会重复追加」这类只在那个脚本上成立的细节）；本技能只负责下面三条前提与判据，
不复述命令，也不假设任何项目的脚本名。

三条前提，缺一条就得先解决再动手：

1. **先把提交推到远端** —— 发布脚本通常用 `git rev-parse HEAD` 作 `--commit-hash`；推送在后会让回执指向远端没有的提交。
2. **凭据在仓外**（本机环境变量文件，按本机实际配置），**不进仓库**。
3. **产物必须是新的** —— 判据仍是日志里的 `✓ built in`；动手前先把旧产物移走（见第 0 步）。

**先确认这条通道当前能不能用**：凭据是否仍然有效（失效时唯一诚实的结论是「阻塞」），
以及项目文档有没有反过来记「远端 CI 已恢复、不要再走直发」——两条都核过再动手，别按记忆里的旧状态开工。

- **判据仍是「独立通道回读」，不是脚本的 `status: released`**：线上 `index.html` 与本地
  `dist/index.html` 比 sha256；入口 chunk **本地 / 线上 / 清单三方一致**；再挑一个**本轮改动所在的
  分片**，比它**线上 vs 本地的 sha256 逐字节相同** —— 这一条才是「新代码真的上去了」。
  **别只比入口名**（hash 是内容寻址的，入口没变也可能是没发上去），**也别靠特征字符串计数**
  （minify 后一个词可能被内联成好几处，计数变化不等于代码变了；2026-09-21 实测：同一句
  `queueMicrotask` 在改动前后的同一分片里是 5 → 6，而 `selectionStart` 是 6 → 4，
  计数只有配合 diff 才解释得清）。分片 sha256 相等是无歧义的。
  想先本地确认「产物里确实是这一版代码」，用**旧产物做差分**（`mv dist .tmp/dist-prev-<sha>` 留下的
  那一份就是上一版）：同一分片里本轮该消失/该出现的符号各数一次，两侧一比就知道。
- ⚠️ **探针要量「改动引入的形状」，不能量「那个符号的词频」** —— 同一个符号往往有**两处来源**，
  词频天然分不开。2026-09-25 实测：验证「关掉 `release` 注入每个 chunk」（注入的代码是
  `e.SENTRY_RELEASE={id:"…"}`）时，`grep -c SENTRY_RELEASE` 在**已修好**的线上入口分片里仍报 **1**
  —— 那一次是**源码自身**的引用（`typeof e.VITE_SENTRY_RELEASE=="string"`，即读 `import.meta.env`
  的业务逻辑，minify 后属性名保留）。换成**注入的形状** `grep -o 'SENTRY_RELEASE={' | wc -l` → **0**，
  结论立刻反过来。**先想「这个改动在产物里长什么样」，再写 grep**；只看词频会得出「修复没生效」。
- **发布记录文件（如 `deploy/production-release.json`）是覆盖式的「当前正式版本」**：覆盖前先看它
  记的是哪一版。如果中间有几次发布没写进去，**覆盖会连带丢掉那一条唯一记录** —— 这时宁可不写，
  把本次的回执与回滚目标写进人读的文档（如 `docs/reference/FRONTEND-CUTOVER.md` 的
  「当前正式版本」节，新的在上、旧的降为「上一版：」），并在报告里点名这个缺口等用户定。
  回滚链本身由回执里的 `previous.id` 保证连续，与那份 JSON 是否更新无关。
- **`--commit-hash` 用的是 `git rev-parse HEAD`**，所以推送必须先做，否则线上回执指向一个远端没有的提交。
- **发布脚本会留下未跟踪的产物与回执**（实例：`release-receipt.json` 与被追加过 `[vars]` 的配置）
  —— 属发布通道产物，**别顺手带进 main 的提交**；要还原的配置文件按项目文档还原。
- **HTTP 层全绿 ≠ 页面能开**：SPA 的典型事故是外壳 200、chunk 也在，运行时抛错 → 全白，
  **任何 HTTP 判据都不会红**。收尾用真浏览器打开线上地址，量标题 / 可见文字长度 / 控制台错误，
  **三者都要打出来**。
- **字节一致 + 冒烟不报错 ≠ 你改的那条交互是对的**（2026-09-21 实测，代价是当天发了两次）：
  同一天第一版修复的 index.html / 入口 / 改动分片 sha256 **三方全一致**、冒烟 5 条路由
  **0 控制台错误**，而用户报的那条交互**还是坏的**（受控 textarea 被旧值写回，只在真浏览器里发生）。
  所以：**改动涉及交互时，收尾必须在线上把那条交互真按一遍**（真登录 + 真输入 + 真按键），
  并且这条「按一遍」最好已经是一个脚本；**只跑冒烟等于没验**。
  同族：**单元测试测不出渲染时序**（`act()` 会把两次 flush 并在一起），
  这类缺陷的判据只能进真浏览器门禁 —— 别拿「单测全绿」当交互已验。
- **这个通道只推 main，不推发布分支**：发布分支的唯一作用是触发那个被额度锁死的工作流，
  上线已完成时再推一个分支是纯 churn（还要 `git add -f dist/`）。

## 第 3.6 步：让「不含产物改动」的提交不部署（路径过滤）

> 具体排除集、判据正则与实测读数记在项目文档（实例：`docs/reference/FRONTEND-CUTOVER.md` 的「推 main 即部署」节）。
> 下面的命令是**形状**，不是那份配置的副本 —— 两处各写一份一定会漂，改的时候改项目文档那份。

「推 main 即部署」的仓库里，**每次部署都可能让在线用户撞一次旧 chunk 404**：构建期把
release 短 sha 注入每个 chunk ⇒ **全部 chunk 名轮换**，而服务端的旧资源回退通常只覆盖
有限几个固定候选，标签页落后 ≥2 版就取不回来了。所以「哪些提交不该触发部署」值得单独设判据。

### 判据写成「默认部署、只排除已知不影响产物的路径」

**不要用白名单**（`paths:` 列出 `src/`、`public/`…）。白名单漏掉任何一个目录
（`functions/`、`scripts/`、各种配置、**workflow 自己**）就是「改了代码却不部署」——
那是**静默失败**，比多部署一次糟得多。排除集要窄到能逐个说出理由：

```bash
grep -qvE '^(docs/|.*\.md$|deploy/production-release\.json$)'
```

### 比较不出来时一律按「动了代码」处理

首次推送 / force push / `before` 不在本地（浅检出）—— 这三种情况 diff 不可用，
**fail-safe 到「部署」**，不要 fail 到「跳过」：

```bash
if [ -z "$before" ] || [ "$before" = "0000000000000000000000000000000000000000" ] \
   || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
  echo "code=true" >> "$GITHUB_OUTPUT"; exit 0
fi
```

### 不要用 workflow 级的 `on.push.paths-ignore`

它会让**整个 workflow 不跑**——连文档门禁一起没了，而文档提交恰恰最需要那些门禁。
改成 job 级：门禁照跑，**只让发布 job 跳过**（`needs: [..., changes]` + `if: ... && needs.changes.outputs.code == 'true'`）。
新 job 若被仓库的**本地 CI 镜像**解析（如 `scripts/ci-local.mjs` 的 `NON_LOCAL_JOBS`），
要同步登记 —— 本地没有「这次 push 的范围」这个概念。

### 验证：正则从 workflow 里**现读**，别另写一份

最容易犯的错是自己另写一份等价判据去测 —— 断言两侧同源，永远通过。正确做法是从
workflow 文件里抽出**那条真实正则**，再拿它在真实提交区间上跑：

```js
const script = yaml.load(readFileSync('.github/workflows/verify.yml','utf8')).jobs.changes.steps.find(s=>s.run).run
const pattern = /grep -qvE '([^']+)'/.exec(script)[1]   // ← 真的会跑的那条
```

三个方向都要验：

1. **代码提交不能被误排除** —— 拿一批「影响产物的路径」逐条过（`src/**`、`public/_headers`、
   `functions/**`、`index.html`、`wrangler.toml`、**`.github/workflows/*.yml` 自己**、
   `package.json`…），**必须全部判 true**；
2. **该跳过的确实跳过** —— 拿真实历史里的纯文档提交逐条过，判 false；
3. 报出「最近 N 个提交里有多少会被跳过」—— 它既是收益量化也是抽样检查。
   ⚠️ 这个数**要按最终判据重算**：只排除 `docs/**`+`*.md` 时是 14/60，
   把发布记录也排除后才到 20/60；先把预测数写进注释、实测才发现不一致。

⚠️ **`release` 被跳过这件事本机验不了**（不 push 就没有远端 run）。本地能验的只有
「YAML 结构 + 解析器回归 + 判据在真实历史上双向成立」，报告里要说清这条边界，
线上判据是「纯文档提交的 run 里 `release` 为 `skipped`」。

✅ **2026-09-25 两半都实测过了**：
- 含 `src/**` 的 10 提交推送（run `36062488106`）：`changes` job 日志原文「有非文档改动，照常发布」
  ⇒ `code=true`，`release` **`success`**（7/7 job 全绿）。
- **纯文档**推送（run `36073309681`，只改 `docs/reference/FRONTEND-CUTOVER.md`，tip `b2777fe`）
  ⇒ `release` **`completed/skipped`**，其余 6 个 job 全 `success`，总 `conclusion: success`。
  **零成本补记发布记录这条路是通的** —— 但注意总结论仍是 `success`，
  **只看 `conclusion` 区分不出「发布了」和「跳过了」，必须读 `--json jobs`。**
判据写法：`gh run view <id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'`，
要看到 `release: skipped`，**不是** `release: success`（`success` 说明它照样跑了）。
另注意：`changes` 自己也会出现在 `--json jobs` 里，别把它当成 `release` 的读数。

**顺带一条机械判据：拿发布回执里的 `previous` 与本文件上一条记录对账。** 2026-09-25 实测：
回执 `previous.id` = `0bda5dce`（`previousAsset` = `/assets/index-DCzt34gM.js`），而
`docs/reference/FRONTEND-CUTOVER.md` 的「当前正式版本」写的是 `99766b64` /
`index-DOX_iT79.js` ⇒ **两者之间至少还有一次未记录的部署**。这条对账能一眼看出「文档落后了几次」，
比逐条比对入口 chunk 名快。**发现缺口时如实标注，不要追补猜测的 UUID** ——
回滚链本身由回执的 `previous.id` 保证连续，文档只是人读记录。

## 第 3.7 步：本地全套测试红了 —— 先归因，别改代码

并行跑单测的仓库里，全套 `npm test` 会**随机红**，而红的往往是**超时**不是断言。
三条判据按可靠性排序：

1. **失败用例的耗时卡在超时上限**（最硬的一条）。Testing Library 的 `findBy*` / `waitFor`
   默认等 **1000ms**（`asyncUtilTimeout`），而 vitest 的 `testTimeout` 默认 **5000ms**
   —— **这是两个不同的预算**。2026-09-25 实测：5 条失败用例耗时 **1.03–1.11s**
   （精确卡在 1.0s），而同一文件**通过**的用例有跑到 **4.37s** 的
   ⇒ 缺的是前者（等 1 秒没等到），不是后者。
2. **失败文件不固定** —— 同一个提交跑多次，失败在多个文件之间跳。
3. **单跑那个文件稳定全过**（跑 3 次）—— 组件确实会渲染，只是负载下太慢。

**只有「稳定红 + 本轮动过相关文件」才算回归。**

⚠️ 三条要一起用：`findBy*` 在「元素**真的**不存在」时**也是**等满 1 秒才报错，
所以**单看耗时区分不了「慢」和「没有」**。第 3 条（单跑全过）才是决定性的。

**修法分两类，别混**：

| 失败形态 | 缺的是哪个预算 | 怎么修 |
|---|---|---|
| `findBy*` 卡在 1.0s | `asyncUtilTimeout`（Testing Library） | 在**文件顶层** `configure({ asyncUtilTimeout: 5000 })` |
| 整条用例卡在 `testTimeout` | `testTimeout`（vitest） | `vi.setConfig({ testTimeout: 60_000 })`，**并把最重的用例拆开** |

⚠️ **别逐个传 `{ timeout: 5000 }`** —— 这是 2026-09-25 被实测推翻的一条：
`App.test.tsx` 原先就是逐个传（已经有 7 处，甚至有一行专门写了注释解释），
但**漏了几处**，而漏掉的正是满负载时失败的那 5 条。逐个传的问题是**它依赖人记得写**。
改用文件顶层一行 `configure()`：覆盖该文件全部 `findBy*` / `waitFor`，不会再漏。

⚠️ 但要区分**文件级**和**项目级**：`configure` 改的是 Testing Library 的模块级配置，
**别放进 setup 文件或 vitest 配置**（那会波及所有测试文件，让"本该 1 秒报错的断言"
也变成 5 秒才报错，把快速的失败信号稀释掉）。写在**单个测试文件的顶层**是安全的 ——
前提是 vitest 的 `isolate` 为 `true`（默认值；若项目显式设过 `isolate: false`，先核对）。

⚠️ **光加 timeout 不够，还要拆重用例**：例如 `check-quick.test.ts` 有一条
「5 个路径的 for 循环」，一个用例里跑 5 次 `fixture()` + 5 次子进程。
拆成 5 条 `it.each` 后空载单条 **~5s → 0.97s**；但**满负载下仍被测到 37.30s**
（空载的 **38 倍**，Windows 上 git/node 子进程在满负载下启动极慢）——
所以 timeout 也要一起加（30s → 60s）。**两个都做才算修好**：
拆分是把负载从根上降下来，timeout 是缓冲。
拆分还顺带带来一个好处：失败时能直接看出是哪个路径，而不是靠 assert 的 message 猜。

⚠️ **别把全套测试与 tsc / lint / 门禁并行跑** —— 负载翻几倍，抖动概率大增。
2026-09-25 实测：并行时 9 红，单独跑 0 红。

⚠️ **门禁读数要在干净工作树上取**。合并后「在分支跑还是去 main 跑」这个问题，
判据是 `git diff --stat main HEAD`：为空 ⇒ 两边同一提交、跑哪边等价；
**但只要那边工作树有别人的未提交改动（例如别人的 `README.md`），就别在那边跑** ——
读数会混入那些改动，取到的不是你这个提交的数。这就是「构建前 `git status --porcelain
-- src/` 必须为空」的同一条原则。

### 反过来：CI 红、本机绿 —— 先找**环境差异**，别先改断言

本机全套绿、CI 某一片红，且失败是**真断言**（不是超时）时，第一嫌疑是
「这条断言依赖了某个**随运行环境变**的东西」。2026-09-26 实测一类：

**`String.prototype.localeCompare()` 不带参数 = 用运行时默认 locale。**

| 环境 | `Intl` 解析出的 locale | `'生图'.localeCompare('seedance/h3')` |
|---|---|---|
| 本机 Windows | `zh-CN` | `-1`（生图在前） |
| CI Linux runner | `en` | `1`（seedance 在前） |

后果：**排序结果随机器变**，于是「断言这个顺序」的测试本机绿、CI 红 ——
而且红的那条看起来像「产品坏了」，其实产品只是换了个顺序。
（同族：`Intl.NumberFormat` / `toLocaleString` / 日期格式 / 时区。）

判据与修法：

1. 先**实测**两种 locale 下的结果，不要靠推断：
   `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale, '生图'.localeCompare('seedance/h3'))"`
2. **修产品而不是修断言**：把比较器换成显式的 `new Intl.Collator('en')`（或项目选定的那个），
   让顺序与环境无关。只改断言等于把「顺序不可移植」留在代码里，下次换个环境还会红。
   顺带：两个模块**同一个概念的排序**要共用同一个比较器，否则它们会各排各的。
3. 同类调用点要一次点清：`localeCompare` 常散在多处，且**只有数据里同时有 CJK 与拉丁时才会暴露** ——
   纯 ASCII 的排序点（模型名 slug、日期）现在无害，但同属一类，要在报告里列出来。
4. 阳性对照：把显式 locale 临时换成另一个（`'en'` → `'zh'`），新断言必须**当场变红** ——
   否则你写的不是判据。
5. ⚠️ 这类差异**本机复现不了**，所以「本地跑一遍绿的」不构成证据。报告里要写清
   「本机绿 / CI 红，根因 = 环境 locale」，并指出**这次 CI 红导致 `release` 被跳过 = 没部署**
   —— 这一条比红本身更要紧。

## 第 3.8 步：部署链的「身份」与「版本一致性」

部署事故里最常见的一类不是代码错，是**「你以为在部署 A，实际在部署 B」**。四条判据，全部来自真实踩坑。

### 私有仓 404 = 没有权限，不是仓库没了

GitHub 对**无权访问的私有仓**一律返回 404（刻意不泄露存在性）。于是 404 有三种成因：仓库真不存在、路径拼错、token 没有该仓权限 —— `curl` 分不出来。

判据：用**目标账号的 token** 读一次 `gh api repos/<owner>/<repo> --jq .full_name`，能读到 `owner/repo` 才算通；读不到再去查仓库本身。**`curl` 的 404 在「有没有权限」这件事上没有判别力。**

真实踩过：`<account-a>/upstream-app` 与 `<account-b>/upstream-app` 只差一个字母，服务器 `gh` 默认登录的是后者；`git push` 报 `Repository not found` 看起来像仓库被删，实际是权限。同一账号下**不同 key 的模型授权也可以不同**（「同账号」不等于「同权限」）—— 配渠道前要用该渠道自己的 key 试一次目标模型。

### 容器 tag 不反映真实 commit，要看 digest

很多部署脚本把新镜像**重新打上一个固定 tag**（如 `local/x:cutover-<旧sha>`），于是 `docker ps` 里永远显示同一个名字，**与真实运行的 commit 无关**。

判据：
```bash
docker inspect <container> --format '{{.Image}}'     # digest
docker images --digests | grep <digest>              # 反查真正的 <repo>/<name>:<sha> tag
```
再用应用自己的版本字段（`/api/status.version`、`--version`）交叉验证。

### 部署后一致性断言：线上 == 部署 commit == main

**部署完必须核对三者相同**：
```bash
线上版本字段 == 部署的 commit == git rev-parse main
```
不同就是欠账。真实踩过两次：
- 功能分支部署了但没合回 main —— **从 main 再部署一次，这个功能会无声消失**（不是报错，是静默回退）；
- 另一版部署后又加了提交，main 落后一格。

同理，**部署脚本里写死的默认仓库会过期**：两个仓名只差一个字母、错的那个也有同名 workflow、main 停在三个月前 —— 忘了传 `--github-repo` 就会构建出旧代码并热替换到生产。修法：默认值从 `git remote` 解析 + 目标仓库与 remote 不一致时**在任何网络请求前**中止，而不是写死；加一条「解析不出就报错退出」，否则自检形同虚设。自检本身要做**正反两向**验证（错误仓库 exit 1、正确仓库 exit 0），只验负面分不清「自检有效」和「自检永远拒绝」。

### git 凭据一次性注入，不改全局配置

`git push` 报 `could not read Username for 'https://github.com'`：gh 登录了但 git 没配 credential helper。一次性解法：
```bash
git -c credential.helper='!gh auth git-credential' push ...
```
不改全局配置。同一台机器有多个账号时，先确认 `gh auth status` 的活跃账号是不是目标仓库有权限的那个。

## 报告格式（三栏）

**已实现 / 待核对 / 未执行**，并给出：

- 推送区间（`旧tip..新tip`）、提交数、文件数与增删行数
- 本地 vs 远端是否同步（`git rev-list --left-right --count origin/main...HEAD` → `0 0`）
- **CI run 号与结论**，附链接
- 悬空项（未并入的分支、stash）及其处置建议

## 反面清单

| 别做 | 为什么 |
|---|---|
| 把 `git push` 的输出当结论 | 那是本地 git 的自述，不是远端门禁的结论 |
| 把「命令跑完了」当构建成功 | 构建可能中途抛错而产物原样保留；判据是日志里的 `✓ built in` |
| 线上没变先怀疑 CDN 缓存 | 先量「线上入口 chunk 名 vs 本地」—— 不等就是根本没发上去 |
| 把 `cancelled` 当红（去查代码）或当绿（收工） | 它是被下一次 push 掐掉的；判据是最新 tip 的 `conclusion` |
| 靠特征字符串**计数**判断「新代码上去了」 | minify 后计数会变但解释不了；同一符号还常有**源码自身**与**注入**两处来源 ⇒ 量「改动引入的**形状**」或比**分片 sha256** |
| 改完 `concurrency` 只看总 `conclusion` | 矩阵 job 共用分组时会**同 run 内互相取消**，总结论只是 `cancelled`，根因要看 `--json jobs` 的逐片结论 |
| 为同一个 source commit 再打一个发布包 | 两个包都会部署、都 success、都不报警；先查一遍现有分支 |
| 用 `gh run watch \| tail` 判断 CI | 缓冲导致全程无输出，会误判为「还在跑」 |
| 因为推送无输出就重推 | 7 分钟无输出是正常的 |
| 把「无上游」的分支当成漏推去补推 | 部署/原型分支本该与 main 分叉 |
| 顺手删掉「未并入 main」的分支 | 它可能是发布通道或文档引用的证据链 —— 先 grep 文档再决定 |
| 自行 apply 他方 agent 的 stash | 无授权；先给「是否已被主线取代」的证据 |
| 丢弃 stash 前不验证备份可还原 | 导出非空 ≠ 能恢复，要在基准提交上 `apply --check` 通过 |
