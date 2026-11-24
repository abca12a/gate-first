# 给项目装协作骨架

只有“给一个新项目装工作流”时才读本文件。日常协作决策读 [SKILL.md](../SKILL.md)。

## 先找项目已有的入口，再决定落什么

**不要把一套固定文件名硬塞进已有项目。** 装之前先核对五类入口是否已经存在：

| 要找的 | 常见已有形态（示例，不是必须） | 找不到才创建 |
|---|---|---|
| 协作 / 状态入口 | 项目根已有项目规则文件（`AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 等），或状态入口文档 | `AGENTS.md` |
| 门禁入口 | `package.json` 里已有 gate / check / verify 一类脚本；或已有 `scripts/*-gate.mjs` | `scripts/agent-gate.mjs` |
| 提交钩子 | 已有 `.githooks/pre-commit`、`.husky/pre-commit`，或仓库已设 `core.hooksPath` | `.githooks/pre-commit` |
| 踩坑记录 | `GOTCHAS` / `LESSONS` / 已有问题清单 | `docs/LESSONS.md` |
| 工单 / 证据模板 | 项目自己的任务模板、回报模板 | `docs/AGENT-TASK-TEMPLATE.md`、`docs/EVIDENCE-REPORT.md` |

已有等价物时不落重复文件，脚本会在输出里点名“它认到了哪一份”。判断顺序：**先认领、再创建**；两套并存的代价是后来的人不知道该更新哪一份。

## 一条命令做什么

```text
node <本技能目录>/scripts/init-project.mjs <项目目录> [--gate-command "<验收命令>"]
```

- 落上面那五类里**项目还没有**的那些文件；重复运行安全，不覆盖已有文件。
- 已有门禁入口时，钩子直接调用项目自己的入口，不再生成一层包装；没有时才生成 `scripts/agent-gate.mjs`。
- 设仓库本地 `core.hooksPath`；已有别的设置时不覆盖，只提示手工合并。
- 不装依赖、不改别的项目、不写用户级配置。

## 装完必须做的

1. 改项目规则文件的 TODO：脚本落的是 `AGENTS.md`，已有 `CLAUDE.md` 等等价文件时改的就是那一份——项目在哪、跑什么命令、什么不许碰。
2. 核一遍门禁入口：项目已有入口时确认钩子调的就是它；生成了 `scripts/agent-gate.mjs` 时改里面的检查项（默认只有一条 `npm test`，按项目加减）。
3. 把钩子与门禁入口提交进仓库，否则换机器或重新 clone 就没了（钩子文件也要在 `.gitattributes` 里钉 `eol=lf`，CRLF 的钩子在按 shebang 执行的系统上起不来）。
4. 验证：在项目里制造一次已知失败（改坏一个断言），确认钩子真拦下**且退出码非零**；再修好确认放行。**缺门禁脚本或缺运行时必须拦下（退出码 1），不能放行** —— 「没跑」和「通过」在退出码上必须分开。

## 功能地图

装完骨架后给项目建一份可执行的功能地图，不建纯文档：

- 路由或页面清单：从现有路由配置派生的契约测试，新增页面未登记就红。
- 主流程冒烟：一个脚本按“打开、操作、断言关键元素”跑 3–5 条主流程，结果写本地证据目录。每条断言要能区分“对的页面”和兜底页（404、首页静态壳、加载中）：只判字数或容器存在会假绿；缺数据时记失败，不静默跳过；产物比源码旧时拒跑。
- 覆盖登记：路由与冒烟脚本之间放一份覆盖登记（自动打开 / 专项场景 / 写明理由的豁免），登记完整性做成门禁里的快速单测，浏览器部分不进门禁。
- 数据页：本地只验能打开、不白屏；数据内容用真实环境验收。
- 命令写进 `package.json`（例如 `test:interactions`），不放进提交门禁，作为发布前检查。

## 模板与契约

- 工单：[templates/AGENT-TASK-TEMPLATE.md](../templates/AGENT-TASK-TEMPLATE.md)
- 证据回报：[templates/EVIDENCE-REPORT.md](../templates/EVIDENCE-REPORT.md)
- 工作区隔离检查：[worktree.md](worktree.md)
