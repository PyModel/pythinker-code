import { readFile } from 'node:fs/promises';
import { resolve } from 'pathe';

import { ErrorCodes, PythinkerError } from '#/errors';
import { resolveGlobalLogPath } from '#/logging/logger';
import { parseSessionMetadata } from '../index';
import { buildExportManifest } from '#/session/export/manifest';
import { scanSessionWire } from '#/session/export/wire-scan';
import {
  type ExtraZipEntry,
  collectFilesRecursive,
  writeExportZip,
} from '#/session/export/zip';
import type { ExportSessionPayload, ExportSessionResult, SessionSummary } from '#/rpc/core-api';

const SESSION_LOG_REL = 'logs/pythinker-code.log';
const GLOBAL_LOG_REL = 'logs/global/pythinker-code.log';

export async function exportSessionDirectory(input: {
  readonly request: ExportSessionPayload;
  readonly summary: SessionSummary;
  readonly homeDir?: string | undefined;
  readonly globalLogPath?: string | undefined;
}): Promise<ExportSessionResult> {
  const sessionDir = input.summary.sessionDir;
  const sessionFiles = await collectFilesRecursive(sessionDir);
  if (sessionFiles.length === 0) {
    throw new PythinkerError(ErrorCodes.SESSION_EXPORT_NOT_FOUND, `Session "${input.summary.id}" has no exportable directory at "${sessionDir}"`, {
      details: { sessionId: input.summary.id, sessionDir },
    });
  }

  await validateSessionState(sessionDir, input.summary.id);
  const sessionScan = await scanSessionWire(sessionDir);
  const hasSessionLog = sessionFiles.some((f) =>
    f.endsWith(`/${SESSION_LOG_REL}`) || f.endsWith(`\\${SESSION_LOG_REL.replaceAll('/', '\\')}`),
  );

  const extras: ExtraZipEntry[] = [];
  let bundledGlobal = false;
  const globalPath =
    input.globalLogPath ??
    (input.homeDir === undefined ? undefined : resolveGlobalLogPath(input.homeDir));
  if (input.request.includeGlobalLog === true && globalPath !== undefined) {
    const data = await readOptionalFile(globalPath);
    if (data !== undefined) {
      extras.push({ data, target: GLOBAL_LOG_REL });
      bundledGlobal = true;
    }
  }

  const now = new Date();
  const manifest = buildExportManifest({
    summary: input.summary,
    now,
    version: input.request.version,
    sessionScan,
    sessionLogPath: hasSessionLog ? SESSION_LOG_REL : undefined,
    globalLogPath: bundledGlobal ? GLOBAL_LOG_REL : undefined,
    installSource: input.request.installSource,
    shellEnv: input.request.shellEnv,
  });

  const outputPath =
    input.request.outputPath !== undefined
      ? resolve(input.request.outputPath)
      : resolve(defaultExportZipName(input.summary.id, now));

  const entries = await writeExportZip({
    outputPath,
    manifest,
    sessionDir,
    sessionFiles,
    extraEntries: extras,
  });

  return {
    zipPath: outputPath,
    entries,
    sessionDir,
    manifest,
  };
}

function defaultExportZipName(sessionId: string, now: Date): string {
  const shortId = sessionId.slice(0, 8);
  const timestamp = now.toISOString().replaceAll(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
  return `pythinker-debug-${shortId}-${timestamp}.zip`;
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

async function validateSessionState(sessionDir: string, sessionId: string): Promise<void> {
  try {
    parseSessionMetadata(JSON.parse(await readFile(resolve(sessionDir, 'state.json'), 'utf-8')));
  } catch (error) {
    if (error instanceof PythinkerError && error.code === ErrorCodes.SESSION_STATE_INVALID) {
      throw error;
    }
    throw new PythinkerError(
      ErrorCodes.SESSION_STATE_INVALID,
      `Session "${sessionId}" state.json is invalid`,
      { cause: error },
    );
  }
}
