#!/usr/bin/env node
/**
 * 03-secret-shapes 阳性与阴性对照自测套件（临时子 Git 仓库隔离测试）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-secret-shapes.mjs')

function cleanGitEnv() {
  const env = { ...process.env }
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
  ]) {
    delete env[k]
  }
  return env
}

function withTempGitRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'gate03-secrets-'))
  const env = cleanGitEnv()
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: root, env, encoding: 'utf8' })
    assert.equal(init.status, 0, init.stderr)
    writeFileSync(join(root, '.gitignore'), '.tmp/\nallowlist.json\n', 'utf8')
    return fn(root, env)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runCheck(root, env, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], { cwd: root, env, encoding: 'utf8' })
}

const FAKE_SK = ['sk', 'canary', '0123456789abcdefghijklmnop'].join('-')
const FAKE_GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

const cases = [
  [
    '阴性对照：干净文本文件与含 NUL 字节的二进制产物（自动跳过）通过（退出 0）',
    () =>
      withTempGitRepo((root, env) => {
        writeFileSync(join(root, 'README.md'), '# Clean Repo\nNo credentials here.\n')
        writeFileSync(join(root, 'logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
        const res = runCheck(root, env)
        assert.equal(res.status, 0, res.stderr)
      }),
  ],
  [
    '阳性对照：尚未 git add 的非常规后缀文件（.env.local 与 ovcli.conf）混入假密钥，必须当场检出并退出 1',
    () =>
      withTempGitRepo((root, env) => {
        writeFileSync(join(root, '.env.local'), `API_KEY=${FAKE_SK}\n`)
        writeFileSync(join(root, 'ovcli.conf'), `{"token":"${FAKE_GH}"}\n`)
        const res = runCheck(root, env)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /\.env\.local:1/)
        assert.match(res.stderr, /ovcli\.conf:1/)
      }),
  ],
  [
    '边界隔离：已被 .gitignore 忽略的 .tmp/ 本地临时文件不误报（退出 0）',
    () =>
      withTempGitRepo((root, env) => {
        mkdirSync(join(root, '.tmp'), { recursive: true })
        writeFileSync(join(root, '.tmp', 'local-only.txt'), FAKE_GH + '\n')
        writeFileSync(join(root, 'index.js'), 'export const ok = true\n')
        const res = runCheck(root, env)
        assert.equal(res.status, 0, res.stderr)
      }),
  ],
  [
    '阴性对照：测试金丝雀假串携带非空理由登记入白名单后通过（退出 0）',
    () =>
      withTempGitRepo((root, env) => {
        writeFileSync(join(root, 'auth.test.js'), `const CANARY = "${FAKE_SK}"\n`)
        writeFileSync(
          join(root, 'allowlist.json'),
          JSON.stringify({ [FAKE_SK]: 'auth.test.js 边界金丝雀测试假串，非真实密钥' }, null, 2)
        )
        const res = runCheck(root, env, ['--allowlist', 'allowlist.json'])
        assert.equal(res.status, 0, res.stderr)
      }),
  ],
  [
    '阳性对照：白名单条目未填写理由（空字符串）时拒绝放行并退出 1',
    () =>
      withTempGitRepo((root, env) => {
        writeFileSync(join(root, 'auth.test.js'), `const CANARY = "${FAKE_SK}"\n`)
        writeFileSync(join(root, 'allowlist.json'), JSON.stringify({ [FAKE_SK]: '   ' }))
        const res = runCheck(root, env, ['--allowlist', 'allowlist.json'])
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /缺少非空理由/)
      }),
  ],
  [
    '阳性对照：双向过期反查 —— 假串已从代码移除但仍留在白名单中，必须报过期并退出 1',
    () =>
      withTempGitRepo((root, env) => {
        writeFileSync(join(root, 'auth.test.js'), 'const CLEAN = "placeholder"\n')
        writeFileSync(
          join(root, 'allowlist.json'),
          JSON.stringify({ [FAKE_SK]: '旧测试遗留条目，代码早已删掉' })
        )
        const res = runCheck(root, env, ['--allowlist', 'allowlist.json'])
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /白名单过期/)
      }),
  ],
  [
    '三态退出码：--cwd 缺参数或紧跟其它 flag 时返回运行错误退出码 2',
    () =>
      withTempGitRepo((root, env) => {
        const rMissing = runCheck(root, env, ['--cwd'])
        assert.equal(rMissing.status, 2)
        const rSwallowed = runCheck(root, env, ['--cwd', '--help'])
        assert.equal(rSwallowed.status, 2)
      }),
  ],
]

let failed = 0
for (const [label, fn] of cases) {
  try {
    fn()
    console.log(`  PASS  ${label}`)
  } catch (err) {
    failed += 1
    console.error(`  FAIL  ${label}\n        ${err.message}`)
  }
}

if (failed > 0) {
  console.error(`\n[03-secret-shapes] 阳性对照失败 ${failed} 项（退出码 1）`)
  process.exit(1)
}
console.log(`\n[03-secret-shapes] 全部 ${cases.length} 项对照验证通过（退出码 0）`)
