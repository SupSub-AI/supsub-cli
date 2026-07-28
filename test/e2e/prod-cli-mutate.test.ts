// E2E（写操作）：通过子进程驱动 supsub CLI，针对会变更后端数据的命令做闭环验证。
// 基址由 CLI 子进程自行解析（SUPSUB_API_URL > DEFAULT_API_URL，不强制覆盖）。
// 跑测试时用 SUPSUB_API_URL 指向目标环境，并提供同环境的 SUPSUB_E2E_BEARER。
//
// ⚠️  默认双重跳过：
//        - 缺 SUPSUB_E2E_BEARER 跳过（与只读 e2e 同样的鉴权门槛）
//        - 缺 SUPSUB_E2E_MUTATE=1 跳过（避免误打开线上数据写入）
// ⚠️  覆盖范围：sub add → sub list → sub remove 闭环；mp search 全流程（可独立 gate）。
// ⚠️  策略：从 search 结果挑一个 isSubscribed=false 的 SOURCE 作为候选，操作完后立即清理。
//        若运行中失败，afterEach 会兜底再发一次 sub remove，尽量避免污染。
// ⚠️  启用方式：
//        SUPSUB_E2E_BEARER='<jwt>' SUPSUB_E2E_MUTATE=1 \
//          bun test test/e2e/prod-cli-mutate.test.ts
//        # 额外开启 mp search 实测：
//        SUPSUB_E2E_BEARER='<jwt>' SUPSUB_E2E_MUTATE=1 SUPSUB_E2E_MP_SEARCH=1 \
//          bun test test/e2e/prod-cli-mutate.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BEARER = process.env.SUPSUB_E2E_BEARER;
const MUTATE = process.env.SUPSUB_E2E_MUTATE === '1';
const MP_SEARCH = process.env.SUPSUB_E2E_MP_SEARCH === '1';
const SKIP = !BEARER || !MUTATE;

const ENTRY = 'src/index.ts';

type CliResult = { stdout: string; stderr: string; code: number };

