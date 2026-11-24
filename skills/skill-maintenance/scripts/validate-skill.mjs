#!/usr/bin/env node
// 生成时快速校验（正则级）：检查单个技能目录的 SKILL.md 与 frontmatter 形状。
// 退出码：0 = 通过；1 = 资产问题；2 = 运行错误（参数缺失、目录不存在）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `用法：
  node validate-skill.mjs <skill目录>     校验单个技能目录
  node validate-skill.mjs --self-test     运行内置好例/坏例阳性对照
退出码：0 通过 / 1 资产问题 / 2 运行错误`;

function unquote(value) {
  const t = value.trim();
  if (t.length >= 2) {
    const head = t[0];
    if ((head === '"' || head === "'") && t[t.length - 1] === head) return t.slice(1, -1);
  }
  return t;
}

// 取顶层键的值：支持引号串、多行续行，以及含段间空行的 YAML 块标量（| / >）。
// 块内空行（/^\s*$/）不会提前截断块标量，遇到下一个顶格非空键（/^\S/）才结束当前字段。
export function extractField(fmLines, key) {
  const idx = fmLines.findIndex(line => line.startsWith(`${key}:`));
  if (idx === -1) return null;
  let first = fmLines[idx].slice(key.length + 1).trim();
  const isBlockScalar = /^[|>][+-]?$/.test(first);
  if (isBlockScalar) first = '';
  const parts = first ? [first] : [];
  for (let i = idx + 1; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (/^\S/.test(line)) break; // 下一个顶层 YAML 键
    if (/^\s*$/.test(line)) {
      if (isBlockScalar) continue; // 块标量允许段间空行
      break;
    }
    parts.push(line.trim());
  }
  return unquote(parts.join(' ').trim());
}

export function validateSkillDir(dirArg) {
  const dir = path.resolve(dirArg);
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { runtime: `目录不存在：${dirArg}` };
  }
  if (!stat.isDirectory()) return { runtime: `不是目录：${dirArg}` };

  const dirName = path.basename(dir);
  const skillMd = path.join(dir, 'SKILL.md');
  const problems = [];
  const warnings = [];

  if (!fs.existsSync(skillMd)) {
    problems.push('缺少 SKILL.md');
    return { dirName, problems, warnings };
  }

  let text;
  try {
    text = fs.readFileSync(skillMd, 'utf8');
  } catch (err) {
    return { runtime: `读取 SKILL.md 失败：${err.message}` };
  }

  if (text.charCodeAt(0) === 0xfeff) {
    warnings.push('SKILL.md 含 UTF-8 BOM；按字面匹配 frontmatter 的宿主可能读不到（仅提示）');
    text = text.slice(1);
  }

  if (!text.startsWith('---')) {
    problems.push('内容未以 --- 开头（缺少 frontmatter）');
    return { dirName, problems, warnings };
  }

  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    problems.push('frontmatter 格式无效：需要 ^---\\n ... \\n--- 包裹（可能未闭合）');
    return { dirName, problems, warnings };
  }

  const fmLines = fm[1].split(/\r?\n/);
  const name = extractField(fmLines, 'name');
  const description = extractField(fmLines, 'description');

  if (!name) problems.push('缺少 name，或 name 值为空');
  if (!description) problems.push('缺少 description，或 description 值为空');

  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      problems.push(`name '${name}' 不是 hyphen-case（只允许小写字母、数字、连字符）`);
    } else if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
      problems.push(`name '${name}' 不能以连字符开头或结尾，也不能含连续连字符`);
    }
    if (name !== dirName) {
      problems.push(`name '${name}' 与目录名 '${dirName}' 不一致（登记名与入口名脱节，宿主不会报错，只会静默跳过）`);
    }
  }

  if (description && (description.includes('<') || description.includes('>'))) {
    problems.push('description 不能包含尖括号（< 或 >）；description 是唯一触发器，含尖括号会被宿主跳过');
  }

  return { dirName, problems, warnings };
}

function selfTest() {
  const cases = [
    {
      label: '好例：最小合法技能',
      dir: 'good-skill',
      content: ['---', 'name: good-skill', 'description: Does one thing well.', '---', '', '# Body', ''].join('\n'),
      expect: 0,
    },
    {
      label: '好例：description 块标量含段间空行仍完整解析',
      dir: 'block-para-skill',
      content: [
        '---',
        'name: block-para-skill',
        'description: |',
        '  First paragraph summary.',
        '',
        '  Second paragraph trigger condition.',
        'user-invocable: true',
        '---',
        '',
        '# Body',
      ].join('\n'),
      expect: 0,
    },
    {
      label: '好例：CRLF 换行',
      dir: 'crlf-skill',
      content: ['---', 'name: crlf-skill', 'description: Windows 换行。', '---', '', '# Body', ''].join('\r\n'),
      expect: 0,
    },
    { label: '坏例：缺 SKILL.md', dir: 'no-entry', content: null, expect: 1 },
    { label: '坏例：无 frontmatter', dir: 'no-frontmatter', content: '# 只有正文\n', expect: 1 },
    {
      label: '坏例：name 带下划线',
      dir: 'name_underscore',
      content: ['---', 'name: name_underscore', 'description: x', '---', ''].join('\n'),
      expect: 1,
    },
    {
      label: '坏例：块标量空行后的第二段含尖括号（证明未被空行截断）',
      dir: 'block-angle-second-para',
      content: [
        '---',
        'name: block-angle-second-para',
        'description: >',
        '  Safe first paragraph.',
        '',
        '  Unsafe <token> in second paragraph.',
        '---',
      ].join('\n'),
      expect: 1,
    },
    {
      label: '坏例：name 与目录名不一致',
      dir: 'name-mismatch',
      content: ['---', 'name: other-name', 'description: x', '---', ''].join('\n'),
      expect: 1,
    },
    {
      label: '坏例：frontmatter 未闭合',
      dir: 'unclosed',
      content: ['---', 'name: unclosed', 'description: x', ''].join('\n'),
      expect: 1,
    },
    {
      label: '坏例：description 为空或空引号（后续跟其它顶层键）',
      dir: 'empty-desc',
      content: ['---', 'name: empty-desc', 'description: ""', 'user-invocable: true', '---', ''].join('\n'),
      expect: 1,
    },
  ];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-skill-selftest-'));
  let failed = 0;
  try {
    for (const c of cases) {
      const dir = path.join(tmp, c.dir);
      fs.mkdirSync(dir, { recursive: true });
      if (c.content !== null) fs.writeFileSync(path.join(dir, 'SKILL.md'), c.content, 'utf8');
      const r = validateSkillDir(dir);
      const actual = r.runtime ? 2 : (r.problems.length === 0 ? 0 : 1);
      const ok = actual === c.expect;
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  期望 ${c.expect} 实际 ${actual}  ${c.label}`);
      if (!ok && r.problems?.length) for (const p of r.problems) console.log(`        - ${p}`);
      if (!ok && r.runtime) console.log(`        - ${r.runtime}`);
    }

    const r = validateSkillDir(path.join(tmp, 'does-not-exist'));
    const actual = r.runtime ? 2 : (r.problems.length === 0 ? 0 : 1);
    const ok = actual === 2;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  期望 2 实际 ${actual}  运行错误：目录不存在`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failed ? `\nself-test 失败 ${failed} 项（退出码 1）` : `\nself-test 全部通过（退出码 0）`);
  return failed ? 1 : 0;
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

export function main(args = process.argv.slice(2)) {
  if (args.length === 0) {
    console.error(USAGE);
    return 2;
  }
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(USAGE);
    return 0;
  }
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.length !== 1 || args[0].startsWith('--')) {
    console.error(`未知参数：${args.join(' ')}\n\n${USAGE}`);
    return 2;
  }

  const r = validateSkillDir(args[0]);
  if (r.runtime) {
    console.error(`错误：${r.runtime}`);
    return 2;
  }
  for (const w of r.warnings) console.log(`警告: ${r.dirName}: ${w}`);
  if (r.problems.length === 0) {
    console.log(`OK   ${r.dirName}`);
    return 0;
  }
  console.log(`FAIL ${r.dirName}`);
  for (const p of r.problems) console.log(`     - ${p}`);
  return 1;
}

if (isEntryPoint()) {
  process.exitCode = main();
}
