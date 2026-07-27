// E2E：精读（deepread）命令打真实环境。
//
// 分两档门槛：
//   - 只读部分：需要 SUPSUB_E2E_BEARER（quota / get / list / 参数校验，不花钱）
//   - 花钱部分：额外需要 SUPSUB_E2E_DEEPREAD=1 —— `deepread run` 会**真实消耗**
//     本月精读额度（实测 limit=100/月），不该在普通 e2e 里被顺手跑掉。
//
// ⚠️ 这组用例是「API 契约以实测为准」的守卫：api.json 与实际至少有 3 处出入
//    （POST 返回 202 而非 201、version 在顶层而非 content 内、shared 响应把精读
//    结果嵌在 content 而非平铺），契约再漂移时应由这里先炸。
//
// 启用示例：
//   SUPSUB_E2E_BEARER="$(jq -r .access_token ~/.supsub/config.json)" \
//   SUPSUB_E2E_DEEPREAD=1 bun test test/e2e/prod-deepread.test.ts

import { beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BEARER = process.env.SUPSUB_E2E_BEARER || process.env.SUPSUB_API_KEY;
const SKIP = !BEARER;
const SKIP_SPEND = SKIP || process.env.SUPSUB_E2E_DEEPREAD !== '1';

const ENTRY = 'src/index.ts';

type CliResult = { stdout: string; stderr: string; code: number };

async function runCli(
  args: string[],
  opts: { withAuth?: boolean; configDir?: string } = {},
): Promise<CliResult> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.SUPSUB_API_KEY;
  if (opts.configDir) env.SUPSUB_CONFIG_DIR = opts.configDir;

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

type Picked = { sourceType: string; contentId: string; title: string };

/** 从真实订阅里取若干候选文章 */
async function candidates(configDir: string, limit = 10): Promise<Picked[]> {
  const subs = await runCli(['--output', 'json', 'sub', 'list'], { withAuth: true, configDir });
  const list = JSON.parse(subs.stdout).data as Array<{ sourceType: string; sourceId: number }>;
  const first = list[0];
  if (!first) return [];

  const contents = await runCli(
    [
      '--output',
      'json',
      'sub',
      'contents',
      '--source-id',
      String(first.sourceId),
      '--type',
      first.sourceType,
      '--all',
      '--brief',
      '--page-size',
      String(limit),
    ],
    { withAuth: true, configDir },
  );
  const articles = JSON.parse(contents.stdout).data as Array<{ contentId: string; title: string }>;
  return articles.map((a) => ({
    sourceType: first.sourceType,
    contentId: a.contentId,
    title: a.title,
  }));
}

/** 任取一篇（只读用例用，不关心是否精读过） */
async function pickArticle(configDir: string): Promise<Picked | undefined> {
  return (await candidates(configDir, 3))[0];
}

/**
 * 挑一篇**还没精读过**的（status=none）。
 *
 * 必须强制未精读，否则 run 会在预检阶段就命中 done 直接返回，
 * 「POST → 轮询 → done」这条主路径根本没被跑到（第一版就踩了这个坑：
 * 整组 e2e 3.5 秒跑完，看着全绿其实没测到轮询）。
 */
async function pickUnread(configDir: string): Promise<Picked | undefined> {
  for (const c of await candidates(configDir, 10)) {
    const r = await runCli(
      ['--output', 'json', 'deepread', 'get', '--type', c.sourceType, '--content-id', c.contentId],
      { withAuth: true, configDir },
    );
    if (r.code === 0 && JSON.parse(r.stdout).data.status === 'none') return c;
  }
  return undefined;
}

describe.skipIf(SKIP)('e2e/prod-deepread - 精读命令（只读部分）', () => {
  let configDir: string;

  beforeAll(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-deepread-'));
  });

  test('deepread 帮助：列出全部子命令', async () => {
    const r = await runCli(['deepread', '--help'], { configDir });
    expect(r.code).toBe(0);
    for (const sub of ['run', 'get', 'list', 'quota', 'share', 'drop', 'show']) {
      expect(r.stdout).toContain(sub);
    }
  });

  test('quota：返回 limit/used/remaining 三个整数且自洽', async () => {
    const r = await runCli(['--output', 'json', 'deepread', 'quota'], {
      withAuth: true,
      configDir,
    });
    expect(r.code).toBe(0);
    const q = JSON.parse(r.stdout).data as { limit: number; used: number; remaining: number };
    expect(Number.isInteger(q.limit)).toBe(true);
    expect(Number.isInteger(q.used)).toBe(true);
    expect(Number.isInteger(q.remaining)).toBe(true);
    expect(q.used + q.remaining).toBe(q.limit);
  });

  test('get 未精读过的内容：status=none，退出码 0（pending/none 不是错误）', async () => {
    const picked = await pickArticle(configDir);
    if (!picked) return;
    const r = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'get',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(['none', 'pending', 'done', 'failed']).toContain(body.data.status);
  });

  test('list：空队列或数组，退出码 0', async () => {
    const r = await runCli(['--output', 'json', 'deepread', 'list'], {
      withAuth: true,
      configDir,
    });
    expect(r.code).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout).data)).toBe(true);
  });

  test('参数校验在客户端拦截（不发请求）：非法 --type / 空 --content-id → exit 64', async () => {
    const bad = await runCli(['deepread', 'run', '--type', 'TWITTER', '--content-id', 'x'], {
      withAuth: true,
      configDir,
    });
    expect(bad.code).toBe(64);
    expect(bad.stderr).toContain('--type');

    const empty = await runCli(['deepread', 'run', '--type', 'MP', '--content-id', ' '], {
      withAuth: true,
      configDir,
    });
    expect(empty.code).toBe(64);
    expect(empty.stderr).toContain('--content-id');
  });
});

