// packages/cli/src/commands/focus/contents.ts
import type { Command } from 'commander';
import { getFocusContents } from '../../api/focus.ts';
import { formatDate } from '../../lib/format-date.ts';
import type { FocusContent, FocusContentBrief, FocusContentJson } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
// --all / --unread 互斥校验与翻页解析复用 sub 的实现，避免重复
import { parsePage, parsePageSize, requireExclusive } from '../sub/_args.ts';
import { parseFocusId } from './_args.ts';

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

/** 补 publishedAtText，省得调用方（尤其 agent）自己去转 Unix 时间戳 */
function toJson(data: FocusContent[]): FocusContentJson[] {
  return data.map((c) => ({ ...c, publishedAtText: formatDate(c.publishedAt) }));
}

/** --brief：保留跨源聚合必需的 sourceType / sourceName，丢掉 summary / keywords / tags / url */
function toBrief(data: FocusContent[]): FocusContentBrief[] {
  return data.map((c) => ({
    contentId: c.contentId,
    title: c.title,
    publishedAt: c.publishedAt,
    publishedAtText: formatDate(c.publishedAt),
    isRead: c.isRead,
    sourceType: c.sourceType,
    sourceName: c.sourceName,
  }));
}

function renderFocusContentTable(data: FocusContentJson[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'sourceType', 'sourceName', 'contentId', 'url'],
    rows: data.map((c) => [
      c.publishedAtText,
      c.isRead ? '✓' : '',
      truncate(c.title ?? '', 40),
      c.sourceType,
      truncate(c.sourceName ?? '', 20),
      c.contentId,
      shortUrl(c.url ?? ''),
    ]),
    columnWidths: [18, 6, 42, 12, 22, 20, 32],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

function renderFocusBriefTable(data: FocusContentBrief[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'sourceName', 'contentId'],
    rows: data.map((c) => [
      c.publishedAtText,
      c.isRead ? '✓' : '',
      truncate(c.title ?? '', 44),
      truncate(c.sourceName ?? '', 20),
      c.contentId,
    ]),
    columnWidths: [18, 6, 46, 22, 20],
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
    .option('--brief', '精简输出：仅 contentId / title / 来源 / 发布时间 / 已读状态')
    .option('--page <n>', '页码（默认 1）')
    .option('--page-size <n>', '每页条数 1-100（默认 20）')
    .action(
      async (opts: {
        id: string;
        all?: boolean;
        unread?: boolean;
        brief?: boolean;
        page?: string;
        pageSize?: string;
      }) => {
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
        const page = opts.page ? parsePage(opts.page) : undefined;
        const pageSize = opts.pageSize ? parsePageSize(opts.pageSize) : undefined;

        const data = await withSpinner('加载关注点内容…', () =>
          getFocusContents({ focusId, type: contentType, page, pageSize }),
        );

        if (opts.brief) output(toBrief(data), fmt, renderFocusBriefTable);
        else output(toJson(data), fmt, renderFocusContentTable);
      },
    );
}
