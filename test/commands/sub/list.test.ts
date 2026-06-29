// commands/sub/list：mock fetch + JSON 输出 + --type 透传
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerSubList } from '../../../src/commands/sub/list.ts';
import { configDir, configFile } from '../../_helpers/config-path.ts';

const CONFIG_DIR = configDir();
const CONFIG_FILE = configFile();

async function cleanupAuthFields(): Promise<void> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const { api_key: _a, client_id: _c, bearer_token: _b, ...rest } = parsed;
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
  registerSubList(sub);
  return program;
}

const FAKE_SUBS = [
  {
    sourceId: '1',
    sourceType: 'MP',
    name: 'OpenAI',
    description: 'AI lab',
    unreadCount: 3,
  },
  {
    sourceId: '2',
    sourceType: 'WEBSITE',
    name: 'Hacker News',
    description: 'tech news',
    unreadCount: 0,
  },
];

describe('commands/sub/list - 列出订阅源', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let receivedUrl: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    receivedUrl = '';

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ api_key: 'sk_list_ok', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      receivedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      return new Response(JSON.stringify(FAKE_SUBS), {
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

  test('JSON 模式输出 { success: true, data: [...] }', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'sub', 'list']);

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].sourceId).toBe('1');
  });

  test('不传 --type 时请求 URL 不带 sourceType 参数', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'sub', 'list']);
    expect(receivedUrl).toContain('/api/subscriptions');
    expect(receivedUrl).not.toContain('sourceType=');
  });

  test('--type mp 经 normalizeType 透传为 sourceType=MP', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'sub', 'list', '--type', 'mp']);
    expect(receivedUrl).toContain('sourceType=MP');
  });

  test('--type x 经 normalizeType 透传为 sourceType=X（推特）', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'sub', 'list', '--type', 'x']);
    expect(receivedUrl).toContain('sourceType=X');
  });

  test('表格模式下 sourceType=X 渲染为「推特」', async () => {
    globalThis.fetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          {
            sourceId: '9',
            sourceType: 'X',
            name: 'Elon',
            description: 'tweets',
            unreadCount: 1,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const program = buildProgram();
    // 默认 table 输出
    await program.parseAsync(['node', 'supsub', 'sub', 'list']);
    expect(stdoutOutput).toContain('推特');
  });

  test('非法 --type 抛 INVALID_ARGS（不发起请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response('[]');
    };

    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'sub', 'list', '--type', 'blog']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
