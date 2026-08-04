import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const solidRuntimeSpecifier = 'solid-js/dist/solid.js';

export const solidRuntimePath = requireFromHere.resolve(solidRuntimeSpecifier);
export const solidRuntimeAlias = {
  find: /^solid-js$/u,
  replacement: solidRuntimePath,
};

export function solidRuntimeAliasPlugin({ external = false } = {}) {
  return {
    name: 'pythinker-solid-runtime-alias',
    resolveId(source) {
      if (!solidRuntimeAlias.find.test(source)) return null;
      return external
        ? { id: solidRuntimeSpecifier, external: true }
        : solidRuntimeAlias.replacement;
    },
  };
}
