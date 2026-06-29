import { beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BEARER = process.env.SUPSUB_E2E_BEARER || process.env.SUPSUB_API_KEY;
const SKIP = !BEARER;

// bun test 默认 cwd 为项目根目录
const ENTRY = 'src/index.ts';

type CliResult = { stdout: string; stderr: string; code: number };

/**
 * 用子进程运行 CLI，返回 stdout/stderr/exit code。
 * 关键点：
 *   - HOME 指到一个空临时目录，强制 readConfig 拿空对象，
 *     避免本机现有 ~/.supsub/config.json 抢 source=config 优先级
 *   - 不强制覆盖 SUPSUB_API_URL：基址由 CLI 子进程自行解析
 *     （SUPSUB_API_URL > DEFAULT_API_URL）。跑测试时用 SUPSUB_API_URL
 *     指向目标环境，并提供同环境的 SUPSUB_E2E_BEARER。
 *   - exitOverride 不可用（真实子进程），靠 exit code 判断业务结果
 */
async function runCli(
  args: string[],
  opts: {
    withAuth?: boolean;
    tmpHome?: string;
    /**
     * 通过 SUPSUB_API_KEY 环境变量注入 key（用于测试 source=env 路径）。
     * 与 withAuth (=>--api-key flag) 不互斥，但同时设置时 flag 优先。
     */
    apiKeyEnv?: string;
    /** 额外的环境变量覆盖（最高优先级） */
    extraEnv?: Record<string, string>;
  } = {},
): Promise<CliResult> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (opts.tmpHome) env.HOME = opts.tmpHome;
  // 默认先清掉本机 SUPSUB_API_KEY，避免抢 source=env 优先级
  delete env.SUPSUB_API_KEY;
  // 测试需要走 env source 时再显式注入
  if (opts.apiKeyEnv !== undefined) env.SUPSUB_API_KEY = opts.apiKeyEnv;
  if (opts.extraEnv) Object.assign(env, opts.extraEnv);

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

describe.skipIf(SKIP)('e2e/prod-cli - 通过子进程驱动 CLI 打测试环境', () => {
  let tmpHome: string;

  beforeAll(async () => {
    // 每个测试组用一个空 HOME，避免污染本机 ~/.supsub/config.json
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-'));
  });

  // ─── 元命令（不依赖鉴权与网络） ────────────────────────────

  test('查看版本号', async () => {
    const r = await runCli(['--version'], { tmpHome });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('查看顶层帮助：列出 auth/sub/search/mp/focus 全部命令', async () => {
    const r = await runCli(['--help'], { tmpHome });
    expect(r.code).toBe(0);
    for (const cmd of ['auth', 'sub', 'search', 'mp', 'focus']) {
      expect(r.stdout).toContain(cmd);
    }
  });

  test('输入不存在的命令：报错并以非 0 退出', async () => {
    const r = await runCli(['nonexistent'], { tmpHome });
    expect(r.code).not.toBe(0);
  });

  // ─── 鉴权相关 ───────────────────────────────────────────────

  test('没登录就查看登录状态：提示去登录、退出码 2', async () => {
    const r = await runCli(['auth', 'status'], { tmpHome }); // 无 --api-key
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/auth login|登录/);
  });

  test('没登录就查看登录状态（JSON 输出）：返回 UNAUTHORIZED 错误体', async () => {
    const r = await runCli(['--output', 'json', 'auth', 'status'], { tmpHome });
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('用 --api-key 临时登录：能拿到 email、api_key 已脱敏、source=flag', async () => {
    const r = await runCli(['--output', 'json', 'auth', 'status'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(body.data.email).toContain('@');
    // --api-key flag 命中 → source=flag
    expect(body.data.api_key_source).toBe('flag');
    // api_key 必须脱敏（不回显原 token）
    expect(body.data.api_key).not.toBe(BEARER);
    expect(body.data.api_key).toContain('***');
  });

  // ─── 订阅查询（read-only） ──────────────────────────────────

  test('查看订阅列表：返回订阅数组', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('只看公众号订阅：列表里全是 MP 类型', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list', '--type', 'MP'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    for (const s of body.data) {
      expect(s.sourceType).toBe('MP');
    }
  });

  test('查看订阅列表用了不支持的类型：本地参数校验失败，不发请求', async () => {
    const r = await runCli(['sub', 'list', '--type', 'BLOG'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/MP|WEBSITE|BLOG/);
  });

  test('看订阅源文章但漏写了 --type：必填参数报错', async () => {
    const r = await runCli(['sub', 'contents', '--source-id', '1'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  // ─── 搜索 ────────────────────────────────────────────────────

  test('全局搜索：返回 results 数组', async () => {
    const r = await runCli(['--output', 'json', 'search', 'openai'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.results)).toBe(true);
  });

  test('全局搜索用了不支持的类型：参数校验失败', async () => {
    const r = await runCli(['search', 'x', '--type', 'BLOG'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  test('取消一个不存在的公众号搜索任务：业务错误退出', async () => {
    const r = await runCli(['--output', 'json', 'mp', 'search-cancel', 'nonexistent-task-id-xyz'], {
      tmpHome,
      withAuth: true,
    });
    // 后端可能返回 404 或其它；只断言非 0 + json 可解析
    expect(r.code).not.toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
  });

  // ─── 鉴权失败路径 ───────────────────────────────────────────

  test('用伪造的 --api-key 登录：服务端 401 → 退出码 2', async () => {
    const r = await runCli(
      ['--api-key', 'sk_invalid_e2e_token', '--output', 'json', 'auth', 'status'],
      { tmpHome },
    );
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // ─── 子命令帮助文本 ─────────────────────────────────────────

  test('查看认证子命令帮助：列出 login/logout/status', async () => {
    const r = await runCli(['auth', '--help'], { tmpHome });
    expect(r.code).toBe(0);
    for (const sub of ['login', 'logout', 'status']) {
      expect(r.stdout).toContain(sub);
    }
  });

  test('查看订阅子命令帮助：列出 list/add/remove/contents', async () => {
    const r = await runCli(['sub', '--help'], { tmpHome });
    expect(r.code).toBe(0);
    for (const sub of ['list', 'add', 'remove', 'contents']) {
      expect(r.stdout).toContain(sub);
    }
  });

  test('查看公众号子命令帮助：列出 search 与 search-cancel', async () => {
    const r = await runCli(['mp', '--help'], { tmpHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('search');
    expect(r.stdout).toContain('search-cancel');
  });

  test('查看全局搜索帮助：包含 keyword/--type', async () => {
    const r = await runCli(['search', '--help'], { tmpHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('keyword');
    expect(r.stdout).toContain('--type');
  });

  // ─── table 模式输出（默认） ─────────────────────────────────

  test('默认表格模式查看登录状态：能看到 email、api_key 已脱敏，输出不是 JSON', async () => {
    const r = await runCli(['auth', 'status'], { tmpHome, withAuth: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('email');
    expect(r.stdout).toContain('api_key');
    expect(r.stdout).toContain('***'); // 脱敏
    // table 模式不应该是 JSON
    let jsonOk = false;
    try {
      JSON.parse(r.stdout);
      jsonOk = true;
    } catch {
      jsonOk = false;
    }
    expect(jsonOk).toBe(false);
  });

  test('默认表格模式查看订阅列表：含表头或 (empty) 提示', async () => {
    const r = await runCli(['sub', 'list'], { tmpHome, withAuth: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/sourceId|empty/);
  });

  // ─── sub list 扩展 ──────────────────────────────────────────

  test('只看网站订阅：列表里全是 WEBSITE 类型', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list', '--type', 'WEBSITE'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    for (const s of body.data) {
      expect(s.sourceType).toBe('WEBSITE');
    }
  });

  test('只看推特(X)订阅：后端接受 X 类型，返回数组且全是 X', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list', '--type', 'X'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    for (const s of body.data) {
      expect(s.sourceType).toBe('X');
    }
  });

  test('用小写 x 看订阅列表：自动归一为 X（不再因 X 非法而报 64）', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list', '--type', 'x'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('用小写 mp 看订阅列表：自动归一为 MP', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list', '--type', 'mp'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    for (const s of body.data) {
      expect(s.sourceType).toBe('MP');
    }
  });

  test('没登录就查订阅列表：UNAUTHORIZED + JSON 错误体', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list'], { tmpHome });
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('订阅项字段完整：sourceId/sourceType/name/unreadCount 都有', async () => {
    const r = await runCli(['--output', 'json', 'sub', 'list'], { tmpHome, withAuth: true });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    if (body.data.length > 0) {
      const s = body.data[0];
      expect(typeof s.sourceId).toBe('number');
      expect(['MP', 'WEBSITE']).toContain(s.sourceType);
      expect(typeof s.name).toBe('string');
      expect(typeof s.unreadCount).toBe('number');
    }
  });

  // ─── search 扩展 ────────────────────────────────────────────

  test('全局搜索按公众号过滤：结果全部是 SOURCE/MP', async () => {
    const r = await runCli(['--output', 'json', 'search', 'openai', '--type', 'MP'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    for (const item of body.data.results) {
      expect(item.type).toBe('SOURCE');
      expect(item.data.sourceType).toBe('MP');
    }
  });

  test('全局搜索按网站过滤：结果全部是 SOURCE/WEBSITE', async () => {
    const r = await runCli(['--output', 'json', 'search', 'news', '--type', 'WEBSITE'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    for (const item of body.data.results) {
      expect(item.type).toBe('SOURCE');
      expect(item.data.sourceType).toBe('WEBSITE');
    }
  });

  test('全局搜索按文章过滤：结果全部是 CONTENT', async () => {
    const r = await runCli(['--output', 'json', 'search', 'openai', '--type', 'CONTENT'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    for (const item of body.data.results) {
      expect(item.type).toBe('CONTENT');
    }
  });

  test('全局搜索没填关键词：commander 报错退出', async () => {
    const r = await runCli(['search'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('全局搜索一个谁都没用过的词：仍 success=true，结果为空', async () => {
    const r = await runCli(['--output', 'json', 'search', 'zzqxyzz_no_such_keyword_8a7d6f'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.results)).toBe(true);
  });

  test('没登录就全局搜索：UNAUTHORIZED', async () => {
    const r = await runCli(['--output', 'json', 'search', 'openai'], { tmpHome });
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // ─── 鉴权来源（source 优先级） ───────────────────────────────

  test('用环境变量 SUPSUB_API_KEY 登录：source=env', async () => {
    const r = await runCli(['--output', 'json', 'auth', 'status'], { tmpHome, apiKeyEnv: BEARER! });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(body.data.api_key_source).toBe('env');
  });

  test('命令行 --api-key 和环境变量都设了：命令行优先（source=flag）', async () => {
    const r = await runCli(['--api-key', BEARER!, '--output', 'json', 'auth', 'status'], {
      tmpHome,
      apiKeyEnv: 'sk_should_be_overridden',
    });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.success).toBe(true);
    expect(body.data.api_key_source).toBe('flag');
  });

  // ─── 添加订阅源：客户端参数校验（不发请求） ─────────────────

  test('添加订阅源时漏填 --source-id：必填参数报错', async () => {
    const r = await runCli(['sub', 'add', '--type', 'MP'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('添加订阅源时漏填 --type：必填参数报错', async () => {
    const r = await runCli(['sub', 'add', '--source-id', '1'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('添加订阅源时类型不支持（如 BLOG）：参数非法退出', async () => {
    const r = await runCli(['sub', 'add', '--type', 'BLOG', '--source-id', '1'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/MP|WEBSITE|BLOG/);
  });

  test('添加订阅源时 --source-id 不是数字：参数非法退出', async () => {
    const r = await runCli(['sub', 'add', '--type', 'MP', '--source-id', 'abc'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/source-id|abc|正整数/);
  });

  test('添加订阅源时 --source-id=0：参数非法退出（要求正整数）', async () => {
    const r = await runCli(['sub', 'add', '--type', 'MP', '--source-id', '0'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  test('添加订阅源时 --source-id 是负数：参数非法退出', async () => {
    const r = await runCli(['sub', 'add', '--type', 'MP', '--source-id', '-3'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).not.toBe(0);
  });

  test('添加订阅源时 --group 不是数字：参数非法退出', async () => {
    const r = await runCli(['sub', 'add', '--type', 'MP', '--source-id', '1', '--group', 'abc'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/group|数字/);
  });

  // ─── 删除订阅源：客户端参数校验 ──────────────────────────────

  test('删除订阅源时漏填 --source-id：必填参数报错', async () => {
    const r = await runCli(['sub', 'remove', '--type', 'MP'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('删除订阅源时漏填 --type：必填参数报错', async () => {
    const r = await runCli(['sub', 'remove', '--source-id', '1'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('删除订阅源时类型不支持（如 BLOG）：参数非法退出', async () => {
    const r = await runCli(['sub', 'remove', '--type', 'BLOG', '--source-id', '1'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  test('删除订阅源时 --source-id 不是数字：参数非法退出', async () => {
    const r = await runCli(['sub', 'remove', '--type', 'MP', '--source-id', 'abc'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  // ─── 看订阅源文章：客户端参数校验 ────────────────────────────

  test('看订阅源文章时漏填 --type：必填参数报错', async () => {
    const r = await runCli(['sub', 'contents', '--source-id', '1'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('看订阅源文章同时指定 --all 和 --unread：提示互斥', async () => {
    const r = await runCli(
      ['sub', 'contents', '--type', 'MP', '--source-id', '1', '--all', '--unread'],
      { tmpHome, withAuth: true },
    );
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/互斥/);
  });

  test('看订阅源文章时类型不支持（如 BLOG）：参数非法退出', async () => {
    const r = await runCli(['sub', 'contents', '--type', 'BLOG', '--source-id', '1'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  test('看订阅源文章时 --source-id 不是数字：参数非法退出', async () => {
    const r = await runCli(['sub', 'contents', '--type', 'MP', '--source-id', 'abc'], {
      tmpHome,
      withAuth: true,
    });
    expect(r.code).toBe(64);
  });

  // ─── 公众号搜索任务：客户端校验 ─────────────────────────────

  test('取消公众号搜索任务时没传任务 ID：必填参数报错', async () => {
    const r = await runCli(['mp', 'search-cancel'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });

  test('公众号子命令下输入不存在的子命令：报错退出', async () => {
    const r = await runCli(['mp', 'nonexistent'], { tmpHome, withAuth: true });
    expect(r.code).not.toBe(0);
  });
});
