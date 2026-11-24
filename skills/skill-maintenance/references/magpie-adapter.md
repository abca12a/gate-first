# Magpie 生产适配与防坑经验

本参考面向使用 **Magpie**（或同类跨宿主配置与技能同步器）在单机统一驱动多个编码宿主（如 Claude Code、Codex、DSH、OpenCode、Antigravity）的维护者。通用技能校验规则见 [SKILL.md](../SKILL.md)。

## 1. 实体层与入口层的本机拓扑

在生产多宿主环境中，推荐把「资产真源」与「宿主加载目录」彻底解耦：

| 层级 | 路径形态 | 登记与管理规则 |
|---|---|---|
| **自持技能实体** | `~/.config/magpie/library/skills/<name>`（或软链自本仓库 `skills/<name>`） | `library.json` 中该条目**不含 `source.repo`**，表示本地自持资产，可直接演进维护。 |
| **上游社区技能实体** | `~/.config/magpie/library/skills/<name>` | `library.json` 中带 `source.repo`（如 `mattpocock/skills`、`pbakaus/impeccable`）；更新走上游同步，不在本地缓存中混改。 |
| **宿主入口层** | `~/.agents/skills/<name>`、`~/.claude/skills/<name>`、`~/.codex/skills/<name>`、`~/.gemini/skills/<name>` 等 | **只放指向实体层的符号链接**，绝不在入口层直接新建实体文件夹（否则绕开 `library.json` 登记，下次 `sync` 后两边状态分裂）。 |
| **全局规则分发** | `~/.config/magpie/library/instructions.md` → 各宿主全局规则文件 | 必须为每个宿主生成带受管哈希块（`<!-- magpie:begin ... -->`）的**独立普通文件**，严禁将多个宿主的全局规则文件软链共指同一个共享中转文件（原因见下方坑 1）。 |

## 2. 三个真实踩过的生产事故（必防）

### 坑 1：3 个宿主的全局规则软链共指同一共享中转文件 → 覆写踩踏清空成 0 字节

**事故现场**：早期为了让多个宿主（`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md` 等共 3 个宿主入口）共用同一份全局规则，曾把这 3 个宿主的全局规则路径全部做成符号链接，共同指向同一个共享中转文件（`~/.agents/AGENTS.md`）。

**失效机制**：分发器执行 `sync` 时，按宿主顺序依次打开各宿主的目标路径并执行截断覆写（`O_TRUNC`）以更新受管块。由于 3 个入口在文件系统底层解析到**同一个共享中转文件 inode**，多个宿主通道在读写与截断同一底层文件时互相踩踏，直接把该共享目标文件清空成 **`0` 字节**——导致 3 个宿主的全局规则同时归零，而同步命令退出码仍为 `0`。

**硬判据与修法**：
1. **各宿主的全局规则文件必须是彼此独立的普通文件（Regular File），严禁多宿主软链共指同一共享中转目标**。先用 `lstat` 核对各宿主全局规则路径不是 symlink。
2. 由分发器将 `library/instructions.md` 的内容以受管标记块（`<!-- magpie:begin -->` ... `<!-- magpie:end -->`）分别写入各宿主独立的普通文件，并在同步后断言每个目标文件字节数 `> 0` 且包含受管起止标记。

### 坑 2：技能收敛下架后留下 33 条悬空软链，普通路径存在检查报「全绿」

**事故现场**：一次技能库收敛（将数十个细碎技能合并、下架过期技能）后，实体目录已清理干净，但某个宿主的 `skills/` 目录里残留了 **33 个指向已删除实体的符号链接**。用常规的「路径是否存在」判断逐条核验时，33 条悬空链接全部返回存在（因为链接文件本身的目录项仍在，只是目标没了），得出「0 断链」的假绿。宿主启动也不报错，只是静默丢失对应技能。

**硬判据与修法**：
1. 检查宿主入口目录时，**禁止用不跟随链接的存在性判断或仅靠 `lstat` 代替目标可达性判断**。
2. 必须先用 `fs.lstatSync` 识别符号链接，再用 `fs.statSync` **穿透符号链接读取目标**——目标不存在时抛出 `ENOENT`，立即记为 `BROKEN_LINK` 并退出 `1`（见 `scripts/check-host-skills.mjs`）。

### 坑 3：与外部记忆系统（如 OpenViking）混管导致 MCP 冲突

**硬判据与修法**：若生产栈同时挂载了 OpenViking 原生生命周期插件，严禁在 Magpie 的 MCP 表中重复下发裸 `uvx ... openviking` MCP（实测会报 `Initialize` 无响应，且与宿主插件内置的 stdio MCP 桥接代理抢占冲突）；同时将 Magpie 自带的 `magpie-memory` 设为 `hidden: true` 并在全部宿主置为 `paused`，保持「Magpie 只管静态提示词/Skill/常规 MCP 分发，OpenViking 专管动态记忆」的清晰切割。

## 3. Magpie 同步前后的标准核对清单

每次在共享库新增、改名、下架技能或修改全局规则后，按以下顺序核对：

```bash
# 1. 校验改动技能的 frontmatter 与目录名一致性
node skills/skill-maintenance/scripts/validate-skill.mjs <技能目录>

# 2. 校验全局共享技能未混入单一宿主专属词
node skills/skill-maintenance/scripts/check-host-neutral.mjs

# 3. 校验技能间引用与内部相对资源完整
node skills/skill-maintenance/scripts/check-skill-deps.mjs

# 4. 执行分发同步后，穿透链接检查各宿主实际加载目录（0 断链、0 空文件）
node skills/skill-maintenance/scripts/check-host-skills.mjs
```

### 登记一致性补充检查项

- **防未登记野生目录**：对比 `~/.agents/skills`（或各宿主入口）中的技能名集合与 `library.json` 的 `skills[].name` 集合，差集不为空说明有安装器绕过库把实体直接写进了入口层，需迁回 `library/skills/` 并补登记。
- **路由型技能配套分发**：若技能 A（如 `grill-with-docs`）依赖技能 B（如 `domain-modeling`），`library.json` 中技能 A 启用的 `agents` 集合必须是技能 B `agents` 集合的子集，防止某个宿主拿到了入口技能却读不到被调技能。
- **区分文件同步与会话生效**：以上四步全部退出 `0` 证明磁盘实体与宿主入口链接一致；正在运行中的旧会话不保证热刷新技能列表，最终生效以新开会话的技能列表为准。
