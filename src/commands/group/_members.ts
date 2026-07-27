// packages/cli/src/commands/group/_members.ts
// add-sub / remove-sub 共享的「读-改-写」辅助。
//
// 后端没有原子的单个移入/移出端点，只有 POST 全量覆盖成员数组。
// 注意并发风险：GET 与 POST 之间若网页端/另一 CLI 修改了同组成员，
// 本次 POST 会以 last-write-wins 覆盖对方改动（后端无版本号可防护），
// 请勿并发编辑同一分组。
import { listGroupSubs } from '../../api/group.ts';
import type { GroupMember } from '../../lib/types.ts';

/**
 * 读取组内现有成员，映射为写入形态（只挑 sourceType/sourceId 两个字段）。
 * sourceType 原样透传（不大写化、不过白名单）：组内可能有网页端加入的
 * PODCAST / NEWSLETTER 成员，回写时必须原样保留。
 * 分组不存在时后端返回 404（2026-07 实测确认），错误原样抛出。
 */
export async function readMembers(groupId: string): Promise<GroupMember[]> {
  const subs = await listGroupSubs({ groupId, groupOnly: true });
  return subs.map((s) => ({ sourceType: s.sourceType, sourceId: s.sourceId }));
}

/** 成员相等判定：sourceId 全等 && sourceType 大小写不敏感相等 */
export function memberEquals(a: GroupMember, b: GroupMember): boolean {
  return a.sourceId === b.sourceId && a.sourceType.toUpperCase() === b.sourceType.toUpperCase();
}

/** 按 sourceType+sourceId 去重（防脏数据在全量覆盖时越写越多） */
export function dedupeMembers(members: GroupMember[]): GroupMember[] {
  const result: GroupMember[] = [];
  for (const m of members) {
    if (!result.some((r) => memberEquals(r, m))) result.push(m);
  }
  return result;
}
