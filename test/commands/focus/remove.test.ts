// commands/focus/remove：mock DELETE + JSON 输出 + --id 校验
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerFocusRemove } from '../../../src/commands/focus/remove.ts';
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
  const focus = program.command('focus');
  registerFocusRemove(focus);
  return program;
}

describe('commands/focus/remove - 删除关注点', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;
  let receivedUrl: string;
  let receivedMethod: string;
  let fetched: boolean;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    stdoutOutput = '';
    receivedUrl = '';
    receivedMethod = '';
    fetched = false;

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ api_key: 'sk_focus_ok', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetched = true;
      receivedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      receivedMethod = init?.method ?? 'GET';
      return new Response(JSON.stringify({ message: '已删除关注点' }), {
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

  test('DELETE /api/focuses/{id} 并输出 { message }', async () => {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'focus',
      'remove',
      '--id',
      '42',
    ]);
    expect(receivedMethod).toBe('DELETE');
    expect(receivedUrl).toContain('/api/focuses/42');

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe('已删除关注点');
  });

  test('--id 非正整数抛 INVALID_ARGS（不发起请求）', async () => {
    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'focus', 'remove', '--id', '-1']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect(fetched).toBe(false);
  });
});
