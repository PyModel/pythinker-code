import { describe, expect, it } from 'vitest';

import { workspaceRootKey } from '../src/lib/rootKey';

describe('workspaceRootKey', () => {
  it('folds Windows drive and UNC spelling variants', () => {
    expect(workspaceRootKey('C:\\Users\\Foo\\')).toBe('c:/users/foo');
    expect(workspaceRootKey('c:/users/foo')).toBe('c:/users/foo');
    expect(workspaceRootKey('\\\\HOST\\Share\\Dir')).toBe('//host/share/dir');
    expect(workspaceRootKey('C:\\')).toBe('c:');
    expect(workspaceRootKey('C:\\')).toBe(workspaceRootKey('c:/'));
  });

  it('keeps POSIX paths case-sensitive', () => {
    expect(workspaceRootKey('/home/Foo/')).toBe('/home/Foo');
    expect(workspaceRootKey('/home/Foo')).not.toBe(workspaceRootKey('/home/foo'));
  });
});
