---
"@pymodel/pythinker-code": patch
---

Remove the never-implemented `executor = "pyaos"` option (and its old `"kaos"` alias) from MCP stdio server configuration; configs that use it now fail validation at load time.
