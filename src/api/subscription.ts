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
  page?: number;
  pageSize?: number;
}): Promise<Article[]> {
  return request<Article[]>({
    method: 'GET',
    path: '/api/subscriptions/contents',
    query: {
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      type: params.type,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    },
  });
}

/**
 * POST /api/subscriptions/contents/mark-as-read — 整源标记已读。
 *
 * 后端也接受 contentId 只标单篇，但 CLI 不暴露：文章没有「详情 / 阅读」这一步，
 * 产生不了自然的单篇已读事件，只保留用户明确表达的整源已读。无 mark-as-unread，不可逆。
 */
export async function markAsRead(body: {
  sourceType: SourceType;
  sourceId: number;
}): Promise<void> {
  await request<undefined>({
    method: 'POST',
    path: '/api/subscriptions/contents/mark-as-read',
    body,
  });
}
