// packages/cli/src/commands/sub/mark-read.ts
import { type Command, Option } from 'commander';
import { markAsRead } from '../../api/subscription.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { normalizeType, parseSourceId } from './_args.ts';

/** 老版本 skills 里还留着单篇写法，命中时给明确原因，而不是 commander 的 unknown option */
const SINGLE_REMOVED =
  '已不支持单篇标记已读：文章没有「详情 / 阅读」这一步，产生不了自然的单篇已读。请用 --all 标记整源已读。';

export function registerSubMarkRead(parent: Command): void {
  parent
    .command('mark-read')
    .description('标记订阅源全部内容为已读（不可逆，无取消已读命令）')
    .requiredOption('--source-id <id>', '信息源 ID')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .option('--all', '确认标记该订阅源全部内容为已读（必填，不可逆）')
    .addOption(new Option('--content-id <cid>').hideHelp())
    .action(async (opts: { sourceId: string; type: string; all?: boolean; contentId?: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      if (opts.contentId) {
        throw { code: 'INVALID_ARGS', status: 0, message: SINGLE_REMOVED } satisfies ErrorEnvelope;
      }
      // --all 是唯一模式，但仍要求显式给出：不可逆操作需要一个明确的「我确实要全清」标记
      if (!opts.all) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '必须显式指定 --all：本命令只做整源已读（不可逆），不支持单篇标记已读',
        } satisfies ErrorEnvelope;
      }

      const sourceType = normalizeType(opts.type);
      const sourceId = parseSourceId(opts.sourceId);

      await withSpinner('标记已读…', () => markAsRead({ sourceType, sourceId }));

      // 后端 204 无 body，本地兜底文案
      output({ message: '已标记该订阅源全部内容为已读（不可逆）' }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
