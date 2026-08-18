import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', '..', 'src');

const VENDOR_GATE_RE = /[!=]==?\s*'pythinker'|'pythinker'\s*[!=]==?|\bcase\s+'pythinker'\s*:/;

interface GateHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (relative(SRC_ROOT, abs) === 'kosong') continue;
      out.push(...walk(abs));
    } else if (abs.endsWith('.ts')) {
      out.push(abs);
    }
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function findVendorGates(source: string, file: string): GateHit[] {
  const hits: GateHit[] = [];
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    if (isCommentLine(line)) continue;
    VENDOR_GATE_RE.lastIndex = 0;
    if (VENDOR_GATE_RE.test(line)) {
      hits.push({ file, line: index + 1, text: line.trim() });
    }
  }
  return hits;
}

describe('vendor-name gates', () => {
  it('flags vendor compares and switch cases in code', () => {
    const hits = findVendorGates(
      [
        `if (provider.type === 'pythinker') return;`,
        `if (provider?.type !== 'pythinker' || provider.oauth === undefined) return;`,
        `const managed = 'pythinker' === vendor;`,
        `switch (type) { case 'pythinker': break; }`,
        `if (type == 'pythinker') return;`,
      ].join('\n'),
      'fixture.ts',
    );
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores comments, brand/env names, and pythinker as data', () => {
    const hits = findVendorGates(
      [
        '// v1 `provider.type === \'pythinker\'` gate restored.',
        ' * `provider.type === \'pythinker\'` parity): strict validation',
        '/* legacy: provider.type === \'pythinker\' */',
        'const home = process.env.PYTHINKER_CODE_HOME;',
        `const event = { provider_type: 'pythinker' };`,
        `const provider = { type: 'pythinker', oauth };`,
        `registerProviderDefinition({ id: 'pythinker', ...rest });`,
      ].join('\n'),
      'fixture.ts',
    );
    expect(hits).toEqual([]);
  });

  it('finds no vendor-name gates in src/ outside kosong', () => {
    const hits = walk(SRC_ROOT).flatMap((file) =>
      findVendorGates(readFileSync(file, 'utf8'), relative(SRC_ROOT, file)),
    );
    expect(
      hits.map((hit) => `${hit.file}:${hit.line} ${hit.text}`),
      'vendor-name gate found outside kosong — ask the provider-definition / adapter registries instead',
    ).toEqual([]);
  });
});
