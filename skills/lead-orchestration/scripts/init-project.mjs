#!/usr/bin/env node
// 新项目起步包：一条命令把协作工作流装进一个 git 仓库。
//
// 只做四件事：落项目**还没有**的协作及证据骨架、落门禁入口、落 .githooks/pre-commit、
// 设仓库本地 core.hooksPath。
// 判断顺序是「先认领、再创建」：项目里已有状态入口、门禁入口、踩坑记录等价物时，
// 不再落一份平行文件，并在输出里点名它认到了哪一份。
// 不覆盖已存在文件、不装依赖、不改别的项目、不写用户级配置；重复运行结果一致。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, '..', 'templates');
const defaultGateCommand = 'npm test';

// 模板文件 → 目标仓库内的相对路径
const templateFiles = [
  ['AGENTS.md', 'AGENTS.md'],
  ['AGENT-TASK-TEMPLATE.md', 'docs/AGENT-TASK-TEMPLATE.md'],
  ['EVIDENCE-REPORT.md', 'docs/EVIDENCE-REPORT.md'],
  ['LESSONS.md', 'docs/LESSONS.md'],
  ['gate/agent-gate.mjs', 'scripts/agent-gate.mjs'],
  ['githooks/pre-commit', '.githooks/pre-commit'],
];

// 「项目里已经有等价物时不再落重复文件」：dest 之外的其他常见落点。
const equivalents = [
  { dest: 'AGENTS.md', role: '项目规则文件', probes: ['CLAUDE.md', 'GEMINI.md', '.cursorrules'] },
  { dest: 'docs/LESSONS.md', role: '踩坑记录', probes: ['LESSONS.md', 'docs/GOTCHAS.md', 'GOTCHAS.md', 'docs/reference/GOTCHAS.md', 'docs/KNOWN-ISSUES.md', 'docs/OPEN-ISSUES.md'] },
  { dest: 'docs/AGENT-TASK-TEMPLATE.md', role: '工单模板', probes: ['TASK-TEMPLATE.md', 'docs/TASK-TEMPLATE.md', 'docs/reference/TASK-TEMPLATE.md'] },
  { dest: 'docs/EVIDENCE-REPORT.md', role: '证据模板', probes: ['REPORT-TEMPLATE.md', 'docs/REPORT-TEMPLATE.md', 'docs/EVIDENCE-TEMPLATE.md', 'docs/reference/EVIDENCE-REPORT.md'] },
  { dest: '.githooks/pre-commit', role: '提交钩子', probes: ['.husky/pre-commit'] },
];

const gateScriptPath = 'scripts/agent-gate.mjs';
const packageGateNames = ['gate', 'check:quick', 'verify', 'check', 'check:all', 'ci:local'];

const usage = [
  '用法：node init-project.mjs <项目目录> [--gate-command "<验收命令>"]',
  '',
  '  项目目录        已有 .git 的仓库根目录（不是子目录）',
  '  --gate-command  只在需要生成 scripts/agent-gate.mjs 时用；不给就用 npm test。',
  '                  项目已有门禁入口时这个参数不生效（不覆盖既有入口）。',
  '',
  '例：node init-project.mjs /path/to/new-app --gate-command "npm test"',
  '',
  '已有文件与已有等价入口一律认领、不覆盖；重复运行安全。',
  '',
].join('\n');

const out = text => process.stdout.write(text + '\n');

function parseArgs(argv) {
  const args = { target: '', gateCommand: '', help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--help' || item === '-h') {
      args.help = true;
    } else if (item === '--gate-command') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--gate-command 后面要跟一条命令');
      args.gateCommand = value;
      i += 1;
    } else if (item.startsWith('--gate-command=')) {
      args.gateCommand = item.slice('--gate-command='.length);
      if (!args.gateCommand.trim()) throw new Error('--gate-command 不能为空');
    } else if (item.startsWith('-')) {
      throw new Error('不认识的参数：' + item);
    } else {
      positional.push(item);
    }
  }
  if (positional.length > 1) throw new Error('只能给一个项目目录，收到 ' + positional.length + ' 个');
  args.target = positional[0] || '';
  return args;
}

