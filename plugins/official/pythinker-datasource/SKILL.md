---
name: pythinker-datasource
description: Query external data sources through the datasource MCP tools.
---

# pythinker-datasource

Use the datasource MCP tools registered by this plugin. Do not shell out to scripts by hand.

## Tools

- `get_data_source_desc`  describe a named data source and its parameters
- `query_data_source`  run a query against a named data source

Pass JSON arguments that match each tool schema. Credentials come from the local Pythinker login state (`/login`). When `PYTHINKER_CODE_OAUTH_HOST` / `PYTHINKER_CODE_BASE_URL` are set, those environment-specific credentials are used.

## Notes

Source catalogs and paid scopes vary by deployment. Ask for `get_data_source_desc` before querying an unfamiliar source.
