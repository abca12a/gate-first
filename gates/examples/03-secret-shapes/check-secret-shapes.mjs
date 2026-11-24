#!/usr/bin/env node
/**
 * 凭据形状门禁：拦截受版本控制及待提交新文件中的明文密钥形状，并强制白名单双向保鲜。
 *
 * 扫描范围：`git ls-files -z --cached --others --exclude-standard`
 *   不限文件扩展名（全覆盖 `.env.local`、`.env.production`、`ovcli.conf`、`*.toml`、无后缀脚本等），
 *   读取 Buffer 后按「非空且不含 NUL 字节 (`!buf.includes(0)`)、体积 <= 2MB」自动识别全部文本资产。
 *
 * 退出码：0 通过；1 发现未登记凭据形状、白名单缺理由或白名单条目已过期；2 运行错误。
 * 用法：
 *   node check-secret-shapes.mjs [--allowlist <json文件路径>] [--cwd <仓库根目录>]
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_SCAN_BYTES = 2 * 1024 * 1024

export const PATTERNS = [
  {
    id: 'openai-style-key',
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
    message: 'OpenAI / 通用 API 风格密钥串 (sk-...)',
  },
  {
    id: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{22,})/g,
    message: 'GitHub Personal Access Token',
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    message: 'Google API Key (AIza...)',
  },
  {
    id: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g,
    message: 'Bearer 授权头后跟长令牌',
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    message: 'JWT 三段式令牌',
  },
  {
    id: 'pem-private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
    message: 'PEM 格式私钥块头',
  },
]

function filesToScan(cwd) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  return out.split('\0').filter(Boolean)
}

export function scanSecretShapes(cwd, allowed = {}) {
  const invalidAllowlist = Object.entries(allowed)
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length === 0)
    .map(([key]) => key)

  const problems = []
  const seen = new Map()
  let scanned = 0

  for (const file of filesToScan(cwd)) {
    const abs = resolve(cwd, file)
    let st
    try {
      st = lstatSync(abs)
    } catch {
      continue
    }
    if (st.isSymbolicLink() || !st.isFile() || st.size === 0 || st.size > MAX_SCAN_BYTES) continue

    let buf
    try {
      buf = readFileSync(abs)
    } catch {
      continue
    }
    if (buf.includes(0)) continue // 二进制文件跳过

    scanned += 1
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (const { id, pattern, message } of PATTERNS) {
      pattern.lastIndex = 0
      for (let index = 0; index < lines.length; index += 1) {
        for (const matched of lines[index].matchAll(pattern)) {
          const value = matched[0]
          if (Object.prototype.hasOwnProperty.call(allowed, value) && !invalidAllowlist.includes(value)) {
            seen.set(value, (seen.get(value) ?? 0) + 1)
            continue
          }
          problems.push({ file, line: index + 1, id, message, value })
        }
      }
    }
  }

  const stale = Object.keys(allowed).filter(
    (value) => !invalidAllowlist.includes(value) && !seen.has(value)
  )

  return { scanned, problems, invalidAllowlist, stale }
}

export function main(argv = process.argv.slice(2)) {
  let allowlistPath = ''
  let cwd = process.cwd()

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--allowlist') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:secrets] ✗ 运行错误：--allowlist 需要 JSON 文件路径')
        return 2
      }
      allowlistPath = val
    } else if (argv[i] === '--cwd') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:secrets] ✗ 运行错误：--cwd 需要仓库根目录路径')
        return 2
      }
      cwd = resolve(val)
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node check-secret-shapes.mjs [--allowlist <json文件>] [--cwd <仓库根目录>]')
      return 0
    } else {
      console.error(`[check:secrets] ✗ 运行错误：未知参数 ${argv[i]}`)
      return 2
    }
  }

  let allowed = {}
  if (allowlistPath) {
    try {
      allowed = JSON.parse(readFileSync(resolve(cwd, allowlistPath), 'utf8'))
    } catch (err) {
      console.error(`[check:secrets] ✗ 运行错误：无法读取白名单 ${allowlistPath}：${err.message}`)
      return 2
    }
  }

  let report
  try {
    report = scanSecretShapes(cwd, allowed)
  } catch (err) {
    console.error(`[check:secrets] ✗ 运行错误：${err.message}`)
    return 2
  }

  console.log(`[check:secrets] 扫描 ${report.scanned} 个受版本控制或待暂存的非二进制文件`)

  if (report.invalidAllowlist.length > 0) {
    console.error('\n[check:secrets] 白名单条目缺少非空理由（无理由的白名单会退化成垃圾桶）：')
    for (const k of report.invalidAllowlist) console.error(`  - ${k.slice(0, 40)}`)
  }

  if (report.problems.length > 0) {
    console.error(`\n[check:secrets] 发现 ${report.problems.length} 处未登记的凭据形状串：\n`)
    for (const p of report.problems) {
      console.error(`  ✗ ${p.file}:${p.line}  [${p.id}] ${p.message}`)
      console.error(`      ${p.value.slice(0, 48)}...`)
    }
    console.error(
      '\n处置：先确认是否为真实凭据（若是，立即在服务端吊销轮换）；测试假值请改为不含真实前缀的占位符，确需保留原形状则携理由登记进白名单。'
    )
  }

  if (report.stale.length > 0) {
    console.error('\n[check:secrets] 白名单过期：以下豁免串在全仓已不存在，请同步清理白名单条目：\n')
    for (const value of report.stale) console.error(`  - ${value}`)
  }

  if (report.invalidAllowlist.length > 0 || report.problems.length > 0 || report.stale.length > 0) {
    return 1
  }

  console.log('[check:secrets] 通过：没有未登记的凭据形状串，白名单也无过期条目。')
  return 0
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
