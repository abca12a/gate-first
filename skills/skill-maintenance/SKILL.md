---
name: skill-maintenance
description: Maintain local skills when trigger boundaries overlap, copies drift, duplicate registrations appear, or an edited skill needs validation. Check ownership, YAML, loading paths, and reusable behavior without expanding the task.
agent_created: true
user-invocable: true
---

# Skill asset maintenance

维护 skill 的选择边界、单一真源与可验证性。项目文档漂移用 `docs-drift-audit`；将真实缺陷转成约束用 `pit-to-gate`。只处理与当前任务相关的资产。

## 先确认来源

- 查看目录链接目标、来源索引和安装元数据；`agent_created: true` 也曾加给第三方移植件，不能单凭它认定所有权。
- 区分自建、本地适配、上游原件和插件缓存。按用户授权维护本地资产，保留来源及特殊调用策略；不修改供应商缓存来覆盖上游规则。
- 先备份有独有内容的文件，记录实际加载入口。多个副本不能仅按修改时间决定哪份是源。

## 触发重叠

1. 比较每条 skill 独有的输入、判断轴、输出和执行限制。有独立价值就按用户问题划界；确实完全重叠才合并，并迁移仍有价值的内容。
2. 在双方 description 和正文表达一致边界；例如“找实际缺陷”和“审需求符合性”。任务问题优先于“是否由另一个 agent 委派”等调用方式。
3. 更新实际存在的路由索引，移除悬空入口；不要为一次划界另建索引。
4. 用普通请求、边界请求和不应触发的请求走查。能力选对、必要证据不丢、用户已给的信息不重复问，才算完成。

## 副本漂移与重复加载

```text
# 先看目录是不是链接、指向哪里（按当前环境可用的方式；判据是「链接类型 + 目标」两列）
ls -l <技能目录的父目录>
```

实体目录需要比较，链接需要检查目标。比较整个 skill，包括 scripts、references、templates 和元数据；文本忽略 BOM / 换行差异，二进制按字节比较。正文相同不代表调用策略或脚本相同。

- 先合并独有内容再同步；不同宿主的有意适配不强行覆盖。
- 一个宿主同时扫描多个路径时，同名项可能重复注入；两个链接指向同一文件也不代表只加载一次。去重前验证保留入口确实可发现。
- 若同一个技能在两处都被扫到，先查**分发器**是谁：把实体复制出去（而不是链接）的那一端会持续再生副本，只删副本不修分发器等于做一次性的表面清理。
- 在用户授权的清理范围内，优先把已确认冗余副本移出扫描目录并保留回退。先核实绝对源/目标路径、所有资源与消费者，再移动；不递归删除链接目标。
- 停止重复的分发入口才算修完再生原因；不要趁分发进程持有内存状态时改库。

## 单一真源与宿主入口拓扑

跨多个编码宿主共用同一套技能时，严格分离**实体层（唯一真源）**与**入口层（宿主发现路径）**：

| 层级 | 职责与管理原则 |
|---|---|
| **实体层：自持技能** | 存放在单一真源目录（如本仓库的 `skills/<name>` 或共享资产库），目录名严格等于 frontmatter 的 `name`；只在此处编辑。 |
| **实体层：上游社区技能** | 独立登记来源仓库与许可证（如 `mattpocock/skills`），通过上游同步机制更新，不混入自持仓库冒充原创，也不直接改写缓存副本。 |
| **入口层：各宿主加载根** | 各宿主目录（如 `~/.claude/skills`、`~/.agents/skills`、`~/.codex/skills`、`~/.gemini/skills` 等）只放**指向实体层的符号链接/目录联接**。某宿主的目录为空不等于没有技能，核对时以宿主实际列出的 catalog 为准。 |
| **宿主内置技能 / 插件缓存** | 留在宿主管理的 `.system` 或插件缓存目录；不编辑缓存，也不单凭同名删除有意适配件。 |

技能名按职责取语义名（如 `lead-orchestration`、`defect-review`、`release-and-verify`、`skill-maintenance`），不用宿主名或工具名作前缀。改名必须同时处理实体目录、frontmatter 的 `name`、分发器登记表及各宿主入口链接；只改 YAML 名称会造成登记名与入口名脱节。

- 每项分别保留原有消费者，不把“纳管”变成“给所有宿主全部启用”。
- 不要在宿主入口层直接新建实体目录——实体落进入口层会绕开单一真源，下次同步或换机即脱节。
- 若使用 Magpie 作为多宿主资产分发器，登记表校验、软链截断陷阱与生产拓扑细节见 [Magpie 生产适配与防坑经验](references/magpie-adapter.md)。

