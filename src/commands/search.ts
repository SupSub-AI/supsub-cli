// packages/cli/src/commands/search.ts
import type { Command } from 'commander';
import { searchAll } from '../api/search.ts';
import type { ErrorEnvelope } from '../lib/errors.ts';
import { formatDate } from '../lib/format-date.ts';
import type {
  SearchResponse,
  SearchResponseJson,
  SearchResultItem,
  SourceBasic,
} from '../lib/types.ts';
import { output } from '../ui/output.ts';
import { withSpinner } from '../ui/spinner.ts';
import { printTable, truncate } from '../ui/table.ts';

const VALID_TYPES = new Set(['ALL', 'MP', 'WEBSITE', 'CONTENT']);

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function sourceKindLabel(sourceType: string): string {
  const t = sourceType.toUpperCase();
  if (t === 'MP') return '公众号';
  if (t === 'WEBSITE') return '网站';
  return sourceType;
}

function resultKindLabel(item: SearchResultItem): string {
  if (item.type === 'CONTENT') return '文章';
  return sourceKindLabel((item.data as SourceBasic).sourceType);
}

/** 补 publishedAtText，省得调用方（尤其 agent）自己去转 Unix 时间戳（同 sub/focus contents） */
function withPublishedAtText(d: SearchResponse): SearchResponseJson {
  return {
    ...d,
    results: (d.results ?? []).map((item) =>
      item.type === 'CONTENT'
        ? { ...item, data: { ...item.data, publishedAtText: formatDate(item.data.publishedAt) } }
        : item,
    ),
  };
}

function renderResultItem(item: SearchResultItem): string[] {
  if (item.type === 'SOURCE') {
    const d = item.data as SourceBasic;
    return [
      resultKindLabel(item),
      String(d.sourceId),
      truncate(d.name, 24),
      shortUrl(d.url),
      truncate(d.description, 40),
    ];
  } else {
    const d = item.data;
    return [
      resultKindLabel(item),
      `contentId: ${d.contentId}\nsourceId: ${d.sourceId}`,
      truncate(d.title, 24),
      shortUrl(d.url),
      truncate(d.summary, 40),
    ];
  }
}

export function registerSearch(program: Command): void {
  program
    .command('search <keyword>')
    .description('全量搜索（源 + 内容）')
    .option('--type <type>', '搜索类型：ALL|MP|WEBSITE|CONTENT', 'ALL')
    .action(async (keyword: string, opts: { type: string }) => {
      const globalOpts = program.opts() as { output?: string };
      const fmt = globalOpts.output;

      const typeVal = opts.type.trim().toUpperCase();
      if (!VALID_TYPES.has(typeVal)) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: `--type 仅支持 ALL|MP|WEBSITE|CONTENT，收到: ${opts.type}`,
        } satisfies ErrorEnvelope;
      }

      const data = await withSpinner(`搜索「${keyword}」中…`, () =>
        searchAll({
          type: typeVal as 'ALL' | 'MP' | 'WEBSITE' | 'CONTENT',
          keywords: keyword,
        }),
      );

      output(withPublishedAtText(data), fmt, (d) => {
        const results = d.results ?? [];

        // Results 表
        if (results.length === 0) {
          process.stdout.write('Results (0 items)\n(empty)\n');
        } else {
          process.stdout.write(`Results (${results.length} items)\n`);
          printTable({
            headers: ['类型', 'id', 'name/title', 'url', 'summary'],
            rows: results.map(renderResultItem),
            columnWidths: [10, 34, 26, 42, 42],
          });
        }
      });
    });
}
