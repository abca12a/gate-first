#!/usr/bin/env node
// 本项目的验收门禁。`npm run gate` 和 .githooks/pre-commit 都只是调这个文件：
//   node scripts/agent-gate.mjs
// 由 lead-orchestration 的 init-project.mjs 生成，当前只有一条检查。
//
// 判定规则只有一条：任何一项没过就 exit 1，全部通过才 exit 0。
// 子命令输出直接透传，不藏日志。

import { spawnSync } from 'node:child_process';

// TODO: 换成这个项目真正的检查项。常见加法：单测、lint、文档链接、构建。
// 每一项是一条命令，经 shell 执行，所以可以写 `a && b`。
const checks = [
  {{GATE_COMMAND_JS}},
];

let failed = 0;
for (const command of checks) {
  process.stdout.write(`\n[门禁] ${command}\n`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`[门禁] 起不来：${result.error.message}\n`);
    failed += 1;
  } else if (result.status !== 0) {
    process.stderr.write(`[门禁] 未通过（退出码 ${result.status}）\n`);
    failed += 1;
  }
}

if (failed) {
  process.stderr.write(`\n门禁未通过：${failed} 项失败。修好再提交；确实要绕过就 --no-verify 并在回报里说明理由。\n`);
  process.exit(1);
}
process.stdout.write('\n门禁通过\n');
