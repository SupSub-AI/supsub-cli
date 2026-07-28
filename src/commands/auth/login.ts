// packages/cli/src/commands/auth/login.ts
import type { Command } from 'commander';
import { getUserInfo } from '../../api/auth.ts';
import { writeConfig } from '../../config/store.ts';
import type { UserInfo } from '../../lib/types.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { runDeviceFlow } from './device-flow.ts';

/**
 * 登录成功后拉取用户信息（邮箱 + 昵称）。
 * getUserInfo 失败不应让整个登录失败：令牌已落盘，吞掉异常返回 undefined 即可，
 * 用户后续可用 `supsub auth status` 再查看。
 */
async function fetchUserInfoSafely(): Promise<UserInfo | undefined> {
  try {
    return await withSpinner('获取用户信息…', () => getUserInfo());
  } catch {
    return undefined;
  }
}

/** 打印登录成功提示；拿到用户信息时附带展示「昵称 <邮箱>」。提示走 stderr，不污染 stdout。 */
function printLoginSuccess(info: UserInfo | undefined): void {
  process.stderr.write('✅ 登录成功\n');
  if (info) {
    process.stderr.write(`👤 ${info.name} <${info.email}>\n`);
  }
}

export function registerAuthLogin(parent: Command): void {
  parent
    .command('login')
    .description('登录 SupSub')
    .action(async () => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      // Device Flow（设备授权）是唯一登录入口：成功后存储 access_token / refresh_token
      const { access_token, refresh_token } = await runDeviceFlow();
      await writeConfig({ access_token, refresh_token, client_id: 'supsub-cli' });
      const info = await fetchUserInfoSafely();
      printLoginSuccess(info);
      if (fmt === 'json') {
        output({ client_id: 'supsub-cli', email: info?.email, name: info?.name }, 'json', () => {});
      }
    });
}