## 四步零依赖验证流水线

新建、修改、重命名或下架技能后，按顺序运行以下四个零依赖检查器（仅依赖 Node.js 内置模块）：

### 1. 生成时单技能校验（`validate-skill.mjs`）

```bash
node <本技能目录>/scripts/validate-skill.mjs <技能目录>
node <本技能目录>/scripts/validate-skill.mjs --self-test
```

逐条检查单个技能目录形状（对齐上游 `quick_validate.py` 并补齐目录名一致性）：
1. `SKILL.md` 存在；
2. 内容以 `---` 开头，frontmatter 能被 `^---\r?\n([\s\S]*?)\r?\n---` 匹配；
3. `name`、`description` 存在且非空；
4. `name` 为 hyphen-case（小写字母、数字、连字符，不以连字符起止，无连续连字符）；
5. `description` 不含 `<` 或 `>`；
6. `name` 与目录名一致（防登记名与入口名脱节，宿主对此类脱节通常静默跳过）。

退出码：`0` 通过 / `1` 资产问题 / `2` 运行错误。

### 2. 宿主中立性门禁（`check-host-neutral.mjs`）

```bash
node <本技能目录>/scripts/check-host-neutral.mjs                  # 默认自动定位并扫描同级 skills/ 目录
node <本技能目录>/scripts/check-host-neutral.mjs --root <目录>    # 指定扫描目录（或临时阳性对照夹具）
node <本技能目录>/scripts/check-host-neutral.mjs --self-test      # 内置好坏对照测试
```

扫描共享技能的全部文本文件，命中**宿主专属词**（只在单一宿主成立的专有接口或配置词）即退出 `1` 并打印 `文件:行:命中词`。唯一业务豁免是 `lead-orchestration/references/host-adapters.md`（宿主差异映射表集中留在该处）。

**判据**：「这个词会不会在另一个宿主上变成假的」。混入全局技能正文后，其他宿主读到自己没有的接口不会报错，只会在运行时变形或静默失败。

### 3. 依赖闭包与内部引用检查（`check-skill-deps.mjs`）

```bash
node <本技能目录>/scripts/check-skill-deps.mjs                  # 默认扫描同级 skills/ 目录
node <本技能目录>/scripts/check-skill-deps.mjs --root <目录>    # 限定扫描入口（可重复传）
node <本技能目录>/scripts/check-skill-deps.mjs --self-test      # 内置好坏对照测试
```

只读检查三件事：① 技能间硬依赖引用是否仍在当前 catalog（推荐搭配的外部上游技能单独提示，不混同于断链）；② `SKILL.md` 及附属文档中的 Markdown 相对链接与 `references/`、`templates/`、`assets/` 资源是否存在；③ 提及的外部 CLI 命令是否在 `PATH`（外部命令缺失仅列为警告，不判资产失败）。退出码：`0` 通过 / `1` 资产问题 / `2` 运行错误。

### 4. 宿主入口拓扑与悬空链接检查（`check-host-skills.mjs`）

```bash
node <本技能目录>/scripts/check-host-skills.mjs                  # 扫描本机常见宿主 skills 根
node <本技能目录>/scripts/check-host-skills.mjs --root <目录>    # 扫描指定宿主入口目录
node <本技能目录>/scripts/check-host-skills.mjs --self-test      # 内置悬空链接与坏头部对照测试
```

在下架技能、合并目录、执行分发同步或换新机器后运行，拦截四类宿主侧静默退化：`BROKEN_LINK`（悬空符号链接）、`MISSING_ENTRY`（缺 `SKILL.md`）、`INVALID_FRONTMATTER`（未闭合或非 `---` 开头）、`MISSING_FIELD`（缺 `name` 或 `description`）。

**核心判据**：一律用 `fs.statSync` **穿透符号链接**（目标不存在抛 `ENOENT` 才算断链），绝不用普通路径存在判断——后者对悬空符号链接仍返回存在，会在下架技能后给出「零断链」的假绿。

## 完成判据

选择边界清楚，四个零依赖检查器（含 `--self-test` 阳性对照）均退出 `0`，实际加载路径可正常读回改动，重复再生原因已消除或明确限定；声明宿主自动生效前，以新会话刷新后的实际发现结果为准。
