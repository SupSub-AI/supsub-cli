// packages/cli/src/commands/deepread/share.ts
// 生成精读分享链接。
//
// ⚠️ 生成出来的 /s/<code> 页面**无需登录即可访问**（实测：GET /api/deep-reads/shared
// 不校验 Authorization），且 API 没有撤销接口。CLI 本身不做交互确认
// （对齐本项目「CLI 不交互、skills 层强制二次确认」的分工），
// 二次确认写在 skills/supsub-deepread/SKILL.md 里。
import type { Command } from 'commander';
import { shareDeepRead } from '../../api/deep-read.ts';
import { renderMarkdown } from '../../lib/deep-read-render.ts';
import { readEntry, writeEntry } from '../../lib/deep-read-store.ts';
import { shareUrl } from '../../lib/web-url.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { parseRef } from './_shared.ts';

type SharePayload = {
  sourceType: string;
  contentId: string;
  title?: string;
  shareCode: string;
  shareUrl: string;
  /** true 表示复用了之前生成过的分享码，本次没有新建 */
  reused: boolean;
};

function render(p: SharePayload): void {
  process.stdout.write(`${p.title ?? p.contentId}\n`);
  process.stdout.write(`分享链接  ${p.shareUrl}\n`);
  process.stdout.write(
    `${p.reused ? '（复用已有分享码）' : '（新建分享码）'}此链接任何人都可访问，且当前无法撤销\n`,
  );
}

export function registerDeepReadShare(parent: Command): void {
  parent
    .command('share')
    .description('生成精读分享链接（公开可访问，不可撤销）')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .requiredOption('--content-id <id>', '内容 ID')
    .action(async (opts: { type: string; contentId: string }) => {
      const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
      const ref = parseRef(opts);

      const cached = await readEntry(ref.sourceType, ref.contentId);
      if (cached?.shareCode) {
        output(
          {
            ...ref,
            title: cached.title,
            shareCode: cached.shareCode,
            shareUrl: shareUrl(cached.shareCode),
            reused: true,
          },
          fmt,
          render,
        );
        return;
      }

      const { shareCode } = await withSpinner('生成分享链接…', () => shareDeepRead(ref));
      if (cached) {
        await writeEntry({ ...cached, shareCode }, renderMarkdown);
      }

      output(
        {
          ...ref,
          title: cached?.title,
          shareCode,
          shareUrl: shareUrl(shareCode),
          reused: false,
        },
        fmt,
        render,
      );
    });
}
