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

/** DELETE /api/focuses/{focusId} — 删除关注点（破坏性，不可逆） */
export async function removeFocus(params: { focusId: number }): Promise<{ message: string }> {
  return request<{ message: string }>({
    method: 'DELETE',
    path: `/api/focuses/${params.focusId}`,
  });
}
