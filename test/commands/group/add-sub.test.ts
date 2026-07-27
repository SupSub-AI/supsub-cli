// commands/group/add-sub：读-改-写全量覆盖（保留异构成员、剥离多余字段、幂等、404 拦截）
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerGroupAddSub } from '../../../src/commands/group/add-sub.ts';
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
  const group = program.command('group');
  registerGroupAddSub(group);
  return program;
}

// 组内已有成员：一个 MP + 一个网页端加入的 PODCAST（带完整展示字段）
const MEMBERS_FIXTURE = [
  {
    sourceType: 'MP',
    sourceId: 1,
    name: '已有公众号',
    img: 'http://x/1.png',
    description: 'desc',
    inGroup: true,
    unreadCount: 3,
  },
  {
    sourceType: 'PODCAST',
    sourceId: 5,
    name: '某播客',
    img: 'http://x/5.png',
    description: 'desc',
    inGroup: true,
    unreadCount: 0,
  },
];

describe('commands/group/add-sub - 加入分组（读-改-写）', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let postBody: unknown;
  let postCount: number;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    postBody = null;
    postCount = 0;

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ api_key: 'sk_addsub', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    // 按 method 路由：GET 返回成员夹具，POST 捕获 body 返回 204
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify(MEMBERS_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      postCount += 1;
      const raw = init?.body;
      postBody = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null);
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

  test('新成员：POST 全量数组 = 现有成员(剥离展示字段、PODCAST 原样保留) + 新成员', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'add-sub',
      '--id',
      '9',
      '--source-id',
      '2',
      '--type',
      'mp',
    ]);
    expect(postCount).toBe(1);
    expect(postBody).toEqual([
      { sourceType: 'MP', sourceId: 1 },
      { sourceType: 'PODCAST', sourceId: 5 },
      { sourceType: 'MP', sourceId: 2 },
    ]);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.message).toBe('已将订阅源加入分组');
  });

  test('幂等：已在组中不发 POST，提示成功', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'add-sub',
      '--id',
      '9',
      '--source-id',
      '1',
      '--type',
      'MP',
    ]);
    expect(postCount).toBe(0);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toContain('已在分组中');
  });

  test('分组不存在：GET 404 错误原样抛出且无 POST', async () => {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ code: 'NotFound', message: '分组不存在', status: 404 }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      postCount += 1;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'group',
        'add-sub',
        '--id',
        '999999999',
        '--source-id',
        '2',
        '--type',
        'MP',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('NotFound');
    expect(postCount).toBe(0);
  });

  test('--type PODCAST 不在 add-sub 白名单，抛 INVALID_ARGS（不请求）', async () => {
    let anyFetch = false;
    globalThis.fetch = async (): Promise<Response> => {
      anyFetch = true;
      return new Response('[]');
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        'group',
        'add-sub',
        '--id',
        '9',
        '--source-id',
        '5',
        '--type',
        'PODCAST',
      ]);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(anyFetch).toBe(false);
  });
});
