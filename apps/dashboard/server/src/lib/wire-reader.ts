import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  AGENT_WIRE_PROTOCOL_VERSION,
  assertAgentRecord,
} from '@pymodel/agent-core';

import {
  DashboardIncompatibilityError,
  type WireEntry,
} from './agent-record-types';

export interface WireReadResult {
  metadata: { protocolVersion: string; createdAt: number };
  records: ReadonlyArray<WireEntry>;
}

/** Read an exact-current agent wire file. */
export async function readAgentWire(path: string): Promise<WireReadResult> {
  try {
    const stream = createReadStream(path, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNo = 0;
    let metadata: WireReadResult['metadata'] | null = null;
    const records: WireEntry[] = [];

    for await (const line of rl) {
      lineNo += 1;
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Wire record is invalid JSON at line ${lineNo}`, { cause: error });
      }
      assertAgentRecord(parsed);
      if (metadata === null) {
        if (parsed['type'] !== 'metadata') {
          throw new Error(`Wire file missing metadata header at line ${lineNo}`);
        }
        const pv = parsed['protocol_version'];
        const ca = parsed['created_at'];
        if (pv !== AGENT_WIRE_PROTOCOL_VERSION || typeof ca !== 'number') {
          throw new TypeError(`Wire metadata malformed at line ${lineNo}`);
        }
        metadata = { protocolVersion: pv, createdAt: ca };
        continue;
      }
      records.push({
        lineNo,
        data: structuredClone(parsed),
        raw: parsed,
      });
    }
    if (metadata === null) {
      throw new Error('Wire file is empty (no metadata)');
    }
    return { metadata, records };
  } catch (error) {
    if (error instanceof DashboardIncompatibilityError) throw error;
    throw new DashboardIncompatibilityError('wire', { cause: error });
  }
}
