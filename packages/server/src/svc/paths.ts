

import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolvePythinkerHome } from '@pythoughts/agent-core';


export const PYTHINKER_SERVER_LABEL = 'ai.pythoughts.pythinker-server';


export const PYTHINKER_SERVER_PLIST_FILENAME = `${PYTHINKER_SERVER_LABEL}.plist`;


export const PYTHINKER_SERVER_SYSTEMD_UNIT = 'pythinker-server.service';


export const PYTHINKER_SERVER_TASK_NAME = 'PythinkerServer';


export function launchAgentPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', PYTHINKER_SERVER_PLIST_FILENAME);
}


export function systemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', PYTHINKER_SERVER_SYSTEMD_UNIT);
}


export function supervisorLogPath(): string {
  return join(resolvePythinkerHome(), 'server', 'server.log');
}


export function installPlanPath(): string {
  return join(resolvePythinkerHome(), 'server', 'install.json');
}


export function guiDomain(uid: number = process.getuid?.() ?? 0): string {
  return `gui/${uid}`;
}
