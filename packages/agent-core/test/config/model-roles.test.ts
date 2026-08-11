import { describe, expect, it } from 'vitest';

import { expandModelRef, resolveModelRoleAlias } from '../../src/config';

describe('model roles', () => {
  it('resolves assigned roles and treats empty assignments as cleared', () => {
    const config = {
      modelRoles: {
        small: 'haiku-4-5',
        empty: '',
        whitespace: '   ',
      },
    };

    expect(resolveModelRoleAlias(config, 'small')).toBe('haiku-4-5');
    expect(resolveModelRoleAlias(config, 'missing')).toBeUndefined();
    expect(resolveModelRoleAlias(config, 'empty')).toBeUndefined();
    expect(resolveModelRoleAlias(config, 'whitespace')).toBeUndefined();
  });

  it('resolves the default role through defaultModel', () => {
    expect(resolveModelRoleAlias({ defaultModel: 'opus-5' }, 'default')).toBe('opus-5');
    expect(resolveModelRoleAlias(undefined, 'default')).toBeUndefined();
  });

  it('expands role references without recursion', () => {
    const config = {
      modelRoles: {
        small: 'haiku-4-5',
        nested: '@small',
      },
      defaultModel: 'opus-5',
    };

    expect(expandModelRef(config, '@small')).toBe('haiku-4-5');
    expect(expandModelRef(config, '@nested')).toBe('@small');
    expect(expandModelRef(config, '@default')).toBe('opus-5');
    expect(expandModelRef(config, '@unassigned')).toBeUndefined();
  });

  it('passes non-role aliases through unchanged, including without config', () => {
    expect(expandModelRef(undefined, 'gpt-5-codex')).toBe('gpt-5-codex');
    expect(expandModelRef(undefined, '@small')).toBeUndefined();
  });
});
