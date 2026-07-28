// packages/cli/src/lib/auto-update.ts
// 后台静默自动更新（对标 Claude Code）。核心原则：
//
// 1. 绝不阻塞当前命令。启动时只做**本地状态读** + 节流判断；真正的下载/切版交给一个
//    detached 子进程（`supsub __background-update`）异步完成，父进程立刻继续跑旧版。
//    为什么用 detached 子进程而不是「命令结束后 await」：CLI 是短生命周期进程，主命令
//    一结束进程就退出，挂在事件循环上的异步下载会被直接掐断、无法可靠完成。detached +
//    unref 的子进程独立于父进程生命周期，父进程退出后它仍能把下载/切版跑完。
// 2. 只换 symlink 指向、当前进程继续用旧版——**新版本下次启动才生效**，不影响本次运行。
// 3. 只在 **native 安装**下自动更新（真实路径在 versions/ 下）。npm 安装保持手动，
//    与 Claude Code 对 npm 的态度一致——npm 目录可能需要 sudo、原地覆盖不可回滚。
// 4. `-o json` / CI / `SUPSUB_DISABLE_AUTOUPDATER` 一律不自动更新——那正是 agent / 脚本
//    在跑，静默升级会带来不可预期的行为。复用 skills-check 的 isTruthyEnv / isCIEnv 语义。
//
// 独立 fetch（checkForUpdate / downloadBinary）不走 http/client.ts，理由同 self-update.ts
// 顶部注释：目标是 npm registry / GitHub，无需鉴权、不该触发 401→clearAuth。

import { spawn } from 'node:child_process';
import { type Config, readConfig } from '../config/store.ts';
import {
  detectInstallMethod,
  type InstallMethod,
  installNativeVersion,
  pruneVersions,
  switchToVersion,
} from './install-layout.ts';
import {
  CURRENT_VERSION,
  checkForUpdate,
  compareSemver,
  resolveRealBinary,
  semverParts,
} from './self-update.ts';
import { isCIEnv, isTruthyEnv } from './skills-check.ts';
import { readUpdateState, type UpdateState, writeUpdateState } from './update-state.ts';

/** 两次后台检查的最小间隔：4 小时。对标 Claude Code 的低频后台检查，避免每次启动都打网。 */
export const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 保留的历史版本数（含当前版本），更旧的在切版后清理。 */
export const KEEP_VERSIONS = 3;

/** detached 子进程的内部命令名——不进 commander，避免污染 help / version。 */
export const BACKGROUND_UPDATE_ARGV = '__background-update';

/** 自动更新通道 */
export type Channel = 'latest' | 'stable';

/** 是否被环境变量显式关闭后台自动更新（`supsub update` 手动更新仍可用） */
export function autoUpdateDisabled(): boolean {
  return isTruthyEnv(process.env.SUPSUB_DISABLE_AUTOUPDATER);
}

// ─── 调度门限（父进程侧，纯函数，便于单测） ──────────────────────────────

export type ScheduleGate = { ok: boolean; reason?: string };

/**
 * 判断「本次启动是否应调度一次后台检查」。全部为本地判断，零网络。
 * 任一条件不满足即不调度，并给出 reason（供 doctor / 测试）。
 */
export function shouldScheduleAutoUpdate(opts: {
  isJson: boolean;
  method: InstallMethod;
  now: number;
  state: UpdateState;
  intervalMs?: number;
}): ScheduleGate {
  if (autoUpdateDisabled()) return { ok: false, reason: 'disabled' };
  if (isCIEnv()) return { ok: false, reason: 'ci' };
  // json 模式基本等同 agent / 脚本调用，静默升级会带来不可预期行为——绝不自动更新。
  if (opts.isJson) return { ok: false, reason: 'json' };
  // 只有 native 安装才自动更新；npm / dev 保持手动。
  if (opts.method !== 'native') return { ok: false, reason: 'not-native' };
  // 节流：距上次检查未超过阈值就不再打网。
  const interval = opts.intervalMs ?? AUTO_UPDATE_INTERVAL_MS;
  if (opts.state.lastCheck) {
    const last = Date.parse(opts.state.lastCheck);
    if (Number.isFinite(last) && opts.now - last < interval) {
      return { ok: false, reason: 'throttled' };
    }
  }
  return { ok: true };
}

// ─── 版本级别与门限（通道 + minimumVersion） ────────────────────────────

/** 判断 latest 相对 current 是哪一级 bump（none 表示不更新 / 更旧） */
export function classifyBump(
  current: string,
  latest: string,
): 'none' | 'patch' | 'minor' | 'major' {
  if (compareSemver(latest, current) <= 0) return 'none';
  const [cmaj, cmin] = semverParts(current);
  const [lmaj, lmin] = semverParts(latest);
  if (lmaj !== cmaj) return 'major';
  if (lmin !== cmin) return 'minor';
  return 'patch';
}

export type Eligibility = { eligible: boolean; reason?: string };

/**
 * 目标版本是否符合自动更新门限。
 *
 * - `already-latest`：latest 不比 current 新，无需更新。
 * - `below-minimum`：latest 低于 minimumVersion——绝不自动降级到门限以下。
 * - stable 通道：**只自动升 patch**；minor/major 记为 `stable-needs-manual-*`，需手动 `supsub update`。
 *
 *   取舍说明：Claude Code 的 stable 语义是「延迟发布（灰度滚动）」，需要发布侧维护一条
 *   滚动通道，对小项目维护成本偏高。这里把 stable 实现成「只自动跟 patch」——语义直观
 *   （修 bug 自动跟上，破坏性 / 功能性变更由用户显式确认），实现最简，对小项目更实用。
 *   若未来需要真正的灰度延迟，可在此扩展一条 registry dist-tag（如 `stable`）来源。
 */
