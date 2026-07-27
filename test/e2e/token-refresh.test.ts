// E2E：access_token 失效时用真实 refresh_token 自动续期。
//
// ── 覆盖的两条路径 ──────────────────────────────────────────────────
//   A. 主动续期：本地 access_token 的 exp 已过 → 发请求前先换新令牌
//   B. 被动续期：access_token 的 exp 没过但服务端不认（签名无效）→ 401 后换新令牌再重试
//   两条都断言「命令 exit 0」+「config 里的 access_token 被换掉了」。
//
// ── 运行前提 ────────────────────────────────────────────────────────
//   - 门槛：缺 SUPSUB_E2E_REFRESH_TOKEN 则跳过。
//   - 用例会真的换取新令牌。实测该后端换新后**旧 refreshToken 在有效期内仍可用**，
//     所以拿本机 ~/.supsub 的令牌跑不会把自己踢下线；但换回来的新令牌落在
//     用例的临时 config 里（路径见 stderr 打印），本机 config 不会被更新。
//   - 基址：统一走 e2eApiUrl()（SUPSUB_API_URL > DEFAULT_API_URL），
//     refresh_token 必须与该环境匹配。
//
// 启用示例：
//   SUPSUB_E2E_REFRESH_TOKEN='<jwt>' bun test test/e2e/token-refresh.test.ts
//
// 两个用例按顺序共享同一个临时 config：B 用的是 A 换回来的新 refresh_token。

import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { e2eApiUrl } from '../_helpers/api-url.ts';
import { makeJwt } from '../_helpers/jwt.ts';

// bun test 默认 cwd 为项目根目录
const ENTRY = 'src/index.ts';

const REFRESH_TOKEN = process.env.SUPSUB_E2E_REFRESH_TOKEN;
const SKIP = !REFRESH_TOKEN;

type Cfg = { access_token?: string; refresh_token?: string; client_id?: string };

type RunResult = { code: number | null; stdout: string; stderr: string };

/** 跑一次 CLI 子进程，指定隔离的 SUPSUB_CONFIG_DIR。 */
function runCli(args: string[], configDir: string, apiUrl: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', ENTRY, ...args], {
      env: {
        ...process.env,
        SUPSUB_CONFIG_DIR: configDir,
        SUPSUB_API_URL: apiUrl,
        // 保证凭证只可能来自 config，避免本机 env 干扰
        SUPSUB_API_KEY: '',
        SUPSUB_NO_BROWSER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(SKIP)('E2E - 令牌自动续期', () => {
  const apiUrl = e2eApiUrl();
  let configDir = '';

  async function readCfg(): Promise<Cfg> {
    return JSON.parse(await fs.readFile(path.join(configDir, 'config.json'), 'utf-8')) as Cfg;
  }

  async function writeCfg(cfg: Cfg): Promise<void> {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  }

  test('A. access_token 本地已过期 → 主动续期后命令正常返回', async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-refresh-'));
    const now = Math.floor(Date.now() / 1000);
    const staleAccess = makeJwt({ id: 0, client: 'cli', iat: now - 7200, exp: now - 3600 });
    await writeCfg({
      access_token: staleAccess,
      refresh_token: REFRESH_TOKEN as string,
      client_id: 'supsub-cli',
    });

    const res = await runCli(['auth', 'status', '-o', 'json'], configDir, apiUrl);
    expect(res.code).toBe(0);

    const parsed = JSON.parse(res.stdout) as { success: boolean; data?: { email?: string } };
    expect(parsed.success).toBe(true);
    expect(typeof parsed.data?.email).toBe('string');

    // 新令牌已落盘：access_token 不再是那个过期的假货
    const cfg = await readCfg();
    expect(cfg.access_token).toBeDefined();
    expect(cfg.access_token).not.toBe(staleAccess);
    expect(typeof cfg.refresh_token).toBe('string');
    // 轮换后的令牌在这里，用例失败时方便捞回来
    process.stderr.write(`[e2e] 续期后的 config 目录：${configDir}\n`);
  }, 120_000);

  test('B. access_token 未过期但服务端不认 → 401 后续期重试成功', async () => {
    // 用 A 换回来的 refresh_token，顺带验证「续期写回的令牌确实能再次用于续期」
    const before = await readCfg();
    const now = Math.floor(Date.now() / 1000);
    // exp 在未来 → 本地判定「没过期」，不会触发主动续期；但签名是假的，服务端必然 401
    const bogusAccess = makeJwt({ id: 0, client: 'cli', iat: now, exp: now + 86_400 });
    await writeCfg({
      access_token: bogusAccess,
      refresh_token: before.refresh_token,
      client_id: 'supsub-cli',
    });

    const res = await runCli(['auth', 'status', '-o', 'json'], configDir, apiUrl);
    expect(res.code).toBe(0);

    const parsed = JSON.parse(res.stdout) as { success: boolean; data?: { email?: string } };
    expect(parsed.success).toBe(true);
    expect(typeof parsed.data?.email).toBe('string');

    const cfg = await readCfg();
    expect(cfg.access_token).not.toBe(bogusAccess);
    process.stderr.write(`[e2e] 续期后的 config 目录：${configDir}\n`);
  }, 120_000);
});
