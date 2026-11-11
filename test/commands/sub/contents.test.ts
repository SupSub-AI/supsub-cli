// commands/sub/contents：请求构造（默认翻页/自定义翻页）+ 校验拦截 + contentId 渲染
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerSubContents } from '../../../src/commands/sub/contents.ts';
import { configDir, configFile } from '../../_helpers/config-path.ts';

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
    /* ignore */
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('supsub')
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .exitOverride();
  const sub = program.command('sub');
  registerSubContents(sub);
  return program;
}

// 2026-07 实测线上契约：内容 ID 字段为 contentId（非旧版 articleId）
const FIXTURE = [
  {
    contentId: 'zRTT6XmyB5HEVOU2MVFHXA',
    url: 'https://mp.weixin.qq.com/s/xxx',
    title: '测试文章',
    originalTitle: '测试文章的原始标题',
    coverImage: '',
    tags: [],
    summary: '',
    publishedAt: 1784790480,
    isRead: false,
  },
];

describe('commands/sub/contents - 查看订阅源内容', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let receivedUrl: string;
  let fetched: boolean;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    receivedUrl = '';
    fetched = false;

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_contents_ok', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      fetched = true;
      receivedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      return new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(async () => {
    process.stdout.write = originalStdout;
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await cleanupAuthFields();
  });

  test('默认 type=unread 且 page=1&pageSize=20（向后兼容回归）', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      'MP',
    ]);
    expect(receivedUrl).toContain('/api/subscriptions/contents');
    expect(receivedUrl).toContain('type=unread');
    expect(receivedUrl).toContain('page=1');
    expect(receivedUrl).toContain('pageSize=20');
  });

  test('--page 3 --page-size 50 透传到 query', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      'MP',
      '--page',
      '3',
      '--page-size',
      '50',
    ]);
    expect(receivedUrl).toContain('page=3');
    expect(receivedUrl).toContain('pageSize=50');
  });

  test.each([
    'MP',
    'WEBSITE',
    'X',
  ])('%s 的 json 输出透传 contentId、title 和 originalTitle', async (sourceType) => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      sourceType,
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data[0].contentId).toBe('zRTT6XmyB5HEVOU2MVFHXA');
    expect(parsed.data[0].title).toBe('测试文章');
    expect(parsed.data[0].originalTitle).toBe('测试文章的原始标题');
  });

  test('table 输出渲染 contentId 列', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      'MP',
    ]);
    expect(stdoutOutput).toContain('contentId');
    // 列宽 20，22 字符的 contentId 会被截断成前缀 + …
    expect(stdoutOutput).toContain('zRTT6XmyB5HEVOU2M');
  });

  test('json 输出补 publishedAtText（agent 不必自己转 Unix 时间戳）', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      'MP',
    ]);
    const parsed = JSON.parse(stdoutOutput);
    // 原始值保留（便于排序），另补可读文本
    expect(parsed.data[0].publishedAt).toBe(1784790480);
    expect(parsed.data[0].publishedAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test.each([
    'MP',
    'WEBSITE',
    'X',
  ])('%s 的 --brief 保留 contentId/title/originalTitle/publishedAt(+Text)/isRead', async (sourceType) => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      '143',
      '--type',
      sourceType,
      '--brief',
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(Object.keys(parsed.data[0]).sort()).toEqual([
      'contentId',
      'isRead',
      'originalTitle',
      'publishedAt',
      'publishedAtText',
      'title',
    ]);
    expect(parsed.data[0].title).toBe('测试文章');
    expect(parsed.data[0].originalTitle).toBe('测试文章的原始标题');
    // summary / url / coverImage / tags 是撑爆输出的元凶，必须被丢掉
    expect(parsed.data[0].summary).toBeUndefined();
    expect(parsed.data[0].url).toBeUndefined();
  });

  test('--id 是 --source-id 的别名（focus contents 用 --id，两边易混）', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'contents',
      '--id',
      '143',
      '--type',
      'MP',
    ]);
    expect(receivedUrl).toContain('sourceId=143');
  });

  test('--source-id 与 --id 都不给 → INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'sub', 'contents', '--type', 'MP']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--page 0 抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'contents',
        '--source-id',
        '143',
        '--type',
        'MP',
        '--page',
        '0',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--page-size 101 抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'contents',
        '--source-id',
        '143',
        '--type',
        'MP',
        '--page-size',
        '101',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--page-size 非数字抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'contents',
        '--source-id',
        '143',
        '--type',
        'MP',
        '--page-size',
        'abc',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
