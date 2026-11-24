import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 只读工作树隔离检查器（不创建或删除 worktree）。
// 支持两阶段校验：
//   - phase = 'pre'（默认，建好 worktree 后、动手修改前）：要求工作树干净且 HEAD === base；
//   - phase = 'post'（执行者完成本地提交后、回报合并前）：要求工作树干净、HEAD !== base 且 base 是 HEAD 的祖先提交。
export function checkWorkerWorkspace({ coordinator, worker, base, phase = 'pre' }) {
  const cleanEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete cleanEnv[k];
  }

  const runGit = (cwd, ...args) =>
    spawnSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      env: cleanEnv,
    });

  const git = (cwd, ...args) => {
    const r = runGit(cwd, ...args);
    if (r.status !== 0) throw new Error(`Git 检查失败：${args[0]}`);
    return r.stdout.trim();
  };

  try {
    if (phase !== 'pre' && phase !== 'post') {
      throw new Error(`无效阶段 '${phase}'（仅支持 pre 或 post）`);
    }
    if (!coordinator || !worker || !base) throw new Error('必须指定主导目录、执行者目录和完整基线 SHA');
    const real = p => fs.realpathSync(p);
    const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
    const main = real(git(coordinator, 'rev-parse', '--show-toplevel'));
    const child = real(git(worker, 'rev-parse', '--show-toplevel'));
    if (key(main) === key(child)) throw new Error('共用工作目录');
    if (key(real(coordinator)) !== key(main) || key(real(worker)) !== key(child)) throw new Error('工单目录必须为工作树根');
    const common = cwd => key(real(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')));
    if (common(main) !== common(child)) throw new Error('不是同仓库独立工作树');
    const branch = git(child, 'symbolic-ref', '--quiet', '--short', 'HEAD');
    if (branch === git(main, 'symbolic-ref', '--quiet', '--short', 'HEAD')) throw new Error('共用分支');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base)) throw new Error('需要完整 SHA-1 或 SHA-256 基线');

    const head = git(child, 'rev-parse', 'HEAD');
    if (git(child, 'status', '--porcelain', '--untracked-files=all')) throw new Error('执行者工作树非干净');

    if (phase === 'pre') {
      if (head !== base) throw new Error('开工前检查失败：执行者 HEAD 不等于工单基线');
      return {
        ok: true,
        phase,
        coordinator: main,
        worker: child,
        branch,
        base,
        head,
        coordinatorDirty: Boolean(git(main, 'status', '--porcelain', '--untracked-files=all')),
      };
    }

    // phase === 'post'
    if (head === base) throw new Error('提交后检查失败：执行者尚未产生新提交（HEAD 仍等于工单基线）');
    const anc = runGit(child, 'merge-base', '--is-ancestor', base, head);
    if (anc.status !== 0) throw new Error('提交后检查失败：执行者 HEAD 不是从工单基线演进的后代提交');
    const aheadCount = Number(git(child, 'rev-list', '--count', `${base}..${head}`));

    return {
      ok: true,
      phase,
      coordinator: main,
      worker: child,
      branch,
      base,
      head,
      aheadCount,
      coordinatorDirty: Boolean(git(main, 'status', '--porcelain', '--untracked-files=all')),
    };
  } catch (e) {
    return { ok: false, phase, error: e.message };
  }
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-ws-selftest-'));
  const cleanEnv = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete cleanEnv[k];
  }
  const g = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv, windowsHide: true });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout.trim();
  };

  try {
    const mainDir = path.join(tmp, 'main-repo');
    const workerDir = path.join(tmp, 'worker-wt');
    fs.mkdirSync(mainDir);
    g(mainDir, 'init', '-q', '-b', 'main');
    g(mainDir, 'config', 'user.email', 'bot@example.com');
    g(mainDir, 'config', 'user.name', 'Test Bot');
    fs.writeFileSync(path.join(mainDir, 'README.md'), '# Base\n');
    g(mainDir, 'add', '.');
    g(mainDir, 'commit', '-q', '-m', 'init base');
    const baseSha = g(mainDir, 'rev-parse', 'HEAD');

    // 建立独立分支 worktree
    g(mainDir, 'worktree', 'add', '-q', '-b', 'feat/slice-a', workerDir, baseSha);

    // 1. 开工前 pre 阶段：干净且 HEAD === base ⇒ 通过；此时跑 post ⇒ 必须失败
    const preOk = checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'pre' });
    assert.equal(preOk.ok, true, preOk.error);
    const postTooEarly = checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'post' });
    assert.equal(postTooEarly.ok, false);
    assert.match(postTooEarly.error, /尚未产生新提交/);

    // 2. 工作树有未提交改动 ⇒ pre 与 post 都必须拦截
    fs.writeFileSync(path.join(workerDir, 'slice.js'), 'export const x = 1;\n');
    assert.equal(checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'pre' }).ok, false);
    assert.equal(checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'post' }).ok, false);

    // 3. 本地提交完成后 ⇒ post 阶段通过（aheadCount === 1），此时误用 pre ⇒ 失败
    g(workerDir, 'add', '.');
    g(workerDir, 'commit', '-q', '-m', 'feat: add slice');
    const postOk = checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'post' });
    assert.equal(postOk.ok, true, postOk.error);
    assert.equal(postOk.aheadCount, 1);
    assert.equal(checkWorkerWorkspace({ coordinator: mainDir, worker: workerDir, base: baseSha, phase: 'pre' }).ok, false);

    // 4. 非基线后代（孤立根提交）⇒ post 阶段必须拦截
    const orphanDir = path.join(tmp, 'orphan-wt');
    g(mainDir, 'worktree', 'add', '-q', '--detach', orphanDir, baseSha);
    g(orphanDir, 'checkout', '-q', '--orphan', 'feat/unrelated-root');
    fs.writeFileSync(path.join(orphanDir, 'other.txt'), 'orphan\n');
    g(orphanDir, 'add', '.');
    g(orphanDir, 'commit', '-q', '-m', 'orphan commit');
    const postNonAncestor = checkWorkerWorkspace({ coordinator: mainDir, worker: orphanDir, base: baseSha, phase: 'post' });
    assert.equal(postNonAncestor.ok, false);
    assert.match(postNonAncestor.error, /后代提交/);

    console.log('[check-worker-workspace] self-test 全部 4 组两阶段（pre/post）对照通过（退出码 0）');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function parseCliArgs(argv) {
  let phase = 'pre';
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--phase') {
      const val = argv[++i];
      if (!val || val.startsWith('--')) return { error: '--phase 后面需要 pre 或 post' };
      phase = val;
    } else if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
    } else if (arg.startsWith('-')) {
      return { error: `未知参数：${arg}` };
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 3) return { error: '参数过多' };
  const [coordinator, worker, base] = positional;
  return { coordinator, worker, base, phase };
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  const normalize = (p) => {
    let resolved;
    try { resolved = fs.realpathSync(p); } catch { resolved = path.resolve(p); }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--self-test') {
    process.exitCode = selfTest();
  } else if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    console.log('用法：node check-worker-workspace.mjs <主目录> <执行者目录> <完整基线SHA> [--phase pre|post] | --self-test');
    process.exitCode = 0;
  } else {
    const parsed = parseCliArgs(argv);
    const r = parsed.error ? { ok: false, error: parsed.error } : checkWorkerWorkspace(parsed);
    console.log(JSON.stringify(r));
    process.exitCode = r.ok ? 0 : 1;
  }
}
