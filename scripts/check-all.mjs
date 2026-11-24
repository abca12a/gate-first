#!/usr/bin/env node
/**
 * gate-first 全仓统一狗粮总门禁入口（被 `npm test` 与 `.githooks/pre-commit` 直接调用）。
 *
 * 严格按顺序执行 8 大项硬判据，任一子项返回非 0 立即记为失败并以退出码 1 阻断：
 *   ① 10 个核心工作流 Skill 的 validate-skill.mjs 逐个校验 + --self-test 阳性对照；
 *   ② check-host-neutral.mjs 全量扫描 skills/ + --self-test 阳性对照；
 *   ③ check-skill-deps.mjs 依赖闭包扫描 skills/ + --self-test + check-host-skills.mjs / check-worker-workspace.mjs --self-test；
 *   ④ 本仓 docs/STATE.md 的 check-state-log.mjs 120 行上限校验；
 *   ⑤ 全仓 Markdown 相对链接与锚点校验 check-doc-links.mjs；
 *   ⑥ 3 个真实事故门禁样本各自的 test-positive-control.mjs + stop-hook-example.mjs --self-test；
 *   ⑦ POSIX Git 钩子文件字节级 `\r` (CRLF) 零残留检查 + 已入索引钩子的 `100755` 可执行位检查（含子仓阳性对照）；
 *   ⑧ check-no-private-leak.mjs 全仓脱敏扫描 + --self-test + check-secret-shapes.mjs 全仓扫描。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath

const EXPECTED_SKILLS = [
  'audit-fix-loop',
  'defect-review',
  'docs-drift-audit',
  'git-branch-worktree-cleanup',
  'lead-orchestration',
  'pit-to-gate',
  'project-orientation',
  'release-and-verify',
  'retire-dead-subsystem',
  'skill-maintenance',
]

const HOOK_FILES_MUST_BE_LF_AND_EXEC = [
  '.githooks/pre-commit',
  'gates/hooks/pre-commit',
  'skills/lead-orchestration/templates/githooks/pre-commit',
]

function cleanGitEnv() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete env[k]
  }
  return env
}

/**
 * 检查单个 POSIX 钩子文件：
 * 1. 字节级 CR (0x0d) 必须为 0；
 * 2. 若已被 Git 索引跟踪（`git ls-files --stage -- <rel>` 非空），mode 必须为 `100755`（100644 在 Linux/macOS 会静默跳过钩子）。
 */
export function inspectHookFile(repoRoot, rel, env = cleanGitEnv()) {
  const abs = join(repoRoot, rel)
  if (!existsSync(abs)) {
    return { ok: false, reason: `钩子文件缺失：${rel}` }
  }
  const buf = readFileSync(abs)
  let crCount = 0
  for (const byte of buf) {
    if (byte === 0x0d) crCount += 1
  }
  if (crCount > 0) {
    return {
      ok: false,
      reason: `${rel} 检测到 ${crCount} 个 CR (\\r) 字节，POSIX 内核执行 #!/bin/sh\\r 会报坏解释器！`,
    }
  }

  const stage = spawnSync('git', ['ls-files', '--stage', '--', rel], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    windowsHide: true,
  })
  const stageLine = (stage.stdout || '').trim()
  if (stage.status === 0 && stageLine) {
    const mode = stageLine.split(/\s+/)[0]
    if (mode !== '100755') {
      return {
        ok: false,
        reason: `${rel} 在 Git 索引中的权限位为 ${mode}（必须为 100755，否则 Linux/macOS 会静默不跑钩子）！请执行：git update-index --chmod=+x ${rel}`,
      }
    }
    return { ok: true, bytes: buf.length, mode }
  }

  return { ok: true, bytes: buf.length, mode: 'untracked (首次 git add 请用 --chmod=+x)' }
}

function runHookCheckSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'hook-mode-selftest-'))
  const env = cleanGitEnv()
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: tmp, env, windowsHide: true }).status, 0)
    mkdirSync(join(tmp, '.githooks'), { recursive: true })
    const hookPath = join(tmp, '.githooks', 'pre-commit')

    // 1. CRLF 坏例 ⇒ 必须拦截
    writeFileSync(hookPath, '#!/bin/sh\r\nexit 0\r\n', 'utf8')
    const rCrlf = inspectHookFile(tmp, '.githooks/pre-commit', env)
    assert.equal(rCrlf.ok, false)
    assert.match(rCrlf.reason, /CR \(\\r\) 字节/)

    // 2. LF 但以 100644 暂存（Windows git add 默认行为）⇒ 必须拦截并提示 chmod=+x
    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n', 'utf8')
    assert.equal(
      spawnSync('git', ['add', '--chmod=-x', '.githooks/pre-commit'], { cwd: tmp, env, windowsHide: true }).status,
      0
    )
    const r644 = inspectHookFile(tmp, '.githooks/pre-commit', env)
    assert.equal(r644.ok, false)
    assert.match(r644.reason, /100644/)
    assert.match(r644.reason, /git update-index --chmod=\+x/)

    // 3. 执行 git update-index --chmod=+x 升为 100755 ⇒ 通过
    assert.equal(
      spawnSync('git', ['update-index', '--chmod=+x', '.githooks/pre-commit'], { cwd: tmp, env, windowsHide: true }).status,
      0
    )
    const r755 = inspectHookFile(tmp, '.githooks/pre-commit', env)
    assert.equal(r755.ok, true)
    assert.equal(r755.mode, '100755')

    console.log('  PASS  阳性对照：钩子 CRLF 与索引 100644 均被拦截，update-index --chmod=+x (100755) 后放行')
    return true
  } catch (err) {
    console.error(`  FAIL  钩子权限阳性对照失败：${err.message}`)
    return false
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

let failedSteps = 0

function banner(index, title) {
  console.log(`\n━━━ [${index}/8] ${title} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

function runNode(scriptRelPath, args = []) {
  const scriptAbs = join(ROOT, scriptRelPath)
  const res = spawnSync(NODE, [scriptAbs, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  return res.status === 0
}

const startedAt = Date.now()

// ① 10 个 Skill 格式与名称一致性校验 + --self-test
banner(1, '校验全部 10 个核心 Skill 目录形状与 validate-skill 阳性对照')
{
  let stepOk = true
  const skillsDir = join(ROOT, 'skills')
  const actualSkills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()

  const missing = EXPECTED_SKILLS.filter((s) => !actualSkills.includes(s))
  if (missing.length > 0) {
    console.error(`[check-all] ✗ 缺少预期的核心 Skill：${missing.join(', ')}`)
    stepOk = false
  }
  for (const skill of actualSkills) {
    if (!runNode('skills/skill-maintenance/scripts/validate-skill.mjs', [join('skills', skill)])) {
      stepOk = false
    }
  }
  if (!runNode('skills/skill-maintenance/scripts/validate-skill.mjs', ['--self-test'])) {
    stepOk = false
  }
  if (!stepOk) failedSteps += 1
}

// ② 宿主中立性扫描 + 阳性对照
banner(2, '校验 skills/ 宿主中立性门禁与阳性对照')
{
  const okScan = runNode('skills/skill-maintenance/scripts/check-host-neutral.mjs')
  const okTest = runNode('skills/skill-maintenance/scripts/check-host-neutral.mjs', ['--self-test'])
  if (!okScan || !okTest) failedSteps += 1
}

// ③ 技能依赖闭包、宿主软链与 worktree 两阶段检查器自测
banner(3, '校验 skills/ 依赖闭包完整性、宿主软链与 worktree 两阶段自测')
{
  const okDeps = runNode('skills/skill-maintenance/scripts/check-skill-deps.mjs')
  const okDepsTest = runNode('skills/skill-maintenance/scripts/check-skill-deps.mjs', ['--self-test'])
  const okHostTest = runNode('skills/skill-maintenance/scripts/check-host-skills.mjs', ['--self-test'])
  const okWtTest = runNode('skills/lead-orchestration/scripts/check-worker-workspace.mjs', ['--self-test'])
  if (!okDeps || !okDepsTest || !okHostTest || !okWtTest) failedSteps += 1
}

// ④ 本仓狗粮 docs/STATE.md 120 行上限检查
banner(4, '校验本仓 docs/STATE.md 「当前动作」120 行硬上限')
{
  if (!runNode('gates/examples/01-state-log-cap/check-state-log.mjs')) failedSteps += 1
}

// ⑤ 全仓 Markdown 相对链接与标题锚点校验
banner(5, '校验全仓 Markdown 相对链接与 #anchor 标题锚点')
{
  const showcaseHtml = join(ROOT, 'showcase', 'index.html')
  const linkArgs = []
  if (!existsSync(showcaseHtml)) {
    console.log('[check-all] 提示：showcase/index.html 当前尚未落盘，本次显式标记为待合入项；文件一旦生成将自动执行存在性硬校验。')
    linkArgs.push('--allow-pending', 'showcase/index.html')
  }
  if (!runNode('gates/examples/02-doc-links/check-doc-links.mjs', linkArgs)) failedSteps += 1
}

// ⑥ 3 个门禁样本子进程阳性对照 + Stop Hook 防死循环自测
banner(6, '运行 3 个门禁样本的阳性对照套件与 Stop Hook 防死循环自测')
{
  const g1 = runNode('gates/examples/01-state-log-cap/test-positive-control.mjs')
  const g2 = runNode('gates/examples/02-doc-links/test-positive-control.mjs')
  const g3 = runNode('gates/examples/03-secret-shapes/test-positive-control.mjs')
  const sh = runNode('gates/hooks/stop-hook-example.mjs', ['--self-test'])
  if (!g1 || !g2 || !g3 || !sh) failedSteps += 1
}

// ⑦ POSIX Shell 钩子字节级 LF（零 CR 字节）与 Git 索引 100755 可执行权限检查
banner(7, '检查 Git 钩子脚本字节级 LF 换行与 Git 索引 100755 可执行位')
{
  let hookOk = true
  for (const rel of HOOK_FILES_MUST_BE_LF_AND_EXEC) {
    const res = inspectHookFile(ROOT, rel)
    if (!res.ok) {
      console.error(`  ✗ ${res.reason}`)
      hookOk = false
    } else {
      console.log(`  OK   ${rel}（${res.bytes} bytes，CR = 0，index mode = ${res.mode}）`)
    }
  }
  if (!runHookCheckSelfTest()) hookOk = false
  if (!hookOk) failedSteps += 1
}

// ⑧ 全仓隐私脱敏门禁 + 凭据形状门禁
banner(8, '运行全仓隐私脱敏扫描（含阳性对照）与凭据形状扫描')
{
  const pScan = runNode('scripts/check-no-private-leak.mjs')
  const pTest = runNode('scripts/check-no-private-leak.mjs', ['--self-test'])
  const sScan = runNode('gates/examples/03-secret-shapes/check-secret-shapes.mjs')
  if (!pScan || !pTest || !sScan) failedSteps += 1
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2)
console.log('\n══════════════════════════════════════════════════════════════════')
if (failedSteps > 0) {
  console.error(`[check-all] ✗ 全仓门禁未通过：${failedSteps}/8 组检查失败（耗时 ${elapsedSec}s，退出码 1）`)
  process.exit(1)
}
console.log(`[check-all] ✓ 全仓 8/8 组门禁与阳性对照全部通过（耗时 ${elapsedSec}s，退出码 0）`)
