// commands/sub/mark-read：mock fetch + 验证整源已读 body 与 --all 必填校验
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerSubMarkRead } from '../../../src/commands/sub/mark-read.ts';
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
  registerSubMarkRead(sub);
  return program;
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

describe('commands/sub/mark-read - 标记已读', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let captured: Captured;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    captured = { url: '', method: '', body: null };

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ api_key: 'sk_markread_ok', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      captured.method = init?.method ?? 'GET';
      const raw = init?.body;
      captured.body = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null);
      // 后端成功为 204 无 body
      return new Response(null, { status: 204 });
    };
  });

  afterEach(async () => {
    process.stdout.write = originalStdout;
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await cleanupAuthFields();
  });

  test('--all 整源：POST body 只含 sourceType / sourceId', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'mark-read',
      '--source-id',
      '25',
      '--type',
      'mp',
      '--all',
    ]);
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/subscriptions/contents/mark-as-read');
    expect(captured.body).toEqual({ sourceType: 'MP', sourceId: 25 });
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe('已标记该订阅源全部内容为已读（不可逆）');
  });

  test('不给 --all 抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'mark-read',
        '--source-id',
        '1',
        '--type',
        'MP',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('--all');
    expect(fetched).toBe(false);
  });

  // 单篇已读已移除：老 skills 仍可能传 --content-id，要给「为什么不支持」而不是 unknown option
  test('--content-id（单篇写法）抛 INVALID_ARGS 并说明原因（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'mark-read',
        '--source-id',
        '1',
        '--type',
        'MP',
        '--content-id',
        'zRTT6XmyB5HEVOU2MVFHXA',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('不支持单篇标记已读');
    expect(fetched).toBe(false);
  });

  test('非法 --type 抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'mark-read',
        '--source-id',
        '1',
        '--type',
        'blog',
        '--all',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
