// commands/group/rename + remove：PUT/DELETE 请求构造与 204 兜底文案
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerGroupRemove } from '../../../src/commands/group/remove.ts';
import { registerGroupRename } from '../../../src/commands/group/rename.ts';
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
  registerGroupRename(group);
  registerGroupRemove(group);
  return program;
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

describe('commands/group/rename & remove', () => {
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
      JSON.stringify({ access_token: 'sk_group_mut', client_id: 'supsub-cli' }, null, 2),
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

  test('rename：PUT /api/groups/{id} body {name}，204 兜底文案', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'rename',
      '--id',
      '9',
      '--name',
      '新名字',
    ]);
    expect(captured.method).toBe('PUT');
    expect(captured.url).toContain('/api/groups/9');
    expect(captured.body).toEqual({ name: '新名字' });
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.message).toBe('分组已重命名');
  });

  test('rename：--name 纯空白抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'group', 'rename', '--id', '9', '--name', '  ']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });

  test('remove：DELETE /api/groups/{id}，204 兜底文案', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'group',
      'remove',
      '--id',
      '1182',
    ]);
    expect(captured.method).toBe('DELETE');
    expect(captured.url).toContain('/api/groups/1182');
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.message).toBe('已删除分组');
  });

  test('remove：--id 空白抛 INVALID_ARGS（不请求）', async () => {
    let fetched = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetched = true;
      return new Response(null, { status: 204 });
    };
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'group', 'remove', '--id', '  ']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
