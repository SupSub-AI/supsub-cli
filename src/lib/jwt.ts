// packages/cli/src/lib/jwt.ts

/**
 * 解析 JWT payload 里的 `exp`（秒级 Unix 时间戳），返回毫秒时间戳。
 *
 * 只做 base64url 解码取字段，**不验签**——验签是服务端的事。CLI 这里只想知道
 * 「本地这张 access_token 大概什么时候过期」，好在过期前主动续期，
 * 省掉一趟注定 401 的请求。
 *
 * 任何不合法输入（段数不对 / 非 base64 / 无 exp 字段）一律返回 undefined，
 * 调用方按「无法判断过期时间」处理，不要抛错——凭证不一定是 JWT
 * （api_key、浏览器粘贴的 bearer_token 都可能不是）。
 */
export function getTokenExpiryMs(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const payload = parts[1];
  if (!payload) return undefined;

  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const parsed = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf-8')) as {
      exp?: unknown;
    };
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return undefined;
    return parsed.exp * 1000;
  } catch {
    return undefined;
  }
}

/**
 * 判断 token 是否已过期或即将过期（默认剩余不足 60 秒即算）。
 *
 * 解析不出 exp 时返回 false：宁可把请求发出去让 401 兜底，
 * 也不要凭猜测触发续期。
 */
export function isTokenExpiringSoon(token: string, skewMs = 60_000): boolean {
  const expMs = getTokenExpiryMs(token);
  if (expMs === undefined) return false;
  return Date.now() >= expMs - skewMs;
}

/**
 * 解析 JWT 里的用户标识，用于给本地缓存目录分账号。
 *
 * 依次尝试 `id`（SupSub access_token 实际用的字段，2026-07-27 实测 payload 形如
 * `{id, client, iat, exp}`）、`sub`、`userId`。解析不出返回 undefined，
 * 调用方回落到「按凭证哈希分目录」。
 *
 * 同样不验签——只是拿来当目录名，不做任何鉴权判断。
 */
export function getTokenSubject(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const payload = parts[1];
  if (!payload) return undefined;

  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const parsed = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf-8')) as Record<
      string,
      unknown
    >;
    for (const field of ['id', 'sub', 'userId'] as const) {
      const v = parsed[field];
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}
