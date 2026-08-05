Launch multiple subagents from complete prompts, one prompt template, existing agent resumes, or a combination.

Use DynamicWorkflow when several independent subagents should run in parallel. Without `prompt_template`, every `items` entry is a complete subagent prompt. When many subagents should run the same kind of task over different inputs, provide a template whose placeholder is exactly `{{item}}`. For example, with `prompt_template` set to `Review {{item}} for likely regressions.` and `items` set to `["src/a.ts", "src/b.ts"]`, DynamicWorkflow launches two new subagents with those two concrete prompts.

Use `resume_agent_ids` to continue subagents that already exist from earlier work, such as ones that failed: map each agent id to the prompt for that resumed subagent (usually `continue` if no extra information is needed). You may combine `resume_agent_ids` with `items` in the same call to resume existing subagents and launch new ones. Do not duplicate resumed work in `items`.

Use `model` and `effort` to run this workflow's subagents on a different model than the one orchestrating them, such as a cheaper or faster model for mechanical work while the orchestration stays on the current model. Both apply to every subagent in the call. Omit them to use the subagent type's own settings.

Use enough subagents to keep the work focused and parallel. DynamicWorkflow supports up to 128 subagents, and launches are queued automatically, so it is safe to split large tasks into many clear, independent items. Workflow subagents have no automatic timeout; they run until completion, failure, or user cancellation.

If `DynamicWorkflow` is called, that call must be the only tool call in the response.
