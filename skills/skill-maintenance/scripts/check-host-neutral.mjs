#!/usr/bin/env node
// 宿主中立性门禁：扫一批技能的全部文本文件，命中「只对某个宿主成立」的词就退 1。**只读，不改任何文件。**
//
// ## 它挡的是什么
//
// 全局技能是所有宿主共用的同一份实体。正文里一旦写进某个宿主的专有工具名、专有路径或特定 hook 机制，
// 这份知识就跟着分发到**每一个**宿主 —— 别的宿主读到的是自己做不到的命令，而**没有任何东西会报错**：
// 技能照常加载、照常被调用，只是照着做会失败。这类退化只有专门去数词的门禁能挡住。
//
// ## 判据与豁免
//
// - 宿主能力表：`lead-orchestration/references/host-adapters.md` —— 它本来就该集中承载宿主差异。
// - 本脚本自己：`PATTERNS` 表必须逐字包含这些模式才匹配得上。豁免按 `<技能名>/<技能内相对路径>` 精确匹配。
//
// ## 退出码
//
// - `0` 通过
// - `1` 有命中（逐条打印 `文件:行:命中词`）
// - `2` 运行错误（参数不对、目录读不了、意外异常）
//
// 用法：
//   node check-host-neutral.mjs                  # 默认自动定位本仓 skills/ 目录下的全部技能
//   node check-host-neutral.mjs --root <目录>    # 扫描指定目录（可重复传）
//   node check-host-neutral.mjs --self-test      # 运行内置好坏对照测试

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = dirname(HERE)
const SKILLS_ROOT = dirname(SKILL_DIR)

/** 允许出现宿主专属词的文件，键是 `<技能目录名>/<技能内相对路径>`（正斜杠）。 */
const EXEMPT = new Set([
  'lead-orchestration/references/host-adapters.md',
  'skill-maintenance/scripts/check-host-neutral.mjs',
])

const TEXT_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.mjs', '.cjs', '.js', '.mts', '.cts', '.ts', '.tsx', '.jsx',
  '.json', '.yml', '.yaml', '.py', '.ps1', '.sh', '.toml', '.cfg', '.ini',
]

const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp'])

// 禁用词表：改了这里就等于改判据，改完必须重跑 --self-test。
const PATTERNS = [
  { label: 'WorkBuddy(.workbuddy-ai)', re: /workbuddy/i },
  { label: 'safe-delete(SAFE_DELETE)', re: /safe[-_]delete/i },
  { label: 'CC Switch', re: /cc[-_\s]*switch/i },
  { label: 'PowerShell', re: /powershell/i },
  { label: 'claude-stop', re: /claude[-_]stop/i },
  { label: 'Stop hook', re: /stop[-_\s]?hook/i },
  { label: 'mnemon', re: /\bmnemon\b/i },
  { label: 'Memory Spaces', re: /memory\s+spaces?/i },
]

const USAGE = [
  '用法：',
  '  node check-host-neutral.mjs                  扫描同级 skills/ 目录下的全部技能',
  '  node check-host-neutral.mjs --root <目录>…   扫描指定目录（阳性对照或外部目录）',
  '  node check-host-neutral.mjs --self-test      运行内置好例/坏例/豁免对照',
  '退出码：0 通过 / 1 有命中 / 2 运行错误',
].join('\n')

const toPosix = value => value.split(sep).join('/')

function isTextFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return true
  return TEXT_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

function collectTextFiles(root) {
  const found = []
  const walk = dir => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full)
      } else if (entry.isSymbolicLink()) {
        let real
        try {
          real = statSync(full)
        } catch {
          continue
        }
        if (real.isFile() && isTextFile(entry.name)) found.push(full)
      } else if (entry.isFile() && isTextFile(entry.name)) {
        found.push(full)
      }
    }
  }
  walk(root)
  return found
}

function resolveExemptionKey(absolute, root) {
  const rel = toPosix(relative(root, absolute))
  const directKey = `${basename(root)}/${rel}`
  if (EXEMPT.has(directKey)) return { rel: directKey, exempt: true }
  if (EXEMPT.has(rel)) return { rel, exempt: true }
  return { rel: directKey, exempt: false }
}

function scanFile(absolute, root) {
  const { rel, exempt } = resolveExemptionKey(absolute, root)
  if (exempt) return { rel, exempt: true, hits: [] }
  const text = readFileSync(absolute, 'utf8')
  if (text.includes('\u0000')) return { rel, exempt: false, hits: [] }
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    for (const pattern of PATTERNS) {
      if (pattern.re.test(lines[i])) hits.push({ line: i + 1, label: pattern.label, text: lines[i].trim() })
    }
  }
  return { rel, exempt: false, hits }
}

function defaultSkillRoots() {
  if (!existsSync(SKILLS_ROOT)) return []
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(d => {
      if (d.name.startsWith('.')) return false
      if (d.isDirectory()) return existsSync(join(SKILLS_ROOT, d.name, 'SKILL.md'))
      if (d.isSymbolicLink()) {
        try { return statSync(join(SKILLS_ROOT, d.name)).isDirectory() && existsSync(join(SKILLS_ROOT, d.name, 'SKILL.md')) } catch { return false }
      }
      return false
    })
    .map(d => join(SKILLS_ROOT, d.name))
    .sort()
}

