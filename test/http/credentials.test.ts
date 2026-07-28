// packages/cli/test/http/credentials.test.ts
// 凭证解析的优先级：access_token（config）> bearer_token（session）。
//
// 配置目录由 SUPSUB_CONFIG_DIR 解析，bun preload (test/setup.ts) 已经
// 把它指向一次性 tmp 目录，afterEach 仅做用例间清理，不会影响本机 ~/.supsub。

import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { configFile } from '../_helpers/config-path.ts';

const CONFIG_FILE = configFile();

async function cleanupAuthFields(): Promise<void> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const {
      access_token: _at,
      refresh_token: _rt,
      api_key: _a,
      client_id: _c,
      bearer_token: _b,
      ...rest
    } = parsed;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(rest, null, 2), 'utf-8');
  } catch {
    // 文件不存在时忽略
  }
}

describe('resolveApiKey - 凭证来源与优先级', () => {
  afterEach(async () => {
    await cleanupAuthFields();
  });

  test('仅 bearer_token 时被识别为 session 来源', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({ bearer_token: 'abc.def.ghi', client_id: 'supsub-cli' });

    const result = await resolveApiKey();
    expect(result.key).toBe('abc.def.ghi');
    expect(result.clientId).toBe('supsub-cli');
    expect(result.source).toBe('session');
    // session 来源没有续期通道
    expect(result.refreshToken).toBeUndefined();
  });

  test('仅 access_token 时被识别为 config 来源', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({ access_token: 'acc.token.jwt', client_id: 'supsub-cli' });

    const result = await resolveApiKey();
    expect(result.key).toBe('acc.token.jwt');
    expect(result.clientId).toBe('supsub-cli');
    expect(result.source).toBe('config');
  });

  test('access_token 与 bearer_token 共存时 access_token 胜出', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({
      access_token: 'acc.token.jwt',
      bearer_token: 'browser_token',
      client_id: 'supsub-cli',
    });

    const result = await resolveApiKey();
    expect(result.key).toBe('acc.token.jwt');
    expect(result.source).toBe('config');
  });

  test('access_token 带 refresh_token 时一并返回，供续期使用', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({
      access_token: 'acc.token.jwt',
      refresh_token: 'ref.token.jwt',
      client_id: 'supsub-cli',
    });

    const result = await resolveApiKey();
    expect(result.refreshToken).toBe('ref.token.jwt');
  });

  // ─── API Key 通道已移除，以下两条守住不会被悄悄改回来 ───

  test('老配置残留的 api_key 不再被当作凭证', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({ api_key: 'sk_live_xxx', client_id: 'supsub-cli' });

    const result = await resolveApiKey();
    expect(result.key).toBeUndefined();
    expect(result.source).toBeUndefined();
  });

  test('api_key 与 bearer_token 共存时由 bearer_token 生效', async () => {
    const { writeConfig } = await import('../../src/config/store.ts');
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    await writeConfig({
      api_key: 'sk_live_xxx',
      bearer_token: 'browser_token',
      client_id: 'supsub-cli',
    });

    const result = await resolveApiKey();
    expect(result.key).toBe('browser_token');
    expect(result.source).toBe('session');
  });

  test('clearAuth 同时清除 bearer_token 与老配置里的 api_key', async () => {
    const { writeConfig, readConfig, clearAuth } = await import('../../src/config/store.ts');

    await writeConfig({
      api_key: 'k_unit',
      bearer_token: 't_unit',
      client_id: 'c_unit',
    });
    await clearAuth();

    const cfg = await readConfig();
    expect(cfg.api_key).toBeUndefined();
    expect(cfg.bearer_token).toBeUndefined();
    expect(cfg.client_id).toBeUndefined();
  });

  test('无任何凭证时 source 为 undefined', async () => {
    const { resolveApiKey } = await import('../../src/http/credentials.ts');

    // 确保 config 没有认证字段
    await cleanupAuthFields();

    const result = await resolveApiKey();
    expect(result.key).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});
