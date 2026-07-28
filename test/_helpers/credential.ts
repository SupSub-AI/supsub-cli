// 测试里切换「当前登录凭证」的辅助。
//
// CLI 移除 API Key 通道后，凭证只能来自配置文件，进程级的 setCliApiKey 注入口
// 也随之删除。测试改为直接写隔离的配置目录（SUPSUB_CONFIG_DIR 由 test/setup.ts
// 的 preload 指到 tmp），resolveApiKey() 每次都重读配置，所以写完即刻生效。
import { clearAuth, writeConfig } from '../../src/config/store.ts';

/** 设为指定凭证；传 undefined 表示登出（清空所有认证字段）。 */
export async function setTestCredential(key: string | undefined): Promise<void> {
  if (key === undefined) {
    await clearAuth();
    return;
  }
  await writeConfig({ access_token: key, client_id: 'supsub-cli' });
}
