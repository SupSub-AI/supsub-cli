// packages/cli/src/http/client.ts
import { clearAuth } from '../config/store.ts';
import { getApiUrl } from '../lib/api-url.ts';
import type { ErrorEnvelope } from '../lib/errors.ts';
import { resolveApiKey } from './credentials.ts';
import { refreshAccessToken, refreshIfExpiringSoon } from './token-refresh.ts';

type RequestOpts = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

const UNAUTHORIZED: ErrorEnvelope = {
  code: 'UNAUTHORIZED',
  message: '请运行 supsub auth login 重新登录',
  status: 401,
};

/**
 * 统一 HTTP 请求客户端
 * - apiUrl / apiKey / clientId 等鉴权与基地址在内部解析
 *   （来源优先级：CLI flag > env > 配置文件），调用方无需透传
 * - 自动拼 query string（undefined 字段跳过）
 * - 自动注入 Authorization / X-Client-ID / Content-Type 头
 * - access_token 快过期 → 先续期再发；401 → 续期后重试一次
 * - 续期无望（refreshToken 失效 / 该来源不支持续期）→ clearAuth() + 抛 UNAUTHORIZED
 * - 4xx/5xx → 尝试解析 ErrorResponse，失败则包装
 * - fetch 抛错 → 包装为 NETWORK_ERROR
 */
export async function request<T>(opts: RequestOpts): Promise<T> {
  const { method, path, query, body } = opts;

  const apiUrl = getApiUrl();

  // 构建 URL + query string
  const url = new URL(path, apiUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  /**
   * 每次发送都重新解析凭证：续期后 config 里已经是新的 access_token，
   * 重试那一发必须带上新令牌，不能复用外层闭包里的旧值。
   */
  const send = async (): Promise<Response> => {
    const { key: apiKey, clientId } = await resolveApiKey();

    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-ID': clientId ?? 'supsub-cli',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
      return await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw {
        code: 'NETWORK_ERROR',
        message: '网络异常，请稍后重试',
        status: 0,
        data: String(err),
      } satisfies ErrorEnvelope;
    }
  };

  // 发送前主动续期：access_token 已过期 / 快过期时先换新的，省掉一趟注定 401 的往返。
  // 'unavailable' 不在这里报错——本地算出的过期时间可能因时钟偏差不准，老令牌
  // 说不定还能用，照常发出去，真不行再由下面的 401 分支收拾。
  if ((await refreshIfExpiringSoon()) === 'invalid') {
    await clearAuth();
    throw UNAUTHORIZED;
  }

  let response = await send();

  // 401：设备授权来源（config 里有 refresh_token）先尝试续期，成功则重试一次
  if (response.status === 401) {
    const outcome = await refreshAccessToken();
    if (outcome === 'refreshed') {
      response = await send();
    } else if (outcome === 'unavailable') {
      // 续期请求本身没跑成（网络 / 5xx）：本地凭证很可能还是好的，
      // 保留凭证并让用户稍后重试，别因为一次抖动把人登出。
      throw {
        code: 'NETWORK_ERROR',
        message: '令牌续期失败，请稍后重试',
        status: 0,
      } satisfies ErrorEnvelope;
    }
    // 'invalid'（refreshToken 也废了）/ 'skipped'（该来源没有续期通道）
    // → 落到下面的 clearAuth 分支
  }

  // 续期后仍是 401，或压根没得续 → 清凭证，要求重新登录
  if (response.status === 401) {
    await clearAuth();
    throw UNAUTHORIZED;
  }

  // 处理 2xx
  if (response.ok) {
    // 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  // 处理 4xx/5xx
  const text = await response.text().catch(() => '');
  let errEnvelope: ErrorEnvelope;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      errEnvelope = {
        code: parsed.code,
        message: parsed.message,
        status: response.status,
        data: parsed.data,
      };
    } else {
      errEnvelope = {
        code: 'SERVER_ERROR',
        message: text || response.statusText,
        status: response.status,
      };
    }
  } catch {
    errEnvelope = {
      code: 'SERVER_ERROR',
      message: text || response.statusText,
      status: response.status,
    };
  }
  throw errEnvelope;
}
