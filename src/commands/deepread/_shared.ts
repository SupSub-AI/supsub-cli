// packages/cli/src/commands/deepread/_shared.ts
// deepread 各子命令共用的参数解析、轮询与落盘逻辑。

import { getDeepRead, requestDeepRead } from '../../api/deep-read.ts';
import { renderMarkdown } from '../../lib/deep-read-render.ts';
import {
  type DeepReadEntry,
  entryPaths,
  readEntry,
  writeEntry,
} from '../../lib/deep-read-store.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { sleep } from '../../lib/sleep.ts';
import type { DeepReadContent, DeepReadResponse, DeepReadStatus } from '../../lib/types.ts';
import { normalizeType } from '../sub/_args.ts';

/**
 * 轮询节奏。实测精读耗时 21s（普通杂谈）/ 32s（技术长文），
 * 3s 一次约 7~11 次轮询即可拿到结果；默认 180s 上限留足余量，
 * 同时明显低于 agent 侧 Bash 工具 600s 的硬上限。
 */
export const POLL_INTERVAL_MS = 3000;
export const DEFAULT_TIMEOUT_S = 180;

export type DeepReadRefArgs = {
  type?: string;
  contentId?: string;
};

/** 解析 --type / --content-id */
export function parseRef(opts: DeepReadRefArgs): { sourceType: string; contentId: string } {
  const contentId = (opts.contentId ?? '').trim();
  if (contentId === '') {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message:
        '缺少 --content-id。contentId 只能来自 sub contents / focus contents / search 的返回，不要手写或猜测',
    } satisfies ErrorEnvelope;
  }
  return { sourceType: normalizeType(opts.type ?? ''), contentId };
}

/** 解析 --timeout（秒） */
export function parseTimeout(input: string | undefined): number {
  if (input === undefined) return DEFAULT_TIMEOUT_S;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > 600) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: `--timeout 必须是 1-600 的整数（秒），收到: ${input}`,
    } satisfies ErrorEnvelope;
  }
  return n;
}

/** 展示信息（由调用方从 contents / search 结果带入，纯粹为了让本地队列可读） */
export type DisplayMeta = {
  title?: string;
  sourceName?: string;
  url?: string;
};

/**
 * 把一次服务端响应落到本地缓存。
 * 已有记录的 requestedAt / notifiedAt / shareCode / 展示信息会被保留（增量合并）。
 */
export async function persist(
  ref: { sourceType: string; contentId: string },
  resp: DeepReadResponse,
  meta: DisplayMeta = {},
): Promise<{ entry: DeepReadEntry; paths: { json: string; md: string } }> {
  const existing = await readEntry(ref.sourceType, ref.contentId);
  const now = Date.now();

  const entry: DeepReadEntry = {
    ...existing,
    sourceType: ref.sourceType,
    contentId: ref.contentId,
    title: meta.title ?? existing?.title,
    sourceName: meta.sourceName ?? existing?.sourceName,
    url: meta.url ?? existing?.url,
    requestedAt: existing?.requestedAt ?? now,
    status: resp.status,
    checkedAt: now,
    version: resp.version ?? resp.content?.version ?? existing?.version,
    // pending / failed 时服务端不带 content，别把已有的 done 结果覆盖没了
    content: resp.content ?? existing?.content,
  };

  const paths = await writeEntry(entry, renderMarkdown);
  return { entry, paths };
}

/**
 * 轮询到落定（done / failed）或超时。
 * 超时时返回最后一次看到的状态（通常是 pending）——超时**不是错误**，
 * 精读本来就是异步的，调用方以 status 字段分支即可。
 */
export async function pollUntilSettled(
  ref: { sourceType: string; contentId: string },
  timeoutMs: number,
): Promise<DeepReadResponse> {
  const start = Date.now();
  let last: DeepReadResponse = { status: 'pending' };

  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_INTERVAL_MS);
    last = await getDeepRead(ref);
    if (last.status === 'done' || last.status === 'failed') return last;
  }
  return last;
}

/**
 * 发起精读前的预检：命中 done 就别再 POST。
 *
 * 后端对已完成内容的重复 POST 本来就幂等（实测 used 不变），这一步的收益是
 * **省掉一整轮等待**——已经精读过的文章可以立刻出结果。
 * 返回 true 表示已经发过 POST（即本次消耗了额度）。
 */
export async function ensureRequested(
  ref: { sourceType: string; contentId: string },
  current: DeepReadStatus,
): Promise<boolean> {
  if (current === 'done' || current === 'pending') return false;
  await requestDeepRead(ref);
  return true;
}

/** 命令统一的 JSON 输出形态 */
export type DeepReadPayload = {
  sourceType: string;
  contentId: string;
  title?: string;
  sourceName?: string;
  url?: string;
  status: DeepReadStatus;
  version?: string;
  requestedAt: number;
  checkedAt: number;
  /** 本地渲染好的 Markdown 全文路径；agent 需要细节时直接读它，不必把正文塞进上下文 */
  cachePath?: string;
  shareCode?: string;
  shareUrl?: string;
  content?: DeepReadContent;
  /** 本次调用是否真的消耗了一次精读额度 */
  quotaSpent?: boolean;
};

export async function toPayload(
  entry: DeepReadEntry,
  opts: { brief?: boolean; quotaSpent?: boolean; content?: DeepReadContent } = {},
): Promise<DeepReadPayload> {
  const paths = await entryPaths(entry.sourceType, entry.contentId);
  return {
    sourceType: entry.sourceType,
    contentId: entry.contentId,
    title: entry.title,
    sourceName: entry.sourceName,
    url: entry.url,
    status: entry.status,
    version: entry.version,
    requestedAt: entry.requestedAt,
    checkedAt: entry.checkedAt,
    cachePath: entry.status === 'done' && entry.content ? paths.md : undefined,
    shareCode: entry.shareCode,
    content: opts.content ?? entry.content,
    quotaSpent: opts.quotaSpent,
  };
}

/** status 的中文说明，table 模式下用 */
export function statusText(status: DeepReadStatus): string {
  switch (status) {
    case 'none':
      return '未发起过精读';
    case 'pending':
      return '精读中…';
    case 'done':
      return '已完成';
    case 'failed':
      return '精读失败';
    default:
      return status;
  }
}
