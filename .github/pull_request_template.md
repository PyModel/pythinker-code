<!--
Thank you for your contribution to Pythinker Code!
External PRs are accepted for approved bug fixes only: link an issue that a maintainer has approved (an `/approve` comment). External feature PRs are not accepted.

See https://github.com/PyModel/pythinker-code/blob/main/CONTRIBUTING.md for more.
-->

## Requirement or Bug

<!-- If there's an issue, write Resolve #(issue_number).
     If it's a requirement, describe it briefly in plain language (under 100 characters). -->

## Bug Reproduction Steps

<!-- Required for bug PRs only; write N/A for feature PRs.
     Prefer writing in the issue and linking here; if no issue exists, write directly. -->

## Root Cause

<!-- Required for bug PRs only. Explain the root cause.
     State whether this is a fundamental fix or a workaround. -->

## Code Changes

<!-- Describe the code changes in plain, easy-to-understand language for the reviewer. -->

## Behavior Changes and Affected Users

<!-- List every observable behavior this PR changes, one row each, including behavior you
     consider "unchanged" whose branch conditions moved, and prompt-text edits sentence by sentence.
     | Behavior | Before | After | Who relies on the old behavior | Escape hatch |
     Name affected users concretely (client, provider dialect, platform, config state, data written
     by older versions, external scripts); see .agents/skills/review-pr/surfaces.md.
     Write "None" with evidence if nothing observable changes.
     Then list affected modules and the test coverage for each row. -->

## Checklist

- [ ] I have read the [CONTRIBUTING](https://github.com/PyModel/pythinker-code/blob/main/CONTRIBUTING.md) document.
- [ ] I have linked a related issue (external PRs: issue must have a maintainer's `/approve`).
- [ ] I have added tests that prove my feature works.
- [ ] The behavior-change table above is complete, and every removed behavior or flipped default is named in the changeset and either has an escape hatch or was explicitly approved by a maintainer in this PR.
- [ ] Ran `gen-changesets` skill, or this PR needs no changeset.
- [ ] Ran `gen-docs` skill, or this PR needs no doc update.
