// packages/cli/src/commands/sub/remove.ts
import type { Command } from 'commander';
import { removeSub } from '../../api/subscription.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { normalizeType, parseSourceId } from './_args.ts';

export function registerSubRemove(parent: Command): void {
  parent
    .command('remove')
    .description('取消订阅')
    .requiredOption('--source-id <id>', '信息源 ID')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .action(async (opts: { sourceId: string; type: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const sourceType = normalizeType(opts.type);
      const sourceId = parseSourceId(opts.sourceId);
      const data = await withSpinner('取消订阅…', () => removeSub({ sourceType, sourceId }));

      output({ message: data.message }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
