#!/usr/bin/env node
/**
 * 02-doc-links 阳性与阴性对照自测套件（零外部依赖，真实子进程退出码验证）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-doc-links.mjs')
const toPosix = (p) => p.replace(/\\/g, '/')

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'gate02-doc-links-'))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runCheck(root, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], { cwd: root, encoding: 'utf8' })
}

const cases = [
  [
    '阴性对照：GFM 中文全角标点锚点、斜杠双连字符(--)锚点、重复标题(-1)、列表缩进代码块与四反引号围栏均通过（退出 0）',
    () =>
      withFixture((root) => {
        mkdirSync(join(root, 'docs'), { recursive: true })
        mkdirSync(join(root, 'templates'), { recursive: true })
        // 根级 templates/ 占位模板不误报，目录内悬空软链安全跳过不崩溃
        writeFileSync(join(root, 'templates', 'T.md'), '[占位](./TODO.md)\n')
        try {
          symlinkSync(join(root, 'does-not-exist'), join(root, 'dangling-dir'), 'junction')
        } catch {}

        writeFileSync(
          join(root, 'docs', 'SPEC.md'),
          [
            '# 规范总览',
            '',
            '## 二、引擎拆解（v0.5.5）：是 / 不是',
            '',
            '## 边界说明',
            '',
            '## 边界说明',
            '',
          ].join('\n')
        )
        writeFileSync(
          join(root, 'README.md'),
          [
            '# 首页',
            '参见 [引擎节](./docs/SPEC.md#二引擎拆解v055是--不是)、[边界](./docs/SPEC.md#边界说明) 与 [重复节](./docs/SPEC.md#边界说明-1)。',
            '',
            '- 列表内缩进围栏示例：',
            '  ```markdown',
            '  [缩进围栏内的假链接](./missing-in-list.md)',
            '  ```',
            '',
            '````markdown',
            '```',
            '[四反引号嵌套围栏内的假链接](./missing-in-quad-fence.md)',
            '```',
            '````',
            '',
          ].join('\n')
        )
        const res = runCheck(root)
        assert.equal(res.status, 0, res.stderr)
      }),
  ],
  [
    '阳性对照：模拟归档搬移（docs/ -> docs/archive/ 内容未改但基准差一层）必须退出 1',
    () =>
      withFixture((root) => {
        mkdirSync(join(root, 'docs', 'reference'), { recursive: true })
        mkdirSync(join(root, 'docs', 'archive'), { recursive: true })
        writeFileSync(join(root, 'docs', 'reference', 'FIELDS.md'), '# 字段契约\n')
        writeFileSync(
          join(root, 'docs', 'archive', 'STATE-2026-09.md'),
          '# 归档记录\n详见 [字段契约](./reference/FIELDS.md)。\n'
        )
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /文件不存在/)
      }),
  ],
  [
    '阳性对照：文件存在但 #anchor 标题不存在（含保留了中文全角冒号的错误锚点）时必须退出 1',
    () =>
      withFixture((root) => {
        writeFileSync(join(root, 'TARGET.md'), '## 一、真实标题：说明\n')
        writeFileSync(join(root, 'README.md'), '[坏锚点](./TARGET.md#一、真实标题：说明)\n')
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /锚点不存在/)
      }),
  ],
  [
    'CI 外部基线边界：未挂载的跨仓库绝对路径（含 Windows 反斜杠盘符）显式记为未校验，不制造假红（退出 0）',
    () =>
      withFixture((root) => {
        const unavailable = toPosix(join(root, 'unmounted-repo', 'src', 'router.tsx')) + ':155'
        writeFileSync(join(root, 'README.md'), `[外部对照源码](${unavailable})\n`)
        const res = runCheck(root)
        assert.equal(res.status, 0, res.stderr)
        assert.match(res.stdout, /外部基线不可用，未校验 1 条/)
      }),
  ],
  [
    '阳性对照：外部 Git 基线已挂载（存在 .git）但目标文件漂移缺失时仍退出 1',
    () =>
      withFixture((root) => {
        const externalRepo = join(root, 'mounted-repo')
        mkdirSync(join(externalRepo, '.git'), { recursive: true })
        const missingTarget = toPosix(join(externalRepo, 'src', 'deleted.ts')) + ':23'
        writeFileSync(join(root, 'README.md'), `[外部已删源码](${missingTarget})\n`)
        const res = runCheck(root)
        assert.equal(res.status, 1, res.stdout)
        assert.match(res.stderr, /跨仓库绝对路径不存在/)
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
  console.error(`\n[02-doc-links] 阳性对照失败 ${failed} 项（退出码 1）`)
  process.exit(1)
}
console.log(`\n[02-doc-links] 全部 ${cases.length} 项对照验证通过（退出码 0）`)
