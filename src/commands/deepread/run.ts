// packages/cli/src/commands/deepread/run.ts
// 发起精读。默认前台等到出结果（实测 21~32s），--no-wait 只排队。
import type { Command } from 'commander';
import { getDeepRead } from '../../api/deep-read.ts';
import { briefContent, renderCard } from '../../lib/deep-read-render.ts';
import { readEntry } from '../../lib/deep-read-store.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import {
  type DeepReadPayload,
  ensureRequested,
  parseRef,
  parseTimeout,
  persist,
  pollUntilSettled,
  statusText,
  toPayload,
} from './_shared.ts';

function render(payload: DeepReadPayload): void {
  if (payload.status === 'done' && payload.content) {
    renderCard(
      {
        sourceType: payload.sourceType,
        contentId: payload.contentId,
        title: payload.title,
        sourceName: payload.sourceName,
        url: payload.url,
        requestedAt: payload.requestedAt,
        status: payload.status,
        checkedAt: payload.checkedAt,
        content: payload.content,
      },
      { brief: !payload.content.body },
    );
    if (payload.cachePath) process.stdout.write(`本地缓存  ${payload.cachePath}\n`);
    return;
  }

  process.stdout.write(`${payload.title ?? payload.contentId}\n`);
  process.stdout.write(`状态  ${statusText(payload.status)}\n`);
  if (payload.status === 'pending') {
    process.stdout.write(
      `稍后用 supsub deepread list 查看，或 supsub deepread get --type ${payload.sourceType} --content-id ${payload.contentId}\n`,
    );
  }
  if (payload.status === 'failed') {
    process.stdout.write('可重新运行 supsub deepread run 重试\n');
  }
}

export function registerDeepReadRun(parent: Command): void {
  parent
    .command('run')
    .description('发起精读（默认等待结果，实测约 20~40 秒）')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .requiredOption('--content-id <id>', '内容 ID（来自 sub contents / focus contents / search）')
    .option('--title <title>', '文章标题（写入本地队列，便于事后辨认）')
    .option('--source-name <name>', '信息源名称（写入本地队列）')
    .option('--url <url>', '原文链接（写入本地队列）')
    .option('--no-wait', '只发起不等待，立刻返回')
    .option('--timeout <sec>', `等待上限秒数（默认 ${180}，上限 600）`)
    .option('--brief', '精简输出：省略正文 sections，只留本质/成色/要点/批注')
    .action(
      async (opts: {
        type: string;
        contentId: string;
        title?: string;
        sourceName?: string;
        url?: string;
        wait: boolean; // commander 的 --no-wait 会把 wait 置 false
        timeout?: string;
        brief?: boolean;
      }) => {
        const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
        const ref = parseRef(opts);
        const timeoutMs = parseTimeout(opts.timeout) * 1000;
        const meta = { title: opts.title, sourceName: opts.sourceName, url: opts.url };

        // 1) 本地缓存命中 done：直接回，零请求零等待
        const cached = await readEntry(ref.sourceType, ref.contentId);
        if (cached?.status === 'done' && cached.content) {
          const { entry } = await persist(ref, { status: 'done', content: cached.content }, meta);
          const payload = await toPayload(entry, {
            quotaSpent: false,
            content: opts.brief ? briefContent(entry.content) : entry.content,
          });
          output(payload, fmt, render);
          return;
        }

        const result = await withSpinner('精读中…', async () => {
          // 2) 预检：已 done 直接用；pending 不重复 POST；none/failed 才真正发起
          const probe = await getDeepRead(ref);
          const spent = await ensureRequested(ref, probe.status);

          if (probe.status === 'done') return { resp: probe, spent };
          if (!opts.wait) {
            return { resp: { status: 'pending' as const }, spent };
          }
          return { resp: await pollUntilSettled(ref, timeoutMs), spent };
        });

        const { entry } = await persist(ref, result.resp, meta);
        const payload = await toPayload(entry, {
          quotaSpent: result.spent,
          content: opts.brief ? briefContent(entry.content) : entry.content,
        });
        output(payload, fmt, render);
      },
    );
}
