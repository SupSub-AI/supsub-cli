// packages/cli/src/cli/index.ts
import { Command } from 'commander';
// Read version from package.json
import pkg from '../../package.json' with { type: 'json' };
// Auth commands
import { registerAuthLogin } from '../commands/auth/login.ts';
import { registerAuthLogout } from '../commands/auth/logout.ts';
import { registerAuthStatus } from '../commands/auth/status.ts';
// Focus commands
import { registerFocusContents } from '../commands/focus/contents.ts';
import { registerFocusList } from '../commands/focus/list.ts';
import { registerFocusRemove } from '../commands/focus/remove.ts';
// MP commands
import { registerMpSearch } from '../commands/mp/search.ts';
import { registerMpSearchCancel } from '../commands/mp/search-cancel.ts';
// Search command
import { registerSearch } from '../commands/search.ts';
import { registerSubAdd } from '../commands/sub/add.ts';
import { registerSubContents } from '../commands/sub/contents.ts';
// Sub commands
import { registerSubList } from '../commands/sub/list.ts';
import { registerSubRemove } from '../commands/sub/remove.ts';
// Self-update command
import { registerUpdate } from '../commands/update.ts';
import { setCliApiKey } from '../http/credentials.ts';
import { setCliApiUrl } from '../lib/api-url.ts';
import { dieWith, type ErrorEnvelope, isErrorEnvelope } from '../lib/errors.ts';

function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (isErrorEnvelope(err)) return err;
  return {
    code: 'UNKNOWN_ERROR',
    message: err instanceof Error ? err.message : String(err),
    status: 0,
  };
}

export async function run(): Promise<void> {
  const program = new Command();

  program
    .name('supsub')
    .description('supsub 命令行工具')
    .version(pkg.version)
    // 全局选项
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .option('--api-key <key>', 'API Key（优先级高于环境变量和配置文件）')
    .option('--api-url <url>', 'API 基地址（优先级高于 SUPSUB_API_URL 环境变量）');

  // 把全局 --api-key / --api-url flag 注入解析器，让 request/api 层无需逐层透传
  program.hook('preAction', () => {
    const opts = program.opts() as { apiKey?: string; apiUrl?: string };
    setCliApiKey(opts.apiKey);
    setCliApiUrl(opts.apiUrl);
  });

  // ─── auth 子命令树 ────────────────────────────────────────
  const auth = program.command('auth').description('认证管理');
  registerAuthLogin(auth);
  registerAuthLogout(auth);
  registerAuthStatus(auth);

  // ─── sub 子命令树 ─────────────────────────────────────────
  const sub = program.command('sub').description('订阅源管理');
  registerSubList(sub);
  registerSubAdd(sub);
  registerSubRemove(sub);
  registerSubContents(sub);

  // ─── search 命令 ──────────────────────────────────────────
  registerSearch(program);

  // ─── mp 子命令树 ──────────────────────────────────────────
  const mp = program.command('mp').description('公众号相关操作');
  registerMpSearch(mp);
  registerMpSearchCancel(mp);

  // ─── focus 子命令树 ───────────────────────────────────────
  const focus = program.command('focus').description('关注点管理');
  registerFocusList(focus);
  registerFocusContents(focus);
  registerFocusRemove(focus);

  // ─── update 命令（自更新） ────────────────────────────────
  registerUpdate(program);

  // 顶层 try/catch：捕获所有命令抛出的错误并统一处理（exit code 由 errors.ts 推导）
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const fmt = program.opts().output as string | undefined;
    dieWith(toErrorEnvelope(err), fmt);
  }
}
