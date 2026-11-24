# gate-first 当前状态（STATE）

> 维护契约：本文件自身受 [`gates/examples/01-state-log-cap/check-state-log.mjs`](../gates/examples/01-state-log-cap/check-state-log.mjs) 实时守护。「`## 当前动作`」节严禁超过 **120 行**；已完成阶段归入 `docs/archive/`。

## 当前动作

- **当前版本阶段**：`v0.1.0` 中英双语开源基线收口并同步推送 GitHub 与 GitHub Pages。
- **本轮已收口核心资产**：
  - 29 行全局协作规则双变体模板与上下文预算拆解（[`prompts/`](../prompts/README.md)）；
  - 后端无关的四层跨会话记忆契约与纯文件最小闭环模板（[`memory/`](../memory/CONTRACT.md)）；
  - 10 个宿主中立核心工作流 Skill、两阶段 `worktree` 校验器与 4 个零依赖维护检查器（[`skills/`](../skills/lead-orchestration/SKILL.md)）；
  - 门禁自增长协议、3 个真实生产事故复盘样本、GFM 锚点/非二进制密钥扫描加固与子进程阳性对照（[`gates/`](../gates/PROTOCOL.md)）；
  - 六层生产参考全栈双语白皮书（[`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md) · [`docs/REFERENCE-STACK.en.md`](./REFERENCE-STACK.en.md)）与中英双语仓库入口（[`README.md`](../README.md) · [`README.en.md`](../README.en.md)）；
  - 中英双语交互式全流程展示页（[`showcase/index.html`](../showcase/index.html)，已提交 `0f7a1ac`，支持 `?lang=en|zh`、`localStorage` 与 `navigator.language` 自动识别，在线版由 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) 自动发布）、3 分钟脚手架（[`scaffold/`](../scaffold/README.md)）与钩子 `LF + 100755` 总门禁（`scripts/check-all.mjs`）。
- **下一步**：
  1. 暂存双语文档更新，走 `.githooks/pre-commit` 提交；
  2. 按 `release-and-verify` 更新 GitHub 双语仓库简介、推送 `main` 至 `abca12a/gate-first` 并完成远端 `pages.yml` 双 job 及线上字节级 SHA-256 核验。
- **验收状态记账**：
  - `已验证`：双语展示页 Edge Headless CDP 多视口零溢出/零漏翻/SVG 边界实测，以及全仓 8/8 组狗粮门禁与阳性对照套件。
  - `待核对`：本轮双语文档提交后的 `git push`、远端 `pages.yml`（`build` / `deploy`）结论与线上 `index.html` SHA-256 一致性。

## 资料分工导航

| 需要查什么 | 权威入口 |
|---|---|
| 项目全景与 3 分钟快速开始 | [`README.md`](../README.md) · [`README.en.md`](../README.en.md) |
| 本仓协作约定与唯一门禁命令 | [`AGENTS.md`](../AGENTS.md) |
| 六层生产参考全栈（中英双语） | [`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md) · [`docs/REFERENCE-STACK.en.md`](./REFERENCE-STACK.en.md) |
| 门禁自增长协议与三态退出码规范 | [`gates/PROTOCOL.md`](../gates/PROTOCOL.md) |
| 跨会话四层记忆契约 | [`memory/CONTRACT.md`](../memory/CONTRACT.md) |
