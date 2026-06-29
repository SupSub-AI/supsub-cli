// packages/cli/src/commands/sub/_args.ts
import type { ErrorEnvelope } from '../../lib/errors.ts';

/**
 * 规范化 --type 参数（toUpperCase 后校验）
 */
export function normalizeType(input: string): 'MP' | 'WEBSITE' | 'X' {
  const v = input.trim().toUpperCase();
  if (v !== 'MP' && v !== 'WEBSITE' && v !== 'X') {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: `--type 仅支持 MP / WEBSITE / X，收到: ${input}`,
    } satisfies ErrorEnvelope;
  }
  return v;
}

/**
 * 解析 --source-id 为整数（API 契约 type:integer）
 */
export function parseSourceId(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: `--source-id 必须是正整数，收到: ${input}`,
    } satisfies ErrorEnvelope;
  }
  return n;
}

/**
 * 校验互斥选项（两者都设置则抛错）
 */
export function requireExclusive(
  opts: Record<string, unknown>,
  keys: [string, string],
  message: string,
): void {
  if (opts[keys[0]] && opts[keys[1]]) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message,
    } satisfies ErrorEnvelope;
  }
}
