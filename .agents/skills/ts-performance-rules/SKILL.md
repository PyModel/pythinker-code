---
name: ts-performance-rules
description: TypeScript and JavaScript performance and code-quality rules, usable in any framework. Use when writing, reviewing, or refactoring hot paths, data-structure choices, async flows, or bundle-size-sensitive code. Triggers include "optimize this function", "too slow", "reduce allocations", "bundle size", "lazy load", "speed up imports", or general code review of utilities and services.
license: MIT
---

# TypeScript performance rules

A rule catalog for TypeScript/JavaScript code in this repository. Rules are
framework-neutral: they apply to the CLI, the agent engines, the gateway, and the
web apps. Each rule file states its impact band, an incorrect/correct pair, and
the reasoning.

Derived from Vercel's react-best-practices rule catalog (MIT); the
React-component-specific rules are intentionally not part of this skill.

## Rule index

### Plain JavaScript efficiency (`js-*.md`)

| Rule | Applies when |
| ---- | ------------ |
| `js-early-exit` | Loops keep scanning after the answer is known |
| `js-length-check-first` | Cheap guards can precede expensive calls |
| `js-set-map-lookups` | Arrays are scanned inside loops for membership |
| `js-index-maps` | Repeated lookups rebuild the same index |
| `js-flatmap-filter` | `filter().map()` (or the reverse) makes two passes |
| `js-combine-iterations` | Multiple loops over the same array can share one pass |
| `js-hoist-regexp` | Regex literals or constructions sit inside hot loops |
| `js-min-max-loop` | `Math.min(...bigArray)` style spreads blow the stack or re-scan |
| `js-cache-function-results` | Pure functions recompute the same inputs |
| `js-cache-property-access` | Deep property chains are read repeatedly in loops |
| `js-cache-storage` | `localStorage`/`sessionStorage` reads sit in hot paths |
| `js-batch-dom-css` | DOM style reads/writes alternate and force layout thrash |
| `js-request-idle-callback` | Non-urgent work blocks interaction |
| `js-tosorted-immutable` | `.sort()` mutates arrays that callers own |

### Async structure (`async-*.md`)

| Rule | Applies when |
| ---- | ------------ |
| `async-cheap-condition-before-await` | A cheap guard sits after an expensive `await` |
| `async-defer-await` | Independent awaits run serially for no reason |
| `async-parallel` | Independent promises could run through `Promise.all` |
| `async-dependencies` | A chain of awaits hides which steps truly depend on each other |

### Bundle size (`bundle-*.md`)

| Rule | Applies when |
| ---- | ------------ |
| `bundle-barrel-imports` | Imports pull whole barrel files for one symbol |
| `bundle-conditional` | Large dependencies load for features that are rarely enabled |
| `bundle-defer-third-party` | Third-party SDKs load eagerly at startup |
| `bundle-dynamic-imports` | Rare code paths could be `import()` splits |
| `bundle-preload` | Known-next navigations could preload their chunks |
| `bundle-analyzable-paths` | Dynamic import paths are built in ways bundlers cannot trace |

## How to apply

1. Pick rules by the code's actual shape, not by keyword match alone; the impact
   band in each rule's frontmatter says how much it typically matters.
2. Apply the smallest change that satisfies the rule; do not restructure working
   code beyond the rule's scope.
3. For repository-specific constraints, the nearest `AGENTS.md` and the package's
   own tests win over these general rules.
