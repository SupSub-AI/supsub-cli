// packages/cli/src/commands/focus/mark-read.ts
import { type Command, Option } from 'commander';
import { markFocusAsRead } from '../../api/focus.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { parseFocusId } from './_args.ts';

/** 老版本 skills 里还留着单篇写法（--content-id + --type/--source-type），命中时给明确原因 */
const SINGLE_REMOVED =
  '已不支持单篇标记已读：文章没有「详情 / 阅读」这一步，产生不了自然的单篇已读。请用 --all 标记整个关注点已读。';

export function registerFocusMarkRead(parent: Command): void {
  parent
    .command('mark-read')
    .description('标记关注点全部内容为已读（不可逆，无取消已读命令）')
    .requiredOption('--id <id>', '关注点 ID')
    .option('--all', '确认标记该关注点全部内容为已读（必填，不可逆）')
    .addOption(new Option('--content-id <cid>').hideHelp())
    .addOption(new Option('--type <type>').hideHelp())
    .addOption(new Option('--source-type <type>').hideHelp())
    .action(
      async (opts: {
        id: string;
        all?: boolean;
        contentId?: string;
        type?: string;
        sourceType?: string;
      }) => {
        const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
        const fmt = globalOpts.output;

        if (opts.contentId || opts.type || opts.sourceType) {
          throw {
            code: 'INVALID_ARGS',
            status: 0,
            message: SINGLE_REMOVED,
          } satisfies ErrorEnvelope;
        }
        // --all 是唯一模式，但仍要求显式给出：不可逆操作需要一个明确的「我确实要全清」标记
        if (!opts.all) {
          throw {
            code: 'INVALID_ARGS',
            status: 0,
            message: '必须显式指定 --all：本命令只做整个关注点已读（不可逆），不支持单篇标记已读',
          } satisfies ErrorEnvelope;
        }

        const focusId = parseFocusId(opts.id);

        await withSpinner('标记已读…', () => markFocusAsRead({ focusId }));

        // 后端 204 无 body，本地兜底文案
        output({ message: '已标记该关注点全部内容为已读（不可逆）' }, fmt, (d) => {
          printTable({
            headers: ['结果'],
            rows: [[d.message]],
          });
        });
      },
    );
}
