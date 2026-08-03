import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import * as paths from '../src/paths.js';

describe('paths', () => {
  it('sourceCredentialsDir joins ~/.pythinker/credentials', () => {
    expect(paths.sourceCredentialsDir('/x/.pythinker')).toBe(join('/x/.pythinker', 'credentials'));
  });

  it('targetConfigFile and targetTuiFile', () => {
    expect(paths.targetConfigFile('/y')).toBe(join('/y', 'config.toml'));
    expect(paths.targetTuiFile('/y')).toBe(join('/y', 'tui.toml'));
  });

  it('targetSessionIndex', () => {
    expect(paths.targetSessionIndex('/y')).toBe(join('/y', 'session_index.jsonl'));
  });

  it('migratedMarker is under source', () => {
    expect(paths.migratedMarker('/x/.pythinker')).toBe(join('/x/.pythinker', '.migrated-to-pythinker-code'));
  });

  it('skipMarker is under target', () => {
    expect(paths.skipMarker('/y/.pythinker-code')).toBe(join('/y/.pythinker-code', '.skip-migration-from-pythinker-cli'));
  });

  it('migrationReportFile is under target', () => {
    expect(paths.migrationReportFile('/y')).toBe(join('/y', 'migration-report.json'));
  });

  it('sourceSessionsDir / sourceUserHistoryDir / sourcePythinkerJson', () => {
    expect(paths.sourceSessionsDir('/x')).toBe(join('/x', 'sessions'));
    expect(paths.sourceUserHistoryDir('/x')).toBe(join('/x', 'user-history'));
    expect(paths.sourcePythinkerJson('/x')).toBe(join('/x', 'pythinker.json'));
  });
});
