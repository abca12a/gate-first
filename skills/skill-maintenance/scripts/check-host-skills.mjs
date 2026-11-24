#!/usr/bin/env node
/**
 * 宿主 skills 目录的资产健康门禁。**只读，不改任何文件。**
 * 归属 `skill-maintenance` 技能，事件触发（改技能库 / 下架技能 / 分发同步之后 / 换新机器）。
 *
 * ## 判据（为什么必须用 `fs.statSync` 穿透链接）
 *
 * 常见的普通路径存在判断对**悬空**符号链接返回存在（实测下架技能后宿主目录残留 33 个悬空链接，
 * 逐条被判成存在，得出「零断链」假绿）。这里先 `lstatSync` 识别符号链接，再用 `statSync`
 * **跟着链接走**：目标不存在抛 `ENOENT` 即判 `BROKEN_LINK`。
 *
 * ## 四类问题
 * - `BROKEN_LINK`：符号链接目标不存在
 * - `MISSING_ENTRY`：技能目录里没有 `SKILL.md`
 * - `INVALID_FRONTMATTER`：`SKILL.md` 开头不是闭合的 `---` YAML 块
 * - `MISSING_FIELD`：`name` 或 `description` 缺失/为空
 *
 * 退出码：0 通过 / 1 资产问题 / 2 运行错误
 * 用法：
 *   node check-host-skills.mjs [--root <目录>]…
 *   node check-host-skills.mjs --self-test
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = homedir()

const DEFAULT_ROOTS = [
  join(HOME, '.claude', 'skills'),
  join(HOME, '.agents', 'skills'),
  join(HOME, '.codex', 'skills'),
  join(HOME, '.gemini', 'skills'),
  join(HOME, '.dsh', 'skills'),
]

const IGNORED_NAMES = new Set(['.system'])
const CODES = ['BROKEN_LINK', 'MISSING_ENTRY', 'INVALID_FRONTMATTER', 'MISSING_FIELD']

const pretty = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length).replace(/\\/g, '/')}` : p.replace(/\\/g, '/'))

function usage() {
  console.log('用法：')
  console.log('  node check-host-skills.mjs [--root <目录>]…   扫描宿主 skills 根目录')
  console.log('  node check-host-skills.mjs --self-test        运行悬空软链与坏头部阳性对照')
  console.log('退出码：0 通过 / 1 资产问题 / 2 运行错误')
}

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if ((lines[0] ?? '').trim() !== '---') return { ok: false, reason: '首行不是 ---' }
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return { ok: false, reason: '没有第二个 --- 收尾（frontmatter 未闭合）' }

  const body = lines.slice(1, end)
  const fields = {}
  for (let i = 0; i < body.length; i += 1) {
    const match = body[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (/^[|>][+-]?$/.test(value)) {
      const collected = []
      for (let j = i + 1; j < body.length; j += 1) {
        if (/^[A-Za-z0-9_-]+:/.test(body[j])) break
        if (body[j].trim() !== '') collected.push(body[j].trim())
      }
      value = collected.join(' ')
    }
    value = value.replace(/^['"]/, '').replace(/['"]$/, '').trim()
    if (!(key in fields)) fields[key] = value
  }
  return { ok: true, fields }
}

function inspectSkill(dir) {
  const entry = join(dir, 'SKILL.md')
  if (!existsSync(entry)) return { code: 'MISSING_ENTRY', detail: '没有 SKILL.md' }
  const text = readFileSync(entry, 'utf8')
  const frontmatter = parseFrontmatter(text)
  if (!frontmatter.ok) return { code: 'INVALID_FRONTMATTER', detail: frontmatter.reason }
  for (const field of ['name', 'description']) {
    const value = frontmatter.fields[field]
    if (typeof value !== 'string' || value === '') {
      return { code: 'MISSING_FIELD', detail: `frontmatter 缺 ${field} 或为空` }
    }
  }
  return null
}

export function scanRoot(root) {
  if (!existsSync(root)) return { root, missing: true, skills: 0, skipped: 0, issues: [] }

  const names = readdirSync(root).sort()
  const result = { root, missing: false, skills: 0, skipped: 0, issues: [] }

  for (const name of names) {
    if (IGNORED_NAMES.has(name)) {
      result.skipped += 1
      continue
    }
    const full = join(root, name)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) {
      let target
      try {
        target = statSync(full)
      } catch {
        result.issues.push({ name, code: 'BROKEN_LINK', detail: '链接目标不存在' })
        continue
      }
      if (!target.isDirectory()) {
        result.skipped += 1
        continue
      }
    } else if (!stat.isDirectory()) {
      result.skipped += 1
      continue
    }
    result.skills += 1
    const issue = inspectSkill(full)
    if (issue) result.issues.push({ name, ...issue })
  }
  return result
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'host-skills-selftest-'))
  let failed = 0
  const check = (label, ok, detail = '') => {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  }

  try {
    const hostRoot = join(tmp, 'host-skills')
    mkdirSync(hostRoot, { recursive: true })
    mkdirSync(join(hostRoot, '.system'), { recursive: true })

    // 合法技能实体与有效链接
    const entity = join(tmp, 'entity-valid')
    mkdirSync(entity, { recursive: true })
    writeFileSync(join(entity, 'SKILL.md'), '---\nname: valid-skill\ndescription: Works well.\n---\n')
    symlinkSync(entity, join(hostRoot, 'valid-skill'), 'junction')

    const rValid = scanRoot(hostRoot)
    check('好例：有效链接与内置 .system 目录通过', rValid.issues.length === 0 && rValid.skills === 1)

    // 悬空链接 + 缺入口 + 空块标量
    symlinkSync(join(tmp, 'deleted-entity'), join(hostRoot, 'dangling-skill'), 'junction')
    mkdirSync(join(hostRoot, 'empty-dir'), { recursive: true })
    mkdirSync(join(hostRoot, 'empty-block-desc'), { recursive: true })
    writeFileSync(join(hostRoot, 'empty-block-desc', 'SKILL.md'), '---\nname: empty-block-desc\ndescription: |\n---\n')

    const rBroken = scanRoot(hostRoot)
    const codes = new Set(rBroken.issues.map(i => i.code))
    check(
      '坏例（阳性对照）：检出 BROKEN_LINK / MISSING_ENTRY / MISSING_FIELD',
      codes.has('BROKEN_LINK') && codes.has('MISSING_ENTRY') && codes.has('MISSING_FIELD'),
      `codes=${[...codes].join(',')}`
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log(failed ? `\n[check-host-skills] self-test 失败 ${failed} 项（退出码 1）` : '\n[check-host-skills] self-test 全部通过（退出码 0）')
  return failed ? 1 : 0
}

export function main(argv = process.argv.slice(2)) {
  const cliRoots = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      return 0
    }
    if (arg === '--self-test') return selfTest()
    if (arg === '--root') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        console.error('[check-host-skills] ✗ 运行错误：--root 后面要跟一个目录')
        return 2
      }
      cliRoots.push(resolve(value))
      i += 1
      continue
    }
    if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length)
      if (!value) {
        console.error('[check-host-skills] ✗ 运行错误：--root= 后面要跟一个目录')
        return 2
      }
      cliRoots.push(resolve(value))
      continue
    }
    console.error(`[check-host-skills] ✗ 运行错误：不认识的参数：${arg}`)
    return 2
  }

  let results
  try {
    const roots = cliRoots.length > 0 ? cliRoots : DEFAULT_ROOTS
    results = roots.map(scanRoot)
  } catch (error) {
    console.error(`[check-host-skills] ✗ 运行错误：${error.message}`)
    return 2
  }

  const counts = Object.fromEntries(CODES.map((code) => [code, 0]))
  let totalIssues = 0
  let totalSkills = 0
  let missingRoots = 0

  for (const result of results) {
    if (result.missing) {
      missingRoots += 1
      console.log(`[check-host-skills] – ${pretty(result.root)}  不存在，跳过（不是每台机器都装了全部宿主）`)
      continue
    }
    totalSkills += result.skills
    const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个非目录/内置条目` : ''
    if (result.issues.length === 0) {
      console.log(`[check-host-skills] ✓ ${pretty(result.root)}  技能 ${result.skills} 个${skipped}，问题 0`)
      continue
    }
    console.error(`[check-host-skills] ✗ ${pretty(result.root)}  技能 ${result.skills} 个${skipped}，问题 ${result.issues.length}`)
    for (const issue of result.issues) {
      counts[issue.code] += 1
      totalIssues += 1
      console.error(`    ${issue.code}  ${issue.name}  —— ${issue.detail}`)
    }
  }

  const scanned = results.length - missingRoots
  console.log(`\n[check-host-skills] 汇总：扫描 ${scanned} 个根（跳过 ${missingRoots} 个不存在），技能 ${totalSkills} 个，问题 ${totalIssues} 个。`)
  if (totalIssues > 0) {
    console.error(`[check-host-skills] 分类：${CODES.map((code) => `${code} ${counts[code]}`).join(' / ')}`)
    return 1
  }
  console.log('[check-host-skills] 通过：没有断链，也没有缺入口 / 坏 frontmatter 的技能。')
  return 0
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
