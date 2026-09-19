import { describe, expect, it } from 'vitest';

import {
  capabilityStatusSchema,
  listCapabilitiesResponseSchema,
} from '../src/protocol/rest-capability';
import { sharedAuthHeaders, sharedServer } from './helpers/sharedServer';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

describe('server-v2 /api/v1 capabilities', () => {
  async function getJson<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${sharedServer().base}${path}`, {
      headers: sharedAuthHeaders(),
    } as never);
    return { status: res.status, body: (await res.json()) as Envelope<T> };
  }

  async function postJson<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${sharedServer().base}${path}`, {
      method: 'POST',
      headers: sharedAuthHeaders({ 'content-type': 'application/json' }),
      body: '{}',
    } as never);
    return { status: res.status, body: (await res.json()) as Envelope<T> };
  }

  it('lists zero built-in capabilities after managed surface strip', async () => {
    const { body } = await getJson<unknown>('/api/v1/capabilities');
    expect(body.code).toBe(0);
    const parsed = listCapabilitiesResponseSchema.parse(body.data);
    expect(parsed.capabilities).toEqual([]);
  });

  it('40418s on an unknown capability id', async () => {
    const missing = await getJson<unknown>('/api/v1/capabilities/nope');
    expect(missing.body.code).toBe(40418);
    expect(missing.body.data).toBeNull();
  });

  it('installs 40418 on an unknown id without side effects', async () => {
    const { body } = await postJson<unknown>('/api/v1/capabilities/nope:install');
    expect(body.code).toBe(40418);
  });

  it('rejects bare ids and unknown actions with 40001', async () => {
    const bare = await postJson<unknown>('/api/v1/capabilities/pythinker-cu');
    expect(bare.body.code).toBe(40001);
    const bogus = await postJson<unknown>('/api/v1/capabilities/pythinker-cu:uninstall');
    expect(bogus.body.code).toBe(40001);
  });
});
