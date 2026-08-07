---
"@pythoughts/pythinker-code": minor
---

Replace the Dynamic Workflow progress bar with the two things it can actually know: how many tool calls each agent has made, and how long it has been silent. The old bar pinned every tool-using agent at 75% until it finished, so an agent working hard and one wedged for ten minutes looked identical. A row that goes quiet now turns amber, then red.
