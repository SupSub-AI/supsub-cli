// packages/cli/src/lib/skills-state.ts
// skills 同步状态文件：记录「上一次把仓库内 skills 同步到本地 agent 配置」时
// 对应的 CLI 版本，供「漂移检测」（skills-check.ts）与「增量同步」（skills-sync.ts）使用。
//
// 为什么需要它：skills（Agent Skills）随 CLI 一起发版，但用户本地的 skills
// 是单独装在 ~/.claude/skills（或项目 ./.agents/skills）里的。CLI 自更新只换了
// 二进制，本地 skills 不会自动跟着更新——于是出现「二进制已是 v0.4.0，但本地
// skills 还停留在 v0.3.2」的漂移。这个状态文件就是判断漂移的唯一依据。
//
// 用同步 fs（与 self-update.ts 一致）：启动时的漂移检测要在派发命令前快速读到，
// 且只是一次本地小文件读写，无需引入异步。

import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '../config/store.ts';

/** skills 安装范围：global → ~/.claude/skills；project → 当前项目 ./.agents/skills */
export type SkillsScope = 'global' | 'project';

export type SkillsState = {
  /** 上次同步成功时的 CLI 版本（与 package.json#version 同源） */
  version: string;
  /** 同步的 skill 名称列表 */
  skills: string[];
  /** 同步范围 */
  scope: SkillsScope;
  /** 同步时间（ISO 8601 UTC） */
  syncedAt: string;
};

const STATE_FILE = 'skills-state.json';

/** 状态文件路径：与 config.json 同目录（~/.supsub，可被 SUPSUB_CONFIG_DIR 覆盖） */
export function skillsStatePath(): string {
  return path.join(getConfigDir(), STATE_FILE);
}

/**
 * 读取状态文件。文件不存在或内容损坏都返回 null（视为「从未通过 supsub 同步过」），
 * 调用方据此决定是否提示——冷启动（无状态）不应打扰用户。
 */
export function readSkillsState(): SkillsState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(skillsStatePath(), 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SkillsState>;
    if (typeof parsed.version !== 'string' || parsed.version === '') return null;
    return {
      version: parsed.version,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      scope: parsed.scope === 'project' ? 'project' : 'global',
      syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * 写入状态文件。确保目录存在（0700）、文件权限 0600（与 config.json 一致）。
 * Windows 上静默跳过 chmod。
 */
export function writeSkillsState(state: SkillsState): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* 静默忽略 */
    }
  }
  const file = skillsStatePath();
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* 静默忽略 */
    }
  }
}

/** 取上次同步的版本号；无状态 / 损坏返回 null */
export function readSyncedVersion(): string | null {
  const state = readSkillsState();
  return state?.version ?? null;
}
