#!/usr/bin/env node
/**
 * Deterministic, idempotent rebrand transform for continuous upstream porting:
 * MoonshotAI/kimi-code tree -> Pythinker naming.
 *
 * Usage: node scripts/upstream-sync/rebrand.mjs <srcDir> <outDir>
 *
 * Product identity is renamed; the Kimi/Moonshot MODEL PROVIDER is kept:
 * provider platform ids (moonshot-cn/moonshot-ai), api.moonshot.* URLs,
 * platform.kimi.* consoles, kimi-k* model names, "Kimi Platform" labels,
 * kimi-for-coding, and moonshot-v1 model ids.
 * Managed-service stripping is deliberately NOT done here — that lives on the
 * merge side (tasks/todo.md D5) so this script stays mechanical.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip',
  '.gz', '.tar', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mov',
  '.wasm', '.node', '.dylib', '.so', '.dll', '.exe', '.wav', '.mp3',
]);

// Org/scope/docs renames that must run BEFORE protection: they contain
// substrings (moonshot-ai, moonshotai) that the protection pass keeps for
// the model provider.
const RENAME_FIRST = [
  ['@moonshot-ai/kimi-code', '@pymodel/pythinker-code'],
  ['@moonshot-ai', '@pymodel'],
  ['moonshotai.github.io/kimi-code', 'code.pythinker.com/pythinker-code'],
  ['github.com/MoonshotAI/kimi-code', 'github.com/PyModel/pythinker-code'],
  ['MoonshotAI/kimi-code', 'PyModel/pythinker-code'],
  ['moonshot-ai/kimi-code', 'pymodel/pythinker-code'],
];

// Substrings that must survive rebranding (the Kimi/Moonshot MODEL PROVIDER).
// Each is swapped to a placeholder before the rename rules run, and restored
// afterwards.
const PROTECT = [
  'api.moonshot.cn',
  'api.moonshot.ai',
  'api.kimi.com',
  'API.KIMI.COM',
  "'kimi-k'",
  'platform.kimi.com',
  'platform.kimi.ai',
  'www.kimi.com',
  'kimi.com',
  'kimi.ai',
  'Kimi Platform',
  'Kimi Open Platform',
  'kimi-for-coding',
  'cloudbase-kimi.zip',
  'kimi-k1',
  'kimi-k2',
  'kimi-k3',
  'kimi-k4',
  'kimi-latest',
  'kimi-thinking',
  'Kimi K1',
  'Kimi K2',
  'Kimi K3',
  'moonshot-cn',
  'moonshot-ai',
  'moonshot-v1',
  'moonshotai/', // huggingface-style org paths for model weights
  'MOONSHOT_API_KEY',
];

// Ordered rename rules (longest / most specific first). Plain string pairs;
// applied globally to both file contents and paths.
const RENAME = [
  // company + managed web services (search/fetch providers) — PyModel only
  ['Moonshot AI', 'PyModel'],
  ['MoonshotAI', 'PyModel'],
  ['Moonshot', 'PyModel'],
  ['MOONSHOT', 'PYMODEL'],
  ['moonshot', 'pymodel'],
  // swarm feature was renamed to dynamic workflow in pythinker
  ['SWARM_MODE', 'DYNAMIC_WORKFLOW_MODE'],
  ['SWARM_', 'DYNAMIC_WORKFLOW_'],
  ['SWARM', 'DYNAMIC_WORKFLOW'],
  ['swarm_mode', 'dynamic_workflow_mode'],
  ['swarmMode', 'dynamicWorkflowMode'],
  ['swarm_index', 'dynamic_workflow_index'],
  ['swarmIndex', 'dynamicWorkflowIndex'],
  ['SwarmMode', 'DynamicWorkflowMode'],
  ['swarm-', 'dynamic-workflow-'],
  ['Swarm', 'DynamicWorkflow'],
  ['swarms', 'dynamicWorkflows'],
  ['swarm', 'dynamic_workflow'],
  // kaos OS-abstraction layer was renamed to pyaos in pythinker
  ['KAOS_', 'PYAOS_'],
  ['KAOS', 'PYAOS'],
  ['Kaos', 'Pyaos'],
  ['kaos', 'pyaos'],
  // product identity
  ['kimi-code', 'pythinker-code'],
  ['KimiCode', 'PythinkerCode'],
  ['kimiCode', 'pythinkerCode'],
  ['KIMI_CODE', 'PYTHINKER_CODE'],
  ['Kimi Code', 'Pythinker Code'],
  ['Kimi-Code', 'Pythinker-Code'],
  ['KIMI_', 'PYTHINKER_'],
  ['KIMI', 'PYTHINKER'],
  ['Kimi', 'Pythinker'],
  ['kimi', 'pythinker'],
];

function transformText(text) {
  let out = text;
  for (const [from, to] of RENAME_FIRST) out = out.split(from).join(to);
  PROTECT.forEach((s, i) => {
    out = out.split(s).join(`\u0000P${i}\u0000`);
  });
  // camelCase continuations (swarmItem, swarmMembers, ...) must stay camel:
  // handle them before the bare snake_case fallback rule below.
  out = out.replaceAll(/swarm(?=[A-Z])/g, 'dynamicWorkflow');
  for (const [from, to] of RENAME) out = out.split(from).join(to);
  PROTECT.forEach((s, i) => {
    out = out.split(`\u0000P${i}\u0000`).join(s);
  });
  return out;
}

function transformPath(p) {
  // Paths never contain the protected URL/label strings above except plugin
  // product dirs, which PROTECT handles via the same placeholder mechanism.
  return transformText(p);
}

function isBinary(path, buf) {
  const dot = path.lastIndexOf('.');
  if (dot !== -1 && BINARY_EXT.has(path.slice(dot).toLowerCase())) return true;
  return buf.subarray(0, 8192).includes(0);
}

function walk(dir, base, files) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, files);
    else files.push(relative(base, full));
  }
  return files;
}

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: rebrand.mjs <srcDir> <outDir>');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let renamedPaths = 0;
let changedFiles = 0;
const files = walk(src, src, []);
for (const rel of files) {
  const target = transformPath(rel);
  if (target !== rel) renamedPaths++;
  const dest = join(out, target);
  mkdirSync(join(dest, '..'), { recursive: true });
  const buf = readFileSync(join(src, rel));
  if (isBinary(rel, buf)) {
    cpSync(join(src, rel), dest);
    continue;
  }
  const text = buf.toString('utf8');
  const next = transformText(text);
  if (next !== text) changedFiles++;
  writeFileSync(dest, next);
}
console.log(`rebranded ${files.length} files (${renamedPaths} paths renamed, ${changedFiles} contents changed)`);
