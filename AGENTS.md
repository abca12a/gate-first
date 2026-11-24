# gate-first 协作与门禁约定（Dogfooding AGENTS.md）

本仓库不仅提供 `gate-first` 方法论，自身也 100% 遵循并运行同一套协作与门禁契约。

## 每轮开工先核对

1. 先读 [`docs/STATE.md`](./docs/STATE.md) 的「`## 当前动作`」节（受 120 行硬门禁守护），确认当前目标、未决项与授权范围。
2. 修改前核对 `git status`、`git diff --stat` 及并行会话写入边界；保留其他会话或用户的在途改动。
3. 编辑 `skills/` 下任何文档前，遵守 `writing-for-agents` 准则与宿主中立原则（宿主差异只写进 [`skills/lead-orchestration/references/host-adapters.md`](./skills/lead-orchestration/references/host-adapters.md)）。

## 唯一门禁执行入口

本仓已通过 `.githooks/pre-commit`（`git config --local core.hooksPath .githooks`）挂载统一狗粮总门禁：

```bash
npm test          # 等价于 node scripts/check-all.mjs
```

总门禁一次性串行覆盖 8 项硬判据（任一失败即退出 `1`）：

1. `skills/` 下全部 10 个 Skill 的 `validate-skill.mjs` 校验 + `--self-test` 阳性对照；
2. `check-host-neutral.mjs` 宿主中立性全量扫描 + `--self-test` 阳性对照；
3. `check-skill-deps.mjs` 技能间依赖闭包与相对资源完整性校验 + `--self-test`；
4. 本仓 `docs/STATE.md` 的 `check-state-log.mjs` 120 行上限检查；
5. 全仓 Markdown 相对链接与 `#anchor` 标题锚点检查（`check-doc-links.mjs`）；
6. `gates/examples/` 下 3 个真实事故门禁样本各自的 `test-positive-control.mjs` 与 `stop-hook-example.mjs --self-test`；
7. `.githooks/pre-commit`、`gates/hooks/pre-commit` 及脚手架钩子模板的字节级 `\r`（CRLF）零残留与 Git 索引 `100755` 可执行位检查；
8. `scripts/check-no-private-leak.mjs` 全仓隐私、路径与凭据脱敏扫描 + `--self-test` 阳性对照。

> **检查纪律**：已通过 `pre-commit` 钩子跑过 `check-all.mjs` 的同套提交不再手动重跑；未经过钩子时手动运行 `npm test` 并在回报中注明档位。严禁通过调高阈值、删除阳性对照或塞入无理由白名单换取绿灯。

## 仓库目录与只读/脱敏红线

- **零外部依赖红线**：`package.json` 不引入任何第三方运行时或开发依赖，所有检查器与脚手架仅使用 `Node.js >= 20` 标准库。
- **脱敏红线**：除公开仓库署名信息（作者 `han`、公开仓库 `abca12a/gate-first`、公开站点 `dimilinks.com`）外，全仓任何文档、可复用技能模板、注释或展示页中严禁出现本机系统用户名、含个人目录的盘符/家目录绝对路径、私有业务仓库/其它私有账号名、内网真实 IP 或真实 API 凭据（由 `npm run check:privacy` 强制拦截）。
- **外部操作边界**：本地编码、门禁测试与脚手架临时目录测试默认允许；`git push`、打 Tag 发布或外部写入须先获明确授权。
