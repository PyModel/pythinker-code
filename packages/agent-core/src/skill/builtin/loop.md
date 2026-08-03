---
name: loop
description: Run a prompt or slash command on a recurring interval, defaulting to 10 minutes.
when-to-use: Use when the user wants to poll for status or repeat work on an interval. Do not use for one-off tasks.
user-invocable: true
argument-hint: "[interval] <prompt>"
---

# Schedule a recurring prompt

Parse `$ARGUMENTS` as `[interval] <prompt>`.

1. If the first token matches `^\d+[smhd]$`, use it as the interval.
2. Otherwise, accept a trailing `every <number><unit>` or `every <number> <unit word>` clause.
3. Otherwise, use `10m`.

If the prompt is empty, show `Usage: /loop [interval] <prompt>` and do not create a job.

Convert the interval to a five-field cron expression:

- `Ns`: round up to `ceil(N / 60)m`; cron has one-minute granularity.
- `Nm`, where `N <= 59`: `*/N * * * *`.
- `Nm`, where `N >= 60`: convert exact whole hours to `0 */H * * *`.
- `Nh`: `0 */N * * *`.
- `Nd`: `0 0 */N * *`.

When an interval cannot be expressed evenly, use the nearest clean interval and tell the user what changed.

Call `CronCreate` with the parsed prompt verbatim and `recurring: true`. Confirm the prompt, cron expression, human-readable cadence, seven-day automatic expiry, job ID, and that `CronDelete` cancels it.

After scheduling, immediately execute the parsed prompt once. Invoke slash commands through the `Skill` tool; otherwise perform the requested work directly.
