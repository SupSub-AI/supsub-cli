// packages/cli/src/commands/deepread/list.ts
// 本地精读队列 =「收件箱」，不是「收藏夹」。
//
// 默认只报两类：还在跑的（pending）、跑完但还没跟用户说过的（done 且无 notifiedAt）。
// 播报一次就打上 notifiedAt 水位线，否则每次会话开头都会把三个月前的老结果再念一遍。
// 想看全部历史用 --all（--all 不打水位线，纯只读）。
import type { Command } from 'commander';
import { getDeepRead } from '../../api/deep-read.ts';
import { renderMarkdown } from '../../lib/deep-read-render.ts';
import {
  type DeepReadEntry,
  entryPaths,
  listEntries,
  writeEntry,
} from '../../lib/deep-read-store.ts';
import { formatDate } from '../../lib/format-date.ts';
import { sleep } from '../../lib/sleep.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
import { POLL_INTERVAL_MS, parseTimeout, statusText } from './_shared.ts';

type ListItem = {
  sourceType: string;
  contentId: string;
  title?: string;
  sourceName?: string;
  url?: string;
  status: string;
  requestedAt: number;
  requestedAtText: string;
  essence?: string;
  qualityGrade?: string;
  cachePath?: string;
  shareCode?: string;
  /** 本次是否是第一次向用户播报（收件箱语义） */
  fresh: boolean;
};

/** 回查所有 pending 项（done 是终态，不再查），把最新状态写回本地 */
async function refreshPending(entries: DeepReadEntry[]): Promise<DeepReadEntry[]> {
  const refreshed = await Promise.all(
    entries.map(async (e) => {
      if (e.status !== 'pending') return e;
      try {
        const resp = await getDeepRead({ sourceType: e.sourceType, contentId: e.contentId });
        const next: DeepReadEntry = {
          ...e,
          status: resp.status,
          checkedAt: Date.now(),
          version: resp.version ?? e.version,
          content: resp.content ?? e.content,
        };
        await writeEntry(next, renderMarkdown);
        return next;
      } catch {
        // 单条查询失败不影响整体列表，保留上次已知状态
        return e;
      }
    }),
  );
  return refreshed;
}

async function toItem(e: DeepReadEntry): Promise<ListItem> {
  const paths = await entryPaths(e.sourceType, e.contentId);
  return {
    sourceType: e.sourceType,
    contentId: e.contentId,
    title: e.title,
    sourceName: e.sourceName,
    url: e.url,
    status: e.status,
    requestedAt: e.requestedAt,
    requestedAtText: formatDate(Math.floor(e.requestedAt / 1000)),
    essence: e.content?.essence,
    qualityGrade: e.content?.quality?.grade,
    cachePath: e.status === 'done' && e.content ? paths.md : undefined,
    shareCode: e.shareCode,
    fresh: e.status === 'done' && !e.notifiedAt,
  };
}

function render(items: ListItem[]): void {
  if (items.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['发起时间', '状态', '成色', 'title', '类型', 'contentId'],
    rows: items.map((i) => [
      i.requestedAtText,
      statusText(i.status as never),
      i.qualityGrade ?? '',
      truncate(i.title ?? '(无标题)', 36),
      i.sourceType,
      i.contentId,
    ]),
    columnWidths: [18, 12, 8, 38, 10, 26],
  });
  process.stdout.write(`(${items.length} items)\n`);
  for (const i of items) {
    if (i.essence) process.stdout.write(`\n${i.title ?? i.contentId}\n  ${i.essence}\n`);
  }
}

export function registerDeepReadList(parent: Command): void {
  parent
    .command('list')
    .description('本地精读队列（默认只显示进行中 + 尚未播报过的结果）')
    .option('--all', '显示全部历史记录（且不写播报水位线）')
    .option('--wait', '等到队列里所有进行中的精读都落定')
    .option('--timeout <sec>', '等待上限秒数（默认 180，上限 600）')
    .action(async (opts: { all?: boolean; wait?: boolean; timeout?: string }) => {
      const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
      const timeoutMs = parseTimeout(opts.timeout) * 1000;

      let entries = await withSpinner('检查精读队列…', async () => {
        let current = await refreshPending(await listEntries());
        if (opts.wait) {
          const start = Date.now();
          while (current.some((e) => e.status === 'pending') && Date.now() - start < timeoutMs) {
            await sleep(POLL_INTERVAL_MS);
            current = await refreshPending(current);
          }
        }
        return current;
      });

      if (!opts.all) {
        entries = entries.filter((e) => e.status === 'pending' || !e.notifiedAt);
      }

      const items = await Promise.all(entries.map(toItem));

      // 播报水位线：默认视图里出现过的已完成项，标记为「已告知用户」。
      // --all 是纯浏览，不动水位线。
      if (!opts.all) {
        await Promise.all(
          entries
            .filter((e) => e.status === 'done' && !e.notifiedAt)
            .map((e) => writeEntry({ ...e, notifiedAt: Date.now() }, renderMarkdown)),
        );
      }

      output(items, fmt, render);
    });
}
