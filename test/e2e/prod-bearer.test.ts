import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUserInfo } from '../../src/api/auth.ts';
import { searchAll } from '../../src/api/search.ts';
import { listSubs } from '../../src/api/subscription.ts';
import { e2eApiUrl } from '../_helpers/api-url.ts';

const BEARER_TOKEN = process.env.SUPSUB_E2E_BEARER;
const SKIP = !BEARER_TOKEN;

/**
 * 解析 JWT payload（URL-safe base64），用于断言 /api/user/info 返回与 token 身份一致。
 * 不校验签名（运行时无密钥），仅取 payload。
 */
function decodeJwtPayload(token: string): { id?: number; email?: string } {
  const part = token.split('.')[1];
  if (!part) return {};
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const json = Buffer.from(b64 + pad, 'base64').toString('utf-8');
  return JSON.parse(json) as { id?: number; email?: string };
}

describe.skipIf(SKIP)('e2e/prod-bearer - 测试环境 access_token 鉴权', () => {
  let originalApiUrl: string | undefined;
  let originalConfigDir: string | undefined;
  let configDir: string;
  let expectedId: number | undefined;
  let expectedEmail: string | undefined;

  beforeAll(async () => {
    const payload = decodeJwtPayload(BEARER_TOKEN!);
    expectedId = payload.id;
    expectedEmail = payload.email;

    originalApiUrl = process.env.SUPSUB_API_URL;
    originalConfigDir = process.env.SUPSUB_CONFIG_DIR;
    // 统一基址来源：SUPSUB_API_URL > DEFAULT_API_URL（不在仓库写死测试环境地址）。
    // 跑测试时用 SUPSUB_API_URL 指向目标环境，并提供同环境的 SUPSUB_E2E_BEARER。
    process.env.SUPSUB_API_URL = e2eApiUrl();
    // 把 BEARER 作为 access_token 写进隔离的临时 config 目录，让 resolveApiKey()
    // 从 config 读到它（source=config）。只写 access_token、不写 refresh_token —— 与旧
    // --api-key 直登等价，没有续期通道，token-refresh 不会介入。
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-e2e-bearer-'));
    process.env.SUPSUB_CONFIG_DIR = configDir;
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ access_token: BEARER_TOKEN, client_id: 'supsub-cli' }),
    );
  });

  afterAll(async () => {
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    if (originalConfigDir === undefined) delete process.env.SUPSUB_CONFIG_DIR;
    else process.env.SUPSUB_CONFIG_DIR = originalConfigDir;
    await fs.rm(configDir, { recursive: true, force: true });
  });

  test('GET /api/user/info 返回的 id/email 与 JWT payload 一致', async () => {
    const info = await getUserInfo();
    if (expectedId !== undefined) expect(info.id).toBe(expectedId);
    if (expectedEmail !== undefined) expect(info.email).toBe(expectedEmail);
    expect(typeof info.expired).toBe('boolean');
  });

  test('GET /api/subscriptions 返回数组（订阅列表）', async () => {
    const subs = await listSubs();
    expect(Array.isArray(subs)).toBe(true);
    if (subs.length > 0) {
      const s = subs[0]!;
      expect(typeof s.sourceId).toBe('number');
      expect(['MP', 'WEBSITE']).toContain(s.sourceType);
      expect(typeof s.name).toBe('string');
      expect(typeof s.unreadCount).toBe('number');
    }
  });

  test('GET /api/search 返回 SearchResponse 结构（results）', async () => {
    const r = await searchAll({ type: 'ALL', keywords: 'openai' });
    expect(Array.isArray(r.results)).toBe(true);
    // results 内每项必须有 type 字段且为 SOURCE/CONTENT
    for (const item of r.results) {
      expect(['SOURCE', 'CONTENT']).toContain(item.type);
    }
  });

  test('GET /api/subscriptions 携带 --type=MP 时仅返回 MP 类型', async () => {
    const subs = await listSubs({ sourceType: 'MP' });
    expect(Array.isArray(subs)).toBe(true);
    for (const s of subs) {
      expect(s.sourceType).toBe('MP');
    }
  });
});
