// E2E（只读）：通过子进程驱动 supsub CLI，针对「关注点（focus）」命令打真实测试环境。
//
// 基址由 CLI 子进程自行解析（SUPSUB_API_URL > DEFAULT_API_URL，不强制覆盖）。
// 跑测试时用 SUPSUB_API_URL 指向目标环境，并提供同环境的 SUPSUB_E2E_BEARER。
//
// ⚠️ 默认跳过：缺 SUPSUB_E2E_BEARER 时整组 skip（与其它只读 e2e 同样的鉴权门槛）。
// ⚠️ 全程只读 + 客户端参数校验：**绝不调用真实的 focus remove**——CLI 无新增关注点能力，
//    删除不可逆，会破坏真实数据。remove 仅测客户端参数校验（不发请求）。
//
// 启用示例：
//   SUPSUB_API_URL='https://<env>' SUPSUB_E2E_BEARER='<jwt>' \
//     bun test test/e2e/prod-focus.test.ts

import { beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BEARER = process.env.SUPSUB_E2E_BEARER || process.env.SUPSUB_API_KEY;
const SKIP = !BEARER;

const ENTRY = 'src/index.ts';

type CliResult = { stdout: string; stderr: string; code: number };

async function runCli(
  args: string[],
  opts: { withAuth?: boolean; tmpHome?: string } = {},
): Promise<CliResult> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (opts.tmpHome) env.HOME = opts.tmpHome;
  // 清掉本机 SUPSUB_API_KEY，避免抢 source=env 优先级
  delete env.SUPSUB_API_KEY;

  const finalArgs = opts.withAuth
    ? ['run', ENTRY, '--api-key', BEARER!, ...args]
    : ['run', ENTRY, ...args];

  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn('bun', finalArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

describe.skipIf(SKIP)('e2e/prod-focus - 关注点命令打测试环境（只读）', () => {
  let tmpHome: string;

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-focus-'));
  });

  // ─── 帮助文本 ───────────────────────────────────────────────

  test('focus 子命令帮助：列出 list/contents/remove', async () => {
    const r = await runCli(['focus', '--help'], { tmpHome });
    expect(r.code).toBe(0);
    for (const sub of ['list', 'contents', 'remove']) {
      expect(r.stdout).toContain(sub);
    }
  });

  // ─── 关注点列表（read-only） ────────────────────────────────

  test('关注点列表：返回数组，且每项含 id/icon/title/unreadCount', async () => {
    const r = await runCli(['--output', 'json', 'focus', 'list'], { tmpHome, withAuth: true });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      const f = body.data[0];
      expect(typeof f.id).toBe('number');
      expect(typeof f.icon).toBe('string');
      expect(typeof f.title).toBe('string');
      expect(typeof f.unreadCount).toBe('number');
    }
  });

  test('默认表格模式查看关注点列表：含表头或 (empty) 提示', async () => {
    const r = await runCli(['focus', 'list'], { tmpHome, withAuth: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/id|title|empty/);
  });

  // ─── 关注点内容（read-only，用真实列表里的第一个 id） ────────

  test('关注点内容：对真实存在的关注点取内容，返回数组', async () => {
    const list = await runCli(['--output', 'json', 'focus', 'list'], { tmpHome, withAuth: true });
    expect(list.code).toBe(0);
    const focuses = JSON.parse(list.stdout).data as Array<{ id: number }>;
    if (focuses.length === 0) {
      // 没有关注点可测，跳过断言（环境数据相关，不算失败）
      return;
    }
    const id = String(focuses[0]!.id);
    const r = await runCli(['--output', 'json', 'focus', 'contents', '--id', id, '--all'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    // 若有内容，校验关键字段齐全（关注点聚合多源，必带 sourceType/sourceName）
    for (const c of body.data) {
      expect(typeof c.articleId).toBe('string');
      expect(typeof c.sourceType).toBe('string');
      expect(typeof c.sourceName).toBe('string');
      expect(typeof c.isRead).toBe('boolean');
    }
  });

  // ─── 鉴权失败路径 ───────────────────────────────────────────

  test('没登录就看关注点列表：UNAUTHORIZED + 退出码 2', async () => {
    const r = await runCli(['--output', 'json', 'focus', 'list'], { tmpHome });
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // ─── 客户端参数校验（不发请求 / 不删数据） ──────────────────

  test('看关注点内容时漏填 --id：必填参数报错', async () => {
    const r = await runCli(['focus', 'contents'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('看关注点内容时 --id 不是正整数：退出码 64', async () => {
    const r = await runCli(['focus', 'contents', '--id', 'abc'], { tmpHome, withAuth: true });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/id|正整数|abc/);
  });

  test('看关注点内容同时指定 --all 和 --unread：提示互斥、退出码 64', async () => {
    const r = await runCli(['focus', 'contents', '--id', '1', '--all', '--unread'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/互斥/);
  });

  test('删除关注点时漏填 --id：必填参数报错（不发请求，不删数据）', async () => {
    const r = await runCli(['focus', 'remove'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('删除关注点时 --id 不是正整数：退出码 64（不发请求，不删数据）', async () => {
    const r = await runCli(['focus', 'remove', '--id', 'abc'], { tmpHome, withAuth: true });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/id|正整数|abc/);
  });
});
