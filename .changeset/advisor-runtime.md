---
"@pythoughts/pythinker-code": minor
---

Add an opt-in advisor: a second model reviews the conversation after each completed user turn and its notes appear as an `<advisory>` block in the agent's next turn; enable with `[advisor] enabled = true` plus an advisor model (the `advisor` model role or `[advisor] model`), and it runs only when the advisor shares the session model's provider.
