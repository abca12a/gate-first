# worktree 隔离

只有多个写者需要并行、必须隔离风险，或任务明确要求独立分支时，才建立 worktree。单负责人可在获授权的主目录顺序修改。

## 建立与两阶段检查

1. **先核对主目录**：确认当前分支、完整基线 SHA、status 和 diff。未提交改动不随 worktree 带走。
2. **开工前基线核验（`--phase pre`，默认）**：建好独立 worktree 与独立分支后、动笔修改前运行：
   ```text
   node <本技能目录>/scripts/check-worker-workspace.mjs <主目录> <写入目录> <完整基线SHA> --phase pre
   ```
   确认同仓库独立工作树、独立分支、`HEAD === 基线 SHA` 且工作树干净（退出码 `0` 且 JSON `ok: true`）。
3. **隔离执行与本地提交**：在 worktree 内按工单限定范围修改，不跨目录改主检出；跑通门禁并在该独立分支完成本地提交。
4. **提交后交付核验（`--phase post`）**：执行者完成本地提交、向负责人回报合并前运行：
   ```text
   node <本技能目录>/scripts/check-worker-workspace.mjs <主目录> <写入目录> <完整基线SHA> --phase post
   ```
   确认执行者工作树无脏残留、`HEAD !== 基线 SHA` 且 `HEAD` 严格是从工单基线演进的后代提交（`git merge-base --is-ancestor`）。该检查只核对拓扑、基线演进与干净态，不替代 diff 范围审查，也不是 OS 沙箱。

## 不隔离的东西

worktree 不隔离端口、账户、数据库、依赖链接、缓存或外部副作用。这些资源逐任务指定归属；非 Git 资产需要写入时，先完整备份、记录哈希并限定单写者。

## 合并前

负责人审查实际差异、基线和未覆盖项；worktree 里“检查通过”不等于改动可信。合并后按项目门禁在提交点再跑一次。
