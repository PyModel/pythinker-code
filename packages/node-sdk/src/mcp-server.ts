import {
  enableDiagnosticDebugLogging,
  startAgentToolMcpServer,
} from '@pythoughts/agent-core';

import { SDKRpcClient } from '#/sdk-rpc-client';
import type { PythinkerHarnessOptions } from '#/types';

export interface PythinkerMcpServerOptions extends PythinkerHarnessOptions {
  readonly workDir: string;
  readonly version: string;
  readonly debug?: boolean;
  readonly verbose?: boolean;
}

export async function runPythinkerMcpServer(
  options: PythinkerMcpServerOptions,
): Promise<void> {
  if (options.debug === true || options.verbose === true) await enableDiagnosticDebugLogging();
  const rpc = new SDKRpcClient({
    identity: options.identity,
    homeDir: options.homeDir,
    configPath: options.configPath,
    skillDirs: options.skillDirs,
    telemetry: options.telemetry,
    onOAuthRefresh: options.onOAuthRefresh,
  });
  const summary = await rpc.createSession({
    workDir: options.workDir,
    permission: 'manual',
  });
  const session = rpc.core.sessions.get(summary.id);
  const agent = session?.getReadyAgent('main');
  if (session === undefined || agent === undefined) {
    await rpc.close();
    throw new Error('MCP tool server failed to initialize its agent session');
  }

  const close = async (): Promise<void> => {
    await rpc.core.closeSession({ sessionId: summary.id });
    await rpc.close();
  };
  try {
    await startAgentToolMcpServer(agent, {
      version: options.version,
      onClose: () => {
        void close();
      },
    });
  } catch (error) {
    await close();
    throw error;
  }
}
