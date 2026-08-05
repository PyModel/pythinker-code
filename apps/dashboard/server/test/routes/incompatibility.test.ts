import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createApp } from '../../src/app';
import { buildSessionFixture } from '../fixtures/build';

const SESSION_ID = 'session_fixture';
const READ_ROUTES = [
  `/api/sessions/${SESSION_ID}`,
  `/api/sessions/${SESSION_ID}/context?agent=main`,
  `/api/sessions/${SESSION_ID}/wire?agent=main`,
  `/api/sessions/${SESSION_ID}/agents`,
  `/api/sessions/${SESSION_ID}/blobs/${'a'.repeat(64)}?agent=main`,
] as const;

describe('session incompatibility routes', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup !== null) await cleanup();
    cleanup = null;
  });

  it('returns state incompatibility from every session-scoped read route', async () => {
    expect.hasAssertions();
    const fixture = await buildSessionFixture('sample-main');
    cleanup = fixture.cleanup;
    const statePath = join(fixture.sessionDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
    state['sessionFormatVersion'] = 1;
    await writeFile(statePath, JSON.stringify(state));

    await expectIncompatibilityMatrix(
      fixture.home,
      'incompatible_state',
      { error: 'session state is incompatible', code: 'INCOMPATIBLE_SESSION_STATE' },
    );
  });

  it('returns wire incompatibility from every session-scoped read route', async () => {
    expect.hasAssertions();
    const fixture = await buildSessionFixture('sample-main');
    cleanup = fixture.cleanup;
    const wirePath = join(fixture.sessionDir, 'agents', 'main', 'wire.jsonl');
    const lines = (await readFile(wirePath, 'utf8')).split('\n');
    lines[0] = JSON.stringify({ type: 'metadata', protocol_version: '1.1', created_at: 1 });
    await writeFile(wirePath, lines.join('\n'));

    await expectIncompatibilityMatrix(
      fixture.home,
      'incompatible_wire',
      { error: 'agent wire is incompatible', code: 'INCOMPATIBLE_AGENT_WIRE' },
    );
  });
});

async function expectIncompatibilityMatrix(
  homeDir: string,
  health: 'incompatible_state' | 'incompatible_wire',
  body: { error: string; code: string },
): Promise<void> {
  const app = await createApp({ homeDir });
  const list = await app.request('/api/sessions');
  expect(list.status).toBe(200);
  expect(await list.json()).toMatchObject({ sessions: [{ health }] });

  for (const route of READ_ROUTES) {
    const response = await app.request(route);
    expect(response.status, route).toBe(409);
    expect(await response.json()).toEqual(body);
  }
}
