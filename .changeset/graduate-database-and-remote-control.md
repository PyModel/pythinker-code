---
"@pymodel/pythinker-code": major
---

Remote Control is always available — `pythinker rc`, `pythinker web --remote-control` and `/remote-control` no longer need an experimental flag. Session indexing and global search move to the new `[database]` section: set `PYTHINKER_CODE_PERSISTENCE_MINIDB_READMODEL` (was `PYTHINKER_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL`) and `PYTHINKER_CODE_SEARCH_WORKER` (was `PYTHINKER_CODE_EXPERIMENTAL_SEARCH_WORKER`), or `[database] base` and `[database] search` in `config.toml`.
