---
name: pythinker-datasource
description: |
  Universal data-source assistant for stocks (Wind, S&P, SEC EDGAR), macro (World Bank, IMF, FRED, NBS), Chinese government data and standards (GB/HB/DB/TT), corporate, academic, legal, WHO/FAO/OECD and other IGO data, financial news (Xinhua, Caixin).
  This plugin exposes tools via MCP server `plugin-pythinker-datasource_data`; call them in the flow `mcp__plugin-pythinker-datasource_data__get_data_source_desc` → `mcp__plugin-pythinker-datasource_data__call_data_source_tool`.
---

# pythinker-datasource — Universal Data-Source Assistant

## 0. How to invoke

This skill uses the two tools registered by the datasource MCP server. Do not run scripts manually through Bash:

- `mcp__plugin-pythinker-datasource_data__get_data_source_desc`
- `mcp__plugin-pythinker-datasource_data__call_data_source_tool`

Both tools are hosted and executed by Pythinker Code; pass arguments as JSON following each tool schema.

The tools read the local OAuth credentials of the current Pythinker Code environment; when `PYTHINKER_CODE_OAUTH_HOST` / `PYTHINKER_CODE_BASE_URL` are set, the isolated credentials of the matching environment are used. If there are no login credentials, ask the user to run `/login` in Pythinker Code first.

## 1. What this skill provides

This plugin fronts 25 external data sources. The "data source name" in each row is the `name` passed to `get_data_source_desc`.

| Capability | Data source | Typical questions |
|---|---|---|
| **A-share / HK / US stock quotes & financials** | `stock_finance_data` | "What is Moutai trading at?", "CATL 2024 annual report", "Tencent shareholders", "AI stocks in Hangzhou" |
| **Yahoo Finance global markets** | `yahoo_finance` | "Apple analyst ratings", "AAPL options chain", "Apple top-10 institutional holders" |
| **World Bank historical macro** | `world_bank_open_data` | "China GDP by year", "India inflation", "population comparison across countries" |
| **Chinese corporate registry** | `tianyancha` | "ByteDance shareholders", "BYD legal risk", "CATL patents" |
| **arXiv preprints** | `arxiv` | "Find RAG surveys", "download 2406.xxxxx" |
| **Google Scholar search** | `scholar` | "Latest Hinton papers", "highly cited transformer surveys" |
| **Chinese laws & regulations / court cases** | `yuandian_law` | "Civil Code provisions on the right of habitation", "statutes on labor-contract termination", "unjust-enrichment precedents" |
| **Wind (A-shares / funds / bonds / macro)** | `wind` | "Moutai minute bars today", "10-year treasury yield trend", "fund NAV lookup" |
| **IMF international macro (FX / CPI / forecasts)** | `imf` | "USD/CNY exchange rate", "GDP growth forecasts by country", "global inflation comparison" |
| **HS Gildata smart screening** | `gildata` | "Screen stocks with net-profit growth above 30% and ROE above 15%", "screen fund managers" |
| **US SEC filings** | `sec_edgar` | "Tesla 10-K annual report", "Apple 10-Q quarterly", "Form 4 insider trades", "13F institutional holdings" |
| **S&P Capital IQ US fundamentals** | `sp_data` | "Apple analyst consensus", "US valuation ratio comparison", "competitor relationships" |
| **China open-data catalog (National Data Administration)** | `china_nda` | "What is in the national public-data resource registry?", "which datasets do provincial open-data platforms offer?" |
| **National Bureau of Statistics macro indicators** | `china_nbs` | "Official China GDP series by year", "population & employment by province", "total retail sales of consumer goods" |
| **Chinese standards (national / industry / local / group)** | `china_standards` | "Look up a GB national standard full text", "current industry standards for a sector" |
| **WHO global health** | `who` | "Global infant mortality", "life expectancy by country" |
| **FAO agriculture & food** | `fao` | "Cereal production by country", "agricultural commodity prices" |
| **UN Statistics UNdata** | `unsd` | "UN member-state statistical yearbook tables", "international trade statistics" |
| **ECB statistics** | `ecb` | "Eurozone benchmark rate", "euro-area money supply" |
| **Eurostat** | `eurostat` | "Unemployment rate across EU countries", "euro-area CPI" |
| **UNICEF** | `unicef` | "Global child nutrition indicators", "child immunization coverage" |
| **OECD data** | `oecd` | "GDP comparison across OECD countries", "education spending by member state" |
| **FRED US/global macro** | `fred` | "Long US CPI time series", "fed funds rate trend" |
| **Xinhua Finance news & announcements** | `xhcj` | "Xinhua Finance flashes", "A-share company announcements", "sector policy news" |
| **Caixin database** | `caixin` | "Search Caixin data APIs", "Caixin news and data" |

