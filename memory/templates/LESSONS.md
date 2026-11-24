# 项目错题本与门禁索引（LESSONS）

> 维护契约：只记**犯过第二次**或代价极高的真实事故。**凡能用程序二元判定的约束，一律升级成测试或门禁脚本，本文件只留一行索引**；下方正文只保留仍需上下文判断的经验。

## 已升级为机器门禁（零上下文负担，提交必拦）

| 历史事故模式 | 拦截门禁脚本 | 阳性对照验证入口 |
|---|---|---|
| `STATE.md` 只打警告退 0，8 天膨胀至 569 行 / 104 KB | `gates/examples/01-state-log-cap/check-state-log.mjs` | `gates/examples/01-state-log-cap/test-positive-control.mjs` |
| 归档文档原文未改但目录深一层，静默断掉 4 条相对链接 | `gates/examples/02-doc-links/check-doc-links.mjs` | `gates/examples/02-doc-links/test-positive-control.mjs` |
| 未 `git add` 的新建文件混入测试密钥漏扫 & 白名单过期堆积 | `gates/examples/03-secret-shapes/check-secret-shapes.mjs` | `gates/examples/03-secret-shapes/test-positive-control.mjs` |

## 仍需人工 / Agent 上下文判断的经验

### 1. TODO: 一句话概括事故形状

- **症状**：TODO: 表面看到的现象。
- **真实根因**：TODO: 底层机制原因（而非「疏忽了」）。
- **操作判据**：TODO: 下次动手前先跑哪条命令、看到什么读数才继续。
- **失效条件**：TODO: 当依赖的框架/工具升级或移除时本条作废（首次记录：YYYY-MM-DD）。
