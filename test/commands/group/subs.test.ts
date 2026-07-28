// commands/group/subs：groupOnly 两态 + type 过滤 + inGroup 渲染
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerGroupSubs } from '../../../src/commands/group/subs.ts';
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
  registerGroupSubs(group);
  return program;
}

const FIXTURE = [
  {
    sourceType: 'MP',
    sourceId: 143,
    name: '远行者与碎冰匠',
    img: '',
    description: '讲故事的人',
    inGroup: true,
    unreadCount: 4,
  },
  {
    sourceType: 'PODCAST',
    sourceId: 55,
    name: '某播客',
    img: '',
    description: '',
    inGroup: false,
  },
];

describe('commands/group/subs - 分组订阅源', () => {
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
      JSON.stringify({ access_token: 'sk_group_subs', client_id: 'supsub-cli' }, null, 2),
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

  test('默认 groupOnly=true 且无 sourceType 过滤', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'group', 'subs', '--id', '9']);
    expect(receivedUrl).toContain('/api/groups/9/subscriptions');
    expect(receivedUrl).toContain('groupOnly=true');
    expect(receivedUrl).not.toContain('sourceType=');
  });

  test('--all 请求 groupOnly=false，table 渲染 inGroup ✓', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', 'group', 'subs', '--id', '9', '--all']);
    expect(receivedUrl).toContain('groupOnly=false');
    expect(stdoutOutput).toContain('inGroup');
    expect(stdoutOutput).toContain('✓');
    expect(stdoutOutput).toContain('播客');
  });

  test('--type podcast 大写化透传 sourceType=PODCAST', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'subs',
      '--id',
      '9',
      '--type',
      'podcast',
    ]);
    expect(receivedUrl).toContain('sourceType=PODCAST');
  });

  test('非法 --type 抛 INVALID_ARGS（不请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'group', 'subs', '--id', '9', '--type', 'rss']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('默认 table 渲染 unreadCount 列', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', 'group', 'subs', '--id', '9']);
    expect(stdoutOutput).toContain('unreadCount');
    expect(stdoutOutput).toContain('远行者与碎冰匠');
  });
});
