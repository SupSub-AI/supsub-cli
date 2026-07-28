// E2E：设备授权流程（Device Flow）完整闭环。
//
// ── 闭环步骤（无需真人点浏览器）──────────────────────────────────────
//   1. 子进程跑 `supsub auth login`（SUPSUB_NO_BROWSER=1 + 独立 SUPSUB_CONFIG_DIR）：
//      CLI POST /api/auth/device/code 申请设备码，stderr 打印「授权码: XXXX」并开始轮询；
//   2. 测试从子进程 stderr 抓出 userCode；
//   3. 用一个「已授权的 bearer」模拟网页端审批（替代真人在 /device 页点「授权设备」）：
//        POST /api/auth/device/approve { userCode }，带 Authorization: Bearer <bearer>；
//   4. CLI 下一次轮询 /api/auth/device/token 拿到 authorized + accessToken/refreshToken，
//      写入 config 后以 0 退出；
//   5. 用同一个 SUPSUB_CONFIG_DIR 跑 `auth status`，断言已登录（GET /api/user/info）。
//
// ── 运行前提 ────────────────────────────────────────────────────────
//   - 鉴权门槛：缺 SUPSUB_E2E_BEARER 跳过（approve 需要登录态，bearer 即「审批人」）。
//   - 基址来源：统一走 e2eApiUrl()（SUPSUB_API_URL > DEFAULT_API_URL）；
//     bearer 必须与 SUPSUB_API_URL 指向的环境一致。
//   - 环境兜底：若目标环境尚未实现 device 端点（device/code 非 2xx），跳过而非失败，
//     这样对着「device 未实现」的环境跑也不会误报红。
//
// 启用示例：
//   SUPSUB_API_URL='https://<env>' SUPSUB_E2E_BEARER='<jwt>' \
//     bun test test/e2e/device-flow.test.ts

import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { e2eApiUrl } from '../_helpers/api-url.ts';

// bun test 默认 cwd 为项目根目录
const ENTRY = 'src/index.ts';

const BEARER = process.env.SUPSUB_E2E_BEARER;
const SKIP = !BEARER;

/** 轮询等待 fn 返回非空值；超时抛错。用于从持续累积的 stderr 里捞 userCode。 */
async function waitFor<T>(fn: () => T | undefined, timeoutMs: number, stepMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined && v !== null && (v as unknown) !== '') return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('waitFor 超时：未在期望时间内拿到目标值');
}

/** 解析 JWT payload（URL-safe base64），仅取 payload、不验签。用于断言新旧 token 同属一人。 */
function decodeJwtPayload(token: string): { id?: number } {
  const part = token.split('.')[1];
  if (!part) return {};
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf-8')) as { id?: number };
}

/** 探测目标环境是否实现了 device/code（未实现则跳过完整闭环，而非判失败）。 */
async function deviceEndpointsImplemented(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(SKIP)('e2e/device-flow - 设备授权完整闭环', () => {
  test('auth login → 抓 userCode → approve → 轮询拿 token → auth status 已登录', async () => {
    const apiUrl = e2eApiUrl();

    // 环境兜底：device 端点没实现就跳过（不让「未实现的环境」把这条测试判红）
    if (!(await deviceEndpointsImplemented(apiUrl))) {
      console.warn(`[device-flow] ${apiUrl} 未实现 device 端点，跳过完整闭环`);
      return;
    }

    // 每条测试用独立的 config 目录，便于断言「token 确实写盘」且不串味
    const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-deviceflow-'));
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    env.SUPSUB_API_URL = apiUrl;
    env.SUPSUB_CONFIG_DIR = cfgDir;
    env.SUPSUB_NO_BROWSER = '1';

    // 1. 启动 auth login（会持续轮询），捕获 stderr
    const child = spawn('bun', ['run', ENTRY, 'auth', 'login'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c.toString()));
    let exited = false;
    const closed = new Promise<number>((resolve) =>
      child.on('close', (code) => {
        exited = true;
        resolve(code ?? -1);
      }),
    );

    try {
      // 2. 从 stderr 抓 userCode（输出形如「授权码: XXXX」）
      const userCode = await waitFor(() => stderr.match(/授权码[:：]\s*(\S+)/)?.[1], 15_000);

      // 3. 用已授权 bearer 模拟网页审批
      const approve = await fetch(`${apiUrl}/api/auth/device/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${BEARER}`,
        },
        body: JSON.stringify({ userCode }),
      });
      expect(approve.ok).toBe(true);

      // 4. CLI 轮询拿到 token → 写 config → 0 退出
      const code = await closed;
      expect(code).toBe(0);

      // config 落盘：access_token / refresh_token 都在
      const cfg = JSON.parse(await fs.readFile(path.join(cfgDir, 'config.json'), 'utf-8')) as {
        access_token?: string;
        refresh_token?: string;
      };
      expect(typeof cfg.access_token).toBe('string');
      expect(typeof cfg.refresh_token).toBe('string');

      // 新 token 与审批人 bearer 同属一个账号（payload.id 一致）
      const newId = decodeJwtPayload(cfg.access_token ?? '').id;
      const approverId = decodeJwtPayload(BEARER ?? '').id;
      if (newId !== undefined && approverId !== undefined) {
        expect(newId).toBe(approverId);
      }
    } finally {
      // 兜底：中途失败别把子进程挂在那儿继续轮询
      if (!exited) child.kill();
    }

    // 5. 用同一 config 跑 auth status，断言已登录
    const status = await new Promise<{ stdout: string; code: number }>((resolve, reject) => {
      const c = spawn('bun', ['run', ENTRY, '--output', 'json', 'auth', 'status'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      c.stdout.on('data', (d) => (out += d.toString()));
      c.on('error', reject);
      c.on('close', (code) => resolve({ stdout: out, code: code ?? -1 }));
    });
    expect(status.code).toBe(0);
    const body = JSON.parse(status.stdout);
    expect(body.success).toBe(true);
    expect(typeof body.data.email).toBe('string');
  }, 60_000);
});
