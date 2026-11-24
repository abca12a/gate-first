#!/usr/bin/env node
// 只读检查技能集合的依赖闭包：技能间硬依赖引用、技能内相对资源与 Markdown 链接、外部命令提示。
// 零外部依赖，默认自动定位并扫描本仓同级 skills/ 目录，也支持 --root <目录> 扫描任意技能目录。
//
// 退出码：0 = 通过；1 = 发现资产问题；2 = 运行错误。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractField } from './validate-skill.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_ROOT = path.resolve(HERE, '..', '..');

const TOOLS = ['node', 'python', 'python3', 'git', 'gh', 'rg', 'git-wt', 'npx', 'pnpm'];

const OPTIONAL_UPSTREAM_SKILLS = new Set([
  'diagnosing-bugs',
  'domain-modeling',
  'grill-with-docs',
  'grilling',
  'handoff',
  'writing-for-agents',
  'design-taste-frontend',
  'impeccable',
  'ov-experience-memory',
]);

const NON_SKILL_TOKENS = new Set([
  'git-wt', 'js-yaml', 'lark-cli', 'pre-commit', 'pre-merge-commit',
  'hyphen-case', 'utf-8', 'utf-8-sig', 'sha-1', 'sha-256', 'no-verify',
  'is-ancestor', 'diff-filter', 'ls-remote', 'ls-files', 'for-each-ref',
  'rev-list', 'rev-parse', 'merge-base', 'cat-file', 'cherry-pick',
  'quick-validate', 'skill-creator', 'agent-gate', 'init-project',
  'check-all', 'check-quick', 'check-skills', 'check-host-neutral',
  'check-host-skills', 'check-skill-deps', 'validate-skill',
]);

function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter(d => {
        if (d.name.startsWith('.')) return false;
        if (d.isDirectory()) return true;
        if (d.isSymbolicLink()) {
          try { return fs.statSync(path.join(p, d.name)).isDirectory(); } catch { return false; }
        }
        return false;
      })
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

function collectMarkdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) collectMarkdownFiles(full, out);
    else if (st.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// CommonMark 围栏代码块剥离（支持列表缩进与 3+ 反引号/波浪号外层围栏）
function stripFencedCode(markdown) {
  const out = [];
  let fenceChar = '';
  let fenceLen = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (!fenceChar) {
      const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        out.push('');
        continue;
      }
      out.push(line);
    } else {
      const closeRe = new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`);
      if (closeRe.test(line)) {
        fenceChar = '';
        fenceLen = 0;
      }
      out.push('');
    }
  }
  return out.join('\n');
}

// 剥离围栏代码块与多反引号行内代码段，供真实 Markdown 链接提取使用
function stripAllCode(markdown) {
  return stripFencedCode(markdown).replace(/(`+)([^`]|(?!\1)`)*\1/g, '');
}

