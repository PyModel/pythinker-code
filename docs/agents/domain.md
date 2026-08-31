# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring

Read **`CONTEXT.md`** at the repo root. If **`docs/adr/`** exists, read ADRs that touch the area you are about to work in.

If any of these files do not exist, **proceed silently**. Do not flag their absence or create them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`. Do not drift to synonyms that the glossary avoids.

If a needed concept is not in the glossary, reconsider the new language or note a real gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, name the conflict instead of silently overriding it.
