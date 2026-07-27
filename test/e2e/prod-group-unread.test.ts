// E2E：订阅分组生命周期（写操作，自清理）+ 未读概览（只读）。
// 基址由 CLI 子进程自行解析（SUPSUB_API_URL > DEFAULT_API_URL，不强制覆盖）。
//
// ⚠️  分组用例默认双重跳过：
//        - 缺 SUPSUB_E2E_BEARER 跳过（与其它 e2e 同样的鉴权门槛）
//        - 缺 SUPSUB_E2E_MUTATE=1 跳过（避免误打开线上数据写入）
//     unread 用例只读，仅需 SUPSUB_E2E_BEARER。
// ⚠️  覆盖范围：group add → rename → add-sub → subs → remove-sub → remove 闭环；unread shape。
// ⚠️  策略：全程只操作本次新建的一次性分组，afterAll 兜底删除；成员用账号里已有的订阅源，
//        入组/出组都不影响订阅关系本身。**不覆盖 mark-read**（整源已读不可逆，只靠 mock 单测）。
// ⚠️  启用方式：
//        SUPSUB_E2E_BEARER='<jwt>' SUPSUB_E2E_MUTATE=1 \
//          bun test test/e2e/prod-group-unread.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BEARER = process.env.SUPSUB_E2E_BEARER || process.env.SUPSUB_API_KEY;
const MUTATE = process.env.SUPSUB_E2E_MUTATE === '1';
const SKIP_READONLY = !BEARER;
const SKIP_MUTATE = !BEARER || !MUTATE;

const ENTRY = 'src/index.ts';

type CliResult = { stdout: string; stderr: string; code: number };

