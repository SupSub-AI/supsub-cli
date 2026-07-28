// packages/cli/src/cli/index.ts
import { Command } from 'commander';
// Read version from package.json
import pkg from '../../package.json' with { type: 'json' };
// Auth commands
import { registerAuthLogin } from '../commands/auth/login.ts';
import { registerAuthLogout } from '../commands/auth/logout.ts';
import { registerAuthStatus } from '../commands/auth/status.ts';
// Deep read commands
import { registerDeepReadDrop } from '../commands/deepread/drop.ts';
import { registerDeepReadGet } from '../commands/deepread/get.ts';
import { registerDeepReadList } from '../commands/deepread/list.ts';
import { registerDeepReadQuota } from '../commands/deepread/quota.ts';
import { registerDeepReadRun } from '../commands/deepread/run.ts';
import { registerDeepReadShare } from '../commands/deepread/share.ts';
import { registerDeepReadShow } from '../commands/deepread/show.ts';
// Doctor command（安装 / 更新自检）
import { registerDoctor } from '../commands/doctor.ts';
// Focus commands
import { registerFocusContents } from '../commands/focus/contents.ts';
import { registerFocusList } from '../commands/focus/list.ts';
import { registerFocusMarkRead } from '../commands/focus/mark-read.ts';
import { registerFocusRemove } from '../commands/focus/remove.ts';
// Group commands（订阅分组）
import { registerGroupAdd } from '../commands/group/add.ts';
import { registerGroupAddSub } from '../commands/group/add-sub.ts';
import { registerGroupList } from '../commands/group/list.ts';
import { registerGroupRemove } from '../commands/group/remove.ts';
import { registerGroupRemoveSub } from '../commands/group/remove-sub.ts';
import { registerGroupRename } from '../commands/group/rename.ts';
import { registerGroupSubs } from '../commands/group/subs.ts';
// MP commands
import { registerMpSearch } from '../commands/mp/search.ts';
import { registerMpSearchCancel } from '../commands/mp/search-cancel.ts';
// Search command
import { registerSearch } from '../commands/search.ts';
// Skills sync commands
import { registerSkills } from '../commands/skills.ts';
import { registerSubAdd } from '../commands/sub/add.ts';
import { registerSubContents } from '../commands/sub/contents.ts';
// Sub commands
import { registerSubList } from '../commands/sub/list.ts';
import { registerSubMarkRead } from '../commands/sub/mark-read.ts';
import { registerSubRemove } from '../commands/sub/remove.ts';
// Unread overview command（未读概览）
import { registerUnread } from '../commands/unread.ts';
// Self-update command
import { registerUpdate } from '../commands/update.ts';
import { setCliApiUrl } from '../lib/api-url.ts';
import {
  BACKGROUND_UPDATE_ARGV,
  maybeScheduleAutoUpdate,
  runBackgroundUpdate,
} from '../lib/auto-update.ts';
import { dieWith, type ErrorEnvelope, isErrorEnvelope } from '../lib/errors.ts';
import { checkSkillsDrift, formatDriftNotice } from '../lib/skills-check.ts';

function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (isErrorEnvelope(err)) return err;
  return {
    code: 'UNKNOWN_ERROR',
    message: err instanceof Error ? err.message : String(err),
    status: 0,
  };
}

/**
 * 本地 skills 落后于当前 CLI 版本时，在 stderr 打印一行同步提示。
 * help / version / 以及正在处理同步的 skills、update 命令不提示，避免重复打扰。
 *
 * ⚠️ `-o json` 时**完全不打印**：写 stderr 原本是为了不污染 stdout，但 agent 侧的
 * Bash 工具会把 stdout / stderr 合并呈现，这行提示于是混进 JSON 结果里，实测出现过
 * agent 把「skills 版本不一致」当成任务结论转述给终端用户。json 模式基本等同 agent 调用，
 * 直接静默；人类用的 table 模式仍然提示。
 */
function maybeWarnSkillsDrift(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return;
  const suppress = new Set(['skills', 'update', 'help', '--help', '-h', '--version', '-V']);
  if (argv.some((a) => suppress.has(a))) return;
  if (isJsonOutput(argv)) return;
  const drift = checkSkillsDrift();
  if (drift) {
    process.stderr.write(`${formatDriftNotice(drift)}\n`);
  }
}

