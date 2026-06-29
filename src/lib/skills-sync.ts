// packages/cli/src/lib/skills-sync.ts
// skills 同步：把本仓库内的 Agent Skills 安装/更新到用户本地的 agent 配置目录，
// 解决「CLI（或 skills）发版后，用户本地 skills 没跟着更新」的问题。
//
// 实现方式：复用社区的 `skills` CLI（https://github.com/vercel-labs/skills），
// 直接从本仓库的 GitHub 源拉取 skills——与 README 既有文档、以及 larksuite/cli
// 的 `npx skills add <owner/repo>` 同一套机制。同步成功后写状态文件
// （skills-state.ts），记录到达的 CLI 版本，供后续漂移检测使用。
//
// 为什么不走 http/client.ts：这里是 `npx` 子进程，不是 supsub API 请求，无需鉴权，
// 也不应触发 401 → clearAuth。与 self-update.ts 走独立 fetch 同理。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ErrorEnvelope } from './errors.ts';
import { CURRENT_VERSION, getRepoSlug } from './self-update.ts';
import { type SkillsScope, type SkillsState, writeSkillsState } from './skills-state.ts';

const execFileAsync = promisify(execFile);

/**
 * 本仓库提供的官方 skill 名称。仅用于 `skills status` / `skills list` 的展示；
 * 实际同步用 `skills add <repo> -g -y`（安装仓库内全部 skill），不依赖此列表。
 * 新增/删除 skill 时需同步维护此处与 skills/ 目录。
 */
export const OFFICIAL_SKILLS = [
  'supsub-auth',
  'supsub-sub',
  'supsub-search',
  'supsub-mp',
  'supsub-focus',
] as const;

/** 各 skill 的一句话说明（供 `skills list` 展示） */
export const SKILL_DESCRIPTIONS: Record<string, string> = {
  'supsub-auth': '登录 / 登出 / 查看登录状态',
  'supsub-sub': '订阅源管理（list / add / remove / contents）',
  'supsub-search': '全站关键词搜索文章 / 内容',
  'supsub-mp': '公众号发现（mp search）→ 拿 mpId 订阅',
  'supsub-focus': '关注点管理（list / contents / remove）',
};

/**
 * 同步 runner：执行 `npx <args>` 并返回输出。抽成可注入接口，便于测试用 fake runner
 * 替换，不真的起子进程 / 连网（参考 http/credentials.ts 的 setCliApiKey 注入思路）。
 */
export type SyncRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: SyncRunner = async (args) => {
  const { stdout, stderr } = await execFileAsync('npx', args, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout, stderr };
};

let activeRunner: SyncRunner = defaultRunner;

/** 覆盖同步 runner（仅测试用）。传 undefined 恢复默认。 */
export function setSkillsSyncRunner(runner: SyncRunner | undefined): void {
  activeRunner = runner ?? defaultRunner;
}

export type SyncOptions = {
  /** 安装范围，默认 project（./.agents/skills，仅当前项目；全局安装侵入性强，需显式 --global 选择） */
  scope?: SkillsScope;
  /** 同步到的目标版本，默认当前 CLI 版本 */
  version?: string;
};

export type SyncResult = {
  /** 同步到达的版本 */
  version: string;
  /** 同步的 skill 名称 */
  skills: string[];
  /** 安装范围 */
  scope: SkillsScope;
  /** `npx skills` 的合并输出（截断），便于排查 */
  detail?: string;
};

/** 拼出 `npx skills add` 的参数（与 larksuite/cli runSkillsAdd 一致：`-g -y` 安装全部） */
export function buildSkillsAddArgs(scope: SkillsScope): string[] {
  const args = ['-y', 'skills', 'add', getRepoSlug()];
  if (scope === 'global') args.push('-g');
  args.push('-y');
  return args;
}

/** 把同步失败映射成友好的 ErrorEnvelope（npx 缺失是最常见的失败） */
function mapSyncError(err: unknown): ErrorEnvelope {
  const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
  if (e?.code === 'ENOENT') {
    return {
      code: 'SKILLS_TOOL_NOT_FOUND',
      message:
        '未找到 npx（需要 Node.js）。请安装 Node.js 后重试，或手动安装 skills：npx -y skills add ' +
        `${getRepoSlug()} -g -y`,
      status: 0,
    };
  }
  const detail = [e?.stdout, e?.stderr, e?.message].filter(Boolean).join('\n').slice(0, 2000);
  return {
    code: 'SKILLS_SYNC_FAILED',
    message: `同步 skills 失败：${e?.message ?? String(err)}`,
    status: 0,
    data: detail || undefined,
  };
}

/**
 * 执行同步：`npx skills add <owner/repo> [-g] -y`，成功后写状态文件。
 * 失败抛 ErrorEnvelope（调用方走统一 dieWith / 输出层处理）。
 */
export async function syncSkills(
  opts: SyncOptions = {},
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  const scope: SkillsScope = opts.scope ?? 'project';
  const version = opts.version ?? CURRENT_VERSION;

  let out: { stdout: string; stderr: string };
  try {
    out = await activeRunner(buildSkillsAddArgs(scope));
  } catch (err) {
    throw mapSyncError(err);
  }

  const state: SkillsState = {
    version,
    skills: [...OFFICIAL_SKILLS],
    scope,
    syncedAt: now().toISOString(),
  };
  writeSkillsState(state);

  const detail = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
  return {
    version,
    skills: state.skills,
    scope,
    detail: detail ? detail.slice(0, 2000) : undefined,
  };
}
