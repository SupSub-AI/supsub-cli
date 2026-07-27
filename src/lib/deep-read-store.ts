// packages/cli/src/lib/deep-read-store.ts
// 精读结果的本地缓存 / 队列。
//
// 为什么需要它：裸 `POST /api/deep-reads` **不会**进网页端的「稍后阅读」列表
// （2026-07-27 实测确认），而 API 又没有「列出我所有精读」的接口 —— 也就是说
// CLI 发起的精读，除了当场拿到的这一次响应，服务端不提供任何找回入口。
// 本地缓存就是这个索引：跨会话找回、免重复请求、可 grep 的个人精读库。
//
// 存储形态（每条两个文件，无中心索引）：
//   ~/.supsub/deepread/<账号>/<sourceType>_<hash(contentId)>.json   完整记录（真相）
//   ~/.supsub/deepread/<账号>/<sourceType>_<hash(contentId)>.md     渲染好的正文（给人读 / 给 agent grep）
//
// 一条一个文件是**刻意**的：agent 会并发跑多个 `deepread run`，
// 单文件读-改-写必然丢条目（参考 group add-sub 的「勿并发」教训）。
// 一条一个文件天然幂等、无锁、无竞态，drop 就是 unlink。
//
// 不做自动 GC：服务端已完成的精读能保存多久尚未确认，本地这份有可能是唯一副本，
// 所以只提供显式 `deepread drop`，不替用户删。

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getConfigDir } from '../config/store.ts';
import { resolveApiKey } from '../http/credentials.ts';
import { getTokenSubject } from './jwt.ts';
import type { DeepReadContent, DeepReadStatus } from './types.ts';

/** 本地一条精读记录 */
export type DeepReadEntry = {
  sourceType: string;
  contentId: string;
  /** 文章标题等展示信息：由调用方在发起时从 contents/search 结果带入，可能缺失 */
  title?: string;
  sourceName?: string;
  url?: string;
  /** 首次发起时间（毫秒） */
  requestedAt: number;
  /** 最后一次已知的服务端状态。**是缓存不是真相**：pending 每次都回查，done 是终态不再查 */
  status: DeepReadStatus;
  /** 最后一次回查服务端的时间（毫秒） */
  checkedAt: number;
  /** 已经向用户播报过的时间（毫秒）。收件箱水位线，避免每次会话重复播报老结果 */
  notifiedAt?: number;
  /** 生成过的分享码（公开链接，不可撤销），缓存下来避免重复生成 */
  shareCode?: string;
  version?: string;
  content?: DeepReadContent;
};

/** 用于展示的精简形态（list 命令用，不含正文） */
export type DeepReadEntryBrief = Omit<DeepReadEntry, 'content'> & {
  essence?: string;
  qualityGrade?: string;
  cachePath?: string;
};

/**
 * 当前账号对应的缓存子目录名。
 *
 * 走 resolveApiKey() 而不是直接读 config，是为了跟 HTTP 层用同一套凭证优先级
 * （--api-key flag > env > config），否则临时用 `--api-key` 切账号时会读错目录。
 * JWT 能解出用户 id 就用 id，否则退化为凭证哈希；完全没有凭证时用 anonymous。
 */
export async function currentUserKey(): Promise<string> {
  const { key } = await resolveApiKey();
  if (!key) return 'anonymous';
  const subject = getTokenSubject(key);
  if (subject) return `u${subject.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return `k${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

/** 缓存根目录（不含账号层） */
export function deepReadRootDir(): string {
  return path.join(getConfigDir(), 'deepread');
}

/** 当前账号的缓存目录 */
export async function deepReadDir(): Promise<string> {
  return path.join(deepReadRootDir(), await currentUserKey());
}

/**
 * 条目文件名。contentId 是不透明字符串（可能含 `/`、`-`、`_` 等），
 * 直接当文件名不安全，取 sha256 前 16 位；完整 contentId 存在文件内容里。
 */
export function entryKey(sourceType: string, contentId: string): string {
  const hash = createHash('sha256').update(contentId).digest('hex').slice(0, 16);
  return `${sourceType.toUpperCase()}_${hash}`;
}

/** 一条记录对应的两个文件路径 */
export async function entryPaths(
  sourceType: string,
  contentId: string,
): Promise<{ json: string; md: string }> {
  const dir = await deepReadDir();
  const key = entryKey(sourceType, contentId);
  return { json: path.join(dir, `${key}.json`), md: path.join(dir, `${key}.md`) };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(dir, 0o700);
    } catch {
      // 静默忽略（与 config/store.ts 同样的 Windows 兜底）
    }
  }
}

async function writeFile600(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, 'utf-8');
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(file, 0o600);
    } catch {
      // 静默忽略
    }
  }
}

/** 读取一条记录；不存在或损坏返回 undefined */
export async function readEntry(
  sourceType: string,
  contentId: string,
): Promise<DeepReadEntry | undefined> {
  const { json } = await entryPaths(sourceType, contentId);
  try {
    return JSON.parse(await fs.readFile(json, 'utf-8')) as DeepReadEntry;
  } catch {
    return undefined;
  }
}

/**
 * 写入一条记录。同一篇重复写 = 覆盖同一对文件（天然幂等）。
 * `renderMarkdown` 由调用方注入，避免 store 反向依赖渲染层。
 */
export async function writeEntry(
  entry: DeepReadEntry,
  renderMarkdown?: (e: DeepReadEntry) => string,
): Promise<{ json: string; md: string }> {
  const dir = await deepReadDir();
  await ensureDir(dir);
  const paths = await entryPaths(entry.sourceType, entry.contentId);

  await writeFile600(paths.json, `${JSON.stringify(entry, null, 2)}\n`);
  if (entry.status === 'done' && entry.content && renderMarkdown) {
    await writeFile600(paths.md, renderMarkdown(entry));
  }
  return paths;
}

/** 列出当前账号的全部记录，按发起时间倒序 */
export async function listEntries(): Promise<DeepReadEntry[]> {
  const dir = await deepReadDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const entries: DeepReadEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf-8');
      const parsed = JSON.parse(raw) as DeepReadEntry;
      // 损坏 / 结构不对的文件直接跳过，不让一条坏数据拖垮整个 list
      if (typeof parsed?.contentId === 'string' && typeof parsed?.sourceType === 'string') {
        entries.push(parsed);
      }
    } catch {
      // 忽略单条读取失败
    }
  }
  entries.sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0));
  return entries;
}

/** 删除一条记录（json + md）。返回是否真的删掉了东西 */
export async function removeEntry(sourceType: string, contentId: string): Promise<boolean> {
  const paths = await entryPaths(sourceType, contentId);
  let removed = false;
  for (const file of [paths.json, paths.md]) {
    try {
      await fs.unlink(file);
      removed = true;
    } catch {
      // 文件本来就不存在
    }
  }
  return removed;
}
