import { Hono } from 'hono';
import { PYTHINKER_CODE_HOME } from '../config';
import { dashboardIncompatibilityBody } from '../lib/agent-record-types';
import { readSessionDetail } from '../lib/session-store';

export function sessionDetailRoute(home: string = PYTHINKER_CODE_HOME): Hono {
  const r = new Hono();
  r.get('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const detail = await readSessionDetail(home, id);
      if (!detail) return c.json({ error: 'session not found', code: 'NOT_FOUND' }, 404);
      return c.json(detail);
    } catch (err) {
      const incompatibility = dashboardIncompatibilityBody(err);
      if (incompatibility !== null) return c.json(incompatibility, 409);
      return c.json({ error: (err as Error).message, code: 'READ_ERROR' }, 500);
    }
  });
  return r;
}
