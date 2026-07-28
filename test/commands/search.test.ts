// commands/search：参数校验与正常调用
import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerSearch } from '../../src/commands/search.ts';
import { configDir, configFile } from '../_helpers/config-path.ts';

const CONFIG_DIR = configDir();
const CONFIG_FILE = configFile();

async function cleanupAuthFields(): Promise<void> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const {
      access_token: _at,
      refresh_token: _rt,
      api_key: _a,
      client_id: _c,
      bearer_token: _b,
      ...rest
    } = parsed;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(rest, null, 2), 'utf-8');
  } catch {
    // 文件不存在则忽略
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('supsub')
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .exitOverride();
  registerSearch(program);
  return program;
}

describe('commands/search - 参数校验', () => {
  test('非法 --type 抛出 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'search', 'openai', '--type', 'BLOG']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('BLOG');
  });

  test('--type 大小写不敏感（all 视为 ALL，请求 URL 携带 type=ALL）', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_search_ok', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    let receivedUrl = '';
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      receivedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // 屏蔽 stdout 噪声
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const program = buildProgram();
      await program.parseAsync([
        'node',
        'supsub',
        '--output',
        'json',
        'search',
        'openai',
        '--type',
        'all',
      ]);
      expect(receivedUrl).toContain('type=ALL');
      expect(receivedUrl).toContain('keywords=openai');
    } finally {
      process.stdout.write = originalStdout;
      globalThis.fetch = originalFetch;
      if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
      else process.env.SUPSUB_API_URL = originalApiUrl;
      await cleanupAuthFields();
    }
  });

  // 2026-07 实测：agent 拿到 search 结果后还得自己 `date -r` 转 Unix 秒，
  // 与 contents 一致地补 publishedAtText 消除这次多余调用。SOURCE 结果无发布时间，不加。
  test('json 输出为 CONTENT 结果补 publishedAtText，SOURCE 结果不受影响', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_search_date', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    globalThis.fetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          results: [
            { type: 'CONTENT', data: { contentId: 'abc', title: 't', publishedAt: 1768519814 } },
            { type: 'SOURCE', data: { sourceId: 1, sourceType: 'MP', name: 'n' } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    let stdoutOutput = '';
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const program = buildProgram();
      await program.parseAsync(['node', 'supsub', '--output', 'json', 'search', 'rag']);
      const parsed = JSON.parse(stdoutOutput);
      const [content, source] = parsed.data.results;
      // 用正则而非固定串：formatDate 按本地时区渲染，断死值会随 TZ 漂移
      expect(content.data.publishedAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      // 原始时间戳保留，调用方仍可用它排序
      expect(content.data.publishedAt).toBe(1768519814);
      expect(source.data.publishedAtText).toBeUndefined();
    } finally {
      process.stdout.write = originalStdout;
      globalThis.fetch = originalFetch;
      if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
      else process.env.SUPSUB_API_URL = originalApiUrl;
      await cleanupAuthFields();
    }
  });
});
