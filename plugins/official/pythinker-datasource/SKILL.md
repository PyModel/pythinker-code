---
name: pythinker-datasource
description: |
  Universal data-source assistant. Use this skill when the user wants external structured data such as stocks, financial reports, technical indicators, A-share/HK/US markets, global macroeconomics, Chinese enterprise registry information, arXiv papers, Google Scholar results, or Chinese laws/regulations and judicial cases.
  This plugin exposes tools via MCP server `plugin-pythinker-datasource_data`; call them in the flow `mcp__plugin-pythinker-datasource_data__get_data_source_desc` → `mcp__plugin-pythinker-datasource_data__call_data_source_tool`.
---

# pythinker-datasource — Universal Data Source Assistant

## 0. How to invoke

This skill uses the two tools registered by the datasource MCP server. Do not run scripts manually through Bash:

- `mcp__plugin-pythinker-datasource_data__get_data_source_desc`
- `mcp__plugin-pythinker-datasource_data__call_data_source_tool`

Pythinker Code hosts both tools. Pass parameters as JSON according to each tool schema.

The tools read local OAuth credentials for the current Pythinker Code environment. When `PYTHINKER_CODE_OAUTH_HOST` / `PYTHINKER_CODE_BASE_URL` is set, they use isolated credentials for that environment. If no credentials are available, ask the user to run `/login` in Pythinker Code first.

## 1. What this skill provides

This plugin connects to 7 external data sources. The data source name in each row is the `name` passed to `get_data_source_desc`.

| Domain | Data source name | Typical questions |
|---|---|---|
| **A-share / HK / US quotes and financials** | `stock_finance_data` | "What is Moutai trading at?", "CATL 2024 earnings", "Tencent shareholders", "AI stocks in Hangzhou" |
| **Yahoo Finance global markets** | `yahoo_finance` | "Apple analyst ratings", "AAPL options chain", "S&P 500 historical prices" |
| **World Bank macroeconomics** | `world_bank_open_data` | "China GDP over time", "India inflation rate", "population growth by country" |
| **Chinese enterprise registry** | `tianyancha` | "ByteDance shareholders", "BYD legal risks", "CATL patents" |
| **arXiv preprints** | `arxiv` | "Find RAG survey papers", "download 2406.xxxxx" |
| **Google Scholar** | `scholar` | "Hinton's latest papers", "highly cited transformer surveys" |
| **Chinese laws / judicial cases** | `yuandian_law` | "Civil code provisions on residency rights", "labor contract termination statutes", "unjust enrichment precedents" |

**Not supported**: general web search / real-time news. Tell the user the current data sources do not cover that request.

## 2. Standard workflow: `get_data_source_desc` → `call_data_source_tool`

Backend APIs change often. **This skill intentionally does not copy concrete API names or parameter tables.** Before every call, ask the data source on the spot: "What APIs do you expose?"

```
1. Pick a data_source_name from the table above based on the user's question
2. Run get_data_source_desc and read the returned Markdown documentation
3. Read the Markdown carefully. It lists:
     - Overall data source notes (ticker formats, global constraints)
     - Each API's description / required params / optional params / defaults / ranges
4. Pick the best-matching API and build params from the docs
5. Run call_data_source_tool
6. Read the result and answer in English unless the user explicitly requests another language
```

### Example 1: user asks for "Moutai price trend over the past year"

1. Stock trend → `stock_finance_data`
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"stock_finance_data"}`

3. Find the historical-price API in the docs and note required fields such as `ticker / start_date / end_date / file_path`
4. Verify with web_search → Moutai = `600519.SH`
5. Call `mcp__plugin-pythinker-datasource_data__call_data_source_tool` with something like `{"data_source_name":"stock_finance_data","api_name":"<api from docs>","params":{"ticker":"600519.SH","start_date":"...","end_date":"...","file_path":"/tmp/moutai_1y.csv"}}`

### Example 2: user asks for "retrieval augmented generation survey papers"

1. Paper search → `arxiv` (or `scholar`; arxiv is better for preprints, scholar for citations)
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"arxiv"}`

