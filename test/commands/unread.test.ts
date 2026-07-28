// commands/unread：并发聚合 sub list + focus list，过滤语义与两段渲染
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerUnread } from '../../src/commands/unread.ts';
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
    /* ignore */
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('supsub')
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .exitOverride();
  registerUnread(program);
  return program;
}

const SUBS_FIXTURE = [
  {
    sourceType: 'MP',
    sourceId: 25,
    name: '量子位',
    img: '',
    description: '',
    unreadCount: 194,
  },
  {
    sourceType: 'WEBSITE',
    sourceId: 8,
    name: '已读完的网站',
    img: '',
    description: '',
    unreadCount: 0,
  },
];

const FOCUSES_FIXTURE = [
  { id: 674, icon: '🔖', title: 'Agent 设计模式', unreadCount: 299 },
  { id: 664, icon: '🔖', title: '已读完的关注点', unreadCount: 0 },
];

describe('commands/unread - 未读概览', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let requestedUrls: string[];

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    requestedUrls = [];

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_unread', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    // 按 url 路由两个列表端点
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      requestedUrls.push(url);
      const fixture = url.includes('/api/focuses') ? FOCUSES_FIXTURE : SUBS_FIXTURE;
      return new Response(JSON.stringify(fixture), {
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

  test('两个列表端点都被请求', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'unread']);
    expect(requestedUrls.some((u) => u.includes('/api/subscriptions'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/api/focuses'))).toBe(true);
  });

  test('默认过滤 unreadCount=0 的项', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'unread']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.subscriptions).toHaveLength(1);
    expect(parsed.data.subscriptions[0].sourceId).toBe(25);
    expect(parsed.data.focuses).toHaveLength(1);
    expect(parsed.data.focuses[0].id).toBe(674);
  });

  test('--all 不过滤', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'unread', '--all']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.subscriptions).toHaveLength(2);
    expect(parsed.data.focuses).toHaveLength(2);
  });

  test('table 输出含「订阅源」「关注点」两段', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', 'unread']);
    expect(stdoutOutput).toContain('订阅源 (1 items)');
    expect(stdoutOutput).toContain('关注点 (1 items)');
    expect(stdoutOutput).toContain('量子位');
    expect(stdoutOutput).toContain('Agent 设计模式');
  });
});
