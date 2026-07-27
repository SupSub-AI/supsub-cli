// commands/deepread run/get：预检语义（不重复扣额度）、本地缓存命中、--no-wait、--brief
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { pollUntilSettled } from '../../../src/commands/deepread/_shared.ts';
import { registerDeepReadGet } from '../../../src/commands/deepread/get.ts';
import { registerDeepReadRun } from '../../../src/commands/deepread/run.ts';
import { setCliApiKey } from '../../../src/http/credentials.ts';
import { deepReadRootDir } from '../../../src/lib/deep-read-store.ts';

const DONE_BODY = {
  status: 'done',
  version: 'v1',
  content: {
    essence: '一句话本质',
    quality: { grade: '低', comment: '灌水' },
    keyPoints: ['要点一'],
    body: { sections: [{ title: '第一节', markdown: '正文' }] },
    annotations: {
      background: '背景',
      stance: '立场',
      credibility: { grade: '低', reason: '无信源' },
      weakestLink: '最弱一环',
    },
  },
};

type Call = { method: string; url: string };

function buildProgram(): Command {
  const program = new Command();
  program
    .name('supsub')
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .exitOverride();
  const deepread = program.command('deepread');
  registerDeepReadRun(deepread);
  registerDeepReadGet(deepread);
  return program;
}

describe('commands/deepread - run / get', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let originalStdout: typeof process.stdout.write;
  let stdoutOutput: string;
  let calls: Call[];
  let getStatus: 'none' | 'pending' | 'done' | 'failed';

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    setCliApiKey('sk_deepread_test');
    stdoutOutput = '';
    calls = [];
    getStatus = 'none';

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url });

      if (method === 'POST') return new Response('Accepted', { status: 202 });
      const body = getStatus === 'done' ? DONE_BODY : { status: getStatus };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(async () => {
    process.stdout.write = originalStdout;
    globalThis.fetch = originalFetch;
    setCliApiKey(undefined);
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await fs.rm(deepReadRootDir(), { recursive: true, force: true });
  });

  test('status=none 时先预检再 POST，quotaSpent=true', async () => {
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c1',
      '--no-wait',
    ]);
    const data = JSON.parse(stdoutOutput).data;
    expect(calls[0]?.method).toBe('GET');
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(data.quotaSpent).toBe(true);
    expect(data.status).toBe('pending');
  });

  test('预检already done：不 POST、不扣额度，直接出结果', async () => {
    getStatus = 'done';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c2',
    ]);
    const data = JSON.parse(stdoutOutput).data;
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(data.quotaSpent).toBe(false);
    expect(data.status).toBe('done');
    expect(data.content.essence).toBe('一句话本质');
  });

  test('预检 pending：不重复 POST', async () => {
    getStatus = 'pending';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c3',
      '--no-wait',
    ]);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(JSON.parse(stdoutOutput).data.quotaSpent).toBe(false);
  });

  test('本地缓存命中 done：零网络请求', async () => {
    getStatus = 'done';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c4',
      '--title',
      '缓存标题',
    ]);
    const firstRound = calls.length;
    expect(firstRound).toBeGreaterThan(0);

    stdoutOutput = '';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c4',
    ]);
    expect(calls.length).toBe(firstRound); // 没有新增请求
    const data = JSON.parse(stdoutOutput).data;
    expect(data.status).toBe('done');
    expect(data.title).toBe('缓存标题'); // 展示信息也从缓存带回
  });

  test('done 时给出本地 .md 路径（cachePath），并真的写了文件', async () => {
    getStatus = 'done';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c5',
      '--title',
      'T',
    ]);
    const data = JSON.parse(stdoutOutput).data;
    expect(data.cachePath.endsWith('.md')).toBe(true);
    expect(await fs.exists(data.cachePath)).toBe(true);
    expect(await fs.readFile(data.cachePath, 'utf-8')).toContain('# T');
  });

  test('--brief 丢正文但保留卡片四件套', async () => {
    getStatus = 'done';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'run',
      '--type',
      'MP',
      '--content-id',
      'c6',
      '--brief',
    ]);
    const c = JSON.parse(stdoutOutput).data.content;
    expect(c.body).toBeUndefined();
    expect(c.essence).toBe('一句话本质');
    expect(c.annotations.weakestLink).toBe('最弱一环');
  });

  test('get 在从未精读过时返回 status=none 且不报错（退出码 0）', async () => {
    getStatus = 'none';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'get',
      '--type',
      'MP',
      '--content-id',
      'c7',
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('none');
  });

  test('get --out 导出 Markdown 到指定路径', async () => {
    getStatus = 'done';
    const out = `${deepReadRootDir()}/exported/a.md`;
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'get',
      '--type',
      'MP',
      '--content-id',
      'c8',
      '--title',
      '导出标题',
      '--out',
      out,
    ]);
    expect(await fs.readFile(out, 'utf-8')).toContain('# 导出标题');
  });

  test('get --refresh 忽略缓存，重新请求服务端', async () => {
    getStatus = 'done';
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'get',
      '--type',
      'MP',
      '--content-id',
      'c9',
    ]);
    const n = calls.length;
    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'get',
      '--type',
      'MP',
      '--content-id',
      'c9',
      '--refresh',
    ]);
    expect(calls.length).toBeGreaterThan(n);
  });

  test('参数校验：--type 非法 / --content-id 空', async () => {
    await expect(
      buildProgram().parseAsync([
        'node',
        'supsub',
        'deepread',
        'run',
        '--type',
        'TWITTER',
        '--content-id',
        'x',
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });

    await expect(
      buildProgram().parseAsync([
        'node',
        'supsub',
        'deepread',
        'run',
        '--type',
        'MP',
        '--content-id',
        '  ',
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });

  test('pollUntilSettled 超时返回 pending 而不是抛错', async () => {
    const before = calls.length;
    const r = await pollUntilSettled({ sourceType: 'MP', contentId: 'c10' }, 0);
    expect(r.status).toBe('pending');
    expect(calls.length).toBe(before); // 超时窗口为 0，一次请求都不该发
  });
});
