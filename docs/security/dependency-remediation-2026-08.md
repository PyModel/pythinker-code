# Dependency Advisory Remediation Record

Date: 2026-08-22

## Result

The baseline full-workspace audit returned 88 advisory records for 78 unique GitHub Security
Advisories. The remediated lockfile returns zero vulnerabilities at every severity.

An unreachable advisory is still a valid dependency finding. Reachability affects urgency and
test scope. It does not change an advisory to a false positive.

## Evidence Authority

Use evidence in this order:

1. GitHub Advisory Database or the assigned CVE.
2. The upstream maintainer release, patch, or security advisory.
3. This repository's lockfile, source, and built artifacts.
4. Tavily, Firecrawl, Context7, discussions, and other discovery sources.

Discovery sources can corroborate a result. They do not establish a safe version floor.

## Remediation Ownership

| Phase | Package families |
| --- | --- |
| Runtime | tar, ws, protobufjs, @protobufjs/utf8, React Router, find-my-way, ip-address, fast-uri |
| Browser security | Mermaid, DOMPurify, Monaco |
| Tooling and package | brace-expansion, js-yaml, Vite, esbuild, PostCSS, nanoid, linkify-it, qs, body-parser |
| Controls | CodeQL, dependency review, full audit, secret scanning |

Each family has one phase owner. Browser DOMPurify work includes both Mermaid and Monaco.

## Reachability Record

| Code | Family | Repository evidence and reachability |
| --- | --- | --- |
| R1 | tar | Both agent-core manifests declared tar and its deprecated type stub, but no source imported it. The direct declarations were removed. Electron packaging and node-gyp still resolve the patched release. |
| R2 | ws | The gateway directly creates `WebSocketServer`. Google GenAI, OpenAI, klient tests, and jsdom also resolve ws. This is a reachable runtime path. Every resolved instance uses 8.21.3 or later. |
| R3 | protobufjs and @protobufjs/utf8 | Google GenAI uses this graph in both provider engines. This path is reachable when a Google provider is selected. |
| R4 | React Router | The visualizer directly mounts `BrowserRouter`. The reviewed RSC and server-rendering modes were not present at that entry point, but the dependency finding remained valid and was remediated. |
| R5 | find-my-way | Fastify uses this router in the gateway runtime. HTTP/2 exposure was not established in the default server configuration. The runtime graph was still upgraded. |
| R6 | ip-address | Runtime packages resolve it through SOCKS and MCP-related networking paths. No direct repository call was found. The transitive instance was still upgraded. |
| R7 | fast-uri | Ajv and Fastify-related validation paths resolve it. The transitive runtime and tooling instances were upgraded. |
| R8 | Mermaid | The web chat renders model-produced Mermaid blocks. This is hostile browser input and a reachable sanitizer path. Docs also build Mermaid content. |
| R9 | DOMPurify | Mermaid and Monaco resolved separate vulnerable copies. Both now resolve 3.4.14. The built browser test executes malicious fixtures through both production chunks. |
| R10 | Monaco | The web editor loads Monaco. Monaco 0.55.1 also embedded DOMPurify at version 3.2.7 in its ESM source. A pnpm patch replaces that ESM implementation with the resolved DOMPurify 3.4.14 module and changes Monaco's dependency metadata. A lockfile override alone is not accepted. |
| R11 | Tooling and package families | brace-expansion, js-yaml, Vite, esbuild, PostCSS, nanoid, linkify-it, qs, and body-parser occur in build, package, docs, test, or transitive runtime graphs. Full-workspace audit and artifact checks cover them even when production-only audit classification excludes them. |

## Verification Contract

The following checks are required:

1. `pnpm audit --json` reports zero vulnerabilities. `pnpm audit --prod` is informational only.
2. Lockfile checks reject every known vulnerable package version, including unreachable entries.
3. Monaco dependency metadata, patched ESM source, and resolved DOMPurify version must agree.
4. Malicious Monaco and Mermaid fixtures run in Chrome against the production web build.
5. CLI `dist`, committed `dist-web`, packed CLI, desktop package, VSIX, docs output, and tooling graph are inspected separately. Embedded `dist-web` copies must be byte-identical.

The browser check does not rely only on license banners or version strings. It verifies that event
handlers, script elements, and `javascript:` URLs cannot execute or remain active in rendered DOM.

## Alert and Recurrence Policy

- Pull requests block every net-new dependency vulnerability, at every severity.
- Critical and High disclosures receive triage within 24 hours and a fix target of 72 hours.
- Medium disclosures have a 7-day fix target. Low disclosures have a 30-day fix target.
- The target state is zero `OPEN` Dependabot alerts.
- A dismissed or auto-dismissed record cannot justify a vulnerable lockfile entry.
- Historical `AUTO_DISMISSED`, `DISMISSED`, and `FIXED` states can remain in GitHub reporting after
  the lockfile is clean.
- The development-dependency auto-dismiss preset is disabled because development dependencies can
  enter shipped artifacts in this monorepo.
