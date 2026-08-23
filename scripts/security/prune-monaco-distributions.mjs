#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const webRoot = join(repositoryRoot, 'apps/pythinker-web');
const require = createRequire(import.meta.url);
const packagePath = require.resolve('monaco-editor/package.json', { paths: [webRoot] });
const monacoRoot = dirname(packagePath);
const monacoPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
const esmVendor = join(monacoRoot, 'esm/vs/base/browser/dompurify/dompurify.js');

if (monacoPackage.version !== '0.55.1') {
  throw new Error(`Review Monaco DOMPurify before using version ${monacoPackage.version}.`);
}
if (monacoPackage.main || monacoPackage.exports?.['.']?.require) {
  throw new Error('Monaco still exposes its vulnerable CommonJS distribution.');
}
if (readFileSync(esmVendor, 'utf8').trim() !== "export { default } from 'dompurify';") {
  throw new Error('Monaco ESM does not use the patched DOMPurify dependency.');
}

const removed = [];
for (const distribution of ['dev', 'min']) {
  const target = join(monacoRoot, distribution);
  if (!existsSync(target)) continue;
  rmSync(target, { force: true, recursive: true });
  removed.push(distribution);
}

if (removed.length > 0) {
  process.stdout.write(`Removed unused Monaco distributions: ${removed.join(', ')}.\n`);
}
