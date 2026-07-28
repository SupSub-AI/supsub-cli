// commands/deepread list：收件箱语义（pending 回查 + 播报水位线）
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { registerDeepReadList } from '../../../src/commands/deepread/list.ts';
import {
  type DeepReadEntry,
  deepReadRootDir,
  readEntry,
  writeEntry,
} from '../../../src/lib/deep-read-store.ts';
import { setTestCredential } from '../../_helpers/credential.ts';

const DONE_BODY = {
  status: 'done',
  version: 'v1',
  content: { essence: '跑完了', quality: { grade: '高', comment: '好' } },
};

function buildProgram(): Command {
  const program = new Command();
  program
    .name('supsub')
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .exitOverride();
  const deepread = program.command('deepread');
  registerDeepReadList(deepread);
  return program;
}

function entry(overrides: Partial<DeepReadEntry>): DeepReadEntry {
  return {
    sourceType: 'MP',
    contentId: 'x',
    requestedAt: 1_700_000_000_000,
    status: 'done',
    checkedAt: 1_700_000_000_000,
    content: { essence: '旧结果' },
    ...overrides,
  };
}

describe('commands/deepread - list', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let originalStdout: typeof process.stdout.write;
  let stdoutOutput: string;
  let getCount: number;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    await setTestCredential('sk_list_test');
    stdoutOutput = '';
    getCount = 0;

    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    globalThis.fetch = async (): Promise<Response> => {
      getCount += 1;
      return new Response(JSON.stringify(DONE_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(async () => {
    process.stdout.write = originalStdout;
    globalThis.fetch = originalFetch;
    await setTestCredential(undefined);
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await fs.rm(deepReadRootDir(), { recursive: true, force: true });
  });

  test('只回查 pending，done 是终态不再打扰服务端', async () => {
    await writeEntry(entry({ contentId: 'p1', status: 'pending', content: undefined }));
    await writeEntry(entry({ contentId: 'd1', status: 'done' }));

    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    expect(getCount).toBe(1); // 只有 p1 被回查
  });

  test('pending 回查到 done 后写回本地', async () => {
    await writeEntry(entry({ contentId: 'p2', status: 'pending', content: undefined }));
    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    const back = await readEntry('MP', 'p2');
    expect(back?.status).toBe('done');
    expect(back?.content?.essence).toBe('跑完了');
  });

  test('播报一次后打水位线，再 list 不重复播报', async () => {
    await writeEntry(entry({ contentId: 'd2', status: 'done' }));

    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    expect(JSON.parse(stdoutOutput).data).toHaveLength(1);
    expect(JSON.parse(stdoutOutput).data[0].fresh).toBe(true);

    stdoutOutput = '';
    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    expect(JSON.parse(stdoutOutput).data).toHaveLength(0);
  });

  test('--all 显示全部历史，且不写水位线', async () => {
    await writeEntry(entry({ contentId: 'd3', status: 'done' }));

    await buildProgram().parseAsync([
      'node',
      'supsub',
      '--output',
      'json',
      'deepread',
      'list',
      '--all',
    ]);
    expect(JSON.parse(stdoutOutput).data).toHaveLength(1);
    expect((await readEntry('MP', 'd3'))?.notifiedAt).toBeUndefined();

    // 水位线没被 --all 动过，默认视图仍然会播报它
    stdoutOutput = '';
    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    expect(JSON.parse(stdoutOutput).data).toHaveLength(1);
  });

  test('pending 始终出现在默认视图里（不受水位线影响）', async () => {
    globalThis.fetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await writeEntry(
      entry({ contentId: 'p3', status: 'pending', content: undefined, notifiedAt: 1 }),
    );
    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    const data = JSON.parse(stdoutOutput).data;
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe('pending');
  });

  test('单条回查失败不影响整体列表', async () => {
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error('boom');
    };
    await writeEntry(entry({ contentId: 'p4', status: 'pending', content: undefined }));
    await writeEntry(entry({ contentId: 'd4', status: 'done' }));
    await buildProgram().parseAsync(['node', 'supsub', '--output', 'json', 'deepread', 'list']);
    expect(JSON.parse(stdoutOutput).data).toHaveLength(2);
  });

  test('空队列输出 (empty)', async () => {
    await buildProgram().parseAsync(['node', 'supsub', 'deepread', 'list']);
    expect(stdoutOutput).toContain('(empty)');
  });
});
