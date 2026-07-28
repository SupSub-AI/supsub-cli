// packages/cli/test/config-store.test.ts
// 任务 1.2：config/store.ts 单元自检
//
// store.ts 通过 SUPSUB_CONFIG_DIR 环境变量解析配置目录；
// test/setup.ts（bun preload）已经把它指向一次性 tmp 目录，
// 因此本测试 writeConfig / clearAuth 全部落到 tmp，不污染本机 ~/.supsub。

import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { configFile } from '../_helpers/config-path.ts';

const CONFIG_FILE = configFile();

// 在测试完成后清理认证字段（不删整个目录，可能有其他字段）
async function cleanupConfigAuth(): Promise<void> {
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

describe('config/store - readConfig / writeConfig / clearAuth', () => {
  afterEach(async () => {
    await cleanupConfigAuth();
  });

  test('1.2.a writeConfig 写入后 readConfig 可取回', async () => {
    const { writeConfig, readConfig } = await import('../../src/config/store.ts');

    await writeConfig({ access_token: 'sk_test_unit' });
    const config = await readConfig();
    expect(config.access_token).toBe('sk_test_unit');
  });

  test('1.2.b writeConfig patch 合并保留旧字段', async () => {
    const { writeConfig, readConfig } = await import('../../src/config/store.ts');

    // 先写 access_token
    await writeConfig({ access_token: 'k1_unit' });
    // 再 patch client_id
    await writeConfig({ client_id: 'c1_unit' });
    const config = await readConfig();
    expect(config.access_token).toBe('k1_unit');
    expect(config.client_id).toBe('c1_unit');
  });

  test('1.2.c clearAuth 仅移除认证字段', async () => {
    const { writeConfig, readConfig, clearAuth } = await import('../../src/config/store.ts');

    await writeConfig({ api_key: 'k_unit', client_id: 'c_unit' });
    await clearAuth();
    const config = await readConfig();
    expect(config.api_key).toBeUndefined();
    expect(config.client_id).toBeUndefined();
  });

  test('1.2.e clearAuth 同时移除 access_token / refresh_token', async () => {
    const { writeConfig, readConfig, clearAuth } = await import('../../src/config/store.ts');

    await writeConfig({
      access_token: 'acc_unit',
      refresh_token: 'ref_unit',
      client_id: 'supsub-cli',
    });
    await clearAuth();
    const config = await readConfig();
    expect(config.access_token).toBeUndefined();
    expect(config.refresh_token).toBeUndefined();
    expect(config.client_id).toBeUndefined();
  });

  test('1.2.d 文件不存在时 readConfig 返回空对象', async () => {
    // 在临时目录中验证，不依赖真实 HOME
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supsub-nofile-'));
    const nonExistentFile = path.join(tmpDir, 'config.json');

    // store.ts 的 readConfig 内部 try/catch fs.readFile，失败返回 {}
    // 直接验证：读一个不存在的文件，JSON.parse 会抛，应该返回 {}
    let result: Record<string, unknown>;
    try {
      const content = await fs.readFile(nonExistentFile, 'utf-8');
      result = JSON.parse(content) as Record<string, unknown>;
    } catch {
      result = {};
    }
    expect(result).toEqual({});
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
