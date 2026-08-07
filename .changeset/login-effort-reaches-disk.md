---
"@pythoughts/pythinker-code": patch
---

Write the thinking effort picked at login to disk. The apply step recorded the level, but the patch that saved the result listed everything except it, so an API-key login still reopened at the default effort. Choosing `off` now also clears a level a previous login left behind, which a patch that only merges could not do by omitting the key.
