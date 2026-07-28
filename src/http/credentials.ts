// packages/cli/src/http/credentials.ts
import { readConfig } from '../config/store.ts';

export type CredentialSource = 'config' | 'session';

type ResolvedCredentials = {
  key?: string;
  clientId?: string;
  /**
   * 与当前 key 配套的刷新令牌，**仅当 key 取自 config 的 access_token 时才有值**。
   * bearer_token 是手动粘贴的临时凭证，没有续期通道，也不该被自动续期，
   * 所以这里为 undefined —— http/token-refresh.ts 以此判断「能不能续期」。
   */
  refreshToken?: string;
  /**
   * 当前 key 的来源：
   * - config  → `~/.supsub/config.json` 中的 `access_token`（设备授权登录写入）
   * - session → `~/.supsub/config.json` 中的 `bearer_token`（手动从浏览器粘贴）
   * - 未登录态时为 undefined
   */
  source?: CredentialSource;
};

/**
 * 解析访问凭证，优先级（从高到低）：
 * 1. ~/.supsub/config.json 的 access_token（设备授权访问令牌）
 * 2. ~/.supsub/config.json 的 bearer_token（临时浏览器会话 token）
 *
 * 登录唯一入口是 `supsub auth login`（OAuth 设备授权），没有 API Key 通道。
 */
export async function resolveApiKey(): Promise<ResolvedCredentials> {
  const cfg = await readConfig();
  if (cfg.access_token) {
    return {
      key: cfg.access_token,
      clientId: cfg.client_id ?? 'supsub-cli',
      source: 'config',
      refreshToken: cfg.refresh_token,
    };
  }
  if (cfg.bearer_token) {
    return {
      key: cfg.bearer_token,
      clientId: cfg.client_id ?? 'supsub-cli',
      source: 'session',
    };
  }
  return { clientId: cfg.client_id ?? 'supsub-cli' };
}
