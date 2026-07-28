// packages/cli/test/http-client-401.test.ts
// 任务 2.4：HTTP 客户端 401 时验证 clearAuth 被调用且抛出 UNAUTHORIZED
//
// 验证策略：
// - mock globalThis.fetch 返回 401
// - 预先写入 access_token 到真实配置文件（request 内部会从 config 解析凭证）
//   不写 refresh_token：当前来源不具备续期能力，401 直接走 clearAuth
// - 通过 SUPSUB_API_URL 环境变量提供 apiUrl（request 内部从 env 解析）
// - 调用 request() 后断言配置文件中 access_token 已被移除（clearAuth 的文件系统效果）
// - 断言抛出的错误是 { code: "UNAUTHORIZED" }
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { configDir, configFile } from '../_helpers/config-path.ts';

const CONFIG_DIR = configDir();
const CONFIG_FILE = configFile();

describe('http/client - 401 触发 clearAuth 并抛出 UNAUTHORIZED', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';

    // 预先写入认证信息到配置文件（直接写文件，避免用 store 模块导致模块缓存问题）
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({ access_token: 'sk_test_for_401', client_id: 'test-client' }, null, 2),
      'utf-8',
    );

    // mock fetch 返回 401
    globalThis.fetch = async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      return new Response(null, { status: 401, statusText: 'Unauthorized' });
    };
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;

    if (originalApiUrl === undefined) {
      delete process.env.SUPSUB_API_URL;
    } else {
      process.env.SUPSUB_API_URL = originalApiUrl;
    }

    // 清理：移除测试写入的认证字段
    try {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const { access_token: _at, refresh_token: _rt, client_id: _c, ...rest } = parsed;
      await fs.writeFile(CONFIG_FILE, JSON.stringify(rest, null, 2), 'utf-8');
    } catch {
      // 文件不存在时忽略
    }
  });

  test('2.4.a fetch 返回 401 时 config 中 access_token 被清空（clearAuth 效果）', async () => {
    const { request } = await import('../../src/http/client.ts');

    // 验证前配置文件含 access_token
    const beforeContent = await fs.readFile(CONFIG_FILE, 'utf-8');
    const beforeConfig = JSON.parse(beforeContent) as Record<string, unknown>;
    expect(beforeConfig.access_token).toBe('sk_test_for_401');

    // 调用 request，预期抛出
    try {
      await request({
        method: 'GET',
        path: '/api/user/info',
      });
    } catch {
      // 预期抛出，忽略
    }

    // 验证 access_token 已被 clearAuth 移除
    const afterContent = await fs.readFile(CONFIG_FILE, 'utf-8');
    const afterConfig = JSON.parse(afterContent) as Record<string, unknown>;
    expect(afterConfig.access_token).toBeUndefined();
    expect(afterConfig.client_id).toBeUndefined();
  });

  test('2.4.b fetch 返回 401 时抛出 code=UNAUTHORIZED 的 ErrorEnvelope', async () => {
    const { request } = await import('../../src/http/client.ts');

    let caughtError: unknown;
    try {
      await request({
        method: 'GET',
        path: '/api/user/info',
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as { code: string }).code).toBe('UNAUTHORIZED');
    expect((caughtError as { status: number }).status).toBe(401);
  });
});
