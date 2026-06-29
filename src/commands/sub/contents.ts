// packages/cli/src/commands/sub/contents.ts
import type { Command } from 'commander';
import { getContents } from '../../api/subscription.ts';
import type { Article } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
import { normalizeType, parseSourceId, requireExclusive } from './_args.ts';

/**
 * 将 publishedAt 格式化为 "YYYY-MM-DD HH:mm"
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

function renderArticleTable(data: Article[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'articleId', 'url'],
    rows: data.map((a) => [
      formatDate(a.publishedAt),
      a.isRead ? '✓' : '',
      truncate(a.title, 40),
      a.articleId,
      shortUrl(a.url),
    ]),
    columnWidths: [18, 8, 42, 20, 42],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerSubContents(parent: Command): void {
  parent
    .command('contents')
    .description('查看订阅源内容')
    .requiredOption('--source-id <id>', '信息源 ID')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .option('--all', '显示全部文章')
    .option('--unread', '仅显示未读（默认）')
    .action(async (opts: { sourceId: string; type: string; all?: boolean; unread?: boolean }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      // 互斥校验
      requireExclusive(
        opts as unknown as Record<string, unknown>,
        ['all', 'unread'],
        '--all 与 --unread 互斥，请只指定一个',
      );

      const sourceType = normalizeType(opts.type);
      const sourceId = parseSourceId(opts.sourceId);
      const contentType = opts.all ? 'all' : 'unread';

      const data = await withSpinner('加载文章列表…', () =>
        getContents({
          sourceType,
          sourceId,
          type: contentType,
        }),
      );

      output(data, fmt, renderArticleTable);
    });
}
