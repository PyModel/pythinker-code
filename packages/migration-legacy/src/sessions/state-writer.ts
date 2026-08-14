import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SESSION_FORMAT_VERSION } from '@pymodel/agent-core';
import type { OldSessionState } from '../pythinker-cli-schema.js';

export interface StateWriteInput {
  readonly oldState: Partial<OldSessionState>;
  readonly lastUserPrompt: string;
  readonly sourcePath: string;
  readonly oldSessionUuid: string;
  readonly wireProtocolFromOld: string | null;
  readonly createdAtMs: number;
}

export async function writeSessionState(sessionDir: string, input: StateWriteInput): Promise<void> {
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });

  const customTitle = input.oldState.custom_title ?? null;
  const isCustomTitle =
    customTitle !== null && customTitle.length > 0 && !input.oldState.title_generated;
  const fallbackTitle = input.lastUserPrompt.slice(0, 50).trim();
  const candidateTitle = customTitle ?? fallbackTitle;
  const finalTitle = candidateTitle.length > 0 ? candidateTitle : 'Imported session';

  const wireMtimeS = input.oldState.wire_mtime ?? null;
  const updatedAt =
    wireMtimeS !== null && wireMtimeS !== undefined
      ? new Date(wireMtimeS * 1000).toISOString()
      : new Date(input.createdAtMs).toISOString();

  const meta = {
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    archived: input.oldState.archived === true,
    createdAt: new Date(input.createdAtMs).toISOString(),
    updatedAt,
    title: finalTitle,
    isCustomTitle,
    lastPrompt: input.lastUserPrompt.slice(0, 200),
    agents: {
      main: {
        type: 'main',
        parentAgentId: null,
      },
    },
    custom: {
      imported_from_pythinker_cli: true,
      pythinker_cli_source_path: input.sourcePath,
      pythinker_cli_session_id: input.oldSessionUuid,
      pythinker_cli_wire_protocol: input.wireProtocolFromOld,
      imported_at: new Date().toISOString(),
    },
  };

  await writeFile(join(sessionDir, 'state.json'), JSON.stringify(meta, null, 2), 'utf-8');
}
