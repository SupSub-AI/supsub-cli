// packages/cli/src/commands/group/subs.ts
import type { Command } from 'commander';
import { listGroupSubs } from '../../api/group.ts';
import { sourceKindLabel } from '../../lib/source-label.ts';
import type { GroupSubscription } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable, truncate } from '../../ui/table.ts';
import { normalizeGroupSubsType, parseGroupId } from './_args.ts';

/** 默认（组内成员）：含未读数列 */
function renderMembersTable(data: GroupSubscription[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['sourceId', '类型', 'name', 'unreadCount', 'description'],
    rows: data.map((s) => [
      s.sourceId,
      sourceKindLabel(s.sourceType),
      truncate(s.name, 24),
      s.unreadCount ?? '',
      truncate(s.description, 34),
    ]),
    columnWidths: [14, 10, 26, 13, 36],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

/** --all（全部订阅源）：含 inGroup 列，无未读数（后端仅 groupOnly=true 返回） */
function renderAllTable(data: GroupSubscription[]): void {
  if (data.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  printTable({
    headers: ['sourceId', '类型', 'name', 'inGroup', 'description'],
    rows: data.map((s) => [
      s.sourceId,
      sourceKindLabel(s.sourceType),
      truncate(s.name, 24),
      s.inGroup ? '✓' : '',
      truncate(s.description, 34),
    ]),
    columnWidths: [14, 10, 26, 9, 36],
  });
  process.stdout.write(`(${data.length} items)\n`);
}

export function registerGroupSubs(parent: Command): void {
  parent
    .command('subs')
    .description('查看分组订阅源（默认仅组内成员，含未读数）')
    .requiredOption('--id <id>', '分组 ID')
    .option('--all', '显示所有订阅源（含未加入本分组的，带 inGroup 列）')
    .option('--type <type>', '过滤类型：MP|WEBSITE|X|PODCAST|NEWSLETTER')
    .action(async (opts: { id: string; all?: boolean; type?: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const groupId = parseGroupId(opts.id);
      const sourceType = opts.type ? normalizeGroupSubsType(opts.type) : undefined;

      const data = await withSpinner('加载分组订阅源…', () =>
        listGroupSubs({ groupId, groupOnly: !opts.all, sourceType }),
      );

      output(data, fmt, opts.all ? renderAllTable : renderMembersTable);
    });
}
