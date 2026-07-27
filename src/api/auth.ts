// packages/cli/src/api/auth.ts
import { request } from '../http/client.ts';
import { getApiUrl } from '../lib/api-url.ts';
import type { ErrorEnvelope } from '../lib/errors.ts';
import type { UserInfo } from '../lib/types.ts';

/** GET /api/user/info — 获取当前登录用户信息 */
export async function getUserInfo(): Promise<UserInfo> {
  return request<UserInfo>({
    method: 'GET',
    path: '/api/user/info',
  });
}

// ─── 设备授权（Device Flow）相关 ──────────────────────────────
// 这两个端点不走统一 request()：它们处于"未登录"态，不应触发
// 401 → clearAuth 的统一行为；其响应错误体也非标准 ErrorEnvelope。
// 所以保留独立 fetch 实现，但集中存放在 api 层以保持工程一致性。

/** POST /api/auth/device/code 的成功响应 */
export type DeviceCodeResponse = {
  /** 设备码：CLI 轮询用的密钥 */
  deviceCode: string;
  /** 短码：展示给用户、网页输入用 */
  userCode: string;
  /** 授权页地址（不带码） */
  verificationUri: string;
  /** 授权页地址（带码，可直接打开） */
  verificationUriComplete: string;
  /** 建议轮询间隔（秒） */
  interval: number;
  /** 设备码有效期（秒） */
  expiresIn: number;
};

/** 设备 token 轮询的三种状态 */
export type DeviceTokenStatus = 'pending' | 'authorized' | 'expired';

/**
 * POST /api/auth/device/token 的成功响应（状态轮询）
 * - pending    → 继续轮询
 * - authorized → 授权成功，携带 accessToken / refreshToken
 * - expired    → 设备码过期，停止轮询
 */
export type DeviceTokenResult = {
  status: DeviceTokenStatus;
  accessToken?: string;
  refreshToken?: string;
};

/** POST /api/auth/device/code — 申请设备码（免鉴权，无 body） */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    throw {
      code: 'SERVER_ERROR',
      message: '无法获取设备码，请稍后重试',
      status: res.status,
    } satisfies ErrorEnvelope;
  }
  return (await res.json()) as DeviceCodeResponse;
}

/**
 * POST /api/auth/device/token — 轮询授权状态（免鉴权）
 *
 * - 网络异常 / 非 2xx → 抛出（调用方一般 catch 后继续重试）
 * - 200               → { status, accessToken?, refreshToken? }
 *
 * 字段名容错：schema 用 camelCase（accessToken/refreshToken），但
 * 后端 example 出现过 snake_case（access_token/refresh_token），两者都兼容。
 */
export async function pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/auth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  if (!res.ok) {
    // 非 2xx：当作瞬时错误抛出，由调用方决定是否继续轮询
    throw {
      code: 'SERVER_ERROR',
      message: '轮询授权状态失败',
      status: res.status,
    } satisfies ErrorEnvelope;
  }
  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = (body.accessToken ?? body.access_token) as string | undefined;
  const refreshToken = (body.refreshToken ?? body.refresh_token) as string | undefined;
  return {
    status: body.status as DeviceTokenStatus,
    accessToken,
    refreshToken,
  };
}

// ─── 令牌续期（Refresh Token）────────────────────────────────
// access_token 有效期约 24h、refresh_token 约 14d（实测 JWT exp）。
// 续期端点同样不走统一 request()，理由见下方函数注释。

/** POST /api/auth/tokens 的成功响应：一对新令牌 */
export type RefreshTokenResult = {
  accessToken: string;
  refreshToken: string;
};

/**
 * POST /api/auth/tokens — 用 refreshToken 换一对新令牌（免鉴权头，凭 body 里的 refreshToken）
 *
 * 同样不走统一 request()，原因有二：
 * 1. 它本身就是「请求收到 401」的补救手段，走 request() 会递归触发「401 → 续期」；
 * 2. 必须把「refreshToken 已失效」和「网络/服务端抖动」区分开——前者要求用户重新
 *    登录，后者只是稍后重试，绝不能因为一次网络闪断就把用户登出。
 *
 * 抛错约定（由 http/token-refresh.ts 判定）：
 * - 400 / 401  → `INVALID_REFRESH_TOKEN`，令牌已失效，不可重试
 * - 其余非 2xx → `SERVER_ERROR`，可重试
 * - fetch 抛错 → `NETWORK_ERROR`，可重试
 *
 * 实测（https://supsub.net，2026-07）：
 * - 成功时返回 **201**（api.json 标的是 200），所以这里用 `res.ok` 判成功，别写死 200；
 * - refreshToken 非法 → 401 `{"code":"Unauthorized","message":"无效的令牌","status":401}`；
 * - refreshToken 长度不足 41 字符 → 400 Validation error；
 * - 换新令牌后**旧 refreshToken 在有效期内仍然可用**（服务端不作废旧的）。
 *
 * 字段名容错：与 device/token 一致，camelCase / snake_case 都接受。
 * 响应若没带回新的 refreshToken，沿用传入的那个。
 */
export async function refreshTokens(refreshToken: string): Promise<RefreshTokenResult> {
  const apiUrl = getApiUrl();

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    throw {
      code: 'NETWORK_ERROR',
      message: '网络异常，令牌续期失败',
      status: 0,
      data: String(err),
    } satisfies ErrorEnvelope;
  }

  if (res.status === 400 || res.status === 401) {
    throw {
      code: 'INVALID_REFRESH_TOKEN',
      message: '登录已过期，请重新运行 supsub auth login',
      status: res.status,
    } satisfies ErrorEnvelope;
  }
  if (!res.ok) {
    throw {
      code: 'SERVER_ERROR',
      message: '令牌续期失败，请稍后重试',
      status: res.status,
    } satisfies ErrorEnvelope;
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = (body.accessToken ?? body.access_token) as string | undefined;
  const nextRefreshToken = (body.refreshToken ?? body.refresh_token) as string | undefined;
  if (!accessToken) {
    throw {
      code: 'SERVER_ERROR',
      message: '令牌续期响应缺少 accessToken',
      status: res.status,
    } satisfies ErrorEnvelope;
  }
  return { accessToken, refreshToken: nextRefreshToken ?? refreshToken };
}
