import { relative } from 'node:path';

// Keep this in sync with .oxlintrc.json's "ignorePatterns" — oxlint silently
// treats an all-ignored fileset as an error ("no files to lint", exit 1),
// so lint-staged must filter these out itself before invoking oxlint.
const OXLINT_IGNORE_PATTERNS = [
  'dist/',
  'coverage/',
  'node_modules/',
  'apps/*/scripts/',
  'docs/smoke-archive/',
  'plugins/curated/superpowers/',
  '*.generated.ts',
];

const ignoreRegexes = OXLINT_IGNORE_PATTERNS.map((pattern) => {
  const isDir = pattern.endsWith('/');
  const body = isDir ? pattern.slice(0, -1) : pattern;
  const escaped = body.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll(/\*/g, '[^/]*');
  return isDir ? new RegExp(`(^|/)${escaped}(/|$)`) : new RegExp(`(^|/)${escaped}$`);
});

function lintableFiles(files) {
  return files
    .map((file) => relative(process.cwd(), file))
    .filter((file) => !ignoreRegexes.some((re) => re.test(file)));
}

export default {
  '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}': (files) => {
    const targets = lintableFiles(files);
    if (targets.length === 0) return [];
    const quoted = targets.map((f) => JSON.stringify(f)).join(' ');
    return [`oxlint --fix --quiet ${quoted}`, `oxlint --type-aware --quiet ${quoted}`];
  },
};
