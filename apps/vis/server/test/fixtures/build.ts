import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Copy a fixture session into a temporary PYTHINKER_CODE_HOME. */
export async function buildSessionFixture(name: string): Promise<{
  home: string;
  sessionDir: string;
  cleanup: () => Promise<void>;
}> {
  const src = new URL(`./sessions/${name}`, import.meta.url).pathname;
  const home = await mkdtemp(join(tmpdir(), 'vis-fixture-'));
  const sessionsDir = join(home, 'sessions', 'wd_test_000000000000');
  const sessionDir = join(sessionsDir, 'session_fixture');
  await mkdir(sessionsDir, { recursive: true });
  await cp(src, sessionDir, { recursive: true });

  // Write session_index.jsonl.
  await writeFile(
    join(home, 'session_index.jsonl'),
    JSON.stringify({
      sessionId: 'session_fixture',
      sessionDir,
      workDir: '/tmp/work',
    }) + '\n',
  );

  return {
    home,
    sessionDir,
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}
