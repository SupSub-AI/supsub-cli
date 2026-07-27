// packages/cli/src/api/focus.ts
import { request } from '../http/client.ts';
import type { Focus, FocusContent } from '../lib/types.ts';

/** GET /api/focuses — 关注点列表 */
export async function listFocuses(): Promise<Focus[]> {
  return request<Focus[]>({
    method: 'GET',
    path: '/api/focuses',
  });
}

/** GET /api/focuses/{focusId}/contents — 关注点内容列表 */
export async function getFocusContents(params: {
  focusId: number;
  type: 'all' | 'unread';
  page?: number;
  pageSize?: number;
}): Promise<FocusContent[]> {
  return request<FocusContent[]>({
    method: 'GET',
    path: `/api/focuses/${params.focusId}/contents`,
    query: {
      type: params.type,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    },
  });
}

/**
 * POST /api/focuses/{focusId}/mark-as-read — 整个关注点标记已读（body 为 `{}`）。
 *
 * 后端也接受 contentId + sourceType 只标单篇，但 CLI 不暴露：文章没有「详情 / 阅读」这一步，
 * 产生不了自然的单篇已读事件，只保留用户明确表达的整点已读。无 mark-as-unread，不可逆。
 */
export async function markFocusAsRead(params: { focusId: number }): Promise<void> {
  await request<undefined>({
    method: 'POST',
    path: `/api/focuses/${params.focusId}/mark-as-read`,
    body: {},
  });
}

/**
 * DELETE /api/focuses/{focusId} — 删除关注点（破坏性，不可逆）
 *
 * 注意：后端成功响应形态在文档里自相矛盾（标注 204 又带 {message}）。
 * 实测无法在不删真实数据的前提下确认，故这里容错两种形态：
 *   - 204 No Content（request() 返回 undefined）
 *   - 2xx + { message }
 * 调用方需按 `result?.message` 取值。
 */
export async function removeFocus(params: {
  focusId: number;
}): Promise<{ message?: string } | undefined> {
  return request<{ message?: string } | undefined>({
    method: 'DELETE',
    path: `/api/focuses/${params.focusId}`,
  });
}
