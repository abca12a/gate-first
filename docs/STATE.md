# gate-first 当前状态（STATE）

> 维护契约：本文件自身受 [`gates/examples/01-state-log-cap/check-state-log.mjs`](../gates/examples/01-state-log-cap/check-state-log.mjs) 实时守护。「`## 当前动作`」节严禁超过 **120 行**；已完成阶段归入 `docs/archive/`。

## 当前动作

- **当前版本阶段**：`v0.1.0` 中英双语开源基线已推送 GitHub，当前正在接入 GitHub Pages + Cloudflare Pages（`gate-first.dimilinks.com`）双端自动同步流水线。
- **本轮已收口核心资产**：
  - 29 行全局协作规则双变体模板与上下文预算拆解（[`prompts/`](../prompts/README.md)）；
  - 后端无关的四层跨会话记忆契约与纯文件最小闭环模板（[`memory/`](../memory/CONTRACT.md)）；
  - 10 个宿主中立核心工作流 Skill、两阶段 `worktree` 校验器与 4 个零依赖维护检查器（[`skills/`](../skills/lead-orchestration/SKILL.md)）；
  - 门禁自增长协议、3 个真实生产事故复盘样本、GFM 锚点/非二进制密钥扫描加固与子进程阳性对照（[`gates/`](../gates/PROTOCOL.md)）；
  - 六层生产参考全栈双语白皮书（[`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md) · [`docs/REFERENCE-STACK.en.md`](./REFERENCE-STACK.en.md)）与中英双语仓库入口（[`README.md`](../README.md) · [`README.en.md`](../README.en.md)）；
  - 中英双语交互式全流程展示页（[`showcase/index.html`](../showcase/index.html)）与双端自动部署工作流（[`.github/workflows/pages.yml`](../.github/workflows/pages.yml)：同步发布至 `abca12a.github.io/gate-first` 与 `gate-first.dimilinks.com`，外部 fork 自动跳过 Cloudflare job）、3 分钟脚手架（[`scaffold/`](../scaffold/README.md)）与钩子 `LF + 100755` 总门禁（`scripts/check-all.mjs`）。
- **下一步**：
  1. 提交 `.github/workflows/pages.yml` 与双端链接文档改动，走真实 `.githooks/pre-commit`；
  2. 推送 `origin/main`，核验 `build` / `deploy` / `deploy-cloudflare` 三 job 全绿，并逐字节对账两个线上域名的 SHA-256。
- **验收状态记账**：
  - `已验证`：双语展示页 Edge Headless CDP 真机实测、GitHub Pages（`a3bbcc6` / run `45419867161`）SHA-256 逐字节一致、Cloudflare Token 有效且仓库加密 Secrets 已写入。
  - `待核对`：接入 `deploy-cloudflare` 后的三 job CI 实跑结论及 `https://gate-first.dimilinks.com/` 逐字节 SHA-256 对账。

## 资料分工导航

| 需要查什么 | 权威入口 |
|---|---|
| 项目全景与 3 分钟快速开始 | [`README.md`](../README.md) · [`README.en.md`](../README.en.md) |
| 本仓协作约定与唯一门禁命令 | [`AGENTS.md`](../AGENTS.md) |
| 六层生产参考全栈（中英双语） | [`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md) · [`docs/REFERENCE-STACK.en.md`](./REFERENCE-STACK.en.md) |
| 门禁自增长协议与三态退出码规范 | [`gates/PROTOCOL.md`](../gates/PROTOCOL.md) |
| 跨会话四层记忆契约 | [`memory/CONTRACT.md`](../memory/CONTRACT.md) |
