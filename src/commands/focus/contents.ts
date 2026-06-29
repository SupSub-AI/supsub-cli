// packages/cli/src/commands/focus/contents.ts
import type { Command } from 'commander';
import { getFocusContents } from '../../api/focus.ts';
import type { FocusContent } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
// --all / --unread 互斥校验复用 sub 的 requireExclusive，避免重复实现
import { requireExclusive } from '../sub/_args.ts';
import { parseFocusId } from './_args.ts';

/**
 * 将 publishedAt 格式化为 "YYYY-MM-DD HH:mm"
 * 与 sub/contents.ts 同款逻辑，兼容「整数秒级时间戳」与「字符串」两种形态
 */
function formatDate(val: unknown): string {
  if (typeof val === 'number') {
    // Unix 时间戳（秒）
    const d = new Date(val * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }
  if (typeof val === 'string') return val.slice(0, 16);
  return String(val);
}

/**
 * 提取 URL 主机名
 */
function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function renderFocusContentTable(data: FocusContent[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'sourceType', 'sourceName', 'articleId', 'url'],
    rows: data.map((c) => [
      formatDate(c.publishedAt),
      c.isRead ? '✓' : '',
      truncate(c.title ?? '', 40),
      c.sourceType,
      truncate(c.sourceName ?? '', 20),
      c.articleId,
      shortUrl(c.url ?? ''),
    ]),
    columnWidths: [18, 6, 42, 12, 22, 20, 32],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerFocusContents(parent: Command): void {
  parent
    .command('contents')
    .description('查看关注点内容')
    .requiredOption('--id <id>', '关注点 ID')
    .option('--unread', '仅显示未读（默认）')
    .option('--all', '显示全部内容')
    .action(async (opts: { id: string; all?: boolean; unread?: boolean }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      // 互斥校验
      requireExclusive(
        opts as unknown as Record<string, unknown>,
        ['all', 'unread'],
        '--all 与 --unread 互斥，请只指定一个',
      );

      const focusId = parseFocusId(opts.id);
      const contentType = opts.all ? 'all' : 'unread';

      const data = await withSpinner('加载关注点内容…', () =>
        getFocusContents({ focusId, type: contentType }),
      );

      output(data, fmt, renderFocusContentTable);
    });
}
