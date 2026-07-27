// packages/cli/src/commands/group/add-sub.ts
import type { Command } from 'commander';
import { setGroupSubs } from '../../api/group.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { normalizeType, parseSourceId } from '../sub/_args.ts';
import { parseGroupId } from './_args.ts';
import { dedupeMembers, memberEquals, readMembers } from './_members.ts';

export function registerGroupAddSub(parent: Command): void {
  parent
    .command('add-sub')
    .description('把订阅源加入分组（读-改-写全量覆盖，勿与网页端并发编辑同一分组）')
    .requiredOption('--id <id>', '分组 ID')
    .requiredOption('--source-id <sid>', '订阅源 ID（来自 sub list）')
    .requiredOption('--type <type>', '订阅源类型：MP|WEBSITE|X（X=推特）')
    .action(async (opts: { id: string; sourceId: string; type: string }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const groupId = parseGroupId(opts.id);
      const target = {
        sourceType: normalizeType(opts.type),
        sourceId: parseSourceId(opts.sourceId),
      };

      const message = await withSpinner('更新分组订阅源…', async () => {
        const members = await readMembers(groupId);
        if (members.some((m) => memberEquals(m, target))) {
          // 幂等：已在组中不重复写入（也避免无意义的全量覆盖窗口）
          return '该订阅源已在分组中，无需重复添加';
        }
        await setGroupSubs({ groupId, members: dedupeMembers([...members, target]) });
        return '已将订阅源加入分组';
      });

      output({ message }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}