### Source-selection principles

1. **User named a source** → use that source directly.
2. **No source named** → pick the best match from the table by capability; use the capability-boundary notes below plus the depth and scope of the user's question.
3. **One simple query picks one data source only**, and do not read other sources' descs in parallel. Once the chosen source returns successfully and covers the question, answer immediately; do not keep calling other APIs to add fields, reformat, or cross-check. Query a second source only when the user explicitly asks for a cross-source comparison.

### Capability-boundary notes (objective facts; weigh when selecting)

- `yahoo_finance` FX history goes back at most 2 years; `imf` provides long-run FX, CPI, GDP forecasts, and balance-of-payments series
- `stock_finance_data` quotes are realtime/close snapshots; minute-level intraday series live in `wind` (which also has funds, bonds, and treasury yields)
- Shareholders / institutional holdings: covered by `yahoo_finance`, `sec_edgar` (13F), and `sp_data` (standardized S&P holders), with different scopes and depth
- `world_bank_open_data` is 50+ years of historical macro series; for IMF forecast values use `imf`
- `gildata` takes natural-language screening conditions (stock / fund / fund-manager screens); `tianyancha` is a corporate registry archive
- `wind`'s `indexes`/`indicators` parameters require native Wind field names; map common fields like PE/PB/ROE/market cap via `wind_search_fields` first (supports aliases and Chinese, one lookup at a time) instead of guessing field names
- Official China statistics: `china_nbs` serves NBS macro indicator series (GDP / CPI / PPI etc., national / provincial / major cities); `china_nda` is the NDA open-data catalog (answers "which datasets exist"); `world_bank_open_data` and `imf` are international-standard historical and forecast series
- WHO, FAO, UNSD, ECB, Eurostat, UNICEF, OECD, and FRED are independent sources — select directly by institution; IMF's own datasets (FX / CPI / GDP forecasts) go through `imf`
- National standards (gb), industry standards (hb), local standards (db), and group standards (tt) go to `china_standards`; laws, regulations, and case law belong to `yuandian_law` — do not mix them
- Xinhua Finance (`xhcj`) leans toward announcements / flashes / policy news; `caixin` covers 600+ Caixin data APIs — run its `caixin_api_search` first to find the right API before calling

**Not supported**: general web search, and realtime news beyond what `xhcj` / `caixin` cover.

## 2. Standard workflow: `get_data_source_desc` → `call_data_source_tool`

Backend APIs change often, so **this skill deliberately omits concrete API names and parameter tables**. Before every call you should ask the data source on the spot: "which APIs do you have?"

```
1. From the table above, pick exactly one data_source_name for the user's question
2. Call get_data_source_desc and read that source's Markdown document
3. Read the returned Markdown carefully; it lists:
     - the source's overall notes (ticker formats, global constraints)
     - per-API descriptions / required params / optional params / defaults / value ranges
4. Pick the best-matching API and assemble params per the doc
5. Call call_data_source_tool to fetch data. For sources that require discovering
   APIs / fields / entities first (caixin_api_search, wind_search_fields, Tianyancha
   company search), discovery calls are exempt from the "one source" limit — keep
   calling until you reach the real data-fetching API, then stop once the result
   covers the question
6. Read the results and answer in the language the user asked in
```

### Example 1: "How has Moutai moved over the past year?"

1. Stock price history → `stock_finance_data`
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"stock_finance_data"}`

3. In the doc, find the historical-price API and note it needs `ticker / start_date / end_date / file_path` etc.
4. Verify via web_search → Moutai = `600519.SH`
5. Call `mcp__plugin-pythinker-datasource_data__call_data_source_tool` with args shaped like `{"data_source_name":"stock_finance_data","api_name":"<api from the doc>","params":{"ticker":"600519.SH","start_date":"...","end_date":"...","file_path":"/tmp/mao_1y.csv"}}`

### Example 2: "Find a few retrieval-augmented-generation surveys"

1. Paper search → `arxiv` (or `scholar`; arxiv suits preprints, scholar has broader citation coverage)
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"arxiv"}`

