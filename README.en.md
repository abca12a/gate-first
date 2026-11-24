# gate-first

**Grow deterministic gates out of real incidents instead of bloating your system prompts.**  
A cross-host engineering governance kit for high-intensity AI-assisted development: a ~30-line global prompt contract, 10 battle-tested workflow skills, self-growing Git gates with positive controls, and a backend-agnostic memory architecture.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](./package.json)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-success.svg)](./package.json)
[![Live Blueprint](https://img.shields.io/badge/Live_Blueprint-GitHub_Pages-0ea5e9.svg)](https://abca12a.github.io/gate-first/)

[**Live Interactive Blueprint (`abca12a.github.io/gate-first`)**](https://abca12a.github.io/gate-first/) · [**Local Showcase (`showcase/index.html`)**](./showcase/index.html) · [**Production Reference Stack (`docs/REFERENCE-STACK.md`)**](./docs/REFERENCE-STACK.md) · [**简体中文主文档 (`README.md`)**](./README.md)

---

## The Problem: Why Prompt-Only Governance Collapses

Teams running coding agents across real production repositories hit the same four failure modes within months:

1. **Prompt Sediment**: Every mistake gets appended as another *"NEVER do X"* bullet in `CLAUDE.md` or `AGENTS.md`. At 500+ lines, you pay thousands of always-loaded context tokens on every turn while mid-context attention degrades across the board.
2. **Warnings (`exit 0`) Equal Zero Enforcement**: In one documented production incident, a `120`-line cap on a session handoff section was written in three separate docs and backed by a script printing warnings on every run — with `exit 0`. Within **8 days**, that section ballooned to **569 lines / 104 KB**, dumping 104 KB into every new session while tests and CI stayed green.
3. **Multi-Agent Workspace & Memory Collisions**: Parallel sessions edit the same working tree, or exploratory subagents dump noisy dead-end hypotheses straight into shared long-term memory.
4. **Cross-Host Drift**: Switching across Claude Code, Codex, DSH, OpenCode, and Antigravity leads to diverged copies, dangling symlinks after skill consolidation, or `0`-byte file truncation when multiple host instruction files symlink to the same shared relay file (`~/.agents/AGENTS.md`).

---

## Core Thesis

`gate-first` replaces wishful prompt engineering with four structural invariants:

1. **Rules That Grow Gates ([`gates/PROTOCOL.md`](./gates/PROTOCOL.md))**: Keep always-loaded global instructions capped around **~30 lines** ([`prompts/`](./prompts/README.md)). Whenever an error can be checked deterministically, turn it into an **`exit 1`** script wired to `.githooks/pre-commit`, paired with an automated **positive control** proving the gate actually turns red on known bad inputs.
2. **Single Lead, Isolated Executors ([`skills/lead-orchestration/`](./skills/lead-orchestration/SKILL.md))**: One Lead session owns alignment, task scoping, evidence review, and merging. Parallel writers run inside isolated `git worktree` checkouts verified across two phases (`--phase pre` before edits, `--phase post` after local commits). Subagents report verifiable receipts back to the Lead and **never** write to shared long-term memory.
3. **Backend-Agnostic Memory Contract ([`memory/CONTRACT.md`](./memory/CONTRACT.md))**: Separate always-injected user preferences from repo-scoped facts (`peers`), cold long-form archives (`resources`), and reusable troubleshooting recipes (`experiences`), enforced with **L0 / L1 / L2 progressive disclosure** (abstracts screen candidates; full L2 bodies must be read before acting).
4. **Start Zero-Dependency, Scale to a Six-Layer Production Stack ([`docs/REFERENCE-STACK.md`](./docs/REFERENCE-STACK.md))**: Run the entire core loop in 3 minutes using nothing but `Git` + `Node.js >= 20`, then optionally scale to multi-host distribution (**Magpie**), zero-public-exposure mesh networking (**EasyTier**), and heterogeneous dual-model memory (**OpenViking `v0.5.5`**).

> 💡 **Interactive Architecture Blueprint**: Visit the live GitHub Pages deployment at [**`https://abca12a.github.io/gate-first/`**](https://abca12a.github.io/gate-first/) (or open [**`showcase/index.html`**](./showcase/index.html) locally) to explore the 6-layer architecture flow, EasyTier mesh topology, dual-model memory pipeline, and interactive positive-control gate lab.

---

## What It Is — and What It Is Not

| What `gate-first` is | What `gate-first` is not |
|---|---|
| A **zero-dependency** (`Node.js >= 20` + `Git`) governance kit that drops cleanly into new or existing repositories | Not a heavy Python/TS agent runtime framework that locks you into a custom SDK |
| 10 host-neutral workflow skills distilled from real incidents, guarded by automated lint & dependency checks | Not an uncurated collection of generic "awesome prompts" |
| A cross-host enforcement layer anchored on Git hooks (`LF` + `100755`) so every agent and human passes the exact same bar | Not mandatory infrastructure bloat — external memory, mesh networking, and sync daemons are strictly optional |

---

## 3-Minute Quickstart

### 1. Run `gate-first` on itself (Dogfooding Suite)

```bash
git clone https://github.com/abca12a/gate-first.git
cd gate-first
npm test
```

`npm test` (`node scripts/check-all.mjs`) validates all 10 skills, host neutrality, skill dependency closure, two-phase worktree isolation, the `120`-line cap on `docs/STATE.md`, repository-wide GFM Markdown links and `#anchor` slugs, subprocess positive controls for all 3 gate examples, zero `\r` bytes and `100755` executable index mode on POSIX Git hooks, and structural privacy/secret protection.

### 2. Scaffold any new or existing Git repository

```bash
node scaffold/init-project.mjs /path/to/your-repo --gate-command "npm test"
```

The scaffolder follows a **"Claim First, Create Second"** rule: if your repo already has `CLAUDE.md`, an existing gate script in `package.json`, or a custom `core.hooksPath`, it recognizes and wires into them without leaving unused hook files on disk, and guides staging `.githooks/pre-commit` with `git add --chmod=+x`.

### 3. Install the ~30-line Global Prompt & Skills

- Copy Variant A (pure-file minimal loop) or Variant B (OpenViking + Magpie production stack) from [`prompts/instructions.template.md`](./prompts/instructions.template.md) into your host's global instruction file;
- Symlink `skills/*` into your host skill root (e.g., `~/.agents/skills/` or `~/.claude/skills/`) and verify link health with `npm run check:skills`.

---

## The 10 Host-Neutral Workflow Skills (4 Core + 6 Lifecycle)

Every skill in [`skills/`](./skills/) is verified by `check-host-neutral.mjs` to stay free of single-host lock-in:

| Category | Skill | When It Fires & What It Solves |
|---|---|---|
| **Core** | [`lead-orchestration`](./skills/lead-orchestration/SKILL.md) | Single-lead accountability, dispatch triage ("when to spawn vs keep inline"), two-phase `git worktree` writer isolation (`pre` / `post`), pre-coding engineering standards, and project scaffolding. |
| **Core** | [`pit-to-gate`](./skills/pit-to-gate/SKILL.md) | Routes real defects into `exit 1` machine gates, reusable skills, or project docs — with defenses against tautological tests and handler-bypass false greens. |
| **Core** | [`defect-review`](./skills/defect-review/SKILL.md) | Read-only defect review against true `git merge-base`, ranking demonstrable P0–P3 regressions separately from style nits or spec wishes. |
| **Core** | [`project-orientation`](./skills/project-orientation/SKILL.md) | Fast onboarding into unfamiliar or interrupted repos: maps source-of-truth docs, executable feature maps, and separate accounting for code vs test vs live verification. |
| **Lifecycle** | [`audit-fix-loop`](./skills/audit-fix-loop/SKILL.md) | Processes external P0–P2 audit reports safely: falsifies broken premises first, writes minimal failing tests, fixes, and runs revert-based positive controls ([`CASE-NOTES.md`](./skills/audit-fix-loop/CASE-NOTES.md)). |
| **Lifecycle** | [`docs-drift-audit`](./skills/docs-drift-audit/SKILL.md) | Detects dead premises, dangling refs, stale status claims, and volatile counts; prevents base-path link breakage and `String.replace` `$` expansion bombs during archiving. |
| **Lifecycle** | [`release-and-verify`](./skills/release-and-verify/SKILL.md) | Verifies build artifact freshness, queries true remote CI conclusions (`--repo` on forks, per-job status vs top-level `conclusion`), and checks live chunk `sha256` parity. |
| **Lifecycle** | [`git-branch-worktree-cleanup`](./skills/git-branch-worktree-cleanup/SKILL.md) | Converges local/remote branches to `main` without data loss: guards remote-only commits, gitignored worktree logs, locked dirs, and `node_modules` symlink traversal. |
| **Lifecycle** | [`retire-dead-subsystem`](./skills/retire-dead-subsystem/SKILL.md) | Cleanly excises retired subsystems via `import`-edge reverse graphs — removing hard CI edges before dormant scripts while preserving tool-agnostic lessons. |
| **Lifecycle** | [`skill-maintenance`](./skills/skill-maintenance/SKILL.md) | Governs skill trigger boundaries, single-source-of-truth topology, host neutrality, dependency closure, and `fs.statSync` broken-symlink detection across hosts. |

---

## 3 Real Production Incidents Turned into Gates

Each directory under [`gates/examples/`](./gates/PROTOCOL.md) ships with its real postmortem (`INCIDENT.md`), a zero-dependency Node checker, and an automated positive-control suite (`test-positive-control.mjs`):

1. **[`01-state-log-cap`](./gates/examples/01-state-log-cap/INCIDENT.md)** — *Why warnings fail*: A `120`-line section cap with `exit 0` warnings grew to **569 lines / 104 KB** in 8 days. Fixed by extracting a single shared constant module (`state-section.mjs`) and a dedicated `exit 1` gate (`check-state-log.mjs`).
2. **[`02-doc-links`](./gates/examples/02-doc-links/INCIDENT.md)** — *Zero-diff link rot & CI baseline false alarms*: Moving a file from `docs/` to `docs/archive/` without changing a single character broke 4 relative links; naive absolute-path checks then caused 53 false failures on clean CI runners. Fixed with strict repo-relative + GFM `#anchor` verification and `.git`-aware external baseline detection.
3. **[`03-secret-shapes`](./gates/examples/03-secret-shapes/INCIDENT.md)** — *The untracked-file blindspot & rotting allowlists*: Default `git ls-files` missed secrets in newly created, un-staged files (including `.env.local` and extensionless configs). Fixed with non-binary buffer scanning over `git ls-files -z --cached --others --exclude-standard`, mandatory per-entry reasons, and bidirectional stale-allowlist failure (`exit 1`).

---

## Production Reference Stack Summary

For power users working across multiple machines and **5+ coding hosts**, [`docs/REFERENCE-STACK.md`](./docs/REFERENCE-STACK.md) documents the complete six-layer production stack in full detail:

- **EasyTier Zero-Public-Exposure Encrypted Mesh**:
  - Replaces fragile `ssh -N -L` tunnels with an encrypted private mesh (`private_mode = true`, `dhcp = false`) connecting workstations directly to `http://<easytier-virtual-ip>:1933` (**2-second** onboarding; outbound-only `TCP` / `443 WSS` template for strict corporate networks).
  - OpenViking binds strictly to host loopback `127.0.0.1:1933` (never `0.0.0.0`), exposed solely via `<easytier-virtual-ip>%tun0:1933` user-space forwarding guarded by a **10-second self-healing systemd service**, `warn`-level log tuning (**`98.6%`** log write reduction), and a client-side `~/.openviking/pending/` **60-second single-flight offline replay queue**.
- **OpenViking (`v0.5.5`) Heterogeneous Dual-Model Engine & Customizations**:
  - **Dual Models**: `gemini-embedding-2` (Google native, `dimension = 3072`; `semantic_and_vectors` for 27 structured memories vs `vectors_only` for 47 static long-form docs) + `deepseek-v4.1-flash-1017` (session extraction, L0/L1 compilation, daily consolidation — zero vector re-indexing on VLM swap).
  - **Unified Nested `ovcli.conf` & Dual-Host `URI Guard`**: Nested `"plugin"` config overrides per-host args (`skipSubagentSessions: true`); both Claude Code and DSH enforce `URI Guard` against accidental local-file reads on `viking://` URIs; `recallPeerScope: "actor"` isolates automatic injection per repo while keeping explicit MCP `search`/`find` cross-repo; daily `systemd` timers enumerate all `peers/*` for memory compilation and self-log health reports into `resources/ops/reports/`.
- **Magpie Single-Source Distribution & Clean Jurisdiction Split**: Drives 5 hosts from one 29-line `instructions.md` and `library/skills/` while keeping `magpie-memory` paused/hidden and preventing both shared-relay symlink `0`-byte truncation (`~/.agents/AGENTS.md`) and `ENOENT` dangling symlinks.

---

## Recommended Upstream Companion Skills

`gate-first` only bundles original, host-neutral governance assets. We pair them in production with these upstream open-source skills (credited honestly — install directly from their upstream repositories):

| Upstream Repository | Skills | License | Role Alongside `gate-first` |
|---|---|---|---|
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `handoff`, `writing-for-agents` | `MIT` | Hypothesis-driven bug diagnosis, domain/ADR modeling, pre-plan design grilling, and context-pointer writing craft |
| [`leonxlnx/taste-skill`](https://github.com/leonxlnx/taste-skill) | `design-taste-frontend` | `MIT` | Anti-slop greenfield frontend architecture, visual rhythm, and restrained motion |
| [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) | `impeccable` | `Apache-2.0` | UX critique, typographic hierarchy, edge-case hardening, and polish for existing UIs |
| [`volcengine/openviking`](https://github.com/volcengine/openviking) | `ov-experience-memory` | `Apache-2.0` | Lightweight host bridge for L0/L1 screening + mandatory L2 verification against OpenViking `experiences` |

---

## Author & Links

- **Author**: **han**
- **GitHub Repository**: [`https://github.com/abca12a/gate-first`](https://github.com/abca12a/gate-first)
- **Live Architecture Blueprint**: [`https://abca12a.github.io/gate-first/`](https://abca12a.github.io/gate-first/)
- **Personal Website**: [`dimilinks.com`](https://dimilinks.com/)

## License

[MIT License](./LICENSE) © 2026 han ([`abca12a`](https://github.com/abca12a)).
