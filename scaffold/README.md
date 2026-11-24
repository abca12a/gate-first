# 3 分钟接入指南（Scaffold）

`scaffold/init-project.mjs` 用于在不引入任何 npm 依赖的前提下，用一条命令为**全新或已有** Git 仓库装入 `gate-first` 协作与提交门禁骨架。

> 实现同源说明：`scaffold/init-project.mjs` 直接复用 [`skills/lead-orchestration/scripts/init-project.mjs`](../skills/lead-orchestration/scripts/init-project.mjs)，全仓只维护唯一一份脚手架实现。

---

## 1. 一条命令安装

```bash
# 在你的目标 Git 仓库根目录安装（默认门禁命令为 npm test）
node scaffold/init-project.mjs /path/to/your-repo

# 自定义门禁入口命令（例如已有 lint + 单测组合）
node scaffold/init-project.mjs /path/to/your-repo --gate-command "npm run lint && npm test"
```

---

## 2. 「先认领、再创建」防冲突机制

把一套死板的文件名强塞进成熟仓库，只会制造「两份规则文件不知道信哪份」的混乱。脚手架在写盘前会逐项探测等价资产，**已有文件一律认领跳过、绝不覆盖**：

| 治理角色 | 自动探测的既有等价物 | 均不存在时才创建 |
|---|---|---|
| 项目协作规则入口 | `AGENTS.md` · `CLAUDE.md` · `GEMINI.md` · `.cursorrules` | `AGENTS.md` |
| 门禁执行入口 | `scripts/agent-gate.mjs` 或 `package.json` 中的 `gate` / `check:quick` / `verify` / `check` / `check:all` / `ci:local` | `scripts/agent-gate.mjs` |
| Git 提交前钩子 | `.githooks/pre-commit` · `.husky/pre-commit` | `.githooks/pre-commit`（并设本地 `core.hooksPath`） |
| 错题与门禁索引 | `docs/LESSONS.md` · `LESSONS.md` · `docs/GOTCHAS.md` · `docs/OPEN-ISSUES.md` | `docs/LESSONS.md` |
| 委派工单与证据模板 | 既有的 `TASK-TEMPLATE.md` / `EVIDENCE-REPORT.md` | `docs/AGENT-TASK-TEMPLATE.md` · `docs/EVIDENCE-REPORT.md` |

---

## 3. 装完必做的 4 步收口（3 分钟清单）

1. **填完 `AGENTS.md` 中的 `TODO:`**：写明本仓库核心目录、真实门禁命令与禁止触碰的边界，删掉占位提示。
2. **锁定钩子 LF 换行符与 `100755` 可执行位**：在目标仓库 `.gitattributes` 中加入：
   ```gitattributes
   .githooks/** text eol=lf
   ```
   并在首次暂存时执行 `git add --chmod=+x .githooks/pre-commit`，防止跨平台检出成 CRLF 或 `100644` 后在 Linux / macOS 上无法执行或静默跳过。
3. **按需拷入自增长门禁**：从 [`../gates/examples/`](../gates/PROTOCOL.md) 挑选适合你项目的检查器（如 `check-state-log.mjs`、`check-doc-links.mjs`、`check-secret-shapes.mjs`）挂进 `scripts/agent-gate.mjs`。
4. **跑一次真实阳性对照**：故意改坏一条断言或放一个死链，执行 `git commit` 确认钩子**当场变红阻断（非零退出码）**，再恢复文件提交入库。
