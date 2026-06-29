// packages/cli/src/api/subscription.ts
import { request } from '../http/client.ts';
import type { Article, Subscription } from '../lib/types.ts';

export type SourceType = 'MP' | 'WEBSITE' | 'X';

/** GET /api/subscriptions — 列出订阅源 */
export async function listSubs(params: { sourceType?: SourceType } = {}): Promise<Subscription[]> {
  return request<Subscription[]>({
    method: 'GET',
    path: '/api/subscriptions',
    query: { sourceType: params.sourceType },
  });
}

/** POST /api/subscriptions — 添加订阅 */
export async function addSub(body: {
  sourceType: SourceType;
  sourceId: number;
  groupIds?: number[];
}): Promise<{ message: string }> {
  return request<{ message: string }>({
    method: 'POST',
    path: '/api/subscriptions',
    body,
  });
}

/** DELETE /api/subscriptions — 取消订阅 */
export async function removeSub(body: {
  sourceType: SourceType;
  sourceId: number;
}): Promise<{ message: string }> {
  return request<{ message: string }>({
    method: 'DELETE',
    path: '/api/subscriptions',
    body,
  });
}

/** GET /api/subscriptions/contents — 查看订阅源内容 */
export async function getContents(params: {
  sourceType: SourceType;
  sourceId: number;
  type: 'all' | 'unread';
}): Promise<Article[]> {
  return request<Article[]>({
    method: 'GET',
    path: '/api/subscriptions/contents',
    query: {
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      type: params.type,
      page: 1,
      pageSize: 20,
    },
  });
}

/** POST /api/subscriptions/contents/mark-as-read — 标记已读 */
export async function markAsRead(body: {
  sourceType: SourceType;
  sourceId: number;
  contentId?: string;
}): Promise<void> {
  await request<undefined>({
    method: 'POST',
    path: '/api/subscriptions/contents/mark-as-read',
    body,
  });
}
