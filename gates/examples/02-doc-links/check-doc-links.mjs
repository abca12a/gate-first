#!/usr/bin/env node
/**
 * 文档相对链接与标题锚点漂移检查（对齐 GitHub GFM 锚点规则与 CommonMark 围栏规范）。
 *
 * 检查两件事：
 *   1. Markdown 里的仓库内相对链接指向的目标文件是否存在；
 *   2. 带 `#anchor` 的 Markdown 链接，对应标题 slug 在目标 `.md` 中是否真实存在。
 *
 * 用法：
 *   node check-doc-links.mjs [--root <目录>] [--allow-pending <仓库相对路径>]...
 * 退出码：0 通过；1 存在断链或坏锚点；2 参数/运行错误。
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP = new Set(['node_modules', 'dist', '.git', '.tmp'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = lstatSync(full)
    } catch {
      continue
    }
    // 安全跳过符号链接（避免目录内存在悬空软链时未捕获抛栈，断链由 check-host-skills 专门负责）
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile() && name.endsWith('.md')) out.push(full)
  }
  return out
}

/**
 * GitHub GFM 标题 slug 生成规则（对齐 github-slugger）：
 * 1. 先剥除标题内的 Markdown 链接外壳 `[text](url)` -> `text`；
 * 2. 转小写后剔除除 Unicode 字母 `\p{L}`、数字 `\p{N}`、空白、`_`、`-` 以外的全部标点（含中文全角标点 `：；，。！？、（）【】「」` 等）；
 * 3. 每个空格独立转为单个 `-`（不把多个连续空格合并成一个 `-`，从而保留 `A / B` 去斜杠后的 `a--b`）。
 */
export function slugify(heading) {
  return heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[ \t]/g, '-')
}

/**
 * 按 CommonMark 规范逐行剥离围栏代码块：支持 0~3 空格列表缩进，支持 3 个及以上反引号或波浪号外层围栏（如四反引号包裹三反引号）。
 */
export function stripFencedCode(markdown) {
  const out = []
  let fenceChar = ''
  let fenceLen = 0
  for (const line of markdown.split(/\r?\n/)) {
    if (!fenceChar) {
      const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
      if (open) {
        fenceChar = open[1][0]
        fenceLen = open[1].length
        out.push('')
        continue
      }
      out.push(line)
    } else {
      const closeRe = new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`)
      if (closeRe.test(line)) {
        fenceChar = ''
        fenceLen = 0
      }
      out.push('')
    }
  }
  return out.join('\n')
}

function stripCodeSpans(markdown) {
  return stripFencedCode(markdown).replace(/(`+)([^`]|(?!\1)`)*\1/g, '')
}

/** 收集一个 md 里所有标题的 slug（含重复标题的 -1 -2 后缀）。 */
export function anchorsOf(file) {
  const set = new Set()
  const seen = new Map()
  const raw = stripFencedCode(readFileSync(file, 'utf8'))
  for (const line of raw.split(/\r?\n/)) {
    const m = /^[ \t]{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line)
    if (!m) continue
    const base = slugify(m[2])
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    set.add(n === 0 ? base : `${base}-${n}`)
  }
  return set
}

function hasAvailableExternalBaseline(target) {
  if (/^[A-Za-z]:\//.test(target) && process.platform !== 'win32') return false

  let current = dirname(target)
  while (current !== dirname(current)) {
    if (existsSync(join(current, '.git'))) return true
    current = dirname(current)
  }
  return existsSync(join(current, '.git'))
}

export function scanDocLinks(rootDir, { allowPending = [] } = {}) {
  const root = resolve(rootDir)
  const pendingSet = new Set(allowPending.map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '')))
  const files = walk(root)
  const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g

  const problems = []
  let checked = 0
  let external = 0
  let externalChecked = 0
  let externalUnchecked = 0
  let pendingSkipped = 0

  for (const file of files) {
    const relFile = relative(root, file).replace(/\\/g, '/')
    if (relFile.split('/').includes('templates')) continue

    const text = stripCodeSpans(readFileSync(file, 'utf8'))
    for (const m of text.matchAll(LINK)) {
      const rawTarget = m[1]
      if (/^(https?:|mailto:|conversation:|file:)/.test(rawTarget)) continue

      if (rawTarget.startsWith('#')) {
        checked += 1
        const anchor = decodeURIComponent(rawTarget.slice(1))
        const anchors = anchorsOf(file)
        if (anchor && !anchors.has(anchor)) {
          problems.push({ file: relFile, target: rawTarget, kind: '本文件锚点不存在' })
        }
        continue
      }

      const posixTarget = rawTarget.replace(/\\/g, '/')
      const isAbsolute = /^[A-Za-z]:\//.test(posixTarget) || posixTarget.startsWith('/')
      if (isAbsolute) {
        external += 1
        const normalized = posixTarget.split('#')[0].replace(/:\d+$/, '')
        if (existsSync(normalized)) {
          externalChecked += 1
        } else if (hasAvailableExternalBaseline(normalized)) {
          externalChecked += 1
          problems.push({ file: relFile, target: rawTarget, kind: '跨仓库绝对路径不存在' })
        } else {
          externalUnchecked += 1
        }
        continue
      }

      checked += 1
      const [pathPart, rawAnchor] = posixTarget.split('#')
      const cleanPath = pathPart.replace(/:\d+$/, '')
      const abs = resolve(dirname(file), cleanPath)
      const relTarget = relative(root, abs).replace(/\\/g, '/')

      if (!existsSync(abs)) {
        if (pendingSet.has(relTarget)) {
          pendingSkipped += 1
          continue
        }
        problems.push({ file: relFile, target: rawTarget, kind: '文件不存在' })
        continue
      }

      if (rawAnchor && abs.endsWith('.md')) {
        const anchor = decodeURIComponent(rawAnchor)
        const anchors = anchorsOf(abs)
        if (!anchors.has(anchor)) {
          problems.push({ file: relFile, target: rawTarget, kind: '锚点不存在' })
        }
      }
    }
  }

  return {
    fileCount: files.length,
    checked,
    external,
    externalChecked,
    externalUnchecked,
    pendingSkipped,
    problems,
  }
}

