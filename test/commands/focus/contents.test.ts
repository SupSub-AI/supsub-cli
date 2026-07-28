// commands/focus/contents：参数校验（parseFocusId / 互斥）+ 请求构造
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { parseFocusId } from '../../../src/commands/focus/_args.ts';
import { registerFocusContents } from '../../../src/commands/focus/contents.ts';
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
  const focus = program.command('focus');
  registerFocusContents(focus);
  return program;
}

// ─── 纯函数：parseFocusId ─────────────────────────────────────
describe('commands/focus/_args - parseFocusId', () => {
  test('正整数字符串解析为 number', () => {
    expect(parseFocusId('42')).toBe(42);
  });

  test('零抛出 INVALID_ARGS', () => {
    let caught: unknown;
    try {
      parseFocusId('0');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
  });

  test('负数抛出 INVALID_ARGS', () => {
    expect(() => parseFocusId('-3')).toThrow();
  });

  test('小数抛出 INVALID_ARGS（非整数）', () => {
    expect(() => parseFocusId('3.14')).toThrow();
  });

  test('非数字字符串抛出 INVALID_ARGS', () => {
    let caught: unknown;
    try {
      parseFocusId('abc');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('abc');
  });
});

// ─── 命令行为：请求构造 + 校验拦截 ────────────────────────────
describe('commands/focus/contents - 查看关注点内容', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let originalStdout: typeof process.stdout.write;
  let receivedUrl: string;
  let fetched: boolean;
  let stdoutOutput: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    receivedUrl = '';
    fetched = false;
    stdoutOutput = '';

    // 捕获命令产生的 stdout（多数用例只断言请求构造与校验拦截，--brief 用例会检查输出字段）
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_focus_ok', client_id: 'supsub-cli' }, null, 2),
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
      return new Response(JSON.stringify([]), {
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

  test('默认请求 type=unread，focusId 落在路径，固定 page/pageSize', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'contents',
      '--id',
      '42',
    ]);
    expect(receivedUrl).toContain('/api/focuses/42/contents');
    expect(receivedUrl).toContain('type=unread');
    expect(receivedUrl).toContain('page=1');
    expect(receivedUrl).toContain('pageSize=20');
  });

  test('--all 请求 type=all', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'contents',
      '--id',
      '42',
      '--all',
    ]);
    expect(receivedUrl).toContain('type=all');
  });

  test('--id 非正整数抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'focus', 'contents', '--id', '0']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--id 非数字抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'focus', 'contents', '--id', 'abc']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--page 2 --page-size 50 透传到 query', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'contents',
      '--id',
      '42',
      '--page',
      '2',
      '--page-size',
      '50',
    ]);
    expect(receivedUrl).toContain('page=2');
    expect(receivedUrl).toContain('pageSize=50');
  });

  test('--page-size 200 超上限抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'focus',
        'contents',
        '--id',
        '42',
        '--page-size',
        '200',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--all 与 --unread 互斥抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'focus',
        'contents',
        '--id',
        '42',
        '--all',
        '--unread',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('互斥');
    expect(fetched).toBe(false);
  });

  test('--brief 保留跨源聚合字段（sourceType/sourceName），丢掉 summary/url', async () => {
    globalThis.fetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          {
            contentId: 'AwOk3di8m6eVeIUjzNftgg',
            url: 'https://mp.weixin.qq.com/s/yyy',
            title: '关注点内容',
            coverImage: '',
            keywords: ['a'],
            tags: ['b'],
            summary: '很长的摘要'.repeat(50),
            sourceType: 'MP',
            sourceName: '量子位',
            publishedAt: 1784790480,
            isRead: false,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'contents',
      '--id',
      '42',
      '--brief',
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(Object.keys(parsed.data[0]).sort()).toEqual([
      'contentId',
      'isRead',
      'publishedAt',
      'publishedAtText',
      'sourceName',
      'sourceType',
      'title',
    ]);
    expect(parsed.data[0].summary).toBeUndefined();
    expect(parsed.data[0].publishedAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('非 brief 的 json 也补 publishedAtText', async () => {
    globalThis.fetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          {
            contentId: 'c1',
            url: 'u',
            title: 't',
            coverImage: '',
            keywords: [],
            tags: [],
            summary: 's',
            sourceType: 'MP',
            sourceName: 'n',
            publishedAt: 1784790480,
            isRead: true,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'contents',
      '--id',
      '42',
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data[0].summary).toBe('s');
    expect(parsed.data[0].publishedAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
