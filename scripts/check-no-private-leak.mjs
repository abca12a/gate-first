#!/usr/bin/env node
/**
 * 全仓通用结构化隐私、本机路径、内网地址、邮箱与明文凭据门禁（零自身豁免，公开源码零个人特征）。
 *
 * 检查两层规则：
 * 1. 100% 通用的结构化隐私与凭据规则（随公开仓库入库）：
 *    - Windows 个人用户目录路径（如 `C:\Users\<real>`，放行 `<username>` / `example` 等占位符）
 *    - Unix / macOS 个人家目录路径（如 `/Users/<real>`、`/home/<real>`，放行通用占位符）
 *    - 非回环私有内网与 CGNAT 虚拟网 IPv4 端点（`10.x`、`172.16-31.x`、`192.168.x`、`100.64-127.x`；放行 `127.0.0.1`）
 *    - 非示例域名的真实邮箱地址（放行 `example.com/.org/.net`、`*.example`、`localhost`、`git@github.com`）
 *    - 高置信度明文凭据形状（`sk-...`、GitHub PAT、Google `AIza...`、`Bearer ...`、三段式 JWT、PEM 私钥头）
 * 2. 维护者本地动态词表（绝不硬编码或哈希进公开源码）：
 *    - 环境变量 `GATE_FIRST_DENY_WORDS`（逗号分隔）
 *    - 工作区根目录下已被 `.gitignore` 忽略的 `.privacy-denylist.local`（每行一词，支持 `#` 注释）
 *    - ASCII 词条自动按精确字母数字边界匹配（既能抓出中文紧邻语境如「交xxx确认」「需 xxx 决定」，又不误伤含相同字母子串的正常英文单词）。
 *
 * 退出码：0 通过；1 发现隐私或凭据违规；2 参数或运行错误。
 * 用法：
 *   node scripts/check-no-private-leak.mjs [--root <目录>] [--denylist <词表文件>]
 *   node scripts/check-no-private-leak.mjs --self-test
 */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp'])
const DEFAULT_LOCAL_DENYLIST = '.privacy-denylist.local'
const MAX_SCAN_BYTES = 2 * 1024 * 1024

const SAFE_EMAIL_HOSTS = /^(?:example\.(?:com|org|net)|[a-z0-9.-]+\.example|localhost|users\.noreply\.github\.com)$/i
const SAFE_GIT_SSH = /^git@(?:github\.com|gitlab\.com|bitbucket\.org)$/i

const STRUCTURAL_PATTERNS = [
  {
    id: 'windows-user-path',
    re: /[A-Za-z]:[/\\]Users[/\\](?!(?:<|your-|username\b|user\b|example\b|public\b|default\b))[A-Za-z0-9._-]+/gi,
    message: 'Windows 盘符个人用户路径',
  },
  {
    id: 'unix-home-path',
    re: /(?:^|[\s"'`(=])(\/(?:Users|home)\/(?!(?:<|your-|username\b|user\b|example\b))[A-Za-z0-9._-]{2,})/g,
    message: 'Unix/macOS 个人家目录绝对路径',
  },
  {
    id: 'private-lan-ip',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?\b/g,
    message: '非回环私有内网或 CGNAT 虚拟网 IPv4 地址',
  },
  {
    id: 'openai-style-key',
    re: /\bsk-[A-Za-z0-9_-]{20,}/g,
    message: '明文 API Key 形状 (sk-...)',
  },
  {
    id: 'github-pat',
    re: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{22,})/g,
    message: 'GitHub Personal Access Token',
  },
  {
    id: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    message: 'Google API Key',
  },
  {
    id: 'bearer-token',
    re: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g,
    message: 'Bearer 明文长令牌',
  },
  {
    id: 'jwt-token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    message: 'JWT 三段式令牌',
  },
  {
    id: 'pem-private-key',
    re: new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----', 'g'),
    message: 'PEM 私钥块头',
  },
]

const EMAIL_RE = /\b([A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+))\b/g

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function compileDenyMatchers(rawTerms) {
  const unique = [...new Set(rawTerms.map((s) => s.trim()).filter(Boolean))]
  return unique.map((term) => {
    // 纯 ASCII 词或复合 slug：用前后非 ASCII 字母数字边界，兼容中文紧邻语境且绝不误伤长英文单词
    if (/^[\x20-\x7E]+$/.test(term) && /[A-Za-z0-9]/.test(term)) {
      return {
        term,
        re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, 'gi'),
      }
    }
    return {
      term,
      re: new RegExp(escapeRegExp(term), 'gi'),
    }
  })
}

