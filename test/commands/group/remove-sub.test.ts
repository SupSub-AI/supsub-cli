// commands/group/remove-sub：读-改-写（命中移除、大小写不敏感、幂等）
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerGroupRemoveSub } from '../../../src/commands/group/remove-sub.ts';
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
  registerGroupRemoveSub(group);
  return program;
}

const MEMBERS_FIXTURE = [
  {
    sourceType: 'MP',
    sourceId: 1,
    name: '公众号一',
    img: '',
    description: '',
    inGroup: true,
    unreadCount: 0,
  },
  {
    sourceType: 'PODCAST',
    sourceId: 5,
    name: '某播客',
    img: '',
    description: '',
    inGroup: true,
    unreadCount: 0,
  },
];

describe('commands/group/remove-sub - 移出分组（读-改-写）', () => {
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
      JSON.stringify({ api_key: 'sk_removesub', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

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

  test('命中移除：POST body 为剩余成员（--type mp 小写也能命中 MP）', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'remove-sub',
      '--id',
      '9',
      '--source-id',
      '1',
      '--type',
      'mp',
    ]);
    expect(postCount).toBe(1);
    expect(postBody).toEqual([{ sourceType: 'PODCAST', sourceId: 5 }]);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.message).toBe('已将订阅源移出分组');
  });

  test('幂等：不在组中不发 POST，提示成功', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'remove-sub',
      '--id',
      '9',
      '--source-id',
      '42',
      '--type',
      'MP',
    ]);
    expect(postCount).toBe(0);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toContain('不在分组中');
  });
});
