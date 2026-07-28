// lib/auto-update：调度门限（native / json / CI / disabled / 节流）、版本级别与
// 通道·门限判定、以及 runBackgroundUpdate 的四种落点（updated / up-to-date / gated /
// failed）——后者用注入依赖，不连网、不下载真实二进制。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import {
  AUTO_UPDATE_INTERVAL_MS,
  channelFromConfig,
  classifyBump,
  evaluateEligibility,
  runBackgroundUpdate,
  shouldScheduleAutoUpdate,
} from '../../src/lib/auto-update.ts';
import { CURRENT_VERSION, compareSemver } from '../../src/lib/self-update.ts';
import { readUpdateState, updateStatePath } from '../../src/lib/update-state.ts';

/** 清掉会影响门限的 env + 状态文件，保证确定性 */
function resetEnvAndState(): void {
  delete process.env.CI;
  delete process.env.CONTINUOUS_INTEGRATION;
  delete process.env.SUPSUB_DISABLE_AUTOUPDATER;
  try {
    fs.rmSync(updateStatePath(), { force: true });
  } catch {
    /* ignore */
  }
}

const savedEnv = {
  CI: process.env.CI,
  CONTINUOUS_INTEGRATION: process.env.CONTINUOUS_INTEGRATION,
  SUPSUB_DISABLE_AUTOUPDATER: process.env.SUPSUB_DISABLE_AUTOUPDATER,
};

beforeEach(resetEnvAndState);
afterEach(() => {
  resetEnvAndState();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
});

const NOW = Date.parse('2026-07-28T12:00:00.000Z');
const EMPTY_STATE = { lastCheck: null, lastResult: null } as const;

describe('shouldScheduleAutoUpdate', () => {
  test('native + 非 json + 无 CI + 未禁用 + 从未检查 → ok', () => {
    const gate = shouldScheduleAutoUpdate({
      isJson: false,
      method: 'native',
      now: NOW,
      state: { ...EMPTY_STATE },
    });
    expect(gate.ok).toBe(true);
  });

  test('SUPSUB_DISABLE_AUTOUPDATER 真值 → disabled', () => {
    process.env.SUPSUB_DISABLE_AUTOUPDATER = '1';
    const gate = shouldScheduleAutoUpdate({
      isJson: false,
      method: 'native',
      now: NOW,
      state: { ...EMPTY_STATE },
    });
    expect(gate).toEqual({ ok: false, reason: 'disabled' });
  });

  test('CI 环境 → ci', () => {
    process.env.CI = 'true';
    const gate = shouldScheduleAutoUpdate({
      isJson: false,
      method: 'native',
      now: NOW,
      state: { ...EMPTY_STATE },
    });
    expect(gate).toEqual({ ok: false, reason: 'ci' });
  });

  test('json 模式 → json', () => {
    const gate = shouldScheduleAutoUpdate({
      isJson: true,
      method: 'native',
      now: NOW,
      state: { ...EMPTY_STATE },
    });
    expect(gate).toEqual({ ok: false, reason: 'json' });
  });

  test('非 native 安装（npm / dev / manual）→ not-native', () => {
    for (const method of ['npm', 'dev', 'manual'] as const) {
      const gate = shouldScheduleAutoUpdate({
        isJson: false,
        method,
        now: NOW,
        state: { ...EMPTY_STATE },
      });
      expect(gate).toEqual({ ok: false, reason: 'not-native' });
    }
  });

  test('距上次检查未超过阈值 → throttled', () => {
    const recent = new Date(NOW - AUTO_UPDATE_INTERVAL_MS + 60_000).toISOString();
    const gate = shouldScheduleAutoUpdate({
      isJson: false,
      method: 'native',
      now: NOW,
      state: { lastCheck: recent, lastResult: null },
    });
    expect(gate).toEqual({ ok: false, reason: 'throttled' });
  });

  test('距上次检查已超过阈值 → ok', () => {
    const old = new Date(NOW - AUTO_UPDATE_INTERVAL_MS - 60_000).toISOString();
    const gate = shouldScheduleAutoUpdate({
      isJson: false,
      method: 'native',
      now: NOW,
      state: { lastCheck: old, lastResult: null },
    });
    expect(gate.ok).toBe(true);
  });
});

describe('classifyBump', () => {
  test('none / patch / minor / major', () => {
    expect(classifyBump('0.4.0', '0.4.0')).toBe('none');
    expect(classifyBump('0.4.0', '0.3.9')).toBe('none');
    expect(classifyBump('0.4.0', '0.4.1')).toBe('patch');
    expect(classifyBump('0.4.0', '0.5.0')).toBe('minor');
    expect(classifyBump('0.4.0', '1.0.0')).toBe('major');
  });
});

