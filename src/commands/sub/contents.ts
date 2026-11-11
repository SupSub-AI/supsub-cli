// packages/cli/src/commands/sub/contents.ts
import type { Command } from 'commander';
import { getContents } from '../../api/subscription.ts';
import { formatDate } from '../../lib/format-date.ts';
import type { Article, ArticleBrief, ArticleJson } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
import {
  normalizeType,
  parsePage,
  parsePageSize,
  parseSourceId,
  requireExclusive,
  requireOneOf,
} from './_args.ts';

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
function toJson(data: Article[]): ArticleJson[] {
  return data.map((a) => ({ ...a, publishedAtText: formatDate(a.publishedAt) }));
}

/** --brief：丢掉 summary / coverImage / tags / url，批量枚举时输出体积能小一个数量级 */
function toBrief(data: Article[]): ArticleBrief[] {
  return data.map((a) => ({
    contentId: a.contentId,
    title: a.title,
    originalTitle: a.originalTitle,
    publishedAt: a.publishedAt,
    publishedAtText: formatDate(a.publishedAt),
    isRead: a.isRead,
  }));
}

function renderArticleTable(data: ArticleJson[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'contentId', 'url'],
    rows: data.map((a) => [
      a.publishedAtText,
      a.isRead ? '✓' : '',
      truncate(a.title, 40),
      a.contentId,
      shortUrl(a.url),
    ]),
    columnWidths: [18, 8, 42, 20, 42],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

function renderBriefTable(data: ArticleBrief[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['publishedAt', 'read', 'title', 'contentId'],
    rows: data.map((a) => [
      a.publishedAtText,
      a.isRead ? '✓' : '',
      truncate(a.title, 50),
      a.contentId,
    ]),
    columnWidths: [18, 8, 52, 20],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerSubContents(parent: Command): void {
  parent
    .command('contents')
    .description('查看订阅源内容')
    // --id 是 --source-id 的别名：focus contents 用的是 --id，两边不一致极易写错
    .option('--source-id <id>', '信息源 ID')
    .option('--id <id>', '信息源 ID（--source-id 的别名）')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .option('--all', '显示全部文章')
    .option('--unread', '仅显示未读（默认）')
    .option('--brief', '精简输出：仅 contentId / title / originalTitle / 发布时间 / 已读状态')
    .option('--page <n>', '页码（默认 1）')
    .option('--page-size <n>', '每页条数 1-100（默认 20）')
    .action(
      async (opts: {
        sourceId?: string;
        id?: string;
        type: string;
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
        requireOneOf(
          opts as unknown as Record<string, unknown>,
          ['sourceId', 'id'],
          '缺少信息源 ID：请指定 --source-id（或别名 --id）',
        );

        const sourceType = normalizeType(opts.type);
        const sourceId = parseSourceId(opts.sourceId ?? opts.id ?? '');
        const contentType = opts.all ? 'all' : 'unread';
        const page = opts.page ? parsePage(opts.page) : undefined;
        const pageSize = opts.pageSize ? parsePageSize(opts.pageSize) : undefined;

        const data = await withSpinner('加载文章列表…', () =>
          getContents({
            sourceType,
            sourceId,
            type: contentType,
            page,
            pageSize,
          }),
        );

        if (opts.brief) output(toBrief(data), fmt, renderBriefTable);
        else output(toJson(data), fmt, renderArticleTable);
      },
    );
}
