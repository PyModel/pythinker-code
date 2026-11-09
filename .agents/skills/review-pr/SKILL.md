---
name: review-pr
description: Use when reviewing a pull request in this repository — check the description against the PR template section by section, then run a separate regression and user-impact pass that produces impact levels and a review summary.
disable-model-invocation: true
---

# Review PR

Most regressions in this repository were not logic errors. They were changes that were correct
relative to their own intent but silently altered a behavior an existing population depended on:
a provider-dialect branch narrowed, a default flipped, a system-prompt sentence deleted, an old
path's feature dropped in a refactor, a fix that changed startup timing. General review excludes
intentional behavior changes from bugs, so this skill runs that check as its own pass.

The review criterion is one sentence: **any input that worked before the change — a config key,
an environment variable, a command-line flag, a provider response shape, session data written by
an older version, a client request, or a hook payload — must behave the same after it, unless the
PR explicitly declares the change and provides a way back.**

## Workflow

1. Fetch the PR metadata and description:

   ```bash
   gh pr view <number> --json title,body,url,files,additions,deletions,baseRefName,headRefName
   ```

2. Read the full diff (large PRs file by file):

   ```bash
   gh pr diff <number>
   ```

3. Read enough surrounding code to verify every claim in the description. The diff alone cannot
   show who reached a branch before the change.

4. **Pass 1: classify.** Decide the depth of pass 3; see "Pass 1: classify".

5. **Pass 2: template section check.** See "Pass 2: template section check".

6. **Pass 3: regression and user impact.** Run it in a fresh context when a subagent is
   available: give it only the PR number, base and head, a two-to-three-sentence summary of the
   change, and the path to `surfaces.md`. Do not give it the author's impact conclusions; have it
   build the inventory from the diff and code first, then compare it against the author's table
   when it returns. Without subagent capability, do it yourself in the same order: build the list
   first, read the author's table second. See "Pass 3: regression and user impact".

7. Write the review summary in English; format under "Output".

## Pass 1: classify

| Change class | Pass 3 depth |
|---|---|
| Pure internal refactor, tests, docs, test-only CI | Only evidence that nothing observable changed: which branches, defaults, and contract files are untouched |
| Release and packaging: release, native build, VS Code publishing workflows, packaging scripts, web bundle sync | Full pass; populations split by install channel and platform: npm package, per-platform native binaries, VS Code marketplace, bundled web assets |
| New feature that touches no existing path | Only check whether the new branch captures existing inputs first: does the new condition precede the old one |
| Behavior change, default flip, validation or permission tightened or loosened | Full pass |
| Prompt text: system prompt, tool descriptions, reminders, overlays, built-in skills | Full pass, and every edited sentence gets its own row |
| Replacement of an old path, large refactor, protocol swap | Full pass, and require the author to provide the old path's feature inventory |
| Protocol, disk format, SDK export, hook payload, or CLI contract change | Full pass, and name the consumers outside the repository |
| Fix that changes startup order, lifecycle, or async timing | Full pass, focused on who depended on the old order |

A PR can belong to several classes at once; treat it as the heaviest one.

## Pass 3: regression and user impact

### 1. Behavior-change inventory

List every observable behavior the diff changes, including behavior the author calls "unchanged"
and behavior the author considers "internal". Internal packages ship in the CLI release;
"internal" does not mean invisible to users.

Each row records: behavior, before, after, change type (added / modified / removed / default
flip / tightened / loosened), and evidence (a `file:line` on each side; when one side does not
exist, give a reachable path on the other).

How to read the diff:

- For every deleted or narrowed branch, condition, default, or sentence, ask who reached it
  before the change and where they go now.
- For every new branch or condition, ask which existing inputs now match it first. The classic
  failure: a parser stops reading the string form of a field when the array form exists, and
  gateways shaped like OpenRouter send both.
- Test changes that rewrite an old assertion to the new behavior are direct evidence of a
  behavior change; map each one to an inventory row.
- Scan the diff file list against the "trigger clues" in `surfaces.md` first. Every matched
  surface must have a corresponding row in the inventory, otherwise it is a miss.

### 2. Affected populations

