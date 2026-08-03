# OpenTUI Solid reactivity

`@opentui/solid` imports `solid-js/dist/solid.js`. Every bare `solid-js`
import in this app must resolve to that same file so signals, effects, owners,
and contexts share one reactive graph.

`scripts/solid-runtime.mjs` is the single source of truth:

```js
export const solidRuntimeAlias = {
  find: /^solid-js$/u,
  replacement: solidRuntimePath,
};
```

Keep this exact alias applied in all four execution paths:

- Vitest: `vitest.config.ts`
- development Vite runtime: `scripts/dev-vite-runtime.mjs`
- distributable tsdown build: `tsdown.config.ts`
- native tsdown build: `tsdown.native.config.ts`

The development Vite runtime must also include both `@opentui/solid` and
`solid-js` in `ssr.noExternal`. Otherwise Vite rewrites the app's bare
`solid-js` import through the alias while Node resolves the dependency's
externalized `solid-js/dist/solid.js` import outside Vite's module graph,
splitting the reactive runtime.

The match must stay exact. Subpaths such as `solid-js/store`, `solid-js/web`,
and `solid-js/jsx-runtime` must retain their normal resolution.

Do not replace the alias with default condition resolution. Vitest selects
`dist/dev.js`, while Node and SSR select `dist/server.js`; both split the
runtime from OpenTUI's client `dist/solid.js` and silently stop reactive
updates.

`test/tui/runtime/opentui-reactivity.test.tsx` guards function identity and
signal-driven terminal updates using ordinary imports from `solid-js`.
