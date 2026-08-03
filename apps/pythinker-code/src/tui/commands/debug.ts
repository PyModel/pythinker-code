import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  enableDiagnosticDebugLogging,
  flushDiagnosticLogs,
  resolveGlobalLogPath,
} from '@pythoughts/pythinker-code-sdk';

import { LLM_NOT_SET_MESSAGE } from '../constant/pythinker-tui';
import type { SlashCommandHost } from './dispatch';

const DEBUG_LINES = 20;
const TAIL_BYTES = 64 * 1024;

export async function handleDebugCommand(
  host: SlashCommandHost,
  issueDescription: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined || host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const previousLevel = await enableDiagnosticDebugLogging();
  await flushDiagnosticLogs();
  const sessionDir = session.summary?.sessionDir;
  const logPath =
    previousLevel === 'off' || sessionDir === undefined
      ? resolveGlobalLogPath(host.harness.homeDir)
      : join(sessionDir, 'logs', 'pythinker-code.log');
  const logInfo = await readLogTail(logPath);
  const issue = issueDescription.trim() || 'No specific issue was provided.';
  const loggingStatus =
    previousLevel === 'debug'
      ? ''
      : previousLevel === undefined
        ? 'Diagnostic logging is not configured in this runtime.'
        : `Debug logging is now enabled. Earlier activity was recorded at the ${previousLevel} level.`;

  host.sendNormalUserInput(`# Debug the current Pythinker session

Review the issue and the bounded diagnostic-log tail below. Search the full log for related ERROR and WARN entries, stack traces, and repeated failure patterns when needed. Explain the likely cause in plain language and suggest concrete fixes or next steps.

${loggingStatus}

Log path: \`${logPath}\`
${logInfo}

Issue: ${issue}`);
}

async function readLogTail(logPath: string): Promise<string> {
  try {
    const stats = await stat(logPath);
    const readSize = Math.min(stats.size, TAIL_BYTES);
    const file = await open(logPath, 'r');
    try {
      const buffer = Buffer.alloc(readSize);
      const { bytesRead } = await file.read(buffer, 0, readSize, stats.size - readSize);
      const tail = buffer
        .toString('utf8', 0, bytesRead)
        .split('\n')
        .slice(-DEBUG_LINES)
        .join('\n');
      return `\nLog size: ${String(stats.size)} bytes\n\nLast ${String(DEBUG_LINES)} lines:\n\`\`\`\n${tail}\n\`\`\``;
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '\nNo diagnostic log exists yet. Reproduce the issue, then run `/debug` again.';
    }
    const message = error instanceof Error ? error.message : String(error);
    return `\nFailed to read the diagnostic log: ${message}`;
  }
}
