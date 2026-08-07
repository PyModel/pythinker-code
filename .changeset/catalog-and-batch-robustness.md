---
"@pythoughts/pythinker-code": patch
---

Survive two malformed inputs that used to end a run. A catalog entry that is not an object is now dropped when the catalog is read, instead of reaching the provider picker and throwing past the bundled-catalog fallback that was meant to save the login. A non-finite subagent concurrency limit now falls back to the default: `NaN` passed every clamp, and each free-slot test against it was false, so the batch launched nothing and never finished.