export function evaluateEligibility(opts: {
  current: string;
  latest: string;
  channel: Channel;
  minimumVersion?: string;
}): Eligibility {
  const { current, latest, channel, minimumVersion } = opts;
  const bump = classifyBump(current, latest);
  if (bump === 'none') return { eligible: false, reason: 'already-latest' };
  if (minimumVersion && compareSemver(latest, minimumVersion) < 0) {
    return { eligible: false, reason: 'below-minimum' };
  }
  if (channel === 'stable' && bump !== 'patch') {
    return { eligible: false, reason: `stable-needs-manual-${bump}` };
  }
  return { eligible: true };
}

/** 从配置读取通道（缺省 / 非法值一律回落 latest） */
export function channelFromConfig(cfg: Pick<Config, 'autoUpdateChannel'>): Channel {
  return cfg.autoUpdateChannel === 'stable' ? 'stable' : 'latest';
}

// ─── 父进程侧：调度一次后台检查 ──────────────────────────────────────────

/**
 * 在启动钩子里调用：判断是否该调度后台更新，若是则**抢占式写入 lastCheck**（避免并发
 * 启动的多个进程同时 spawn）后，spawn 一个 detached 子进程去异步完成检查/下载/切版。
 * 本函数只做本地状态读 + 一次 fs 写 + 一次 spawn，不含任何网络，绝不阻塞当前命令。
 */
export function maybeScheduleAutoUpdate(isJson: boolean, now: number = Date.now()): void {
  const method = detectInstallMethod();
  const state = readUpdateState();
  const gate = shouldScheduleAutoUpdate({ isJson, method, now, state });
  if (!gate.ok) return;

  // 抢占节流位：先把 lastCheck 记为现在，后续快速连续启动就不会重复 spawn。
  writeUpdateState({ lastCheck: new Date(now).toISOString() });

  try {
    const child = spawn(resolveRealBinary(), [BACKGROUND_UPDATE_ARGV], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
  } catch {
    // spawn 失败不影响当前命令；下次启动超过阈值会再试。
  }
}

// ─── 子进程侧：真正执行后台更新 ──────────────────────────────────────────

/** 后台更新的可注入依赖（默认接真实实现；测试用 fake 注入，不连网、不落真实文件） */
export type BackgroundDeps = {
  method?: InstallMethod;
  /** 返回最新版本号（默认查 npm registry） */
  fetchLatest?: () => Promise<string>;
  /** 下载并把某版本装进 versions/、切 symlink、清理旧版本（默认真实实现） */
  install?: (version: string) => Promise<void>;
  /** 读取通道 / minimumVersion 配置（默认 readConfig） */
  loadConfig?: () => Promise<Config>;
  now?: () => Date;
};

async function defaultInstall(version: string): Promise<void> {
  await installNativeVersion(version);
  switchToVersion(version);
  pruneVersions(KEEP_VERSIONS);
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/**
 * detached 子进程入口。整个过程静默（stdio 已被父进程忽略），任何异常都吞掉并落到
 * update-state 的 failed 结果，绝不向外抛——它是后台进程，崩溃不能影响任何东西。
 */
export async function runBackgroundUpdate(deps: BackgroundDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const nowIso = (): string => now().toISOString();
  try {
    // 双保险：子进程再确认一次未禁用 + native（防止被直接调用绕过父进程门限）
    if (autoUpdateDisabled() || isCIEnv()) return;
    const method = deps.method ?? detectInstallMethod();
    if (method !== 'native') return;

    // 记录本次检查时间（父进程通常已抢占写过，这里保证直接调用也一致）
    writeUpdateState({ lastCheck: nowIso() });

    const current = CURRENT_VERSION;
    let latest: string;
    try {
      latest = deps.fetchLatest ? await deps.fetchLatest() : (await checkForUpdate()).latest;
    } catch (err) {
      writeUpdateState({
        lastResult: { outcome: 'failed', at: nowIso(), reason: errMessage(err) },
      });
      return;
    }

    const cfg = deps.loadConfig ? await deps.loadConfig() : await readConfig();
    const elig = evaluateEligibility({
      current,
      latest,
      channel: channelFromConfig(cfg),
      minimumVersion: cfg.minimumVersion,
    });
    if (!elig.eligible) {
      writeUpdateState({
        lastResult: {
          outcome: elig.reason === 'already-latest' ? 'up-to-date' : 'gated',
          at: nowIso(),
          latest,
          reason: elig.reason,
        },
      });
      return;
    }

    // 下载新版本落到 versions/ 并原子切 symlink；当前（旧版）进程不受影响，新版下次启动生效。
    try {
      await (deps.install ?? defaultInstall)(latest);
      writeUpdateState({
        lastResult: { outcome: 'updated', at: nowIso(), from: current, to: latest, latest },
      });
    } catch (err) {
      writeUpdateState({
        lastResult: { outcome: 'failed', at: nowIso(), latest, reason: errMessage(err) },
      });
    }
  } catch (err) {
    // 兜底：后台进程绝不能把异常抛出去。
    writeUpdateState({ lastResult: { outcome: 'failed', at: nowIso(), reason: errMessage(err) } });
  }
}