3. Find the search API in the docs and note fields such as `query / file_path / max_results`
4. Run `call_data_source_tool`

### Example 3: user asks "who are ByteDance's shareholders?"

1. Enterprise registry → `tianyancha`
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"tianyancha"}`

3. Note: tianyancha APIs are dynamically registered. The docs will tell you to **use a search API first to find the right API name, then call it**
4. **Use the company's full legal name** ("Beijing ByteDance Technology Co., Ltd."), not a short name. If you do not know the full name, use the company-search API described in the tianyancha docs

## 3. Rules before calling

### 3.1 Verify ticker symbols; never guess from memory

A-shares use `.SH/.SZ/.BJ`, Hong Kong `.HK`, US `.US`, and so on. Users often give company names ("Moutai", "CATL", "Tencent") rather than tickers.

**Before any stock-related API call**, use `web_search` / `WebSearch` or similar to confirm the correct code and suffix.

If no web tool is available, **ask the user to confirm the ticker**. Do not guess. Wrong codes often return wrong or empty data silently.

### 3.2 Enterprise queries require full legal names

`tianyancha` rejects short names like "Tesla", "NetEase", or "Tencent". Use full names such as "Beijing Tesla Sales Co., Ltd." If you do not know the full name, call the company-search API first.

### 3.3 Most APIs require `file_path`

Most data source APIs write full results as CSV to `file_path`. Omitting it yields `Missing required parameters: file_path`. When unsure, use `/tmp/<scenario>_<timestamp>.csv`.

### 3.4 Do not pack too many tickers into one call

`stock_finance_data` realtime APIs accept at most 3 tickers; historical APIs accept at most 10. Excess tickers are truncated or rejected. Batch large lists.

## 4. How to read results

`call_data_source_tool` stdout usually has two parts:

1. **`data_preview`**: CSV header plus a few rows (typically 1–3) for quick answers
2. **`CSV data written to: /tmp/xxx.csv`**: path to the full export

Strategy:
- Single-value questions like "what is XX trading at?" or "China 2023 GDP?" → `data_preview` is usually enough
- Charts, comparisons, P/L, or lists → use `Read` on the CSV
- Mixed A-share + HK queries may split into `_a.csv` / `_hk.csv`; the original `file_path` may not exist

If a call fails, the message usually explains why (bad params / unsupported / empty data). Report that to the user; do not blindly retry.

## 5. `watchlist.json` — user watchlist

`${PYTHINKER_SKILL_DIR}/watchlist.json` holds the user's watchlist. When they ask to "check my watchlist", read that file, then run the standard `get_data_source_desc("stock_finance_data") → call_data_source_tool` flow for realtime quotes. Realtime APIs accept at most 3 tickers per batch; batch larger lists.

Format:

```json
[
  {"code": "600519.SH", "name": "Kweichow Moutai"},
  {"code": "0700.HK", "name": "Tencent Holdings", "hold_cost": 350.5, "hold_quantity": 100}
]
```

- `code` and `name` are required; `hold_cost` and `hold_quantity` are optional
- When both hold fields are present, also compute P/L: `(current_price - hold_cost) * hold_quantity`
- When the user says "add XX to my watchlist": verify the ticker with web_search, then append to the JSON array

## 6. Notes

- **Answer in English by default**. Use another language only when the user explicitly asks you to respond in it.
- **Do not guess ticker codes or full company names from memory**. Wrong codes can return wrong data without obvious errors.
- **Do not pass `api_name` without reading desc first**. The backend returns `API_NOT_FOUND` unless you already read that data source's desc in this session and remember the params.
- **Do not give investment advice**. After presenting data, add "AI-generated; not investment advice."
- If an API error clearly looks like a backend bug (contradictory schema, internal Python traceback, etc.), **report it to the user and stop** — that must be fixed on the service side, not retried here.