export function loadLocalDenyTerms(rootDir, explicitDenylistPath = '') {
  const terms = []
  const envRaw = process.env.GATE_FIRST_DENY_WORDS || ''
  for (const part of envRaw.split(',')) {
    if (part.trim()) terms.push(part.trim())
  }

  const candidateFile = explicitDenylistPath
    ? resolve(explicitDenylistPath)
    : join(resolve(rootDir), DEFAULT_LOCAL_DENYLIST)

  if (explicitDenylistPath && !existsSync(candidateFile)) {
    throw new Error(`指定的词表文件不存在：${explicitDenylistPath}`)
  }

  if (existsSync(candidateFile)) {
    const lines = readFileSync(candidateFile, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      terms.push(trimmed)
    }
  }

  return terms
}

function walkFiles(dir, skipAbsSet, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (skipAbsSet.has(full)) continue
    let st
    try {
      st = lstatSync(full)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) walkFiles(full, skipAbsSet, out)
    else if (st.isFile() && st.size <= MAX_SCAN_BYTES) out.push(full)
  }
  return out
}

export function scanLineForLeaks(line, denyMatchers = []) {
  const findings = []

  // 1. 通用结构化隐私与密钥规则
  for (const rule of STRUCTURAL_PATTERNS) {
    rule.re.lastIndex = 0
    for (const m of line.matchAll(rule.re)) {
      findings.push({
        id: rule.id,
        message: rule.message,
        snippet: (m[1] || m[0]).trim().slice(0, 48),
      })
    }
  }

  // 2. 非示例真实邮箱检测
  EMAIL_RE.lastIndex = 0
  for (const m of line.matchAll(EMAIL_RE)) {
    const fullEmail = m[1]
    const host = m[2]
    if (SAFE_GIT_SSH.test(fullEmail) || SAFE_EMAIL_HOSTS.test(host)) continue
    findings.push({
      id: 'non-example-email',
      message: '非示例域名的真实邮箱地址（示例请统一使用 @example.com）',
      snippet: fullEmail,
    })
  }

  // 3. 动态加载的本地私有词表匹配
  for (const matcher of denyMatchers) {
    matcher.re.lastIndex = 0
    const m = matcher.re.exec(line)
    if (m) {
      findings.push({
        id: 'custom-deny-word',
        message: '命中本地自定义隐私禁词表',
        snippet: m[0],
      })
    }
  }

  return findings
}

