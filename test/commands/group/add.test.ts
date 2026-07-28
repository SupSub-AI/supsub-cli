// commands/group/add：位置参数 + POST body + 201 结果拼装
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerGroupAdd } from '../../../src/commands/group/add.ts';
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
  const group = program.command('group');
  registerGroupAdd(group);
  return program;
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

describe('commands/group/add - 创建分组', () => {
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
      JSON.stringify({ access_token: 'sk_group_add', client_id: 'supsub-cli' }, null, 2),
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
      // 2026-07 实测：创建返回 201 + {id: int}（api.json 声明 string，宽容处理）
      return new Response(JSON.stringify({ id: 1182 }), {
        status: 201,
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

  test('位置参数：POST /api/groups body {name}，结果拼回 name', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'group', 'add', 'AI 周报']);
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/groups');
    expect(captured.body).toEqual({ name: 'AI 周报' });
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ id: 1182, name: 'AI 周报' });
  });

  test('名称两端空白被 trim 后提交', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'group', 'add', '  财经  ']);
    expect(captured.body).toEqual({ name: '财经' });
  });

  test('纯空白名称抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response('{}');
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'group', 'add', '   ']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
