---
"@pymodel/pythinker-code": patch
---

Register plugin skills as `<plugin-id>:<skill-name>`; a bare skill name no longer runs a plugin skill and there is no setting to restore that, so use `/skill:<plugin-id>:<skill-name>`. Plugin names can now contain uppercase letters, dots, and an `@` suffix.
