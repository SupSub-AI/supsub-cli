// packages/cli/src/http/token-refresh.ts
import { refreshTokens } from '../api/auth.ts';
import { writeConfig } from '../config/store.ts';
import { isErrorEnvelope } from '../lib/errors.ts';
import { isTokenExpiringSoon } from '../lib/jwt.ts';
import { resolveApiKey } from './credentials.ts';

/**
 * 一次续期尝试的结果。四种取值对应四种截然不同的善后动作，
 * 调用方（http/client.ts）必须逐个处理，别合并：
 *
 * - `refreshed`   续期成功，新令牌已写回 config；重新 resolve 凭证后重试原请求
 * - `invalid`     refreshToken 已失效（400/401）；清除凭证，要求用户重新登录
 * - `unavailable` 网络 / 服务端抖动；本地令牌原样保留，**不要登出**，让用户稍后重试
 * - `skipped`     当前凭证来源不支持续期（bearer_token）
 */
export type RefreshOutcome = 'refreshed' | 'invalid' | 'unavailable' | 'skipped';

/**
 * 进行中的续期请求。并发请求同时撞上 401 时共享同一次续期，
 * 省掉重复的往返，也避免两次 writeConfig 相互覆盖。
 *
 * （实测 supsub.net：换新令牌后旧 refreshToken 在有效期内仍可用，
 * 所以并发换两次不会把人换登出——但仍然没必要多打一发。）
 */
let inflight: Promise<RefreshOutcome> | undefined;

/**
 * 用 config 里的 refresh_token 换一对新令牌并落盘。
 * 同一时刻只会有一次真实请求在飞，其余调用方共享同一个 Promise。
 */
export async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (inflight) return inflight;
  const task = doRefresh().finally(() => {
    inflight = undefined;
  });
  inflight = task;
  return task;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const { refreshToken } = await resolveApiKey();
  // 没有 refresh_token → 当前来源不具备续期能力（bearer_token）
  if (!refreshToken) return 'skipped';

  try {
    const next = await refreshTokens(refreshToken);
    await writeConfig({
      access_token: next.accessToken,
      refresh_token: next.refreshToken,
    });
    return 'refreshed';
  } catch (err) {
    if (isErrorEnvelope(err) && err.code === 'INVALID_REFRESH_TOKEN') {
      return 'invalid';
    }
    return 'unavailable';
  }
}

/**
 * 发请求前的主动续期：access_token 已过期或即将过期时先换新的，
 * 省掉一趟注定 401 的往返。
 *
 * 解析不出 exp（凭证不是 JWT）或来源不支持续期时直接 `skipped`，
 * 由 401 分支兜底。
 */
export async function refreshIfExpiringSoon(): Promise<RefreshOutcome> {
  const { key, refreshToken } = await resolveApiKey();
  if (!key || !refreshToken) return 'skipped';
  if (!isTokenExpiringSoon(key)) return 'skipped';
  return refreshAccessToken();
}

/**
 * 仅供测试：清掉进行中的续期 Promise，避免用例之间互相串味。
 */
export function __resetRefreshStateForTest(): void {
  inflight = undefined;
}
