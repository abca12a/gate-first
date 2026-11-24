#!/usr/bin/env node
/**
 * 可选宿主收尾钩子（Stop Hook）参考实现与防死循环守卫。
 *
 * 四道工程保护：
 *   1. 交互式终端裸跑保护（`process.stdin.isTTY` 为真时直接打印提示并干净退出，绝不挂起等待键盘输入）；
 *   2. 新轮次计数清零（当输入负载 `stop_hook_active === false` 时重置历史残留计数，避免跨轮次报出 `第 3/2 次阻断`）；
 *   3. 重入死循环熔断（当 `stop_hook_active === true` 且连续阻断次数达到 `maxBlocks` 时放行交由人工裁决）；
 *   4. 阻断时向 `stderr` 输出清晰原因，并以约定阻断码（默认 `2`）退出。
 *
 * 用法：
 *   echo '{"session_id":"s1","stop_hook_active":false}' | node gates/hooks/stop-hook-example.mjs [--cmd "node scripts/check-all.mjs"]
 *   node gates/hooks/stop-hook-example.mjs --self-test
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CMD = 'node scripts/check-all.mjs'
const DEFAULT_MAX_BLOCKS = 2
const BLOCK_EXIT_CODE = 2

export function evaluateStopEvent({
  payload = {},
  gateCommand = DEFAULT_CMD,
  maxBlocks = DEFAULT_MAX_BLOCKS,
  stateDir = join(tmpdir(), 'gate-first-stop-hook-state'),
  cwd = process.cwd(),
}) {
  const sessionId = String(payload.session_id || 'default-session').replace(/[^A-Za-z0-9_-]/g, '_')
  mkdirSync(stateDir, { recursive: true })
  const counterFile = join(stateDir, `${sessionId}.json`)

  let attempts = 0
  // 当 stop_hook_active 显式为 false 时，代表这是一轮全新的用户交互收尾而非钩子重入，立即清零旧计数
  if (payload.stop_hook_active === false) {
    try { rmSync(counterFile, { force: true }) } catch {}
    attempts = 0
  } else if (existsSync(counterFile)) {
    try {
      attempts = Number(JSON.parse(readFileSync(counterFile, 'utf8')).attempts || 0)
    } catch {
      attempts = 0
    }
  }

  // 安全阀：当处于钩子重入轮次且已达到最大阻断上限时，放行交还用户，绝不死循环
  if (payload.stop_hook_active === true && attempts >= maxBlocks) {
    try { rmSync(counterFile, { force: true }) } catch {}
    return {
      exitCode: 0,
      stderr: `[stop-hook] 已连续阻断 ${attempts} 次仍未修复，触发防死循环上限（maxBlocks=${maxBlocks}），放行交由用户核查。\n`,
    }
  }

  const run = spawnSync(gateCommand, { cwd, shell: true, encoding: 'utf8' })
  if (run.status === 0) {
    try { rmSync(counterFile, { force: true }) } catch {}
    return { exitCode: 0, stderr: '' }
  }

  const nextAttempts = attempts + 1
  writeFileSync(counterFile, JSON.stringify({ attempts: nextAttempts, updatedAt: new Date().toISOString() }), 'utf8')
  const outputTail = ((run.stderr || '') + '\n' + (run.stdout || '')).trim().slice(-1500)
  return {
    exitCode: BLOCK_EXIT_CODE,
    stderr:
      `[stop-hook] 收尾门禁未通过（第 ${nextAttempts}/${maxBlocks} 次阻断，命令：${gateCommand}）：\n` +
      `${outputTail}\n` +
      `请先修复上述门禁失败项再结束本轮交付。\n`,
  }
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'stop-hook-selftest-'))
  try {
    const stateDir = join(tmp, 'state')
    const failCmd = `"${process.execPath}" -e "console.error('simulated gate failure'); process.exit(1)"`
    const passCmd = `"${process.execPath}" -e "process.exit(0)"`

    // 1. 门禁通过 ⇒ 退出码 0
    const rPass = evaluateStopEvent({
      payload: { session_id: 's1', stop_hook_active: false },
      gateCommand: passCmd,
      stateDir,
    })
    assert.equal(rPass.exitCode, 0)

    // 2. 第 1 次失败 ⇒ 退出码 2 阻断
    const rFail1 = evaluateStopEvent({
      payload: { session_id: 's2', stop_hook_active: false },
      gateCommand: failCmd,
      maxBlocks: 2,
      stateDir,
    })
    assert.equal(rFail1.exitCode, BLOCK_EXIT_CODE)
    assert.match(rFail1.stderr, /第 1\/2 次阻断/)

    // 3. 新一轮普通对话（stop_hook_active: false）⇒ 重置旧计数，重新从第 1/2 次起算而非越界累加
    const rReset = evaluateStopEvent({
      payload: { session_id: 's2', stop_hook_active: false },
      gateCommand: failCmd,
      maxBlocks: 2,
      stateDir,
    })
    assert.equal(rReset.exitCode, BLOCK_EXIT_CODE)
    assert.match(rReset.stderr, /第 1\/2 次阻断/)

    // 4. 第 2 次重入失败（stop_hook_active: true）⇒ 第 2/2 次阻断
    const rFail2 = evaluateStopEvent({
      payload: { session_id: 's2', stop_hook_active: true },
      gateCommand: failCmd,
      maxBlocks: 2,
      stateDir,
    })
    assert.equal(rFail2.exitCode, BLOCK_EXIT_CODE)
    assert.match(rFail2.stderr, /第 2\/2 次阻断/)

    // 5. 第 3 次重入（stop_hook_active: true，attempts=2 >= 2）⇒ 防死循环安全阀触发，放行退出 0
    const rEscape = evaluateStopEvent({
      payload: { session_id: 's2', stop_hook_active: true },
      gateCommand: failCmd,
      maxBlocks: 2,
      stateDir,
    })
    assert.equal(rEscape.exitCode, 0)
    assert.match(rEscape.stderr, /防死循环上限/)

    console.log('[stop-hook-example] self-test 全部 5 项对照（含新轮次计数重置与重入熔断）通过（退出码 0）')
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function main(argv = process.argv.slice(2)) {
  let gateCommand = DEFAULT_CMD
  let maxBlocks = DEFAULT_MAX_BLOCKS

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') return selfTest()
    if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：通过宿主 Stop Hook 管道传入 JSON，或运行 node stop-hook-example.mjs --self-test')
      return 0
    }
    if (argv[i] === '--cmd') {
      const val = argv[++i]
      if (!val || val.startsWith('--')) {
        console.error('[stop-hook] ✗ 运行错误：--cmd 需要命令字符串')
        return 2
      }
      gateCommand = val
    } else if (argv[i] === '--max-blocks') {
      maxBlocks = Math.max(1, Number(argv[++i] || DEFAULT_MAX_BLOCKS))
    }
  }

  // 防交互式终端裸跑阻塞：无管道输入时打印说明直接返回 0
  if (process.stdin.isTTY) {
    console.log(
      '[stop-hook] 检测到交互式终端（无 stdin 事件管道）。本脚本供宿主生命周期钩子通过 stdin 传入 JSON 调用；自测请运行 --self-test。'
    )
    return 0
  }

  let stdinText = ''
  try {
    stdinText = readFileSync(0, 'utf8').trim()
  } catch {
    stdinText = ''
  }

  let payload = {}
  if (stdinText) {
    try {
      payload = JSON.parse(stdinText)
    } catch {
      payload = {}
    }
  }

  const res = evaluateStopEvent({ payload, gateCommand, maxBlocks })
  if (res.stderr) process.stderr.write(res.stderr)
  return res.exitCode
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
