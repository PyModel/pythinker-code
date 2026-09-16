import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { sharedAuthedFetch } from './helpers/sharedServer';

interface Envelope<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
}

async function createSession(): Promise<string> {
  const res = await sharedAuthedFetch('/api/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ metadata: { cwd: tmpdir() } }),
  });
  const envelope = (await res.json()) as Envelope<{ id: string }>;
  if (envelope.code !== 0 || envelope.data === null) {
    throw new Error(`failed to create session: ${JSON.stringify(envelope)}`);
  }
  return envelope.data.id;
}

describe('file history routes', () => {
  it('serves empty changes and null content for a live session without history', async () => {
    const sessionId = await createSession();

    const changes = await sharedAuthedFetch(
      `/api/v1/sessions/${sessionId}/file-history/changes?turn_id=1`,
    );
    expect(changes.status).toBe(200);
    expect(((await changes.json()) as Envelope<{ changes: unknown[] }>).data).toEqual({
      changes: [],
      recorded: false,
    });

    const content = await sharedAuthedFetch(
      `/api/v1/sessions/${sessionId}/file-history/content?turn_id=1&path=a.txt`,
    );
    expect(content.status).toBe(200);
    expect(((await content.json()) as Envelope<{ content: unknown }>).data).toEqual({
      content: null,
    });
  });

  it('rejects a session that is not live', async () => {
    const res = await sharedAuthedFetch(
      '/api/v1/sessions/does-not-exist/file-history/changes?turn_id=1',
    );
    const envelope = (await res.json()) as Envelope;
    expect(envelope.code).not.toBe(0);
    expect(envelope.data).toBeNull();
  });

  it('rejects a malformed turn_id', async () => {
    const sessionId = await createSession();
    const res = await sharedAuthedFetch(
      `/api/v1/sessions/${sessionId}/file-history/changes?turn_id=abc`,
    );
    const envelope = (await res.json()) as Envelope;
    expect(envelope.code).not.toBe(0);
  });
});
