import { describe, expect, it } from 'vitest';

import { parseManagedUserInfoPayload } from '../src/managed-userinfo';

describe('parseManagedUserInfoPayload goods_version', () => {
  it('keeps goods_version only when it is a non-empty string', () => {
    expect(
      parseManagedUserInfoPayload({ user_id: 'u_1', goods_version: '2' })?.goodsVersion,
    ).toBe('2');
    expect(
      parseManagedUserInfoPayload({ user_id: 'u_1', goods_version: '' })?.goodsVersion,
    ).toBeUndefined();
    expect(
      parseManagedUserInfoPayload({ user_id: 'u_1', goods_version: 2 })?.goodsVersion,
    ).toBeUndefined();
  });
});
