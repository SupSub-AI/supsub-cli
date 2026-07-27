// packages/cli/src/lib/errors.ts
import { EXIT } from './exit-code.ts';

export type ErrorEnvelope = {
  code: string;
  message: string;
  status: number;
  data?: unknown;
};

/**
 * 根据 ErrorEnvelope 推导退出码。所有 code → exit code 的映射规则集中在此。
 */
export function exitCodeFor(envelope: ErrorEnvelope): number {
  switch (envelope.code) {
    case 'UNAUTHORIZED':
    // refreshToken 失效等价于「需要重新登录」，共用 exit code 2。
    // 正常路径下它会被 http/client.ts 转成 UNAUTHORIZED，这里是兜底。
    case 'INVALID_REFRESH_TOKEN':
      return EXIT.UNAUTHORIZED;
    case 'SUBSCRIPTION_PLAN_EXPIRED':
      return EXIT.PLAN_EXPIRED;
    case 'NETWORK_ERROR':
      return EXIT.NETWORK;
    case 'INVALID_ARGS':
      return EXIT.INVALID_ARGS;
    case 'UNKNOWN_ERROR':
      return EXIT.SERVER;
    default:
      return envelope.status >= 500 ? EXIT.SERVER : EXIT.BUSINESS;
  }
}

/**
 * 输出错误并退出进程。
 * 这是唯一允许调用 process.exit() 的地方。
 *
 * @param envelope   错误对象
 * @param outputFmt  当前输出格式（来自 --output 选项）
 */
export function dieWith(envelope: ErrorEnvelope, outputFmt?: string): never {
  const code = exitCodeFor(envelope);
  if (outputFmt === 'json') {
    // JSON 模式：把错误写到 stdout，保证 jq 可解析
    process.stdout.write(`${JSON.stringify({ success: false, error: envelope }, null, 2)}\n`);
  } else {
    // table 模式（默认）：把 message 写到 stderr
    process.stderr.write(`❌ ${envelope.message}\n`);
  }
  process.exit(code);
}

/**
 * 判断一个值是否符合 ErrorEnvelope 形态
 */
export function isErrorEnvelope(val: unknown): val is ErrorEnvelope {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>).code === 'string' &&
    typeof (val as Record<string, unknown>).message === 'string'
  );
}