// 提取非围栏正文中的所有行内代码片段（兼容单反引号与双反引号 `` `code` ``）
function extractInlineCodeTokens(markdownWithoutFences) {
  const tokens = [];
  for (const m of markdownWithoutFences.matchAll(/(`+)((?:[^`\n]|(?!\1)`)+)\1/g)) {
    const val = m[2].trim();
    if (val && val.length <= 80) tokens.push(val);
  }
  return [...new Set(tokens)];
}

function which(cmd) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (fs.existsSync(path.join(dir, cmd + ext))) return path.join(dir, cmd + ext);
      } catch {}
    }
  }
  return null;
}

const looksLikeSkillSlug = t =>
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(t) &&
  t.length >= 5 &&
  !t.startsWith('data-') &&
  !t.startsWith('aria-') &&
  !NON_SKILL_TOKENS.has(t);

export function analyzeSkillDeps(scanRoots) {
  for (const r of scanRoots) {
    let st;
    try { st = fs.statSync(r); } catch { throw new Error(`目录不存在：${r}`); }
    if (!st.isDirectory()) throw new Error(`不是目录：${r}`);
  }

  const catalog = new Set();
  for (const r of scanRoots) for (const n of listDirs(r)) catalog.add(n);

  const issues = {
    missingSkills: [],
    missingFiles: [],
    badFrontmatter: [],
    optionalUpstream: [],
    missingTools: [],
  };

  for (const root of scanRoots) {
    for (const name of listDirs(root)) {
      const dir = path.join(root, name);
      const sm = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(sm)) {
        issues.badFrontmatter.push({ skill: name, issue: '缺少 SKILL.md' });
        continue;
      }
      const text = fs.readFileSync(sm, 'utf8').replace(/^\uFEFF/, '');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      if (!fm) {
        issues.badFrontmatter.push({ skill: name, issue: '缺少或未闭合 frontmatter' });
      } else {
        const fmLines = fm[1].split(/\r?\n/);
        const parsedName = extractField(fmLines, 'name');
        const parsedDesc = extractField(fmLines, 'description');
        if (!parsedName || parsedName !== name) {
          issues.badFrontmatter.push({ skill: name, issue: `name 与目录不一致: ${parsedName || '(缺失)'}` });
        }
        if (!parsedDesc) {
          issues.badFrontmatter.push({ skill: name, issue: '缺少 description 或值为空' });
        }
      }

      const mdFiles = collectMarkdownFiles(dir).filter(
        f => !path.relative(dir, f).split(path.sep).includes('templates')
      );

      for (const mdFile of mdFiles) {
        const raw = fs.readFileSync(mdFile, 'utf8');
        const body = mdFile === sm ? raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '') : raw;
        const proseWithoutFences = stripFencedCode(body);

        // 1. 语境技能引用（已剥离围栏代码块，避免代码块示例触发误报）
        const ctxRefs = [
          ...proseWithoutFences.matchAll(/(?:读取|读|使用|调用|用|按|见|load|read|use)\s*`([a-z][a-z0-9-]{4,})`/gi),
        ].map(m => m[1].toLowerCase());

        for (const ref of ctxRefs) {
          if (!looksLikeSkillSlug(ref) || catalog.has(ref)) continue;
          if (OPTIONAL_UPSTREAM_SKILLS.has(ref)) {
            issues.optionalUpstream.push({ skill: name, ref });
          } else {
            issues.missingSkills.push({ skill: name, ref });
          }
        }

        // 2. 行内代码片段中的技能内相对资源（references/、templates/、assets/）与命令提示
        const tokens = extractInlineCodeTokens(proseWithoutFences);
        for (const t of tokens) {
          const isBareDir = t.endsWith('/');
          if (!isBareDir && /^(references|assets|templates)\//.test(t) && !t.includes(' ') && !t.includes('<')) {
            if (!fs.existsSync(path.join(dir, t))) {
              issues.missingFiles.push({ skill: name, ref: t });
            }
          }
          const first = t.split(/\s+/)[0].replace(/^\$/, '');
          if (TOOLS.includes(first) && !which(first)) {
            issues.missingTools.push({ skill: name, cmd: first });
          }
        }

        // 3. 真实 Markdown 相对链接检查
        const stripped = stripAllCode(body);
        for (const m of stripped.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const target = m[1].replace(/\\/g, '/');
          if (/^(https?:|#|mailto:)/.test(target)) continue;
          if (/^[A-Za-z]:\//.test(target) || target.startsWith('/')) continue;
          const [pathPart] = target.split('#');
          if (!pathPart) continue;
          const resolved = path.resolve(path.dirname(mdFile), pathPart);
          if (!fs.existsSync(resolved)) {
            const relFromSkill = path.relative(dir, mdFile).replace(/\\/g, '/');
            issues.missingFiles.push({ skill: name, ref: `${relFromSkill} -> ${target}` });
          }
        }
      }
    }
  }

  const dedupe = (arr, key) => [...new Map(arr.map(it => [key(it), it])).values()];
  for (const k of Object.keys(issues)) {
    issues[k] = dedupe(issues[k], it => `${it.skill}::${it.ref || it.cmd || it.issue}`);
  }

  const failed = issues.missingSkills.length + issues.missingFiles.length + issues.badFrontmatter.length > 0;
  return { ok: !failed, scanned: scanRoots, catalogSize: catalog.size, ...issues };
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-deps-selftest-'));
  let failed = 0;
  const check = (label, ok, detail = '') => {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ' — ' + detail : ''}`);
  };

  try {
    const goodRoot = path.join(tmp, 'good');
    fs.mkdirSync(path.join(goodRoot, 'alpha-flow', 'references'), { recursive: true });
    fs.mkdirSync(path.join(goodRoot, 'beta-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(goodRoot, 'alpha-flow', 'SKILL.md'),
      [
        '---',
        'name: alpha-flow',
        'description: Alpha skill.',
        '---',
        'Read [guide](references/guide.md) and 按 `beta-gate` 验证，按 `data-design-key` 选元素，日常排障用 `diagnosing-bugs`。',
        '',
        '```markdown',
        '读取 `fake-skill-inside-fence` 与 `references/not-real-in-fence.md` 不应误报。',
        '```',
        '',
      ].join('\n')
    );
    fs.writeFileSync(path.join(goodRoot, 'alpha-flow', 'references', 'guide.md'), '# Guide\n');
    fs.writeFileSync(path.join(goodRoot, 'beta-gate', 'SKILL.md'), '---\nname: beta-gate\ndescription: Beta skill.\n---\n');

    const rGood = analyzeSkillDeps([goodRoot]);
    check(
      '好例：内部引用、可选上游技能与围栏代码块剥离均通过',
      rGood.ok && rGood.optionalUpstream.length === 1,
      JSON.stringify(rGood)
    );

    const badRoot = path.join(tmp, 'bad');
    fs.mkdirSync(path.join(badRoot, 'broken-caller'), { recursive: true });
    fs.mkdirSync(path.join(badRoot, 'empty-desc-newline'), { recursive: true });
    fs.writeFileSync(
      path.join(badRoot, 'broken-caller', 'SKILL.md'),
      '---\nname: broken-caller\ndescription: Broken.\n---\n先读 `ghost-missing-skill`，再看 [missing](references/not-there.md)。\n'
    );
    // 复现 `/^description:\s*\S/m` 跨行吞掉下一行 `user-invocable:` 的历史 bug
    fs.writeFileSync(
      path.join(badRoot, 'empty-desc-newline', 'SKILL.md'),
      '---\nname: empty-desc-newline\ndescription:\nuser-invocable: true\n---\n'
    );
    const rBad = analyzeSkillDeps([badRoot]);
    check(
      '坏例（阳性对照）：检出缺失技能、缺失文件及空 description 跨行陷阱',
      !rBad.ok &&
        rBad.missingSkills.length === 1 &&
        rBad.missingFiles.length === 1 &&
        rBad.badFrontmatter.length === 1
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failed ? `\n[check-skill-deps] self-test 失败 ${failed} 项（退出码 1）` : '\n[check-skill-deps] self-test 全部通过（退出码 0）');
  return failed ? 1 : 0;
}

export function main(args = process.argv.slice(2)) {
  const roots = [];
  let jsonOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('用法：node check-skill-deps.mjs [--root <目录>]... [--json] | --self-test');
      return 0;
    }
    if (args[i] === '--self-test') return selfTest();
    if (args[i] === '--root') {
      const val = args[++i];
      if (!val || val.startsWith('--')) {
        console.error('[check-skill-deps] ✗ 运行错误：--root 后面需要目录路径');
        return 2;
      }
      roots.push(path.resolve(val));
    } else if (args[i] === '--json') {
      jsonOnly = true;
    } else {
      console.error(`[check-skill-deps] ✗ 未知参数: ${args[i]}`);
      return 2;
    }
  }

  const scanRoots = roots.length ? roots : [DEFAULT_SKILLS_ROOT];
  let report;
  try {
    report = analyzeSkillDeps(scanRoots);
  } catch (err) {
    console.error(`[check-skill-deps] ✗ 运行错误：${err.message}`);
    return 2;
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[check-skill-deps] 扫描 ${scanRoots.length} 个入口，catalog ${report.catalogSize} 个技能`);
    const sections = [
      ['missingSkills', '✗ 引用了不在 catalog 的内部技能'],
      ['missingFiles', '✗ 引用了不存在的技能内文件'],
      ['badFrontmatter', '✗ frontmatter / 登记问题'],
      ['optionalUpstream', 'ℹ 可选搭配的外部上游技能（未内置，按需安装）'],
      ['missingTools', '⚠ 提示：提及的外部命令不在当前 PATH（可选增强）'],
    ];
    for (const [k, label] of sections) {
      if (!report[k].length) continue;
      console.log(`\n${label}:`);
      for (const it of report[k]) console.log(`  ${it.skill} -> ${it.ref || it.cmd || it.issue}`);
    }
    console.log(report.ok ? '\n[check-skill-deps] 结果: 通过（退出码 0）' : '\n[check-skill-deps] 结果: 发现资产问题（退出码 1）');
  }
  return report.ok ? 0 : 1;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  const norm = p => {
    let r;
    try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  process.exitCode = main();
}
