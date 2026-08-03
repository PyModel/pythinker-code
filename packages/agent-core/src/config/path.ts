import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'pathe';

export function resolvePythinkerHome(homeDir?: string | undefined): string {
  return homeDir ?? process.env['PYTHINKER_CODE_HOME'] ?? join(homedir(), '.pythinker-code');
}

export function resolveConfigPath(input: {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}): string {
  return input.configPath ?? join(resolvePythinkerHome(input.homeDir), 'config.toml');
}

export function ensurePythinkerHome(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
}
