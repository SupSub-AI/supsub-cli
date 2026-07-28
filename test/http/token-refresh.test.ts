// src/http/token-refresh.ts：用 refresh_token 换新 access_token 的编排层
//
// 关注四种结局的区分（refreshed / invalid / unavailable / skipped），
// 尤其是 **unavailable 不能等同于 invalid** ——一次网络闪断不该把用户登出。
//
// 配置目录由 test/setup.ts 的 preload 指向 tmp 目录，不会碰本机 ~/.supsub。
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

async function writeRawConfig(cfg: Cfg): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

async function readRawConfig(): Promise<Cfg> {
  return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8')) as Cfg;
}

describe('http/token-refresh', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  /** 记录续期端点被打了几次，用来验证并发去重 / 提前跳过 */
  let refreshCalls: number;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    refreshCalls = 0;

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

  /** 让续期端点返回指定响应，并计数调用次数 */
  function mockRefreshEndpoint(handler: () => Promise<Response> | Response): void {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (!url.includes('/api/auth/tokens')) {
        throw new Error(`用例未预期的请求：${url}`);
      }
      refreshCalls += 1;
      return handler();
    };
  }

  test('续期成功：返回 refreshed，新令牌写回 config', async () => {
    await writeRawConfig({
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      client_id: 'supsub-cli',
    });
    mockRefreshEndpoint(
      () =>
        new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }), {
          status: 200,
        }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('refreshed');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('new-access');
    expect(cfg.refresh_token).toBe('new-refresh');
    // 续期不该顺手把 client_id 洗掉
    expect(cfg.client_id).toBe('supsub-cli');
  });

  test('201 也算成功（实测线上返回 201，api.json 写的是 200）', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(
      () =>
        new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }), {
          status: 201,
        }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('refreshed');
    expect((await readRawConfig()).access_token).toBe('new-access');
  });

  test('响应用 snake_case 也能解析（与 device/token 同样的字段名容错）', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(
      () =>
        new Response(
          JSON.stringify({ access_token: 'snake-access', refresh_token: 'snake-refresh' }),
          { status: 200 },
        ),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('refreshed');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('snake-access');
    expect(cfg.refresh_token).toBe('snake-refresh');
  });

  test('服务端未轮换 refreshToken 时沿用旧的', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(
      () => new Response(JSON.stringify({ accessToken: 'new-access' }), { status: 200 }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('refreshed');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('new-access');
    expect(cfg.refresh_token).toBe('old-refresh');
  });

  test('refreshToken 失效（401）：返回 invalid，本层不动 config', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'dead-refresh' });
    mockRefreshEndpoint(
      () =>
        new Response(JSON.stringify({ code: 'Unauthorized', message: '无效的令牌', status: 401 }), {
          status: 401,
        }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('invalid');

    // 清凭证是 http/client.ts 的职责，这一层只负责给出结论
    const cfg = await readRawConfig();
    expect(cfg.refresh_token).toBe('dead-refresh');
  });

  test('参数校验失败（400）同样判为 invalid', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'short' });
    mockRefreshEndpoint(
      () => new Response(JSON.stringify({ code: 'Validation error' }), { status: 400 }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('invalid');
  });

  test('服务端 5xx：返回 unavailable，令牌保持原样', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(() => new Response('boom', { status: 502 }));

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('unavailable');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('old-access');
    expect(cfg.refresh_token).toBe('old-refresh');
  });

  test('网络异常：返回 unavailable，令牌保持原样', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(() => {
      throw new Error('ECONNRESET');
    });

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('unavailable');

    const cfg = await readRawConfig();
    expect(cfg.refresh_token).toBe('old-refresh');
  });

  test('响应缺 accessToken：按 unavailable 处理，不误判为失效', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('unavailable');

    const cfg = await readRawConfig();
    expect(cfg.access_token).toBe('old-access');
  });

  test('bearer_token 来源没有续期通道：返回 skipped 且不发请求', async () => {
    await writeRawConfig({ bearer_token: 'pasted_from_devtools', client_id: 'supsub-cli' });
    mockRefreshEndpoint(() => new Response('{}', { status: 200 }));

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    expect(await refreshAccessToken()).toBe('skipped');
    expect(refreshCalls).toBe(0);
  });

  test('并发续期只打一次端点（省掉重复往返，避免两次 writeConfig 互相覆盖）', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
        {
          status: 200,
        },
      );
    });

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(results).toEqual(['refreshed', 'refreshed', 'refreshed']);
    expect(refreshCalls).toBe(1);
  });

  test('一次续期结束后允许下一次续期（in-flight 状态被正确释放）', async () => {
    await writeRawConfig({ access_token: 'old-access', refresh_token: 'old-refresh' });
    mockRefreshEndpoint(
      () =>
        new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }), {
          status: 200,
        }),
    );

    const { refreshAccessToken } = await import('../../src/http/token-refresh.ts');
    await refreshAccessToken();
    await refreshAccessToken();
    expect(refreshCalls).toBe(2);
  });
});

describe('http/token-refresh - refreshIfExpiringSoon', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let refreshCalls: number;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    refreshCalls = 0;

    const { __resetRefreshStateForTest } = await import('../../src/http/token-refresh.ts');
    __resetRefreshStateForTest();

    globalThis.fetch = async (): Promise<Response> => {
      refreshCalls += 1;
      return new Response(
        JSON.stringify({ accessToken: makeJwtExpiringIn(86_400), refreshToken: 'new-refresh' }),
        { status: 200 },
      );
    };
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;

    const { __resetRefreshStateForTest } = await import('../../src/http/token-refresh.ts');
    __resetRefreshStateForTest();
    await fs.writeFile(CONFIG_FILE, JSON.stringify({}, null, 2), 'utf-8').catch(() => {});
  });

  test('access_token 还很富余时不发续期请求', async () => {
    await writeRawConfig({
      access_token: makeJwtExpiringIn(86_400),
      refresh_token: 'old-refresh',
    });

    const { refreshIfExpiringSoon } = await import('../../src/http/token-refresh.ts');
    expect(await refreshIfExpiringSoon()).toBe('skipped');
    expect(refreshCalls).toBe(0);
  });

  test('access_token 已过期时主动续期', async () => {
    await writeRawConfig({ access_token: makeJwtExpiringIn(-60), refresh_token: 'old-refresh' });

    const { refreshIfExpiringSoon } = await import('../../src/http/token-refresh.ts');
    expect(await refreshIfExpiringSoon()).toBe('refreshed');
    expect(refreshCalls).toBe(1);

    const cfg = await readRawConfig();
    expect(cfg.refresh_token).toBe('new-refresh');
  });

  // 有 refresh_token（续期通道在），但 access_token 解不出 exp —— 走的是 jwt 解析这一关，
  // 而不是「来源不支持续期」那一关。
  test('凭证不是 JWT 时不做任何猜测', async () => {
    await writeRawConfig({ access_token: 'not-a-jwt', refresh_token: 'r_unit' });

    const { refreshIfExpiringSoon } = await import('../../src/http/token-refresh.ts');
    expect(await refreshIfExpiringSoon()).toBe('skipped');
    expect(refreshCalls).toBe(0);
  });

  test('未登录（config 为空）时返回 skipped', async () => {
    await writeRawConfig({});

    const { refreshIfExpiringSoon } = await import('../../src/http/token-refresh.ts');
    expect(await refreshIfExpiringSoon()).toBe('skipped');
    expect(refreshCalls).toBe(0);
  });
});
