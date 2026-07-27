// packages/cli/src/commands/unread.ts
// 未读概览：并发聚合「订阅源列表 + 关注点列表」，一条命令回答「我有哪些未读」。
import type { Command } from 'commander';
import { listFocuses } from '../api/focus.ts';
import { listSubs } from '../api/subscription.ts';
import { sourceKindLabel } from '../lib/source-label.ts';
import type { UnreadOverview } from '../lib/types.ts';
import { output } from '../ui/output.ts';
import { withSpinner } from '../ui/spinner.ts';
import { printTable, truncate } from '../ui/table.ts';

function renderOverview(data: UnreadOverview): void {
  // 订阅源段
  process.stdout.write(`订阅源 (${data.subscriptions.length} items)\n`);
  if (data.subscriptions.length === 0) {
    process.stdout.write('(empty)\n');
  } else {
    printTable({
      headers: ['sourceId', '类型', 'name', 'unreadCount'],
      rows: data.subscriptions.map((s) => [
        s.sourceId,
        sourceKindLabel(s.sourceType),
        truncate(s.name, 24),
        s.unreadCount,
      ]),
      columnWidths: [14, 10, 26, 13],
    });
  }

  // 关注点段
  process.stdout.write(`关注点 (${data.focuses.length} items)\n`);
  if (data.focuses.length === 0) {
    process.stdout.write('(empty)\n');
  } else {
    printTable({
      headers: ['id', 'icon', 'title', 'unreadCount'],
      rows: data.focuses.map((f) => [f.id, f.icon, truncate(f.title, 40), f.unreadCount]),
      columnWidths: [10, 8, 42, 14],
    });
  }
}

export function registerUnread(program: Command): void {
  program
    .command('unread')
    .description('未读概览（订阅源 + 关注点，默认只显示有未读的项）')
    .option('--all', '显示全部（含无未读的项）')
    .action(async (opts: { all?: boolean }) => {
      const globalOpts = program.opts() as { output?: string };
      const fmt = globalOpts.output;

      const [subscriptions, focuses] = await withSpinner('加载未读概览…', () =>
        Promise.all([listSubs(), listFocuses()]),
      );

      const data: UnreadOverview = opts.all
        ? { subscriptions, focuses }
        : {
            subscriptions: subscriptions.filter((s) => s.unreadCount > 0),
            focuses: focuses.filter((f) => f.unreadCount > 0),
          };

      output(data, fmt, renderOverview);
    });
}