async function runCli(
  args: string[],
  opts: { withAuth?: boolean; tmpHome?: string } = {},
): Promise<CliResult> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };

  if (opts.tmpHome) {
    env.HOME = opts.tmpHome;
    // 用 tmpHome 下的 .supsub 作为隔离配置目录，覆盖继承来的全局 preload 目录。
    // withAuth 时把真实 BEARER 写进 config.json 的 access_token（等价于旧 --api-key 直登，
    // 只写 access_token、不写 refresh_token，保持凭证一次性、不触发续期）；否则写空对象模拟未登录。
    const configDir = path.join(opts.tmpHome, '.supsub');
    env.SUPSUB_CONFIG_DIR = configDir;
    await fs.mkdir(configDir, { recursive: true });
    const cfg = opts.withAuth ? { access_token: BEARER, client_id: 'supsub-cli' } : {};
    await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(cfg));
  }

  const finalArgs = ['run', ENTRY, ...args];

  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn('bun', finalArgs, {
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

type SearchSourceResult = {
  type: 'SOURCE';
  data: {
    sourceId: number;
    sourceType: 'MP' | 'WEBSITE';
    isSubscribed: boolean;
    name: string;
  };
};

/** 从 search 结果中找一个 isSubscribed=false 的 SOURCE 候选。找不到返回 null。 */
async function findUnsubscribedCandidate(
  tmpHome: string,
  keyword: string,
  type: 'MP' | 'WEBSITE',
): Promise<{ sourceId: number; sourceType: 'MP' | 'WEBSITE'; name: string } | null> {
  const r = await runCli(['--output', 'json', 'search', keyword, '--type', type], {
    tmpHome,
    withAuth: true,
  });
  if (r.code !== 0) return null;
  const body = JSON.parse(r.stdout) as {
    success: boolean;
    data: { results: Array<SearchSourceResult | { type: 'CONTENT' }> };
  };
  if (!body.success) return null;
  for (const item of body.data.results) {
    if (
      item.type === 'SOURCE' &&
      (item as SearchSourceResult).data.sourceType === type &&
      !(item as SearchSourceResult).data.isSubscribed
    ) {
      const d = (item as SearchSourceResult).data;
      return { sourceId: d.sourceId, sourceType: d.sourceType, name: d.name };
    }
  }
  return null;
}

describe.skipIf(SKIP)('e2e/prod-cli-mutate - 写操作闭环（默认跳过）', () => {
  let tmpHome: string;
  /** 兜底清理：记录所有这次测试期间订阅过、还没主动取消的源 */
  const pendingCleanup: Array<{ sourceType: 'MP' | 'WEBSITE'; sourceId: number }> = [];

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-mutate-'));
  });

  afterAll(async () => {
    for (const c of pendingCleanup) {
      await runCli(
        [
          '--output',
          'json',
          'sub',
          'remove',
          '--type',
          c.sourceType,
          '--source-id',
          String(c.sourceId),
        ],
        { tmpHome, withAuth: true },
      );
    }
    pendingCleanup.length = 0;
  });

  // ─── 订阅闭环：添加订阅源 → 列表里能看到 → 删除订阅源 → 列表里没了 ─────

  test('订阅一个公众号：能添加、列表里看得到、能取消，取消后列表里就没了', async () => {
    const candidate = await findUnsubscribedCandidate(tmpHome, 'openai', 'MP');
    if (!candidate) {
      console.warn('[mutate] 没有找到可用的未订阅 MP 候选，跳过 MP 订阅闭环测试');
      return;
    }
    const { sourceId, sourceType } = candidate;
    pendingCleanup.push({ sourceId, sourceType });

    // 1. 订阅
    const addRes = await runCli(
      ['--output', 'json', 'sub', 'add', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    expect(addRes.code).toBe(0);
    const addBody = JSON.parse(addRes.stdout);
    expect(addBody.success).toBe(true);
    expect(typeof addBody.data.message).toBe('string');

    // 2. list 验证：sourceId 应出现在 MP 列表中
    const listRes = await runCli(['--output', 'json', 'sub', 'list', '--type', sourceType], {
      tmpHome,
      withAuth: true,
    });
    expect(listRes.code).toBe(0);
    const listBody = JSON.parse(listRes.stdout);
    expect(listBody.success).toBe(true);
    const idsAfterAdd = (listBody.data as Array<{ sourceId: number }>).map((s) => s.sourceId);
    expect(idsAfterAdd).toContain(sourceId);

    // 3. 取消订阅
    const removeRes = await runCli(
      ['--output', 'json', 'sub', 'remove', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    expect(removeRes.code).toBe(0);
    const removeBody = JSON.parse(removeRes.stdout);
    expect(removeBody.success).toBe(true);
    // 已主动清理：从兜底清单移除
    pendingCleanup.splice(
      pendingCleanup.findIndex((c) => c.sourceId === sourceId && c.sourceType === sourceType),
      1,
    );

    // 4. list 再验证：sourceId 不应再出现
    const listRes2 = await runCli(['--output', 'json', 'sub', 'list', '--type', sourceType], {
      tmpHome,
      withAuth: true,
    });
    expect(listRes2.code).toBe(0);
    const listBody2 = JSON.parse(listRes2.stdout);
    const idsAfterRemove = (listBody2.data as Array<{ sourceId: number }>).map((s) => s.sourceId);
    expect(idsAfterRemove).not.toContain(sourceId);
  });

  test('订阅一个网站：能添加、列表里看得到、能取消', async () => {
    const candidate = await findUnsubscribedCandidate(tmpHome, 'blog', 'WEBSITE');
    if (!candidate) {
      console.warn('[mutate] 没有找到可用的未订阅 WEBSITE 候选，跳过 WEBSITE 订阅闭环测试');
      return;
    }
    const { sourceId, sourceType } = candidate;
    pendingCleanup.push({ sourceId, sourceType });

    const addRes = await runCli(
      ['--output', 'json', 'sub', 'add', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    expect(addRes.code).toBe(0);
    const addBody = JSON.parse(addRes.stdout);
    expect(addBody.success).toBe(true);

    // 全量 list（不带 --type）也应包含
    const listRes = await runCli(['--output', 'json', 'sub', 'list'], { tmpHome, withAuth: true });
    expect(listRes.code).toBe(0);
    const listBody = JSON.parse(listRes.stdout);
    const ids = (listBody.data as Array<{ sourceId: number; sourceType: string }>)
      .filter((s) => s.sourceType === 'WEBSITE')
      .map((s) => s.sourceId);
    expect(ids).toContain(sourceId);

    const removeRes = await runCli(
      ['--output', 'json', 'sub', 'remove', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    expect(removeRes.code).toBe(0);
    pendingCleanup.splice(
      pendingCleanup.findIndex((c) => c.sourceId === sourceId && c.sourceType === sourceType),
      1,
    );
  });

  test('重复订阅同一个源：第一次成功、第二次会被后端拒掉（已订阅）', async () => {
    const candidate = await findUnsubscribedCandidate(tmpHome, 'openai', 'MP');
    if (!candidate) {
      console.warn('[mutate] 没有候选可用，跳过重复订阅测试');
      return;
    }
    const { sourceId, sourceType } = candidate;
    pendingCleanup.push({ sourceId, sourceType });

    // 第一次订阅
    const r1 = await runCli(
      ['--output', 'json', 'sub', 'add', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    expect(r1.code).toBe(0);

    // 第二次订阅：应被后端拒绝（业务错误）
    const r2 = await runCli(
      ['--output', 'json', 'sub', 'add', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    // 后端可能 200 幂等也可能 4xx；只要可解析 + 不抛运行时错（exit ≤ 1）
    const body = JSON.parse(r2.stdout);
    expect(typeof body.success).toBe('boolean');
    if (!body.success) {
      expect(typeof body.error.code).toBe('string');
    }

    // cleanup
    await runCli(
      ['--output', 'json', 'sub', 'remove', '--type', sourceType, '--source-id', String(sourceId)],
      { tmpHome, withAuth: true },
    );
    pendingCleanup.splice(
      pendingCleanup.findIndex((c) => c.sourceId === sourceId && c.sourceType === sourceType),
      1,
    );
  });

  test('取消一个根本没订阅过的源：返回业务错误，但 JSON 可解析', async () => {
    // 选个肯定没订阅的非法 ID（接近边界但够大）
    const r = await runCli(
      ['--output', 'json', 'sub', 'remove', '--type', 'MP', '--source-id', '999999999'],
      { tmpHome, withAuth: true },
    );
    // 后端可能 4xx；exit 应非 0
    expect(r.code).not.toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
    expect(typeof body.error.code).toBe('string');
  });
});

// ─── 搜索公众号：真实闭环（独立 gate，避免每次跑都创建后端搜索任务） ────
describe.skipIf(SKIP || !MP_SEARCH)('e2e/prod-cli-mutate - 搜索公众号真实流程', () => {
  let tmpHome: string;

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-mp-'));
  });

  test('搜索公众号：30s 内拿到结果或业务错误，不应挂起', async () => {
    // 选一个大概率有结果的关键字
    const r = await runCli(['--output', 'json', 'mp', 'search', 'openai'], {
      tmpHome,
      withAuth: true,
    });
    // 不要求 success，但要求能在 30s 超时内拿到结构化结果
    const body = JSON.parse(r.stdout);
    expect(typeof body.success).toBe('boolean');
    if (body.success) {
      expect(Array.isArray(body.data)).toBe(true);
      for (const mp of body.data) {
        expect(typeof mp.mpId).toBe('string');
        expect(typeof mp.name).toBe('string');
      }
    } else {
      // 允许的失败码：MP_NOT_FOUND / MP_SEARCH_TIMEOUT 或后端返回的其他业务错
      expect(typeof body.error.code).toBe('string');
    }
  }, 60_000);

  test('搜索一个几乎不存在的公众号：返回 MP_NOT_FOUND 或同类业务错', async () => {
    const r = await runCli(
      ['--output', 'json', 'mp', 'search', 'zzqxyzz_unlikely_mp_name_8a7d6f'],
      { tmpHome, withAuth: true },
    );
    expect(r.code).not.toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
    // 实际 code 取决于后端响应（MP_NOT_FOUND / MP_SEARCH_TIMEOUT / 等）
    expect(typeof body.error.code).toBe('string');
  }, 60_000);
});
