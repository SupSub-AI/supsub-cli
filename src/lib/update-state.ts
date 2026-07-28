// packages/cli/src/lib/update-state.ts
// 后台自动更新的状态文件 ~/.supsub/update-state.json：
// - lastCheck：上次「检查更新」的时间戳，用于「距上次检查超过阈值才真正发请求」的节流。
// - lastResult：上次后台更新的结果（成功切版 / 已最新 / 被门限拦下 / 失败原因），供
//   `supsub doctor` 展示与排查——静默自动更新必须有一个可查证的落点。
//
// 与 config.json / skills-state.json 同目录（~/.supsub，可被 SUPSUB_CONFIG_DIR 覆盖），
// 文件权限 0600。用同步 fs（与 skills-state.ts 一致）：启动节流判断要在派发命令前
// 快速读到，只是一次本地小文件读写，无需引入异步。

import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '../config/store.ts';

/** 后台更新一次的结果类型 */
export type UpdateOutcome =
  | 'updated' // 成功下载新版本并切换 symlink
  | 'up-to-date' // 已是最新，无需更新
  | 'gated' // 有新版本但被通道 / minimumVersion 门限拦下
  | 'failed'; // 检查或安装过程出错

export type UpdateResult = {
  outcome: UpdateOutcome;
  /** 记录时间（ISO 8601 UTC） */
  at: string;
  /** updated 时的原版本 */
  from?: string;
  /** updated 时的目标版本 */
  to?: string;
  /** 检查到的最新版本（up-to-date / gated / updated 时有值） */
  latest?: string;
  /** gated 的拦截原因 / failed 的错误信息 */
  reason?: string;
};

export type UpdateState = {
  /** 上次检查时间（ISO 8601 UTC）；null 表示从未检查过 */
  lastCheck: string | null;
  /** 上次后台更新结果；null 表示从未产生过结果 */
  lastResult: UpdateResult | null;
};

const STATE_FILE = 'update-state.json';

/** 状态文件路径：与 config.json 同目录（可被 SUPSUB_CONFIG_DIR 覆盖） */
export function updateStatePath(): string {
  return path.join(getConfigDir(), STATE_FILE);
}

const EMPTY_STATE: UpdateState = { lastCheck: null, lastResult: null };

/**
 * 读取状态文件。文件不存在 / 内容损坏都返回空状态（lastCheck=null），
 * 调用方据此把「从未检查」当作「应当检查」。
 */
export function readUpdateState(): UpdateState {
  let raw: string;
  try {
    raw = fs.readFileSync(updateStatePath(), 'utf-8');
  } catch {
    return { ...EMPTY_STATE };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    return {
      lastCheck: typeof parsed.lastCheck === 'string' ? parsed.lastCheck : null,
      lastResult:
        parsed.lastResult && typeof parsed.lastResult === 'object'
          ? (parsed.lastResult as UpdateResult)
          : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * 合并写入状态文件（patch 方式，不整体覆盖）。确保目录存在（0700）、文件权限 0600。
 * Windows 上静默跳过 chmod。写入失败静默忽略——后台更新的状态记录不该影响主命令。
 */
export function writeUpdateState(patch: Partial<UpdateState>): void {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* 静默忽略 */
      }
    }
    const existing = readUpdateState();
    const merged: UpdateState = { ...existing, ...patch };
    const file = updateStatePath();
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* 静默忽略 */
      }
    }
  } catch {
    /* 后台状态写失败不应影响任何主流程 */
  }
}
