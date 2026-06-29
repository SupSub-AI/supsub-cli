// packages/cli/src/lib/skills-check.ts
// skills 漂移检测：对比「本地已同步的 skills 版本」与「当前运行的 CLI 版本」，
// 不一致就生成一条提示，告诉用户运行 `supsub skills sync` 把本地 skills 同步上来。
//
// 这是「解决 skills 更新后本地未同步」的核心感知层：CLI 自更新只换二进制，
// 本地 skills 不会自动跟着升级。每次跑命令前做一次零网络、零子进程的本地状态读，
// 一旦发现漂移就提示——参考 larksuite/cli 的 internal/skillscheck。

import { CURRENT_VERSION } from './self-update.ts';
import { readSyncedVersion } from './skills-state.ts';

export type SkillsDrift = {
  /** 本地已同步的 skills 版本 */
  current: string;
  /** 当前运行的 CLI 版本（期望本地 skills 也到达此版本） */
  target: string;
};

/** 与 spinner.ts 同语义：空串 / '0' / 'false' 视为假，其余非空视为真 */
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/** 归一化版本号：去掉前导 v/V，便于「v0.3.2」与「0.3.2」相等比较 */
function normalize(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/** 是否处于 CI 环境（CI 里不该弹同步提示，避免污染日志 / 阻断流水线） */
function isCIEnv(): boolean {
  return isTruthyEnv(process.env.CI) || isTruthyEnv(process.env.CONTINUOUS_INTEGRATION);
}

/**
 * 是否应跳过漂移检测：
 * - 显式 opt-out（SUPSUB_NO_SKILLS_NOTIFIER）
 * - CI 环境
 * - 开发版 / 空版本号（源码直跑时 version 仍是 package.json，一般没问题；
 *   但 0.0.0 / dev 这类占位版本无意义，跳过）
 */
export function shouldSkipSkillsCheck(version: string = CURRENT_VERSION): boolean {
  if (isTruthyEnv(process.env.SUPSUB_NO_SKILLS_NOTIFIER)) return true;
  if (isCIEnv()) return true;
  const v = normalize(version);
  if (v === '' || v === '0.0.0' || v.toLowerCase() === 'dev') return true;
  return false;
}

/**
 * 检测漂移。返回 null 表示无需提示：
 * - 命中跳过规则；或
 * - 从未通过 supsub 同步过 skills（无状态文件）——冷启动不打扰；或
 * - 已同步版本与当前 CLI 版本一致。
 * 仅当「同步过、但版本落后于当前二进制」时返回漂移信息。
 */
export function checkSkillsDrift(version: string = CURRENT_VERSION): SkillsDrift | null {
  if (shouldSkipSkillsCheck(version)) return null;
  const synced = readSyncedVersion();
  if (!synced) return null;
  if (normalize(synced) === normalize(version)) return null;
  return { current: synced, target: version };
}

/** 把漂移信息格式化成一行可读、可被 agent 解析的提示（写 stderr，不污染 stdout） */
export function formatDriftNotice(drift: SkillsDrift): string {
  return `⚠ 本地 supsub skills 版本 ${drift.current} 与当前 CLI ${drift.target} 不一致，运行 \`supsub skills sync\` 同步`;
}
