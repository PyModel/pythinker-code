---
"@pythoughts/pythinker-code": minor
---

Let a Dynamic Workflow require structured output from its subagents. Passing `output_schema` makes each subagent return a validated object instead of free text, and a subagent that cannot satisfy the schema is reported separately from one that failed outright.