describe('evaluateEligibility（通道 + minimumVersion）', () => {
  test('latest 不比 current 新 → already-latest', () => {
    expect(evaluateEligibility({ current: '0.4.0', latest: '0.4.0', channel: 'latest' })).toEqual({
      eligible: false,
      reason: 'already-latest',
    });
  });

  test('latest 低于 minimumVersion → below-minimum（绝不降级到门限以下）', () => {
    expect(
      evaluateEligibility({
        current: '0.3.0',
        latest: '0.3.5',
        channel: 'latest',
        minimumVersion: '0.4.0',
      }),
    ).toEqual({ eligible: false, reason: 'below-minimum' });
  });

  test('latest 通道：patch/minor/major 都放行', () => {
    expect(
      evaluateEligibility({ current: '0.4.0', latest: '0.4.1', channel: 'latest' }).eligible,
    ).toBe(true);
    expect(
      evaluateEligibility({ current: '0.4.0', latest: '0.5.0', channel: 'latest' }).eligible,
    ).toBe(true);
    expect(
      evaluateEligibility({ current: '0.4.0', latest: '1.0.0', channel: 'latest' }).eligible,
    ).toBe(true);
  });

  test('stable 通道：只放行 patch，minor/major 需手动', () => {
    expect(
      evaluateEligibility({ current: '0.4.0', latest: '0.4.3', channel: 'stable' }).eligible,
    ).toBe(true);
    expect(evaluateEligibility({ current: '0.4.0', latest: '0.5.0', channel: 'stable' })).toEqual({
      eligible: false,
      reason: 'stable-needs-manual-minor',
    });
    expect(evaluateEligibility({ current: '0.4.0', latest: '1.0.0', channel: 'stable' })).toEqual({
      eligible: false,
      reason: 'stable-needs-manual-major',
    });
  });
});

describe('channelFromConfig', () => {
  test('stable → stable，其余（含缺省 / 非法）→ latest', () => {
    expect(channelFromConfig({ autoUpdateChannel: 'stable' })).toBe('stable');
    expect(channelFromConfig({ autoUpdateChannel: 'latest' })).toBe('latest');
    expect(channelFromConfig({})).toBe('latest');
  });
});

describe('runBackgroundUpdate（注入依赖，不连网）', () => {
  const NOW_ISO = '2026-07-28T12:00:00.000Z';
  const clock = () => new Date(NOW_ISO);

  /** 比 CURRENT_VERSION 高一个 patch 的版本，保证一定「有新版」 */
  function bumpPatch(v: string): string {
    const [maj, min, pat] = v
      .replace(/^v/, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
    return `${maj}.${min}.${(pat ?? 0) + 1}`;
  }

  test('有新版且符合门限 → 安装、切版、写 updated', async () => {
    const latest = bumpPatch(CURRENT_VERSION);
    let installedWith: string | null = null;
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => latest,
      loadConfig: async () => ({}),
      install: async (v) => {
        installedWith = v;
      },
      now: clock,
    });
    expect(installedWith).toBe(latest);
    const state = readUpdateState();
    expect(state.lastResult?.outcome).toBe('updated');
    expect(state.lastResult?.to).toBe(latest);
    expect(state.lastCheck).toBe(NOW_ISO);
  });

  test('已是最新 → up-to-date，不调用 install', async () => {
    let installCalled = false;
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => CURRENT_VERSION,
      loadConfig: async () => ({}),
      install: async () => {
        installCalled = true;
      },
      now: clock,
    });
    expect(installCalled).toBe(false);
    expect(readUpdateState().lastResult?.outcome).toBe('up-to-date');
  });

  test('stable 通道 + minor 新版 → gated，不安装', async () => {
    // 构造一个比当前高一个 minor 的版本
    const [maj, min] = CURRENT_VERSION.split('.').map((n) => Number.parseInt(n, 10) || 0);
    const minorBump = `${maj}.${(min ?? 0) + 1}.0`;
    let installCalled = false;
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => minorBump,
      loadConfig: async () => ({ autoUpdateChannel: 'stable' }),
      install: async () => {
        installCalled = true;
      },
      now: clock,
    });
    expect(installCalled).toBe(false);
    const state = readUpdateState();
    expect(state.lastResult?.outcome).toBe('gated');
    expect(state.lastResult?.reason).toBe('stable-needs-manual-minor');
  });

  test('检查更新失败 → failed，记录错误原因', async () => {
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => {
        throw new Error('网络炸了');
      },
      now: clock,
    });
    const state = readUpdateState();
    expect(state.lastResult?.outcome).toBe('failed');
    expect(state.lastResult?.reason).toContain('网络炸了');
  });

  test('非 native → 直接返回，不写任何状态', async () => {
    await runBackgroundUpdate({
      method: 'npm',
      fetchLatest: async () => '99.0.0',
      now: clock,
    });
    expect(readUpdateState()).toEqual({ lastCheck: null, lastResult: null });
  });

  test('SUPSUB_DISABLE_AUTOUPDATER 真值 → 直接返回，不写状态', async () => {
    process.env.SUPSUB_DISABLE_AUTOUPDATER = '1';
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => '99.0.0',
      now: clock,
    });
    expect(readUpdateState()).toEqual({ lastCheck: null, lastResult: null });
  });

  test('install 抛错 → failed', async () => {
    const latest = bumpPatch(CURRENT_VERSION);
    await runBackgroundUpdate({
      method: 'native',
      fetchLatest: async () => latest,
      loadConfig: async () => ({}),
      install: async () => {
        throw new Error('切 symlink 失败');
      },
      now: clock,
    });
    const state = readUpdateState();
    expect(state.lastResult?.outcome).toBe('failed');
    expect(state.lastResult?.reason).toContain('切 symlink 失败');
  });
});

describe('sanity：CURRENT_VERSION 可比较', () => {
  test('bumpPatch 结果确实比当前新', () => {
    const [maj, min, pat] = CURRENT_VERSION.split('.').map((n) => Number.parseInt(n, 10) || 0);
    const next = `${maj}.${min}.${(pat ?? 0) + 1}`;
    expect(compareSemver(next, CURRENT_VERSION)).toBeGreaterThan(0);
  });
});
