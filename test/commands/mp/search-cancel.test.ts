// commands/mp/search-cancel：成功取消 / 404 转 TASK_NOT_FOUND
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerMpSearchCancel } from '../../../src/commands/mp/search-cancel.ts';
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
  const mp = program.command('mp');
  registerMpSearchCancel(mp);
  return program;
}

describe('commands/mp/search-cancel', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let originalExit: typeof process.exit;
  let originalStdout: typeof process.stdout.write;
  let originalStderr: typeof process.stderr.write;
  let exitCode: number | undefined;
  let stdoutOutput: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    originalExit = process.exit;
    originalStdout = process.stdout.write.bind(process.stdout);
    originalStderr = process.stderr.write.bind(process.stderr);
    process.env.SUPSUB_API_URL = 'http://fake-host';
    exitCode = undefined;
    stdoutOutput = '';

    process.stdout.write = ((c: string | Uint8Array): boolean => {
      stdoutOutput += typeof c === 'string' ? c : new TextDecoder().decode(c);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    process.exit = ((code?: number): never => {
      exitCode = code ?? 0;
      throw new Error(`__exit_${code ?? 0}__`);
    }) as typeof process.exit;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_cancel', client_id: 'supsub-cli' }, null, 2),
      'utf-8',
    );
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await cleanupAuthFields();
  });

  test('204 成功：JSON 输出 message:已取消，不调 exit', async () => {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'mp',
      'search-cancel',
      'search-id-x',
    ]);
    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe('已取消');
  });

  test('404：转译为 code=TASK_NOT_FOUND 的 dieWith', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'no such task' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    const program = buildProgram();
    let thrown: unknown;
    try {
      await program.parseAsync([
        'node',
        'supsub',
        '--output',
        'json',
        'mp',
        'search-cancel',
        'missing-id',
      ]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(exitCode).toBeDefined();
    expect(exitCode).not.toBe(0);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('TASK_NOT_FOUND');
  });

  test('非 404 错误（500）原样向上抛出（非 TASK_NOT_FOUND）', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'SERVER_ERROR', message: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    const program = buildProgram();
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'supsub', 'mp', 'search-cancel', 'any-id']);
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('SERVER_ERROR');
  });
});