/** 从原始 argv 判断是否 `-o json` / `--output json`（含 `--output=json` 写法）。导出仅为便于单测。 */
export function isJsonOutput(argv: string[]): boolean {
  return argv.some(
    (a, i) =>
      a === '--output=json' ||
      a === '-o=json' ||
      ((a === '-o' || a === '--output') && argv[i + 1] === 'json'),
  );
}

/**
 * 是否应为本次启动调度一次后台自动更新检查：
 * - `update` 命令自身在处理更新，避免与它并发切 symlink，跳过；
 * - 无子命令（纯 `supsub` / 只带全局 flag）不调度，减少无意义打网。
 */
function shouldConsiderAutoUpdate(argv: string[]): boolean {
  const first = argv.find((a) => !a.startsWith('-'));
  if (!first) return false;
  if (first === 'update' || first === 'upgrade' || first === BACKGROUND_UPDATE_ARGV) return false;
  return true;
}

export async function run(): Promise<void> {
  // 内部命令：detached 后台自更新子进程入口。由 maybeScheduleAutoUpdate spawn 拉起，
  // 不进 commander（避免污染 help / version）。跑完即退，绝不影响任何用户命令。
  if (process.argv[2] === BACKGROUND_UPDATE_ARGV) {
    await runBackgroundUpdate();
    return;
  }

  const program = new Command();

  program
    .name('supsub')
    .description('supsub 命令行工具')
    .version(pkg.version)
    // 全局选项
    .option('-o, --output <fmt>', '输出格式：table|json', 'table')
    .option('--api-url <url>', 'API 基地址（优先级高于 SUPSUB_API_URL 环境变量）');

  // 把全局 --api-url flag 注入解析器，让 request/api 层无需逐层透传
  program.hook('preAction', () => {
    const opts = program.opts() as { apiUrl?: string };
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
  registerSubMarkRead(sub);

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
  registerFocusMarkRead(focus);
  registerFocusRemove(focus);

  // ─── group 子命令树（订阅分组） ───────────────────────────
  const group = program.command('group').description('订阅分组管理');
  registerGroupList(group);
  registerGroupAdd(group);
  registerGroupRename(group);
  registerGroupRemove(group);
  registerGroupSubs(group);
  registerGroupAddSub(group);
  registerGroupRemoveSub(group);

  // ─── unread 命令（未读概览） ──────────────────────────────
  registerUnread(program);

  // ─── deepread 子命令树（精读） ────────────────────────────
  const deepread = program.command('deepread').description('精读（AI 深度拆解单篇文章）');
  registerDeepReadRun(deepread);
  registerDeepReadGet(deepread);
  registerDeepReadList(deepread);
  registerDeepReadQuota(deepread);
  registerDeepReadShare(deepread);
  registerDeepReadDrop(deepread);
  registerDeepReadShow(deepread);

  // ─── skills 子命令树（同步本地 Agent Skills） ────────────
  registerSkills(program);

  // ─── update 命令（自更新） ────────────────────────────────
  registerUpdate(program);

  // ─── doctor 命令（安装 / 更新自检） ───────────────────────
  registerDoctor(program);

  // skills 漂移提示：本地 skills 落后于当前 CLI 版本时，在 stderr 提示同步。
  // 仅一次本地状态文件读，零网络、零子进程；skills / update 命令本身在处理同步，不重复打扰。
  maybeWarnSkillsDrift();

  // 后台自动更新：仅 native 安装、非 json / CI / 未禁用、且距上次检查超阈值时，
  // spawn 一个 detached 子进程去异步下载 + 切 symlink。本次只做本地状态读 + 一次 spawn，
  // 绝不阻塞当前命令；新版本下次启动才生效。
  const argv = process.argv.slice(2);
  if (shouldConsiderAutoUpdate(argv)) {
    maybeScheduleAutoUpdate(isJsonOutput(argv));
  }

  // 顶层 try/catch：捕获所有命令抛出的错误并统一处理（exit code 由 errors.ts 推导）
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const fmt = program.opts().output as string | undefined;
    dieWith(toErrorEnvelope(err), fmt);
  }
}
