// packages/cli/src/api/group.ts
import { request } from '../http/client.ts';
import type { Group, GroupCreateResult, GroupMember, GroupSubscription } from '../lib/types.ts';

/** GET /api/groups — 分组列表 */
export async function listGroups(): Promise<Group[]> {
  return request<Group[]>({
    method: 'GET',
    path: '/api/groups',
  });
}

/** POST /api/groups — 创建分组（201 返回 {id}） */
export async function createGroup(body: { name: string }): Promise<GroupCreateResult> {
  return request<GroupCreateResult>({
    method: 'POST',
    path: '/api/groups',
    body,
  });
}

/** PUT /api/groups/{id} — 重命名分组（204 无 body） */
export async function renameGroup(params: { groupId: string; name: string }): Promise<void> {
  await request<undefined>({
    method: 'PUT',
    path: `/api/groups/${params.groupId}`,
    body: { name: params.name },
  });
}

/** DELETE /api/groups/{id} — 删除分组（破坏性，不可逆；204 无 body） */
export async function deleteGroup(params: { groupId: string }): Promise<void> {
  await request<undefined>({
    method: 'DELETE',
    path: `/api/groups/${params.groupId}`,
  });
}

/**
 * GET /api/groups/{id}/subscriptions — 分组订阅源列表。
 * groupOnly=true 只返回组内成员（含 unreadCount）；false 返回全部订阅源（含 inGroup）。
 * 分组不存在时后端返回 404 {code:"NotFound"}（2026-07 实测确认，非空数组）。
 */
export async function listGroupSubs(params: {
  groupId: string;
  groupOnly: boolean;
  sourceType?: string;
}): Promise<GroupSubscription[]> {
  return request<GroupSubscription[]>({
    method: 'GET',
    path: `/api/groups/${params.groupId}/subscriptions`,
    query: {
      groupOnly: params.groupOnly,
      sourceType: params.sourceType,
    },
  });
}

/**
 * POST /api/groups/{id}/subscriptions — 编辑分组成员（body 为整份成员数组，
 * 全量覆盖写入，无原子的单个移入/移出端点；204 无 body）。
 */
export async function setGroupSubs(params: {
  groupId: string;
  members: GroupMember[];
}): Promise<void> {
  await request<undefined>({
    method: 'POST',
    path: `/api/groups/${params.groupId}/subscriptions`,
    body: params.members,
  });
}
