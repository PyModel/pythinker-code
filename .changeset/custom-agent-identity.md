---
"@pymodel/pythinker-code": minor
---

Add a custom agent identity, plus a switch for the built-in skills that document Pythinker Code itself. Set `[identity] name` in `config.toml` (or `PYTHINKER_CODE_IDENTITY_NAME`) to change the name the agent uses for itself and the identifier it presents to third-party providers and MCP servers; set `builtin_product_skills = false` to drop the product-documentation skills.
