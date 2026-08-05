import { Hono } from 'hono';
import { join } from 'node:path';

import { PYTHINKER_CODE_HOME } from '../config';
import { dashboardIncompatibilityBody } from '../lib/agent-record-types';
import { isSafeAgentId, readSessionDetail } from '../lib/session-store';
import { rehydrateWireEntries } from '../lib/blob-resolver';
import { readAgentWire } from '../lib/wire-reader';

export function wireRoute(home: string = PYTHINKER_CODE_HOME): Hono {
  const r = new Hono();
  r.get('/:id/wire', async (c) => {
    const id = c.req.param('id');
    const agentId = c.req.query('agent') ?? 'main';
    if (!isSafeAgentId(agentId)) {
      return c.json({ error: 'invalid agent id', code: 'BAD_REQUEST' }, 400);
    }
    try {
      const detail = await readSessionDetail(home, id);
      if (!detail) {
        return c.json({ error: 'session not found', code: 'NOT_FOUND' }, 404);
      }
      const agent = detail.agents.find((a) => a.agentId === agentId);
      if (!agent) {
        return c.json({ error: `agent "${agentId}" not found`, code: 'NOT_FOUND' }, 404);
      }
      if (!agent.wireExists) {
        return c.json({ error: 'wire missing', code: 'NOT_FOUND' }, 404);
      }
      const result = await readAgentWire(
        join(detail.sessionDir, 'agents', agentId, 'wire.jsonl'),
      );
      const baseUrl = new URL(c.req.url).origin;
      rehydrateWireEntries(result.records, id, agentId, baseUrl);
      return c.json({
        sessionId: id,
        agentId,
        protocolVersion: result.metadata.protocolVersion,
        metadata: result.metadata,
        records: result.records,
      });
    } catch (error) {
      const incompatibility = dashboardIncompatibilityBody(error);
      if (incompatibility !== null) return c.json(incompatibility, 409);
      const msg = (error as Error).message;
      return c.json({ error: msg, code: 'READ_ERROR' }, 500);
    }
  });
  return r;
}
