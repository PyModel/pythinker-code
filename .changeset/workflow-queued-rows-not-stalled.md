---
"@pythoughts/pythinker-code": patch
---

Stop a Dynamic Workflow row that has not started from reading as stalled. A queued row measured its silence from the launch of the whole run, so a long queue turned every waiting row amber and then red while nothing was wrong. A queued row now shows the same placeholder a finished one does, and a suspended row keeps its count without the alarm colours, because only a running row can stall.
