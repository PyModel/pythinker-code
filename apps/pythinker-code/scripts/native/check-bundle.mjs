import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

import { nativeJsBundlePath } from './paths.mjs';

const bundlePath = nativeJsBundlePath();
const text = readFileSync(bundlePath, 'utf-8');

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const optionalRuntimeRequires = new Set([
  'ajv-formats/dist/formats',
  'ajv/dist/runtime/validation_error',
  'bufferutil',
  'canvas',
  'chokidar',
  'cpu-features',
  'fast-json-stringify/lib/serializer',
  'fast-json-stringify/lib/validator',
  'utf-8-validate',
]);
const optionalRelativeRuntimeRequires = new Set(['./crypto/build/Release/sshcrypto.node']);
// node-pty joins koffi here: both stay external and resolve from the extracted
// native-asset node_modules at runtime (the ESM bundle reaches node-pty via a
// dynamic import instead of the old CJS require).
const handledNativeRuntimeRequires = new Set(['koffi', 'node-pty']);

function isAllowedSpecifier(specifier) {
  if (builtins.has(specifier) || specifier.startsWith('node:')) return true;
  if (optionalRuntimeRequires.has(specifier)) return true;
  if (handledNativeRuntimeRequires.has(specifier)) return true;
  return false;
}

const errors = [];

function executableLines() {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) return false;
      return true;
    });
}

for (const line of executableLines()) {
  for (const match of line.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      if (optionalRelativeRuntimeRequires.has(specifier)) continue;
      errors.push(`relative require remains: ${specifier}`);
      continue;
    }
    if (!isAllowedSpecifier(specifier)) {
      errors.push(`external require remains: ${specifier}`);
    }
  }

  for (const match of line.matchAll(/(?<![.\w])import\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      errors.push(`relative dynamic import remains: ${specifier}`);
      continue;
    }
    if (!isAllowedSpecifier(specifier)) {
      errors.push(`external dynamic import remains: ${specifier}`);
    }
  }

  if (line.startsWith('import ')) {
    for (const match of line.matchAll(
      /(?:\bfrom\s+|^import\s*)["']([^"']+)["']/g,
    )) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        errors.push(`relative import remains: ${specifier}`);
        continue;
      }
      if (!isAllowedSpecifier(specifier)) {
        errors.push(`external import remains: ${specifier}`);
      }
    }
  }

  if (line.startsWith('export ')) {
    for (const match of line.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        errors.push(`relative export remains: ${specifier}`);
        continue;
      }
      if (!isAllowedSpecifier(specifier)) {
        errors.push(`external export remains: ${specifier}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Native JS bundle check failed for ${bundlePath}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