export function runScan(scanRoots) {
  const files = []
  for (const root of scanRoots) {
    const stats = statSync(root)
    if (!stats.isDirectory()) throw new Error('不是目录：' + root)
    for (const file of collectTextFiles(root)) files.push({ file, root })
  }

  let hitCount = 0
  let exemptCount = 0
  const results = []
  for (const entry of files) {
    const result = scanFile(entry.file, entry.root)
    if (result.exempt) exemptCount += 1
    if (result.hits.length) results.push(result)
    hitCount += result.hits.length
  }
  return { scanRoots, fileCount: files.length, exemptCount, hitCount, results }
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'host-neutral-selftest-'))
  let failed = 0
  const assertCase = (label, ok, detail = '') => {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  }

  try {
    // 1. 干净技能 ⇒ 0 命中
    const cleanDir = join(tmp, 'clean-skill')
    mkdirSync(cleanDir, { recursive: true })
    writeFileSync(join(cleanDir, 'SKILL.md'), '---\nname: clean-skill\ndescription: Cross-host workflow.\n---\n\nRun `node scripts/check.mjs`.\n')
    const rClean = runScan([cleanDir])
    assertCase('好例：中立技能 0 命中', rClean.hitCount === 0)

    // 2. 含宿主专属词 ⇒ 必须检出（阳性对照）
    const dirtyDir = join(tmp, 'dirty-skill')
    mkdirSync(dirtyDir, { recursive: true })
    writeFileSync(join(dirtyDir, 'SKILL.md'), '---\nname: dirty-skill\ndescription: Host leaked.\n---\n\nConfigure Stop hook in PowerShell.\n')
    const rDirty = runScan([dirtyDir])
    assertCase('坏例（阳性对照）：检出 Stop hook 与 PowerShell', rDirty.hitCount === 2, `hitCount=${rDirty.hitCount}`)

    // 3. 精确路径豁免：lead-orchestration/references/host-adapters.md 放行，同目录其它文件仍拦截
    const exemptSkill = join(tmp, 'lead-orchestration')
    mkdirSync(join(exemptSkill, 'references'), { recursive: true })
    writeFileSync(join(exemptSkill, 'references', 'host-adapters.md'), '# Host Adapters\nOptional Stop hook note.\n')
    writeFileSync(join(exemptSkill, 'SKILL.md'), '---\nname: lead-orchestration\ndescription: Core.\n---\n')
    const rExempt = runScan([exemptSkill])
    assertCase('豁免边界：host-adapters.md 精确豁免生效', rExempt.hitCount === 0 && rExempt.exemptCount === 1)

    writeFileSync(join(exemptSkill, 'SKILL.md'), '---\nname: lead-orchestration\ndescription: Core.\n---\nUse WorkBuddy here.\n')
    const rLeakOutsideExempt = runScan([exemptSkill])
    assertCase('豁免边界：非豁免正文泄漏仍被拦截', rLeakOutsideExempt.hitCount === 1)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log(failed ? `\n[check-host-neutral] self-test 失败 ${failed} 项（退出码 1）` : '\n[check-host-neutral] self-test 全部通过（退出码 0）')
  return failed ? 1 : 0
}

export function main(argv = process.argv.slice(2)) {
  const roots = []
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--help' || item === '-h') {
      console.log(USAGE)
      return 0
    }
    if (item === '--self-test') {
      return selfTest()
    }
    if (item === '--root') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        console.error('[check-host-neutral] ✗ 运行错误：--root 后面要跟一个目录')
        return 2
      }
      roots.push(resolve(value))
      i += 1
      continue
    }
    console.error('[check-host-neutral] ✗ 运行错误：不认识的参数：' + item)
    return 2
  }

  let scanRoots = roots
  if (!scanRoots.length) {
    scanRoots = defaultSkillRoots()
    if (!scanRoots.length) {
      console.error('[check-host-neutral] ✗ 运行错误：没有找到可扫描的技能目录：' + SKILLS_ROOT)
      return 2
    }
  }

  let report
  try {
    report = runScan(scanRoots)
  } catch (error) {
    console.error('[check-host-neutral] ✗ 运行错误：' + error.message)
    return 2
  }

  if (!report.hitCount) {
    console.log('[check-host-neutral] OK')
    console.log(`  扫描 ${report.scanRoots.length} 个技能根 / ${report.fileCount} 个文本文件，豁免 ${report.exemptCount} 个；未命中宿主专属词。`)
    return 0
  }

  console.error(`[check-host-neutral] ✗ 命中宿主专属词 ${report.hitCount} 处（${report.results.length} 个文件）：`)
  for (const result of report.results) {
    for (const hit of result.hits) {
      console.error(`  ${result.rel}:${hit.line}: ${hit.label}`)
      if (hit.text) console.error('      ' + (hit.text.length > 120 ? hit.text.slice(0, 120) + '…' : hit.text))
    }
  }
  console.error('\n处置：把宿主专属词换成通用判据，或集中移至 lead-orchestration/references/host-adapters.md。')
  return 1
}

function isEntryPoint() {
  if (!process.argv[1]) return false
  const norm = p => {
    let r
    try { r = realpathSync(p) } catch { r = resolve(p) }
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))
}

if (isEntryPoint()) {
  process.exitCode = main()
}
