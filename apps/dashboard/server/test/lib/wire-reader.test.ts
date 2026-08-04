import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSessionFixture } from '../fixtures/build';
import { readAgentWire } from '../../src/lib/wire-reader';

describe('wire-reader', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
  });

  it('reads main agent wire and assigns line numbers', async () => {
    const { sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const result = await readAgentWire(join(sessionDir, 'agents', 'main', 'wire.jsonl'));
    expect(result.metadata.protocolVersion).toBe('2.0');
    expect(result.records[0]!.lineNo).toBe(2); // metadata is line 1, first record is line 2
    expect(result.records.at(-1)!.lineNo).toBe(10);
    expect(result.records.map((r) => r.data.type)).toEqual([
      'config.update',
      'tools.set_active_tools',
      'permission.set_mode',
      'turn.prompt',
      'context.append_message',
      'context.append_loop_event',
      'context.append_loop_event',
      'context.append_loop_event',
      'usage.record',
    ]);
    expect(result).not.toHaveProperty('warnings');
    // No dashboard annotation should leak into the data/raw bodies.
    for (const entry of result.records) {
      expect(entry.data).not.toHaveProperty('_lineNo');
      expect(entry.raw as object).not.toHaveProperty('_lineNo');
    }
  });

  it('skips blank lines before the exact metadata header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-blank-wire-header-'));
    const path = join(dir, 'wire.jsonl');
    await writeFile(
      path,
      `\n  \n${JSON.stringify({ type: 'metadata', protocol_version: '2.0', created_at: 1 })}\n${JSON.stringify({ type: 'config.update', cwd: '/tmp', time: 2 })}\n`,
    );
    try {
      const result = await readAgentWire(path);
      expect(result.metadata).toEqual({ protocolVersion: '2.0', createdAt: 1 });
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.lineNo).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a wire without an exact metadata header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-missing-wire-header-'));
    const path = join(dir, 'wire.jsonl');
    await writeFile(path, `${JSON.stringify({ type: 'config.update', cwd: '/tmp', time: 1 })}\n`);
    try {
      await expect(readAgentWire(path)).rejects.toThrow('agent wire is incompatible');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['1.1', '2.1'])('rejects non-current wire protocol %s', async (protocolVersion) => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-incompatible-wire-'));
    const path = join(dir, 'wire.jsonl');
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'metadata', protocol_version: protocolVersion, created_at: 1 }),
        JSON.stringify({ type: 'config.update', cwd: '/tmp', time: 2 }),
      ].join('\n') + '\n',
    );
    try {
      await expect(readAgentWire(path)).rejects.toThrow('agent wire is incompatible');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['malformed JSON', 'not json'],
    ['record without a type', JSON.stringify({ record: 'missing type' })],
    ['unknown record discriminant', JSON.stringify({ type: 'unknown.record' })],
  ])('rejects a %s after the metadata header', async (_name, record) => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-invalid-wire-record-'));
    const path = join(dir, 'wire.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({ type: 'metadata', protocol_version: '2.0', created_at: 1 })}\n${record}\n`,
    );
    try {
      await expect(readAgentWire(path)).rejects.toThrow('agent wire is incompatible');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