Map each row to a concrete population in `surfaces.md` and write the population's name together
with evidence that it exists: a doc page, an issue, a config example, a provider payload shape.
A row with no findable population does not become a finding; it goes to "author to confirm".

### 3. Impact level

The level is decided only by the facts of the change, never by remediation state (changeset,
docs, tests). Three steps:

1. Data loss, a widened security boundary, old data becoming unreadable, or a population's
   feature unusable in full: L3 outright.
2. Otherwise: observable with a one-step way back (config, env, flag): L1. Observable with no
   way back and the old behavior unrecoverable: L2. No observable change: L0.
3. Silent upgrade: a user-supplied input (config, env var, data, request field) is ignored or
   dropped with no error signal, so users cannot discover it themselves: raise one level, at
   most L3. Behavior that changed openly and is visible in the output is not silent.

Breadth has three tiers and must name the population: all users / one config or platform
population / edge environments.

Level each row separately; the PR takes the highest. The reason the silent-upgrade rule exists:
with no signal there is no report, so the regression survives until someone stumbles on it.

### 4. Remediation check

Four fixed questions, each answered yes / no / not applicable, with evidence:

- Escape hatch: is there a config, env, or flag that restores the old behavior.
- Changeset: does it name what users **lose**, not only the new default; when there is no way
  back, does it say plainly that the old behavior is gone.
- Old data and old clients: sessions written by the previous version, migrated data, and clients
  shipped in the previous release (desktop, web, VS Code, ACP) still work; rolling back to the
  previous release is safe.
- Guard test: one test that pins the old behavior **for the population that keeps it**.

Plus one: are the documentation promises about this surface updated together with the change.

### Handling per level

- L3: recommend blocking. Requires a guard test plus an escape hatch, a flag gate, or a
  migration; without all of them it must not merge.
- L2: a maintainer must decide explicitly in the PR; the changeset must name the lost behavior;
  docs in sync.
- L1: verify the changeset and docs.
- L0: one sentence on why it is L0, with evidence.

### Findings vs author confirmations

- A finding needs both: `file:line` evidence on each side of the change, and a named population
  with evidence it exists. Missing either one, demote to "author to confirm". When a whole file
  is added or a whole implementation deleted, one side is naturally empty; give the existing side
  the reachable affected `file:line`.
- At most 5 author confirmations, sorted by possible impact; report only the count beyond that.
- Do not report: problems that existed before the PR (a serious one gets a single "incidental
  finding" line), problems lint and typecheck catch, style.
- None of these are evidence of "no impact": the author says "unchanged", no test references the
  deleted sentence, the change is only in internal packages.

## Pass 2: template section check

- Related Issue: is the linked issue valid and relevant; when there is no issue, is the
  requirement stated in one or two sentences?
- Problem: does it state the user need or limitation; is it consistent with the linked issue?
- What changed: does the description match the actual diff; are visual outlines (diff blocks,
  call trees, file trees) accurate and helpful; is the approach sound with simpler alternatives
  considered; which edge cases did the author miss?
- Behavior Changes and Affected Users: compare the author's table row by row with the
  independent inventory from pass 3. A behavior the author missed is a finding; a row you cannot
  reproduce goes to "author to confirm". Are populations named, or just "some users"? When the
  table says `None`, does the evidence hold? Do affected modules and test coverage match the diff
  file list; which risky paths are untested?
- Checklist: are all applicable boxes checked; do you agree with the "not needed" ones?

## Output

English, in this order:

```markdown
## Verdict
One line: merge / changes needed / recommend blocking, plus the PR impact level and change class.

## Regression and user impact
- Change class: ...
- Impact level: Lx (breadth: ...; silent: yes/no)

| Behavior | Before | After | Affected population | Evidence | Level | Escape hatch |
|---|---|---|---|---|---|---|

Remediation check:
- Escape hatch: ...
- Changeset names the lost behavior: ...
- Old data and old clients: ...
- Guard test: ...
- Docs: ...

Author to confirm (max 5):
1. ...

## Template section check
Section by section: adequately filled in, missing, inaccurate, or inconsistent with the diff.

## Changes needed
Actionable list; write "none" if empty.
```

## Retrospective backfill

After every regression post-mortem, add the newly discovered population or trigger clue to
`surfaces.md` and a line to its history table. An inventory that is not updated goes stale.
