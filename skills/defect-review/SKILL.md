---
name: defect-review
description: Perform a read-only defect review and rank actionable findings P0-P3, including delegated defect reviews. Focus on demonstrable bugs; distinguish requirements conformance from defect findings.
agent_created: true
user-invocable: true
---

# Review Agent

Inspect the requested target directly and return every finding that the author would likely fix.
Do not modify files, create commits, push branches, post review comments, or delegate the review
to another agent.

## Which review skill

Pick by the **question**, not by the artifact — either review may target a commit, a branch, a tag, or uncommitted changes:

| The question being asked | Skill |
|---|---|
| "Is this code **wrong**?" — hunt defects, rank by severity | this skill |
| "Is this code **what we asked for**, and does it follow our standards?" | Compare the supplied requirements and repository standards directly; use a dedicated conformance skill only if one is actually available. |

Do not require an unavailable `code-review` skill. When conformance is requested, report requirement mismatches separately from demonstrated defects. Delegated defect-only reviews stay here; delegation does not change the scope. Exclude style nits unless they violate an explicitly requested standard.

## Review the change

1. Read the project's agent instructions file (AGENTS.md, CLAUDE.md, or equivalent).
2. Inspect the complete diff for the requested target and enough surrounding code to understand
   each changed path.
   Reuse the scope and comparison already supplied. For all uncommitted changes, inspect
   `git diff HEAD` and requested untracked files from `git status --short`; use `git diff --cached`
   or `git diff` for explicitly staged-only or unstaged-only reviews.
3. Identify concrete regressions introduced by the change. Continue through the whole diff after
   finding the first issue.
4. Check the relevant tests and call sites to confirm that each finding is real and actionable.

For a base-branch review, compare the changes that would actually merge rather than diffing
directly against the branch tip. Resolve the comparison ref to the branch's upstream when that
upstream exists and is ahead of the local branch; otherwise use the local branch. Run
`git merge-base HEAD <comparison-ref>`, then inspect `git diff <merge-base-sha> HEAD` for
committed-only scope, or `git diff <merge-base-sha>` when work in progress is included. If the local
branch cannot be resolved, try its configured upstream explicitly before reporting that the target
is unavailable.

Flag an issue only when all of these are true:

- It affects correctness, security, performance, or maintainability in a meaningful way.
- It is discrete and actionable.
- It was introduced by the reviewed change.
- The affected scenario or call path can be demonstrated from the code.
- The author would probably fix it if they knew about it.

Do not flag speculative concerns, pre-existing problems, intentional behavior changes, or style
nits that do not obscure the code.

## Write the result

Present findings first, ordered by severity. Use one entry per issue in this form:

`[P1] Imperative finding title — path/to/file.rs:line`

Follow the title with one short paragraph explaining the affected scenario and why the behavior is
wrong. Keep the cited range as small as possible and make sure it overlaps the reviewed diff.

Use these priorities:

- `P0`: universal release blocker or critical failure.
- `P1`: urgent defect that should be fixed next.
- `P2`: ordinary defect that should be fixed.
- `P3`: low-impact issue that is still worth fixing.

If there are no qualifying findings, say `No findings.` Do not invent a finding to fill the result.
After the findings, add a brief overall assessment and mention any material test gaps or residual
risks.
