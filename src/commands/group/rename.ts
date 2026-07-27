// packages/cli/src/commands/group/rename.ts
import type { Command } from 'commander';
import { renameGroup } from '../../api/group.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { parseGroupId } from './_args.ts';

export function registerGroupRename(parent: Command): void {
  parent
    .command('rename')
    .description('重命名订阅分组')
    .requiredOption('--id <id>', '分组 ID')
    .requiredOption('--name <name>', '新分组名称')
    .action(async (opts: { id: string; name: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const groupId = parseGroupId(opts.id);
      const name = opts.name.trim();
      if (!name) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '--name 不能为空',
        } satisfies ErrorEnvelope;
      }

      await withSpinner('重命名分组…', () => renameGroup({ groupId, name }));

      // 后端 204 无 body，本地兜底文案
      output({ message: '分组已重命名' }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
