// packages/cli/src/commands/deepread/show.ts
// 读取他人分享的精读。这是唯一能消费「不属于本账号」内容的入口，且无需登录。
import type { Command } from 'commander';
import { getSharedDeepRead } from '../../api/deep-read.ts';
import { briefContent, renderCard } from '../../lib/deep-read-render.ts';
import type { SharedDeepRead } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';

function render(data: SharedDeepRead): void {
  renderCard(
    {
      sourceType: 'SHARED',
      contentId: '',
      title: data.title,
      url: data.url,
      requestedAt: Date.now(),
      status: 'done',
      checkedAt: Date.now(),
      content: data.content,
    },
    { brief: !data.content?.body },
  );
}

export function registerDeepReadShow(parent: Command): void {
  parent
    .command('show')
    .description('查看他人分享的精读（无需登录）')
    .requiredOption('--share-code <code>', '分享码（分享链接 /s/<code> 里的那段）')
    .option('--brief', '精简输出：省略正文 sections')
    .action(async (opts: { shareCode: string; brief?: boolean }) => {
      const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
      const data = await withSpinner('读取分享精读…', () => getSharedDeepRead(opts.shareCode));
      const payload: SharedDeepRead = opts.brief
        ? { ...data, content: briefContent(data.content) }
        : data;
      output(payload, fmt, render);
    });
}
