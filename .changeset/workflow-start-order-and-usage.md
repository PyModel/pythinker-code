---
'@pythoughts/pythinker-code-sdk': patch
'@pythoughts/pythinker-code': patch
---

Carry a subagent's real launch order and token usage through a Dynamic Workflow batch

A batch does not start its subagents in input order — the launcher ramps
launches, and a rate-limited subagent is requeued and started later. Nothing
recorded the order they actually began in, so there was no way to tell what ran
when. Each result now carries a `startOrder`, assigned on first readiness and
kept across a rate-limit requeue rather than renumbered by the retry.

Token usage was already reaching the tool at runtime but was absent from the
result type, so nothing downstream could read it. Both fields are now part of
the contract.
