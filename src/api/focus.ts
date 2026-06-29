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
}): Promise<FocusContent[]> {
  return request<FocusContent[]>({
    method: 'GET',
    path: `/api/focuses/${params.focusId}/contents`,
    query: {
      type: params.type,
      page: 1,
      pageSize: 20,
    },
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
