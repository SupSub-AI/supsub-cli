// packages/cli/src/commands/deepread/quota.ts
import type { Command } from 'commander';
import { getDeepReadQuota } from '../../api/deep-read.ts';
import type { DeepReadQuota } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';

function render(q: DeepReadQuota): void {
  process.stdout.write(`本月精读额度  ${q.remaining} / ${q.limit}（已用 ${q.used}）\n`);
}

export function registerDeepReadQuota(parent: Command): void {
  parent
    .command('quota')
    .description('查看本月精读额度余额')
    .action(async () => {
      const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
      const data = await withSpinner('查询额度…', () => getDeepReadQuota());
      output(data, fmt, render);
    });
}
