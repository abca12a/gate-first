#!/usr/bin/env node
/**
 * 仓库根目录薄封装入口：直接调用 skills/lead-orchestration/scripts/init-project.mjs，
 * 避免维护两份重复的脚手架逻辑。
 *
 * 用法：
 *   node scaffold/init-project.mjs <目标Git仓库根目录> [--gate-command "<验收命令>"]
 */
import { runInitProject } from '../skills/lead-orchestration/scripts/init-project.mjs';

try {
  process.exitCode = runInitProject(process.argv.slice(2));
} catch (error) {
  process.stderr.write('错误：' + error.message + '\n');
  process.exitCode = 1;
}