3. In the doc, find the search API and note it needs `query / file_path / max_results` etc.
4. Call `call_data_source_tool`

### Example 3: "Who are ByteDance's shareholders?"

1. Corporate registry → `tianyancha`
2. Call `mcp__plugin-pythinker-datasource_data__get_data_source_desc` with `{"name":"tianyancha"}`

3. Note: tianyancha APIs are registered dynamically; the doc will direct you to **find the right API name via its search interface first, then call**
4. **Always use the full registered company name** ("Beijing ByteDance Technology Co., Ltd."), never abbreviations. If the full name is unknown, run tianyancha's company-search API first

## 3. Hard rules before calling

### 3.1 Stock tickers must be verified — never guess from memory

A-shares `.SH/.SZ/.BJ`, HK `.HK`, US `.US`, etc. Users usually say only the company name ("Moutai", "CATL", "Tencent") without a ticker.

**Before any stock-related API call**, confirm the correct ticker + suffix with an online tool such as `web_search` / `WebSearch`.

If no online tool exists in this environment, **have the user confirm the ticker themselves** — do not guess. A wrong ticker makes the API silently return wrong or empty data.

### 3.2 Corporate queries must use full legal names

`tianyancha` rejects short names like "Tesla", "NetEase", or "Tencent"; it requires full names such as "Tesla (Shanghai) Co., Ltd.". When the full name is unknown, call its company-search API first.

### 3.3 Most APIs need `file_path`

Nearly all data-source APIs write the full result set as CSV to `file_path`. Omitting it fails with `Missing required parameters: file_path`. When unsure, pass `/tmp/<scenario>_<timestamp>.csv`.

### 3.4 Do not pile too many tickers into one call

`stock_finance_data` realtime endpoints take at most 3 tickers, historical endpoints at most 10. Beyond that they truncate or error out. Split into batches.

## 4. How to read results

`call_data_source_tool` stdout generally contains two parts:

1. **`data_preview`**: CSV header + first rows (usually 1–3) so you can answer simple questions directly
2. **`CSV data written to: /tmp/xxx.csv`**: path of the full dataset on disk

Strategy:
- Single-value questions ("What is X trading at?", "What was China's 2023 GDP?") → `data_preview` usually suffices; answer directly
- Charting, comparisons, P&L math, long listings → read the CSV with the `Read` tool and process it
- Mixed A-share + HK queries: the server automatically splits the CSV into `_a.csv` / `_hk.csv`; the original `file_path` file does not exist in that case

If an API call fails, the message usually states the cause (bad params / unsupported / empty data). Relay the human-readable reason to the user; do not blindly retry.

## 5. `watchlist.json` — user watchlist

`${PYTHINKER_SKILL_DIR}/watchlist.json` holds the user's stock watchlist. When asked "show my watchlist", read this file, then follow the standard `get_data_source_desc("stock_finance_data") → call_data_source_tool` flow for realtime quotes; the doc's realtime endpoint takes batches of at most 3 tickers — split larger lists.

Format:

```json
[
  {"code": "600519.SH", "name": "Kweichow Moutai"},
  {"code": "0700.HK", "name": "Tencent Holdings", "hold_cost": 350.5, "hold_quantity": 100}
]
```

- `code` and `name` are required; `hold_cost` and `hold_quantity` are optional
- When both holdings fields exist, compute P&L: `(current price - hold_cost) * hold_quantity`
- When the user says "add X to my watchlist": verify the ticker via web_search first, then append to the JSON array

## 6. Cautions

- **Answer in the language the user asked in.** Chinese question → Chinese answer; English question → English answer; any other language likewise.
- **Never guess stock tickers / full company names from memory.** A wrong ticker makes the API silently return wrong data without the user noticing.
- **Never pass a hard-coded `api_name` without reading the desc first.** The backend answers `API_NOT_FOUND`. Exception: you already read that source's desc earlier in this session and remember the params.
- **Do not give investment advice.** After presenting data, add one line: "AI-generated; not investment advice."
- If a data-source API error clearly indicates a backend bug (self-contradictory param schema, internal Python traceback, etc.), **report the error to the user instead of retrying** — such bugs cannot be fixed on this side and need a backend-service fix.
