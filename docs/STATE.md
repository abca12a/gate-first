# gate-first 当前状态（STATE）

> 维护契约：本文件自身受 [`gates/examples/01-state-log-cap/check-state-log.mjs`](../gates/examples/01-state-log-cap/check-state-log.mjs) 实时守护。「`## 当前动作`」节严禁超过 **120 行**；已完成阶段归入 `docs/archive/`。

## 当前动作

- **当前版本阶段**：`v0.1.0` 开源首发基线就绪（核心契约、10 个工作流 Skill、自举门禁、六层生产参考全栈白皮书与交互式展示页已全部合拢）。
- **本轮已收口核心资产**：
  - 29 行全局协作规则双变体模板与上下文预算拆解（[`prompts/`](../prompts/README.md)）；
  - 后端无关的四层跨会话记忆契约与纯文件最小闭环模板（[`memory/`](../memory/CONTRACT.md)）；
  - 10 个宿主中立核心工作流 Skill、两阶段 `worktree` 校验器与 4 个零依赖维护检查器（[`skills/`](../skills/lead-orchestration/SKILL.md)）；
  - 门禁自增长协议、3 个真实生产事故复盘样本、GFM 锚点/非二进制密钥扫描加固与子进程阳性对照（[`gates/`](../gates/PROTOCOL.md)）；
  - 六层生产参考全栈白皮书：EasyTier 零公网暴露加密虚拟网 + OpenViking `v0.5.5` 异构双模型与 6 项专属定制 + Magpie 单一真源分发（[`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md)）；
  - 交互式全流程展示页（[`showcase/index.html`](../showcase/index.html)，在线版 `https://abca12a.github.io/gate-first/` 由 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) 自动发布）、3 分钟接入脚手架（[`scaffold/`](../scaffold/README.md)）与钩子 `LF + 100755` 总门禁（`scripts/check-all.mjs`）。
- **下一步**：
  1. 暂存公开署名、链接与 GitHub Pages 部署工作流改动，走 `.githooks/pre-commit` 完成提交；
  2. 按 `release-and-verify` 推送至 `abca12a/gate-first` 并核对远端 Pages 部署结论。
- **验收状态记账**：
  - `已验证`：全仓 8/8 组狗粮门禁、阳性对照套件、脚手架临时子仓集成测试与通用结构化脱敏扫描。
  - `未执行`：首笔 `git commit` 与远端 GitHub `git push`（按当前协调指令待统一触发）。

## 资料分工导航

| 需要查什么 | 权威入口 |
|---|---|
| 项目全景与 3 分钟快速开始 | [`README.md`](../README.md) · [`README.en.md`](../README.en.md) |
| 本仓协作约定与唯一门禁命令 | [`AGENTS.md`](../AGENTS.md) |
| 六层生产参考全栈（EasyTier + OpenViking + Magpie） | [`docs/REFERENCE-STACK.md`](./REFERENCE-STACK.md) |
| 门禁自增长协议与三态退出码规范 | [`gates/PROTOCOL.md`](../gates/PROTOCOL.md) |
| 跨会话四层记忆契约 | [`memory/CONTRACT.md`](../memory/CONTRACT.md) |
