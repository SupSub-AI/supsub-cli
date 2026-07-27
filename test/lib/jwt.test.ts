// src/lib/jwt.ts：本地解析 access_token 的过期时间（不验签）
//
// 这层的判定只用来决定「要不要提前续期」，所以对垃圾输入必须宽容：
// 解析不出来一律当作「不知道何时过期」，交给 401 兜底。
import { describe, expect, test } from 'bun:test';
import { getTokenExpiryMs, isTokenExpiringSoon } from '../../src/lib/jwt.ts';
import { makeJwt, makeJwtExpiringIn } from '../_helpers/jwt.ts';

describe('lib/jwt - getTokenExpiryMs', () => {
  test('从合法 JWT 解出 exp（秒 → 毫秒）', () => {
    const token = makeJwt({ id: 101, exp: 1_800_000_000 });
    expect(getTokenExpiryMs(token)).toBe(1_800_000_000_000);
  });

  test('段数不足三段时返回 undefined', () => {
    expect(getTokenExpiryMs('not-a-jwt')).toBeUndefined();
    expect(getTokenExpiryMs('only.two')).toBeUndefined();
  });

  test('payload 不是合法 base64/JSON 时返回 undefined', () => {
    expect(getTokenExpiryMs('aaa.!!!not-base64!!!.bbb')).toBeUndefined();
  });

  test('payload 里没有 exp 或 exp 非数字时返回 undefined', () => {
    expect(getTokenExpiryMs(makeJwt({ id: 1 }))).toBeUndefined();
    expect(getTokenExpiryMs(makeJwt({ exp: 'soon' }))).toBeUndefined();
  });

  test('api_key 这类非 JWT 凭证返回 undefined', () => {
    expect(getTokenExpiryMs('sk_live_abcdefg')).toBeUndefined();
  });
});

describe('lib/jwt - isTokenExpiringSoon', () => {
  test('已过期 → true', () => {
    expect(isTokenExpiringSoon(makeJwtExpiringIn(-10))).toBe(true);
  });

  test('剩余时间小于默认 60s 容差 → true', () => {
    expect(isTokenExpiringSoon(makeJwtExpiringIn(30))).toBe(true);
  });

  test('剩余时间充裕 → false', () => {
    expect(isTokenExpiringSoon(makeJwtExpiringIn(3600))).toBe(false);
  });

  test('容差可调：把 skew 调大后同一 token 变成「快过期」', () => {
    const token = makeJwtExpiringIn(300);
    expect(isTokenExpiringSoon(token)).toBe(false);
    expect(isTokenExpiringSoon(token, 600_000)).toBe(true);
  });

  test('解析不出 exp 时返回 false（宁可发出去被 401 兜底，也不乱续期）', () => {
    expect(isTokenExpiringSoon('sk_live_abcdefg')).toBe(false);
  });
});
