// packages/cli/src/commands/deepread/drop.ts
// 从本地队列移除一条。删的只是本地缓存——服务端的精读结果还在，
// 之后再 `deepread get` 能重新拉回来且**不会重复扣额度**（实测幂等）。
import type { Command } from 'commander';
import { removeEntry } from '../../lib/deep-read-store.ts';
import { output } from '../../ui/output.ts';
import { parseRef } from './_shared.ts';

function render(p: { removed: boolean; contentId: string }): void {
  process.stdout.write(
    p.removed ? `已从本地队列移除 ${p.contentId}\n` : `本地队列里没有 ${p.contentId}\n`,
  );
}

export function registerDeepReadDrop(parent: Command): void {
  parent
    .command('drop')
    .description('从本地精读队列移除一条（不影响服务端结果）')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .requiredOption('--content-id <id>', '内容 ID')
    .action(async (opts: { type: string; contentId: string }) => {
      const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
      const ref = parseRef(opts);
      const removed = await removeEntry(ref.sourceType, ref.contentId);
      output({ ...ref, removed }, fmt, render);
    });
}
