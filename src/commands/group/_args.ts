// packages/cli/src/commands/group/_args.ts
import type { ErrorEnvelope } from '../../lib/errors.ts';

/**
 * 解析 --id（分组 ID）。宽容处理：trim 后非空即可，不强制数字——
 * api.json 声明列表 id 为 int、创建返回为 string(uuid)，实测均为 int，
 * 为兼容后端未来切换 uuid 不做数字校验，拼 path 时原样透传。
 */
export function parseGroupId(input: string): string {
  const v = input.trim();
  if (!v) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: '--id 不能为空',
    } satisfies ErrorEnvelope;
  }
  return v;
}

/**
 * 规范化 group subs 的 --type 过滤参数。分组成员可能含网页端加入的
 * PODCAST / NEWSLETTER，比订阅命令的 MP|WEBSITE|X 白名单宽。
 */
export function normalizeGroupSubsType(input: string): string {
  const v = input.trim().toUpperCase();
  const allowed = ['MP', 'WEBSITE', 'X', 'PODCAST', 'NEWSLETTER'];
  if (!allowed.includes(v)) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: `--type 仅支持 MP / WEBSITE / X / PODCAST / NEWSLETTER，收到: ${input}`,
    } satisfies ErrorEnvelope;
  }
  return v;
}
