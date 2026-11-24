#!/usr/bin/env node
/**
 * 01-state-log-cap 阳性与阴性对照自测套件（零外部依赖，真实子进程退出码验证）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LINE_LIMIT, readCurrentAction } from './state-section.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'check-state-log.mjs')

function stateWith(lines, { heading = '## 当前动作' } = {}) {
  if (lines === 2) throw new Error('stateWith: 2 行不可表示（标题后的空行会被 trim 掉）')
  const body = Array.from({ length: Math.max(0, lines - 2) }, (_, i) => `- 第 ${i + 1} 条状态记录`)
  return [
    '# 当前状态',
    '',
    heading,
    ...(body.length > 0 ? ['', ...body] : []),
    '',
    '## 历史索引',
    '',
    '- 这一节不属于「当前动作」',
    '',
  ].join('\n')
}

function withState(stateText, fn) {
  const root = mkdtempSync(join(tmpdir(), 'gate01-state-log-'))
  try {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'STATE.md'), stateText, 'utf8')
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runCheck(root) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
}

const cases = [
  [
    '夹具自检：stateWith 生成的行数与 readCurrentAction 读数严格一致',
    () => {
      for (const lines of [1, 3, 4, 42, LINE_LIMIT, LINE_LIMIT + 1]) {
        const { lineCount } = readCurrentAction(stateWith(lines))
        assert.equal(lineCount, lines, `预期 ${lines} 行，实际 ${lineCount} 行`)
      }
    },
  ],
  [
    `阴性对照：恰好达到上限 ${LINE_LIMIT} 行时退出 0`,
    () =>
      withState(stateWith(LINE_LIMIT), (root) => {
        const res = runCheck(root)
        assert.equal(res.status, 0, res.stderr)
        assert.match(res.stdout, new RegExp(`「## 当前动作」${LINE_LIMIT} 行，上限 ${LINE_LIMIT} 行`))
      }),
  ],
  [
    `阳性对照：超过上限 1 行（${LINE_LIMIT + 1} 行）立即退出 1 并提示 docs/archive/`,
    () =>
      withState(stateWith(LINE_LIMIT + 1), (root) => {
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, new RegExp(`有 ${LINE_LIMIT + 1} 行，超过上限 ${LINE_LIMIT} 行`))
        assert.match(res.stderr, /docs\/archive\//)
      }),
  ],
  [
    '阳性对照：缺少「## 当前动作」标题时退出 1（防改名绕过）',
    () =>
      withState(stateWith(10, { heading: '## 当前进度' }), (root) => {
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /没有「## 当前动作」这一节/)
      }),
  ],
  [
    '阳性对照：只有标题或只有 `> ` 引用说明块、无实际正文时退出 1',
    () =>
      withState(['# 当前状态', '', '## 当前动作', '', '> 本节只写进行中事项', '', '## 下一节', ''].join('\n'), (root) => {
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /空的/)
      }),
  ],
  [
    '边界隔离：后续章节增长三倍上限不影响「当前动作」判定（退出 0）',
    () =>
      withState(
        [
          '# 当前状态',
          '',
          '## 当前动作',
          '',
          '- 正常推进中',
          '',
          '## 架构背景长节',
          '',
          ...Array.from({ length: LINE_LIMIT * 3 }, (_, i) => `- 背景说明 ${i + 1}`),
          '',
        ].join('\n'),
        (root) => {
          const res = runCheck(root)
          assert.equal(res.status, 0, res.stderr)
        }
      ),
  ],
  [
    '阳性对照：顶部导语引用块中提及「## 当前动作」字面量时，仍精确按行首标题计出超限并退出 1',
    () =>
      withState(
        [
          '# 当前状态',
          '',
          '> 维护说明：「## 当前动作」节严禁超过上限。',
          '',
          '## 当前动作',
          '',
          ...Array.from({ length: LINE_LIMIT - 1 }, (_, i) => `- 超限项 ${i + 1}`),
          '',
        ].join('\n'),
        (root) => {
          const res = runCheck(root)
          assert.equal(res.status, 1, res.stdout)
          assert.match(res.stderr, new RegExp(`有 ${LINE_LIMIT + 1} 行，超过上限 ${LINE_LIMIT} 行`))
        }
      ),
  ],
  [
    '单一常量源断言：check-state-log.mjs 必须从 state-section.mjs 导入阈值而非硬编码数字',
    () => {
      const src = readFileSync(SCRIPT, 'utf8')
      assert.match(src, /from '\.\/state-section\.mjs'/)
      assert.doesNotMatch(src, /LINE_LIMIT\s*=\s*\d+/)
    },
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
  console.error(`\n[01-state-log-cap] 阳性对照失败 ${failed} 项（退出码 1）`)
  process.exit(1)
}
console.log(`\n[01-state-log-cap] 全部 ${cases.length} 项对照验证通过（退出码 0）`)
