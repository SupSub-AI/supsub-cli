// 测试用的假 JWT 生成器：只要 payload 能被 base64url 解出来即可，
// 签名段是占位字符串（src/lib/jwt.ts 本来就不验签）。
function b64url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 造一个 payload 为 `payload` 的假 JWT。 */
export function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  return `${header}.${b64url(JSON.stringify(payload))}.sig-not-verified`;
}

/** 造一个「还有 `seconds` 秒到期」的假 access_token。传负数即已过期。 */
export function makeJwtExpiringIn(seconds: number, id = 1): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({ id, client: 'cli', iat: now, exp: now + seconds });
}
