#!/usr/bin/env node
/**
 * 卡 `docs/STATE.md` 的「当前动作」节不许退化成历史流水账。**超上限即退出 1。**
 *
 * 退出码：0 = 合规；1 = 缺节 / 空节 / 超行数上限；2 = 参数或运行错误。
 * 用法：
 *   node check-state-log.mjs [--file <STATE.md路径>]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HEADING, LINE_LIMIT, currentActionBody, readCurrentAction } from './state-section.mjs'

export function checkStateText(text) {
  const { section, lineCount } = readCurrentAction(text)

  if (section === null) {
    return {
      ok: false,
      code: 'MISSING_HEADING',
      lineCount: 0,
      message: `docs/STATE.md 里没有「${HEADING}」这一节。\n  → 没有这一节就不许回答「下一步」；先把这一节补回来。`,
    }
  }

  const body = currentActionBody(section)
  if (body.replace(HEADING, '').trim().length === 0) {
    return {
      ok: false,
      code: 'EMPTY_SECTION',
      lineCount,
      message: `「${HEADING}」正文是空的（引用说明块不计入正文）。\n  → 空不等于「没有下一步」，按错误处理。`,
    }
  }

  if (lineCount > LINE_LIMIT) {
    return {
      ok: false,
      code: 'OVER_LIMIT',
      lineCount,
      message:
        `「${HEADING}」有 ${lineCount} 行，超过上限 ${LINE_LIMIT} 行。\n` +
        '  → 这一节只放「进行中 / 下一步 / 阻塞 / 验收缺口」；已完成的过程移到 `docs/archive/` 并按日期命名，原处留链接。\n' +
        '  → 真实教训：只打警告退 0 时，该节在 8 天内长到 569 行 / 104 KB。',
    }
  }

  return {
    ok: true,
    code: 'OK',
    lineCount,
    message: `通过：「${HEADING}」${lineCount} 行，上限 ${LINE_LIMIT} 行。`,
  }
}

export function main(argv = process.argv.slice(2)) {
  let stateFile = join(process.cwd(), 'docs', 'STATE.md')
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') {
      const val = argv[i + 1]
      if (!val || val.startsWith('--')) {
        console.error('[check-state-log] ✗ 运行错误：--file 后面需要文件路径')
        return 2
      }
      stateFile = resolve(val)
      i += 1
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node check-state-log.mjs [--file <STATE.md路径>]')
      return 0
    } else {
      console.error(`[check-state-log] ✗ 运行错误：未知参数 ${argv[i]}`)
      return 2
    }
  }

  let text
  try {
    text = readFileSync(stateFile, 'utf8')
  } catch (error) {
    console.error(`[check-state-log] ✗ 读不到状态文件 ${stateFile}：${error.message}`)
    return 1
  }

  const res = checkStateText(text)
  if (!res.ok) {
    console.error(`[check-state-log] ✗ ${res.message}`)
    return 1
  }
  console.log(`[check-state-log] ${res.message}`)
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
