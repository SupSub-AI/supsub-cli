// packages/cli/src/api/deep-read.ts
// 精读（deep read）相关接口。
//
// 实测要点（2026-07-27，https://supsub.net）：
// - POST /api/deep-reads 返回 **202 + 纯文本 "Accepted"**（api.json 写的是 201），
//   无 taskId，后续只能按 {sourceType, contentId} 查状态。
// - 对已 done 的内容重复 POST 不会重复扣额度（used 不变），后端自己做了幂等。
//   即便如此，CLI 侧仍先 GET 预检一次：命中缓存/已完成时能立刻返回结果，省一趟等待。
// - 精读耗时实测 21s / 32s（普通杂谈 / 技术长文），远短于 agent 侧 Bash 的默认超时。

import { request } from '../http/client.ts';
import type { DeepReadQuota, DeepReadResponse, SharedDeepRead } from '../lib/types.ts';

export type DeepReadRef = {
  sourceType: string;
  contentId: string;
};

/** POST /api/deep-reads — 发起精读（异步，202 Accepted，无返回体） */
export async function requestDeepRead(ref: DeepReadRef): Promise<void> {
  await request<unknown>({
    method: 'POST',
    path: '/api/deep-reads',
    body: { sourceType: ref.sourceType, contentId: ref.contentId },
  });
}

/** GET /api/deep-reads — 查询精读状态 / 结果 */
export async function getDeepRead(ref: DeepReadRef): Promise<DeepReadResponse> {
  return request<DeepReadResponse>({
    method: 'GET',
    path: '/api/deep-reads',
    query: { sourceType: ref.sourceType, contentId: ref.contentId },
  });
}

/** GET /api/deep-reads/quota — 查询本月精读额度 */
export async function getDeepReadQuota(): Promise<DeepReadQuota> {
  return request<DeepReadQuota>({
    method: 'GET',
    path: '/api/deep-reads/quota',
  });
}

/**
 * POST /api/deep-reads/share — 生成分享码。
 *
 * ⚠️ 生成的链接是**公开可访问**的（GET /api/deep-reads/shared 不校验 Authorization），
 * 且当前 API 没有撤销接口。调用前必须由 skill 层向用户二次确认。
 */
export async function shareDeepRead(ref: DeepReadRef): Promise<{ shareCode: string }> {
  return request<{ shareCode: string }>({
    method: 'POST',
    path: '/api/deep-reads/share',
    body: { sourceType: ref.sourceType, contentId: ref.contentId },
  });
}

/** GET /api/deep-reads/shared?code= — 读取他人分享的精读（无需登录） */
export async function getSharedDeepRead(code: string): Promise<SharedDeepRead> {
  return request<SharedDeepRead>({
    method: 'GET',
    path: '/api/deep-reads/shared',
    query: { code },
  });
}
