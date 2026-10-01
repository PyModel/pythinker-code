---
"@pymodel/pythinker-code": patch
---

Stop restricting file tools and background git through symlink-realpath gates and repo-config probes; project-local `local.toml` loads without the trust prompt again. Writes to paths that resolve to env files, credentials, or SSH keys are still blocked.
