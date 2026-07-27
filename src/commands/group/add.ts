// packages/cli/src/commands/group/add.ts
import type { Command } from 'commander';
import { createGroup } from '../../api/group.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';

export function registerGroupAdd(parent: Command): void {
  parent
    .command('add')
    .description('创建订阅分组')
    .argument('<name>', '分组名称')
    .action(async (name: string) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      const trimmed = name.trim();
      if (!trimmed) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '分组名称不能为空',
        } satisfies ErrorEnvelope;
      }

      const created = await withSpinner('创建分组…', () => createGroup({ name: trimmed }));

      // 把入参 name 拼回结果，方便调用方（尤其是 agent）直接拿 id 接续后续操作
      const data = { id: created.id, name: trimmed };
      output(data, fmt, (d) => {
        printTable({
          headers: ['id', 'name'],
          rows: [[d.id, d.name]],
        });
      });
    });
}
