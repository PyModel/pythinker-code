import { describe, expect, it } from 'vitest';

import { workspaceRootKey } from '../../src/session/store';
import { findRegisteredIdByRootKey } from '../../src/services/workspace/workspaceRegistryService';

const entry = (root: string) => ({
  root,
  name: 'example',
  created_at: '2026-01-01T00:00:00.000Z',
  last_opened_at: '2026-01-01T00:00:00.000Z',
});

describe('workspace root identity', () => {
  it('folds Windows drive, slash, case, and trailing-separator variants', () => {
    expect(workspaceRootKey('C:\\Users\\Dev\\Project\\')).toBe('c:/users/dev/project');
    expect(workspaceRootKey('c:/users/dev/project')).toBe('c:/users/dev/project');
    expect(workspaceRootKey('C:\\')).toBe('c:');
    expect(workspaceRootKey('C:\\')).toBe(workspaceRootKey('c:/'));
  });

  it('folds UNC paths but keeps POSIX paths case-sensitive', () => {
    expect(workspaceRootKey('\\\\HOST\\Share\\Dir')).toBe('//host/share/dir');
    expect(workspaceRootKey('/home/Foo')).not.toBe(workspaceRootKey('/home/foo'));
  });

  it('reuses an existing Windows-spelling variant and honors the preferred id', () => {
    const workspaces = {
      wd_legacy_deadbeef0000: entry('C:\\Users\\Dev\\Project'),
      wd_canonical_0123456789ab: entry('c:\\users\\dev\\project'),
    };
    expect(
      findRegisteredIdByRootKey(
        workspaces,
        workspaceRootKey('C:/Users/Dev/Project'),
        'wd_canonical_0123456789ab',
      ),
    ).toBe('wd_canonical_0123456789ab');
  });
});
