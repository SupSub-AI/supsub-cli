// packages/cli/src/commands/focus/_args.ts
import type { ErrorEnvelope } from '../../lib/errors.ts';

/**
 * 解析 --id 为整数（关注点 ID，API 契约 type:integer）
 */
export function parseFocusId(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: `--id 必须是正整数，收到: ${input}`,
    } satisfies ErrorEnvelope;
  }
  return n;
}
