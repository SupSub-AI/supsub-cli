// packages/cli/src/commands/group/list.ts
import type { Command } from 'commander';
import { listGroups } from '../../api/group.ts';
import type { Group } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';

function renderGroupTable(data: Group[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['id', 'name'],
    rows: data.map((g) => [g.id, truncate(g.name, 40)]),
    columnWidths: [10, 42],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerGroupList(parent: Command): void {
  parent
    .command('list')
    .description('列出订阅分组')
    .action(async () => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const data = await withSpinner('加载分组列表…', () => listGroups());

      output(data, fmt, renderGroupTable);
    });
}
