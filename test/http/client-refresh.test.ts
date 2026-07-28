// src/http/client.ts：401 自动续期 + 重试的闭环
//
// 已有的 client.test.ts 覆盖「无续期通道的来源 401 → clearAuth」的老行为；
// 本文件补的是设备授权来源（config 里有 refresh_token）多出来的一层：
// 过期先续、401 续了再重试、续不成时该不该登出。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { configDir, configFile } from '../_helpers/config-path.ts';
import { makeJwtExpiringIn } from '../_helpers/jwt.ts';

const CONFIG_DIR = configDir();
const CONFIG_FILE = configFile();

type Cfg = {
  access_token?: string;
  refresh_token?: string;
  bearer_token?: string;
  client_id?: string;
};

/** 一次被拦下来的请求：路径 + 当时带的 Authorization 头 */
type Captured = { path: string; auth: string | undefined };

async function writeRawConfig(cfg: Cfg): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

async function readRawConfig(): Promise<Cfg> {
  return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8')) as Cfg;
}

describe('http/client - 401 自动续期', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let captured: Captured[];

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    captured = [];

    const { __resetRefreshStateForTest } = await import('../../src/http/token-refresh.ts');
    __resetRefreshStateForTest();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;

    const { __resetRefreshStateForTest } = await import('../../src/http/token-refresh.ts');
    __resetRefreshStateForTest();
    await fs.writeFile(CONFIG_FILE, JSON.stringify({}, null, 2), 'utf-8').catch(() => {});
  });

  /**
   * 装一个能分辨「业务请求 / 续期请求」的 fetch：
   * @param onBusiness 第 n 次业务请求（从 1 开始）该返回什么
   * @param onRefresh  续期端点该返回什么（抛错表示网络异常）
   */
  function mockFetch(
    onBusiness: (nth: number) => Response,
    onRefresh: () => Response | Promise<Response>,
  ): void {
    let businessCount = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      captured.push({ path: url.pathname, auth: headers.Authorization });
      if (url.pathname === '/api/auth/tokens') {
        return onRefresh();
      }
      businessCount += 1;
      return onBusiness(businessCount);
    };
  }

  const okJson = (data: unknown): Response =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'text/json' } });
  const unauthorized = (): Response => new Response(null, { status: 401 });
  const refreshed = (accessToken: string): Response =>
    okJson({ accessToken, refreshToken: 'refresh-v2' });

  test('业务请求 401 → 续期成功 → 用新令牌重试并拿到结果', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(86_400),
      refresh_token: 'refresh-v1',
      client_id: 'supsub-cli',
    });
    mockFetch(
      (nth) => (nth === 1 ? unauthorized() : okJson({ email: 'a@b.c' })),
      () => refreshed('access-v2'),
    );

    const { request } = await import('../../src/http/client.ts');
    const result = await request<{ email: string }>({ method: 'GET', path: '/api/user/info' });

    expect(result.email).toBe('a@b.c');
    // 三次请求：业务(旧令牌) → 续期 → 业务(新令牌)
    expect(captured.map((c) => c.path)).toEqual([
      '/api/user/info',
      '/api/auth/tokens',
      '/api/user/info',
    ]);
    expect(captured[2]?.auth).toBe('Bearer access-v2');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('access-v2');
    expect(cfg.refresh_token).toBe('refresh-v2');
  });

  test('业务请求 401 → refreshToken 也失效 → clearAuth 并抛 UNAUTHORIZED', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(86_400),
      refresh_token: 'dead-refresh',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => unauthorized(),
      () => new Response(JSON.stringify({ code: 'Unauthorized' }), { status: 401 }),
    );

    const { request } = await import('../../src/http/client.ts');
    let caught: unknown;
    try {
      await request({ method: 'GET', path: '/api/user/info' });
    } catch (err) {
      caught = err;
    }

    expect((caught as { code: string }).code).toBe('UNAUTHORIZED');
    const cfg = await readRawConfig();
    expect(cfg.access_token).toBeUndefined();
    expect(cfg.refresh_token).toBeUndefined();
  });

  test('续期请求本身网络异常 → 保留凭证并抛 NETWORK_ERROR（不把人登出）', async () => {
    const accessToken = makeJwtExpiringIn(86_400);
    await writeRawConfig({
      access_token: accessToken,
      refresh_token: 'refresh-v1',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => unauthorized(),
      () => {
        throw new Error('ECONNRESET');
      },
    );

    const { request } = await import('../../src/http/client.ts');
    let caught: unknown;
    try {
      await request({ method: 'GET', path: '/api/user/info' });
    } catch (err) {
      caught = err;
    }

    expect((caught as { code: string }).code).toBe('NETWORK_ERROR');
    // 关键：凭证必须还在，用户稍后重试即可，不需要重新登录
    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe(accessToken);
    expect(cfg.refresh_token).toBe('refresh-v1');
  });

  test('续期成功后重试仍 401 → clearAuth 并抛 UNAUTHORIZED（只重试一次）', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(86_400),
      refresh_token: 'refresh-v1',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => unauthorized(),
      () => refreshed('access-v2'),
    );

    const { request } = await import('../../src/http/client.ts');
    let caught: unknown;
    try {
      await request({ method: 'GET', path: '/api/user/info' });
    } catch (err) {
      caught = err;
    }

    expect((caught as { code: string }).code).toBe('UNAUTHORIZED');
    // 业务请求恰好两次，不会无限重试
    expect(captured.filter((c) => c.path === '/api/user/info').length).toBe(2);
    expect(captured.filter((c) => c.path === '/api/auth/tokens').length).toBe(1);
  });

  test('access_token 已过期 → 发请求前先续期，业务请求只发一次且带新令牌', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(-60),
      refresh_token: 'refresh-v1',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => okJson({ email: 'a@b.c' }),
      () => refreshed('access-v2'),
    );

    const { request } = await import('../../src/http/client.ts');
    await request({ method: 'GET', path: '/api/user/info' });

    expect(captured.map((c) => c.path)).toEqual(['/api/auth/tokens', '/api/user/info']);
    expect(captured[1]?.auth).toBe('Bearer access-v2');
  });

  test('access_token 已过期且 refreshToken 失效 → 不再发业务请求，直接要求重新登录', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(-60),
      refresh_token: 'dead-refresh',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => okJson({ email: 'a@b.c' }),
      () => new Response(JSON.stringify({ code: 'Unauthorized' }), { status: 401 }),
    );

    const { request } = await import('../../src/http/client.ts');
    let caught: unknown;
    try {
      await request({ method: 'GET', path: '/api/user/info' });
    } catch (err) {
      caught = err;
    }

    expect((caught as { code: string }).code).toBe('UNAUTHORIZED');
    expect(captured.map((c) => c.path)).toEqual(['/api/auth/tokens']);
    const cfg = await readRawConfig();
    expect(cfg.access_token).toBeUndefined();
  });

  test('access_token 已过期但续期端点抖动 → 仍按老令牌发出去（时钟可能有偏差）', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(-60),
      refresh_token: 'refresh-v1',
      client_id: 'supsub-cli',
    });
    mockFetch(
      () => okJson({ email: 'a@b.c' }),
      () => new Response('boom', { status: 502 }),
    );

    const { request } = await import('../../src/http/client.ts');
    const result = await request<{ email: string }>({ method: 'GET', path: '/api/user/info' });

    expect(result.email).toBe('a@b.c');
    expect(captured.map((c) => c.path)).toEqual(['/api/auth/tokens', '/api/user/info']);
  });

  test('bearer_token 来源没有续期通道：401 直接 clearAuth，不打续期端点', async () => {
    await writeRawConfig({ bearer_token: 'browser-token', client_id: 'supsub-cli' });
    mockFetch(
      () => unauthorized(),
      () => refreshed('access-v2'),
    );

    const { request } = await import('../../src/http/client.ts');
    let caught: unknown;
    try {
      await request({ method: 'GET', path: '/api/user/info' });
    } catch (err) {
      caught = err;
    }

    expect((caught as { code: string }).code).toBe('UNAUTHORIZED');
    expect(captured.filter((c) => c.path === '/api/auth/tokens').length).toBe(0);
  });
});
