// packages/cli/src/commands/group/remove.ts
import type { Command } from 'commander';
import { deleteGroup } from '../../api/group.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { parseGroupId } from './_args.ts';

export function registerGroupRemove(parent: Command): void {
  parent
    .command('remove')
    .description('删除订阅分组（破坏性操作，不可逆；组内订阅源本身不受影响）')
    .requiredOption('--id <id>', '分组 ID')
    .action(async (opts: { id: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const groupId = parseGroupId(opts.id);
      await withSpinner('删除分组…', () => deleteGroup({ groupId }));

      // 后端 204 无 body，本地兜底文案
      output({ message: '已删除分组' }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
