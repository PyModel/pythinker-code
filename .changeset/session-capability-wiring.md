---
"@pymodel/agent-core": minor
"@pymodel/server": minor
---

Make `agent_config.tools` and `agent_config.mcp_servers` reach the running agent. A session profile update now persists the selection, merges each field independently so supplying one half does not clear the other, resumes an inactive session before the mutation, and applies the result through a single `setActiveTools` call. MCP server names are turned into tool patterns with the shared naming helper, so a server whose name needs sanitizing still matches its tools.
