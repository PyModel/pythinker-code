import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

import { getBinDir } from '#/utils/paths';
import { resolveCommandPath } from '#/utils/process/resolve-command';

const CANDIDATES = ['fd', 'fdfind'];

export function detectFdPath(): string | null {
  const managed = getManagedFdPath();
  if (managed !== null) return managed;
  return detectSystemFdPath();
}

export async function ensureFdPath(): Promise<string | null> {
  return detectFdPath();
}

function detectSystemFdPath(): string | null {
  for (const name of CANDIDATES) {
    const commandPath = resolveCommandPath(name);
    if (commandPath === undefined) continue;
    try {
      const result = spawnSync(commandPath, ['--version'], { stdio: 'ignore' });
      if (result.status === 0) return commandPath;
    } catch {
      // ENOENT, EACCES, etc. — try next candidate.
    }
  }
  return null;
}

function getManagedFdPath(): string | null {
  const binaryPath = join(getBinDir(), platform() === 'win32' ? 'fd.exe' : 'fd');
  if (!existsSync(binaryPath)) return null;
  try {
    const result = spawnSync(binaryPath, ['--version'], { stdio: 'ignore' });
    return result.status === 0 ? binaryPath : null;
  } catch {
    return null;
  }
}