export function main(argv = process.argv.slice(2)) {
  let root = process.cwd()
  const allowPending = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:doc-links] ✗ 运行错误：--root 需要目录路径')
        return 2
      }
      root = resolve(val)
    } else if (arg === '--allow-pending') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:doc-links] ✗ 运行错误：--allow-pending 需要相对路径')
        return 2
      }
      allowPending.push(val)
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node check-doc-links.mjs [--root <目录>] [--allow-pending <相对路径>]...')
      return 0
    } else {
      console.error(`[check:doc-links] ✗ 运行错误：未知参数 ${arg}`)
      return 2
    }
  }

  const r = scanDocLinks(root, { allowPending })
  console.log(
    `[check:doc-links] 扫描 ${r.fileCount} 个 md，仓库内相对链接 ${r.checked} 条，` +
      `跨仓库绝对链接 ${r.external} 条（已校验 ${r.externalChecked} 条；` +
      `外部基线不可用，未校验 ${r.externalUnchecked} 条）`
  )
  if (r.pendingSkipped > 0) {
    console.log(
      `[check:doc-links] 提示：并行产物尚未落盘，显式跳过待合入链接 ${r.pendingSkipped} 条（文件一旦创建自动切换为强校验）。`
    )
  }

  if (r.problems.length === 0) {
    console.log('[check:doc-links] 通过：仓库内链接与可访问的外部基线没有发现漂移。')
    return 0
  }

  console.error(`[check:doc-links] 失败：${r.problems.length} 处漂移。\n`)
  for (const p of r.problems) {
    console.error(`  ${p.file}  ->  ${p.target}   [${p.kind}]`)
  }
  console.error(
    '\n常见成因：① 文档改名/移动后旧引用未同步；② 归档或搬移 md 时相对链接的解析基准目录变了' +
      '（正文一字未改，坏在目录层级差一层）—— 按新位置重算相对路径即可。'
  )
  return 1
}

function isEntryPoint() {
  if (!process.argv[1]) return false
  const norm = (p) => {
    let r
    try { r = realpathSync(p) } catch { r = resolve(p) }
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))
}

if (isEntryPoint()) {
  process.exitCode = main()
}
