// packages/cli/src/commands/deepread/get.ts
// 取精读结果。默认优先用本地缓存（done 是终态，结果不可变），--refresh 强制回源。

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { getDeepRead } from '../../api/deep-read.ts';
import { briefContent, renderCard, renderMarkdown } from '../../lib/deep-read-render.ts';
import { readEntry } from '../../lib/deep-read-store.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import {
  type DeepReadPayload,
  parseRef,
  parseTimeout,
  persist,
  pollUntilSettled,
  statusText,
  toPayload,
} from './_shared.ts';

function render(payload: DeepReadPayload & { outPath?: string }): void {
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
    if (payload.outPath) process.stdout.write(`已导出    ${payload.outPath}\n`);
    return;
  }
  process.stdout.write(`${payload.title ?? payload.contentId}\n`);
  process.stdout.write(`状态  ${statusText(payload.status)}\n`);
  if (payload.status === 'none') {
    process.stdout.write('尚未精读过，可运行 supsub deepread run 发起（会消耗一次额度）\n');
  }
}

export function registerDeepReadGet(parent: Command): void {
  parent
    .command('get')
    .description('查看精读结果（优先本地缓存）')
    .requiredOption('--type <type>', '信息源类型：MP|WEBSITE|X（X=推特）')
    .requiredOption('--content-id <id>', '内容 ID')
    // 精读接口本身不返回标题，展示信息只能由调用方从 contents/search 结果带入；
    // 缺了不影响功能，但本地 .md 的标题行会退化成 contentId，个人精读库就不好读了。
    .option('--title <title>', '文章标题（补写进本地缓存）')
    .option('--source-name <name>', '信息源名称（补写进本地缓存）')
    .option('--url <url>', '原文链接（补写进本地缓存）')
    .option('--brief', '精简输出：省略正文 sections')
    .option('--refresh', '忽略本地缓存，强制回服务端查')
    .option('--wait', 'pending 时等到落定（默认不等）')
    .option('--timeout <sec>', '等待上限秒数（默认 180，上限 600）')
    .option('--out <file>', '把精读全文导出为 Markdown 文件')
    .action(
      async (opts: {
        type: string;
        contentId: string;
        title?: string;
        sourceName?: string;
        url?: string;
        brief?: boolean;
        refresh?: boolean;
        wait?: boolean;
        timeout?: string;
        out?: string;
      }) => {
        const fmt = (parent.parent?.opts().output ?? undefined) as string | undefined;
        const ref = parseRef(opts);
        const timeoutMs = parseTimeout(opts.timeout) * 1000;
        const meta = { title: opts.title, sourceName: opts.sourceName, url: opts.url };

        const cached = await readEntry(ref.sourceType, ref.contentId);
        const useCache = !opts.refresh && cached?.status === 'done' && cached.content;

        const entry = useCache
          ? // 命中缓存也要吸收本次带入的展示信息（首次 get 时往往还没有标题）
            (await persist(ref, { status: 'done', content: cached.content }, meta)).entry
          : (
              await persist(
                ref,
                await withSpinner('查询精读结果…', async () => {
                  const resp = await getDeepRead(ref);
                  if (resp.status === 'pending' && opts.wait) {
                    return await pollUntilSettled(ref, timeoutMs);
                  }
                  return resp;
                }),
                meta,
              )
            ).entry;

        let outPath: string | undefined;
        if (opts.out && entry.status === 'done' && entry.content) {
          outPath = path.resolve(opts.out);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, renderMarkdown(entry), 'utf-8');
        }

        const payload = {
          ...(await toPayload(entry, {
            content: opts.brief ? briefContent(entry.content) : entry.content,
          })),
          outPath,
        };
        output(payload, fmt, render);
      },
    );
}