const isWin = process.platform === 'win32';
const toPosix = value => value.replace(/\\/g, '/');

function realPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function samePath(left, right) {
  const normalize = value => {
    const abs = realPath(value).replace(/\\/g, '/').replace(/\/+$/, '');
    return isWin ? abs.toLowerCase() : abs;
  };
  return normalize(left) === normalize(right);
}

function runGit(args, cwd) {
  const cleanEnv = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete cleanEnv[k];
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: cleanEnv });
  if (result.error) return { ok: false, status: null, stdout: '', stderr: result.error.message };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function assertRepoRoot(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error('目录不存在：' + target);
  }
  if (!stat.isDirectory()) throw new Error('不是目录：' + target);
  if (!fs.existsSync(path.join(target, '.git'))) {
    throw new Error('不是 git 仓库根目录（没有 .git）：' + target + '\n先 cd 到仓库根目录，或先 git init。');
  }
  const version = runGit(['--version'], target);
  if (!version.ok) throw new Error('找不到可用的 git：' + (version.stderr || '未知原因'));
  const top = runGit(['rev-parse', '--show-toplevel'], target);
  if (!top.ok) throw new Error('git 读不到仓库根目录：' + (top.stderr || '退出码 ' + top.status));
  if (!samePath(top.stdout, target)) {
    throw new Error('这不是仓库根目录。仓库根是：' + toPosix(top.stdout));
  }
}

const exists = (target, relative) => fs.existsSync(path.join(target, relative));

function readPackageScripts(target) {
  const file = path.join(target, 'package.json');
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return data && typeof data.scripts === 'object' && data.scripts ? data.scripts : {};
  } catch {
    return {};
  }
}

function resolveGate(target) {
  if (exists(target, gateScriptPath)) {
    return { entry: 'node ' + gateScriptPath, file: gateScriptPath, mode: 'script', detail: gateScriptPath };
  }
  const scripts = readPackageScripts(target);
  const name = packageGateNames.find(candidate => Object.prototype.hasOwnProperty.call(scripts, candidate));
  if (name) {
    return { entry: 'npm run ' + name, file: '', mode: 'package', detail: 'package.json scripts.' + name };
  }
  return { entry: 'node ' + gateScriptPath, file: gateScriptPath, mode: 'create', detail: gateScriptPath };
}

function findEquivalent(target, dest) {
  const table = equivalents.find(item => item.dest === dest);
  if (!table) return '';
  return table.probes.find(probe => exists(target, probe)) || '';
}

function loadTemplates() {
  if (!fs.existsSync(templateRoot)) throw new Error('模板目录缺失：' + templateRoot + '（技能安装不完整）');
  return templateFiles.map(([source, dest]) => {
    const sourcePath = path.join(templateRoot, source);
    if (!fs.existsSync(sourcePath)) throw new Error('模板缺失：' + sourcePath);
    return { sourcePath, dest, text: fs.readFileSync(sourcePath, 'utf8') };
  });
}

function ensureHookExecutableMode(target) {
  const hookAbs = path.join(target, '.githooks/pre-commit');
  if (!fs.existsSync(hookAbs)) return;
  try {
    fs.chmodSync(hookAbs, 0o755);
  } catch {
    // Windows 文件系统无 POSIX 位，由下方 Git 索引 chmod=+x 补齐跨平台可执行位。
  }
  const staged = runGit(['ls-files', '--stage', '--', '.githooks/pre-commit'], target);
  if (staged.ok && staged.stdout) {
    runGit(['update-index', '--chmod=+x', '.githooks/pre-commit'], target);
  }
}

