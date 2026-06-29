// packages/cli/src/commands/focus/list.ts
import type { Command } from 'commander';
import { listFocuses } from '../../api/focus.ts';
import type { Focus } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';

function renderFocusTable(data: Focus[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['id', 'icon', 'title', 'unreadCount'],
    rows: data.map((f) => [f.id, f.icon, truncate(f.title, 40), f.unreadCount]),
    columnWidths: [10, 8, 42, 14],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerFocusList(parent: Command): void {
  parent
    .command('list')
    .description('列出关注点')
    .action(async () => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const data = await withSpinner('加载关注点列表…', () => listFocuses());

      output(data, fmt, renderFocusTable);
    });
}
