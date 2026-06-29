// commands/sub/add：mock fetch + 验证 --mp-id / --source-id 互斥分支与 body
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerSubAdd } from '../../../src/commands/sub/add.ts';
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
  registerSubAdd(sub);
  return program;
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

describe('commands/sub/add - 添加订阅', () => {
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
      JSON.stringify({ api_key: 'sk_add_ok', client_id: 'supsub-cli' }, null, 2),
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
      if (typeof raw === 'string') {
        try {
          captured.body = JSON.parse(raw);
        } catch {
          captured.body = raw;
        }
      } else {
        captured.body = raw ?? null;
      }
      return new Response(JSON.stringify({ message: '订阅成功' }), {
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

  test('--mp-id 走 POST /api/mps，body 含 mpId', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'add',
      '--mp-id',
      'MzkyNTYzODk0NQ==',
    ]);

    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/mps');
    expect(captured.url).not.toContain('/api/mps/search-tasks');
    expect(captured.body).toEqual({ mpId: 'MzkyNTYzODk0NQ==' });
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe('订阅成功');
  });

  test('--mp-id 配 --group 透传 groupIds 数组', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'add',
      '--mp-id',
      'abc==',
      '--group',
      '3',
      '--group',
      '7',
    ]);
    expect(captured.body).toEqual({ mpId: 'abc==', groupIds: [3, 7] });
  });

  test('--mp-id 显式 --type MP 允许', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'add',
      '--mp-id',
      'abc==',
      '--type',
      'mp',
    ]);
    expect(captured.url).toContain('/api/mps');
  });

  test('--mp-id 配 --type WEBSITE 抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response('{}');
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'add',
        '--mp-id',
        'abc==',
        '--type',
        'WEBSITE',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('--source-id + --type MP 走 POST /api/subscriptions', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'add',
      '--source-id',
      '693',
      '--type',
      'MP',
    ]);
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/subscriptions');
    expect(captured.body).toEqual({ sourceType: 'MP', sourceId: 693 });
  });

  test('--source-id + --type X（推特）走 POST /api/subscriptions，body 含 sourceType:X', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'sub',
      'add',
      '--source-id',
      '42',
      '--type',
      'x',
    ]);
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/subscriptions');
    expect(captured.body).toEqual({ sourceType: 'X', sourceId: 42 });
  });

  test('--source-id 不带 --type 抛 INVALID_ARGS', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response('{}');
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'sub', 'add', '--source-id', '1']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('同时给 --mp-id 与 --source-id 抛 INVALID_ARGS', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response('{}');
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'sub',
        'add',
        '--mp-id',
        'abc==',
        '--source-id',
        '1',
        '--type',
        'MP',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('两个都不给抛 INVALID_ARGS', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'sub', 'add', '--type', 'MP']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
  });
});
