---
"@pymodel/pythinker-code": patch
---

Remove the hosted client-config features: the startup tips banner, prompt-cache hints, recommended thinking effort, and remotely tuned feedback-survey settings. They only ran when `CUSTOM_API_BASE_URL` pointed at a hosted service; the feedback survey now always uses its built-in defaults, and there is no switch to bring the hosted features back.
