// packages/cli/src/commands/focus/remove.ts
import type { Command } from 'commander';
import { removeFocus } from '../../api/focus.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { parseFocusId } from './_args.ts';

export function registerFocusRemove(parent: Command): void {
  parent
    .command('remove')
    .description('删除关注点（破坏性操作：CLI 无新增关注点能力，删除不可逆）')
    .requiredOption('--id <id>', '关注点 ID')
    .action(async (opts: { id: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const focusId = parseFocusId(opts.id);
      const data = await withSpinner('删除关注点…', () => removeFocus({ focusId }));

      // 后端成功可能返回 204 无 body（data 为 undefined）或 { message }，兜底文案
      const message = data?.message ?? '已删除关注点';
      output({ message }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
