import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateOneSession } from '../../src/sessions/migrate-one.js';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

const SCENARIOS = [
  'tiny-hello-world',
  'with-tool-calls',
  'with-thinking',
  'with-image',
  'with-subagent-collapsed',
  'legacy-protocol-1.3',
  'recent-protocol-1.10',
  'broken-state-json',
  'archived',
  'large-100msgs',
] as const;

let target: string;
beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'fixtures-snap-'));
});
afterEach(async () => {
  await rm(target, { recursive: true, force: true });
});

describe.each(SCENARIOS)('migration snapshot: %s', (name) => {
  it('migration succeeds and matches snapshot', async () => {
    const result = await migrateOneSession({
      sourceSessionDir: join(FIXTURES, name),
      oldSessionUuid: name,
      workdirPath: '/Users/example/proj',
      targetHome: target,
    });
    // Broken state defaults should kick in; it may still fail gracefully.
    expect(
      name === 'broken-state-json' ? ['migrated', 'failed'] : ['migrated'],
    ).toContain(result.outcome);
    if (name === 'broken-state-json') return;
    if (result.outcome !== 'migrated') return;

    const wire = await readFile(join(result.targetDir, 'agents', 'main', 'wire.jsonl'), 'utf-8');
    const state = await readFile(join(result.targetDir, 'state.json'), 'utf-8');
    // Redact clock-dependent fields (createdAt/updatedAt/imported_at) and the
    // machine-dependent source paths so the snapshot is stable across hosts.
    const stableState = state
      .replace(/"createdAt": ".+?"/, '"createdAt": "<REDACTED>"')
      .replace(/"updatedAt": ".+?"/, '"updatedAt": "<REDACTED>"')
      .replace(/"imported_at": ".+?"/, '"imported_at": "<REDACTED>"')
      .replace(/"pythinker_cli_source_path": ".+?"/, '"pythinker_cli_source_path": "<REDACTED>"')
      .split(target)
      .join('<TARGET>');
    // Redact wire created_at timestamp (derived from wire_mtime or Date.now()).
    const stableWire = wire.replace(/"created_at":\s*\d+/, '"created_at":<REDACTED>');
    expect({ wire: stableWire, state: stableState }).toMatchSnapshot();
  });
});