async function runCli(args: string[], tmpHome: string): Promise<CliResult> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env.HOME = tmpHome;
  delete env.SUPSUB_API_KEY;

  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn('bun', ['run', ENTRY, '--api-key', BEARER!, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

function parseOk<T>(r: CliResult): T {
  expect(r.code).toBe(0);
  const body = JSON.parse(r.stdout) as { success: boolean; data: T };
  expect(body.success).toBe(true);
  return body.data;
}

describe.skipIf(SKIP_MUTATE)('e2e/group - 分组生命周期（默认跳过）', () => {
  let tmpHome: string;
  /** 兜底清理：本次创建的一次性分组 */
  let createdGroupId: string | null = null;

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-group-'));
  });

  afterAll(async () => {
    if (createdGroupId) {
      await runCli(['--output', 'json', 'group', 'remove', '--id', createdGroupId], tmpHome);
      createdGroupId = null;
    }
  });

  test('分组闭环：创建 → 重命名 → 加成员 → 查成员 → 移出成员 → 删除', async () => {
    // 1) 创建一次性分组
    const name = 'cli-e2e-group';
    const created = parseOk<{ id: number | string; name: string }>(
      await runCli(['--output', 'json', 'group', 'add', name], tmpHome),
    );
    expect(created.name).toBe(name);
    expect(created.id).toBeDefined();
    const gid = String(created.id);
    createdGroupId = gid;

    // 2) 出现在分组列表里
    const groups = parseOk<Array<{ id: number | string; name: string }>>(
      await runCli(['--output', 'json', 'group', 'list'], tmpHome),
    );
    expect(groups.some((g) => String(g.id) === gid)).toBe(true);

    // 3) 重命名
    const renamed = parseOk<{ message: string }>(
      await runCli(
        ['--output', 'json', 'group', 'rename', '--id', gid, '--name', 'cli-e2e-group-2'],
        tmpHome,
      ),
    );
    expect(renamed.message).toBeTruthy();
    const groups2 = parseOk<Array<{ id: number | string; name: string }>>(
      await runCli(['--output', 'json', 'group', 'list'], tmpHome),
    );
    expect(groups2.find((g) => String(g.id) === gid)?.name).toBe('cli-e2e-group-2');

    // 4) 新分组初始应为空
    const empty = parseOk<Array<{ sourceId: number }>>(
      await runCli(['--output', 'json', 'group', 'subs', '--id', gid], tmpHome),
    );
    expect(empty).toHaveLength(0);

    // 5) 从账号已有订阅里挑一个源作为成员（无订阅则跳过成员部分）
    const subs = parseOk<Array<{ sourceId: number; sourceType: string }>>(
      await runCli(['--output', 'json', 'sub', 'list'], tmpHome),
    );
    const candidate = subs.find((s) => ['MP', 'WEBSITE', 'X'].includes(s.sourceType));
    if (!candidate) return; // 账号没有可用订阅源，成员部分无从验证

    const sid = String(candidate.sourceId);
    const stype = candidate.sourceType;

    // 6) 加入分组
    parseOk<{ message: string }>(
      await runCli(
        ['--output', 'json', 'group', 'add-sub', '--id', gid, '--source-id', sid, '--type', stype],
        tmpHome,
      ),
    );

    // 7) 组内能查到该成员，且带 unreadCount 字段
    const members = parseOk<Array<{ sourceId: number; sourceType: string; unreadCount?: number }>>(
      await runCli(['--output', 'json', 'group', 'subs', '--id', gid], tmpHome),
    );
    const hit = members.find((m) => m.sourceId === candidate.sourceId);
    expect(hit).toBeDefined();
    expect(typeof hit?.unreadCount).toBe('number');

    // 8) 幂等：重复加入不报错
    const again = parseOk<{ message: string }>(
      await runCli(
        ['--output', 'json', 'group', 'add-sub', '--id', gid, '--source-id', sid, '--type', stype],
        tmpHome,
      ),
    );
    expect(again.message).toContain('已在分组中');

    // 9) --all 模式返回全部源并带 inGroup 标记
    const all = parseOk<Array<{ sourceId: number; inGroup: boolean }>>(
      await runCli(['--output', 'json', 'group', 'subs', '--id', gid, '--all'], tmpHome),
    );
    expect(all.find((s) => s.sourceId === candidate.sourceId)?.inGroup).toBe(true);

    // 10) 移出分组 → 组内为空；订阅关系不受影响
    parseOk<{ message: string }>(
      await runCli(
        [
          '--output',
          'json',
          'group',
          'remove-sub',
          '--id',
          gid,
          '--source-id',
          sid,
          '--type',
          stype,
        ],
        tmpHome,
      ),
    );
    const afterRemove = parseOk<Array<{ sourceId: number }>>(
      await runCli(['--output', 'json', 'group', 'subs', '--id', gid], tmpHome),
    );
    expect(afterRemove.some((m) => m.sourceId === candidate.sourceId)).toBe(false);
    const subsAfter = parseOk<Array<{ sourceId: number }>>(
      await runCli(['--output', 'json', 'sub', 'list'], tmpHome),
    );
    expect(subsAfter.some((s) => s.sourceId === candidate.sourceId)).toBe(true);

    // 11) 删除分组 → 列表里没了
    parseOk<{ message: string }>(
      await runCli(['--output', 'json', 'group', 'remove', '--id', gid], tmpHome),
    );
    createdGroupId = null;
    const groups3 = parseOk<Array<{ id: number | string }>>(
      await runCli(['--output', 'json', 'group', 'list'], tmpHome),
    );
    expect(groups3.some((g) => String(g.id) === gid)).toBe(false);
  }, 120_000);

  test('分组不存在时 group subs 报错而非返回空数组', async () => {
    const r = await runCli(['--output', 'json', 'group', 'subs', '--id', '999999999'], tmpHome);
    expect(r.code).not.toBe(0);
    const body = JSON.parse(r.stdout) as { success: boolean; error: { status: number } };
    expect(body.success).toBe(false);
    expect(body.error.status).toBe(404);
  }, 60_000);
});

describe.skipIf(SKIP_READONLY)('e2e/unread - 未读概览（只读）', () => {
  let tmpHome: string;

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-unread-'));
  });

  type Overview = {
    subscriptions: Array<{ sourceId: number; sourceType: string; unreadCount: number }>;
    focuses: Array<{ id: number; unreadCount: number }>;
  };

  test('unread 返回 {subscriptions, focuses}，默认项均 unreadCount > 0', async () => {
    const data = parseOk<Overview>(await runCli(['--output', 'json', 'unread'], tmpHome));
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(Array.isArray(data.focuses)).toBe(true);
    for (const s of data.subscriptions) expect(s.unreadCount).toBeGreaterThan(0);
    for (const f of data.focuses) expect(f.unreadCount).toBeGreaterThan(0);
  }, 60_000);

  test('--all 返回的条数不少于默认（默认是过滤后的子集）', async () => {
    const filtered = parseOk<Overview>(await runCli(['--output', 'json', 'unread'], tmpHome));
    const all = parseOk<Overview>(await runCli(['--output', 'json', 'unread', '--all'], tmpHome));
    expect(all.subscriptions.length).toBeGreaterThanOrEqual(filtered.subscriptions.length);
    expect(all.focuses.length).toBeGreaterThanOrEqual(filtered.focuses.length);
  }, 60_000);
});