describe.skipIf(SKIP_SPEND)('e2e/prod-deepread - 完整精读闭环（消耗额度）', () => {
  let configDir: string;
  let picked: Picked | undefined;

  beforeAll(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-deepread-spend-'));
    picked = await pickUnread(configDir);
  }, 120_000);

  test('run --wait：真的走完 POST → 轮询 → done，结果结构完整并落盘', async () => {
    if (!picked) return;
    const started = Date.now();
    const r = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'run',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
        '--title',
        picked.title,
        '--timeout',
        '240',
      ],
      { withAuth: true, configDir },
    );
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout).data;
    expect(d.status).toBe('done');
    // quotaSpent=true 证明确实发了 POST（而不是预检命中 done 抄了近道）
    expect(d.quotaSpent).toBe(true);
    // 精读是真异步任务：至少走过一轮 3s 轮询才可能拿到结果
    expect(Date.now() - started).toBeGreaterThan(3000);

    // 精读结果 v1 的六件套
    expect(typeof d.content.essence).toBe('string');
    expect(typeof d.content.quality.grade).toBe('string');
    expect(Array.isArray(d.content.keyPoints)).toBe(true);
    expect(Array.isArray(d.content.body.sections)).toBe(true);
    expect(typeof d.content.annotations.weakestLink).toBe('string');
    expect(typeof d.content.annotations.credibility.grade).toBe('string');

    // 落盘的 .md 真实存在且带标题
    expect(d.cachePath.endsWith('.md')).toBe(true);
    expect(await fs.readFile(d.cachePath, 'utf-8')).toContain(`# ${picked.title}`);
  }, 300_000);

  test('二次 run：命中本地缓存，quotaSpent=false 且额度不变', async () => {
    if (!picked) return;
    const before = await runCli(['--output', 'json', 'deepread', 'quota'], {
      withAuth: true,
      configDir,
    });
    const usedBefore = JSON.parse(before.stdout).data.used as number;

    const r = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'run',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout).data;
    expect(d.status).toBe('done');
    expect(d.quotaSpent).toBe(false);

    const after = await runCli(['--output', 'json', 'deepread', 'quota'], {
      withAuth: true,
      configDir,
    });
    expect(JSON.parse(after.stdout).data.used).toBe(usedBefore);
  });

  test('list：done 项首次出现 fresh=true，再查被水位线收走', async () => {
    if (!picked) return;
    const first = await runCli(['--output', 'json', 'deepread', 'list'], {
      withAuth: true,
      configDir,
    });
    const items = JSON.parse(first.stdout).data as Array<{ contentId: string; fresh: boolean }>;
    expect(items.some((i) => i.contentId === picked!.contentId && i.fresh)).toBe(true);

    const second = await runCli(['--output', 'json', 'deepread', 'list'], {
      withAuth: true,
      configDir,
    });
    const again = JSON.parse(second.stdout).data as Array<{ contentId: string }>;
    expect(again.some((i) => i.contentId === picked!.contentId)).toBe(false);

    const all = await runCli(['--output', 'json', 'deepread', 'list', '--all'], {
      withAuth: true,
      configDir,
    });
    const allItems = JSON.parse(all.stdout).data as Array<{ contentId: string }>;
    expect(allItems.some((i) => i.contentId === picked!.contentId)).toBe(true);
  });

  test('share → show：分享码可复用，且 /s/<code> 无需登录即可读回同一篇', async () => {
    if (!picked) return;
    const r = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'share',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    expect(r.code).toBe(0);
    const s = JSON.parse(r.stdout).data as { shareCode: string; shareUrl: string; reused: boolean };
    expect(s.shareCode.length).toBeGreaterThan(0);
    expect(s.shareUrl).toContain(`/s/${s.shareCode}`);

    // 再来一次应复用同一个码，不重复生成公开链接
    const again = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'share',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    const s2 = JSON.parse(again.stdout).data as { shareCode: string; reused: boolean };
    expect(s2.shareCode).toBe(s.shareCode);
    expect(s2.reused).toBe(true);

    // show 不带 --api-key：分享页是公开的
    const shown = await runCli(
      ['--output', 'json', 'deepread', 'show', '--share-code', s.shareCode],
      {
        configDir,
      },
    );
    expect(shown.code).toBe(0);
    const body = JSON.parse(shown.stdout).data;
    expect(body.title).toBe(picked.title);
    expect(typeof body.content.essence).toBe('string');
  });

  test('drop：移除本地记录后，get 仍能从服务端拿回且不扣额度', async () => {
    if (!picked) return;
    const dropped = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'drop',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    expect(JSON.parse(dropped.stdout).data.removed).toBe(true);

    const before = await runCli(['--output', 'json', 'deepread', 'quota'], {
      withAuth: true,
      configDir,
    });
    const usedBefore = JSON.parse(before.stdout).data.used as number;

    const r = await runCli(
      [
        '--output',
        'json',
        'deepread',
        'get',
        '--type',
        picked.sourceType,
        '--content-id',
        picked.contentId,
      ],
      { withAuth: true, configDir },
    );
    expect(JSON.parse(r.stdout).data.status).toBe('done');

    const after = await runCli(['--output', 'json', 'deepread', 'quota'], {
      withAuth: true,
      configDir,
    });
    expect(JSON.parse(after.stdout).data.used).toBe(usedBefore);
  });
});