function installFiles(target, templates, render) {
  const written = [];
  const skipped = [];
  const claimed = [];
  for (const item of templates) {
    const destPath = path.join(target, item.dest);
    if (fs.existsSync(destPath)) {
      skipped.push(item.dest);
      continue;
    }
    const existing = findEquivalent(target, item.dest);
    if (existing) {
      const role = equivalents.find(entry => entry.dest === item.dest).role;
      claimed.push({ dest: item.dest, found: existing, role });
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    // 统一 LF：CRLF 的 shell 钩子在按 shebang 执行的系统上起不来。
    fs.writeFileSync(destPath, render(item.text).replace(/\r\n/g, '\n'), 'utf8');
    written.push(item.dest);
  }
  return { written, skipped, claimed };
}

export function runInitProject(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (!args.target) throw new Error('缺少项目目录。\n\n' + usage);

  const target = path.resolve(args.target);
  assertRepoRoot(target);

  const projectName = path.basename(target);
  const gate = resolveGate(target);
  const gateCommand = args.gateCommand || defaultGateCommand;
  const gateText = args.gateCommand ? gateCommand : gateCommand + '，TODO: 不是这个就改';
  const render = text => text
    .replace(/\r\n/g, '\n')
    .replace(/\{\{PROJECT_NAME\}\}/g, () => projectName)
    .replace(/\{\{GATE_COMMAND_JS\}\}/g, () => JSON.stringify(gateCommand))
    .replace(/\{\{GATE_COMMAND\}\}/g, () => gateText)
    .replace(/\{\{GATE_ENTRY_FILE\}\}/g, () => gate.file)
    .replace(/\{\{GATE_ENTRY\}\}/g, () => gate.entry);

  // 先检查目标仓库是否已配置了其它 core.hooksPath（如 .husky）：
  // 若存在冲突且项目原本没有 .githooks/pre-commit，跳过写出 .githooks/pre-commit，避免磁盘残留未启用的冗余钩子。
  const previousHooks = runGit(['config', '--local', '--get', 'core.hooksPath'], target);
  const hasHooksPathConflict =
    previousHooks.ok && Boolean(previousHooks.stdout) && previousHooks.stdout !== '.githooks';
  const preExistingOwnHook = exists(target, '.githooks/pre-commit');

  const templates = loadTemplates().filter(item => {
    if (item.dest === gateScriptPath && gate.mode !== 'create') return false;
    if (item.dest === '.githooks/pre-commit' && hasHooksPathConflict && !preExistingOwnHook) return false;
    return true;
  });

  const { written, skipped, claimed } = installFiles(target, templates, render);

  const problems = [];
  const warnings = [];

  let hooksState = 'set';
  const ownHook = exists(target, '.githooks/pre-commit');
  if (hasHooksPathConflict) {
    hooksState = 'conflict';
    warnings.push(
      '仓库已设置 core.hooksPath = ' +
        previousHooks.stdout +
        '，未覆盖且未额外生成冗余 .githooks/pre-commit。请直接把门禁命令 `' +
        gate.entry +
        '` 接进现有钩子目录，或手动切换 core.hooksPath 后重跑本脚本。'
    );
  } else if (!ownHook) {
    const foreign = claimed.find(item => item.dest === '.githooks/pre-commit');
    hooksState = 'foreign';
    warnings.push(
      '没有生成 .githooks/pre-commit' +
        (foreign ? '（项目已有自己的提交钩子：' + foreign.found + '）' : '') +
        '，因此未改 core.hooksPath。请把门禁命令接进那个钩子，否则提交时什么都不跑。'
    );
  } else if (previousHooks.ok && previousHooks.stdout === '.githooks') {
    hooksState = 'unchanged';
    ensureHookExecutableMode(target);
  } else {
    const setHooks = runGit(['config', '--local', 'core.hooksPath', '.githooks'], target);
    if (!setHooks.ok) {
      hooksState = 'failed';
      problems.push('设置 core.hooksPath 失败：' + (setHooks.stderr || '退出码 ' + setHooks.status));
    } else {
      ensureHookExecutableMode(target);
    }
  }

  out('项目起步包 → ' + toPosix(target));
  out('');

  out('模板：');
  for (const dest of written) out('  + ' + dest);
  for (const dest of skipped) out('  = ' + dest + '（已存在，未覆盖）');
  for (const item of claimed) out('  = ' + item.dest + '（项目已有' + item.role + '：' + item.found + '，未落重复文件）');
  if (!written.length && !skipped.length && !claimed.length) out('  （没有可写的模板）');
  out('');

  out('门禁入口：');
  if (gate.mode === 'create') out('  + 生成 ' + gateScriptPath + '，里面只有一条 ' + gateCommand);
  else out('  = 用项目已有的 ' + gate.detail + '，钩子直接调它（不改写）');
  out('    pre-commit 将执行：' + gate.entry);
  out('');

  out('Git：');
  if (hooksState === 'failed') out('  ! core.hooksPath 设置失败');
  else if (hooksState === 'foreign') out('  ! 未生成 .githooks/pre-commit，也没动 core.hooksPath（见下方「注意」）');
  else if (hooksState === 'unchanged') out('  = core.hooksPath 已是 .githooks');
  else if (hooksState === 'conflict') out('  ! 仓库已有别的 core.hooksPath（' + previousHooks.stdout + '），未覆盖（见下方「注意」）');
  else out('  + core.hooksPath = .githooks（仓库本地）');
  out('');

  if (skipped.includes('AGENTS.md')) {
    out('提示：AGENTS.md 已存在，未覆盖；把它当作项目协作入口，别在旁边再建一份。');
    out('');
  }
  if (claimed.length) {
    out('提示：下面这些落到的是项目已有的那份文件，后续按那里的写法维护：');
    for (const item of claimed) out('  - ' + item.role + '：' + item.found);
    out('');
  }

  if (warnings.length) {
    out('注意：');
    for (const warning of warnings) out('  ! ' + warning);
    out('');
  }

  out('下一步要改什么：');
  const rulesClaimed = claimed.find(item => item.dest === 'AGENTS.md');
  out(rulesClaimed
    ? '  1. ' + rulesClaimed.found + '：补上项目在哪、跑什么命令、什么不许碰（新模板里的 TODO: 换成这一份的写法）。'
    : '  1. AGENTS.md 里的 TODO：项目在哪、跑什么命令、什么不许碰（搜 TODO:）。');
  if (gate.mode === 'create') {
    out('  2. 改 ' + gateScriptPath + ' 里的检查项：现在只有一条 ' + gateCommand + '，按项目加减。');
  } else {
    out('  2. 核一遍 ' + gate.detail + '：钩子直接通过它执行，别在旁边另造一层门禁。');
  }
  if (hooksState === 'foreign' || hooksState === 'conflict') {
    out('  3. 把门禁接进项目已有的提交钩子（见上方「注意」），再确认它真的会拦下失败的提交。');
  } else {
    out('  3. 暂存钩子时确保赋予 100755 可执行位（Windows 必做，否则 Linux/macOS 会跳过钩子）：');
    out('     git add --chmod=+x .githooks/pre-commit && git add ' + (gate.file || 'AGENTS.md'));
    out('     并在 .gitattributes 里钉死 `.githooks/** text eol=lf`。');
  }
  out('  4. docs/LESSONS.md 的示例条目换成真实的；协作分工与工程规范由全局 skill lead-orchestration 承接。');
  out('');
  out('重复运行安全：已有文件一律认领、跳过，不重复追加。');

  if (problems.length) {
    out('');
    out('未完成：');
    for (const problem of problems) out('  ! ' + problem);
    return 1;
  }
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  return samePath(process.argv[1], fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  try {
    process.exitCode = runInitProject(process.argv.slice(2));
  } catch (error) {
    process.stderr.write('错误：' + error.message + '\n');
    process.exitCode = 1;
  }
}