export function scanRepoPrivacy(rootDir, { denylistPath = '', extraTerms = [] } = {}) {
  const root = resolve(rootDir)
  const localFileAbs = denylistPath ? resolve(denylistPath) : join(root, DEFAULT_LOCAL_DENYLIST)
  const skipAbsSet = new Set([localFileAbs])

  const loadedTerms = [...loadLocalDenyTerms(root, denylistPath), ...extraTerms]
  const denyMatchers = compileDenyMatchers(loadedTerms)

  const allFiles = walkFiles(root, skipAbsSet)
  const violations = []
  let scannedTextFiles = 0

  for (const abs of allFiles) {
    let buf
    try {
      buf = readFileSync(abs)
    } catch {
      continue
    }
    if (buf.length === 0 || buf.includes(0)) continue
    scannedTextFiles += 1
    const text = buf.toString('utf8')
    const rel = relative(root, abs).replace(/\\/g, '/')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const hits = scanLineForLeaks(lines[i], denyMatchers)
      for (const hit of hits) {
        violations.push({ file: rel, line: i + 1, ...hit })
      }
    }
  }

  return { scannedTextFiles, activeDenyTerms: denyMatchers.length, violations }
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'privacy-leak-selftest-'))
  let failed = 0
  const verify = (label, fn) => {
    try {
      fn()
      console.log(`  PASS  ${label}`)
    } catch (err) {
      failed += 1
      console.error(`  FAIL  ${label}\n        ${err.message}`)
    }
  }

  // 100% 虚构合成测试样本（无任何真实个人特征）
  const syntheticMatchers = compileDenyMatchers(['ali', 'alice_maintainer', 'acme-internal-web', '内部机密代号'])
  const fakeKey = ['sk', 'proj', '0123456789abcdefghijklmnop'].join('-')

  try {
    verify('阴性对照：含短词字母子串的正常英文词（aligned/valid/calibration/quality/handoff/mechanism）零误报', () => {
      const safeLine =
        'Aligned validation and calibration mechanisms handle quality handoffs cleanly on 127.0.0.1:1933.'
      const hits = scanLineForLeaks(safeLine, syntheticMatchers)
      assert.equal(hits.length, 0, `意外误报: ${JSON.stringify(hits)}`)
    })

    verify('阴性对照：通用占位路径与示例邮箱（/path/to/repo、/Users/<username>、dev@example.com）零误报', () => {
      const hits = scanLineForLeaks(
        '示例路径：/path/to/repo、C:/Users/<username>/app、/Users/<username>/.config 与联系邮箱 dev@example.com',
        syntheticMatchers
      )
      assert.equal(hits.length, 0, `意外误报: ${JSON.stringify(hits)}`)
    })

    verify('阳性对照：中文紧邻语境、英文独立词及复合项目名均被动态词表精准拦截', () => {
      assert.equal(scanLineForLeaks('出现需 ali 决定的实质歧义', syntheticMatchers).length, 1)
      assert.equal(scanLineForLeaks('产品取舍交ali确认。', syntheticMatchers).length, 1)
      assert.equal(scanLineForLeaks('Owner: alice_maintainer', syntheticMatchers).length, 1)
      assert.equal(scanLineForLeaks('2026-09-25 在 acme-internal-web 踩到', syntheticMatchers).length, 1)
      assert.equal(scanLineForLeaks('注意不要泄露内部机密代号文档', syntheticMatchers).length, 1)
    })

    verify('阳性对照：Windows/Unix 个人目录、内网/CGNAT IP、真实邮箱、.privacy-denylist.local 与明文密钥全部拦截', () => {
      const dir = join(tmp, 'dirty-repo')
      mkdirSync(join(dir, 'showcase'), { recursive: true })
      writeFileSync(join(dir, DEFAULT_LOCAL_DENYLIST), '# 本地私有词表\ncanary-secret-codename\n', 'utf8')
      writeFileSync(
        join(dir, 'showcase', 'index.html'),
        [
          ['C:', 'Users', 'Alice', 'secret'].join('/'),
          ['', 'home', 'bob_dev', '.ssh', 'config'].join('/'),
          'http://' + ['192.168', '10.25:8080'].join('.') + '/v1',
          'http://' + ['100.64', '12.8:1933'].join('.') + '/health',
          'maintainer: ' + ['alice.smith', 'acme-corp.io'].join('@'),
          'project: canary-secret-codename',
          fakeKey,
        ].join('\n'),
        'utf8'
      )
      const r = scanRepoPrivacy(dir)
      const ids = new Set(r.violations.map((v) => v.id))
      assert.ok(ids.has('windows-user-path'))
      assert.ok(ids.has('unix-home-path'))
      assert.ok(ids.has('private-lan-ip'))
      assert.ok(ids.has('non-example-email'))
      assert.ok(ids.has('custom-deny-word'))
      assert.ok(ids.has('openai-style-key'))
      // 确保 .privacy-denylist.local 自身不会被当成违规文件扫描进去
      assert.ok(r.violations.every((v) => v.file !== DEFAULT_LOCAL_DENYLIST))
    })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (failed > 0) {
    console.error(`\n[check:privacy] self-test 失败 ${failed} 项（退出码 1）`)
    return 1
  }
  console.log('\n[check:privacy] self-test 全部 4 组对照验证通过（退出码 0）')
  return 0
}

export function main(argv = process.argv.slice(2)) {
  let root = process.cwd()
  let denylistPath = ''

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') return selfTest()
    if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node scripts/check-no-private-leak.mjs [--root <目录>] [--denylist <词表文件>] | --self-test')
      return 0
    }
    if (argv[i] === '--root') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:privacy] ✗ 运行错误：--root 需要目录路径')
        return 2
      }
      root = resolve(val)
    } else if (argv[i] === '--denylist') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[check:privacy] ✗ 运行错误：--denylist 需要词表文件路径')
        return 2
      }
      denylistPath = val
    } else {
      console.error(`[check:privacy] ✗ 运行错误：未知参数 ${argv[i]}`)
      return 2
    }
  }

  let result
  try {
    result = scanRepoPrivacy(root, { denylistPath })
  } catch (err) {
    console.error(`[check:privacy] ✗ 运行错误：${err.message}`)
    return 2
  }

  const denyNote =
    result.activeDenyTerms > 0
      ? `（已加载本地自定义禁词 ${result.activeDenyTerms} 条）`
      : '（通用结构规则模式；可通过 GATE_FIRST_DENY_WORDS 或 .privacy-denylist.local 注入附加词表）'
  console.log(`[check:privacy] 扫描全仓 ${result.scannedTextFiles} 个文本文件 ${denyNote}`)

  if (result.violations.length === 0) {
    console.log('[check:privacy] 通过：未发现个人路径、内网地址、非示例邮箱、禁词或明文凭据泄漏。')
    return 0
  }

  console.error(`\n[check:privacy] ✗ 拦截到 ${result.violations.length} 处脱敏或凭据违规：\n`)
  for (const v of result.violations) {
    console.error(`  ✗ ${v.file}:${v.line}  [${v.id}] ${v.message}  -->  ${v.snippet}`)
  }
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
