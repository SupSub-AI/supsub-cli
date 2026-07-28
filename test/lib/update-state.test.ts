// lib/update-state：后台更新状态文件读写往返、缺失/损坏兜底、patch 合并语义。
// 配置目录由 test/setup.ts 隔离到 tmp（SUPSUB_CONFIG_DIR），不碰真实 ~/.supsub。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { readUpdateState, updateStatePath, writeUpdateState } from '../../src/lib/update-state.ts';

function clearState(): void {
  try {
    fs.rmSync(updateStatePath(), { force: true });
  } catch {
    /* ignore */
  }
}

beforeEach(clearState);
afterEach(clearState);

describe('readUpdateState', () => {
  test('无文件 → 空状态（lastCheck=null）', () => {
    expect(readUpdateState()).toEqual({ lastCheck: null, lastResult: null });
  });
  test('损坏 JSON → 空状态', () => {
    fs.writeFileSync(updateStatePath(), '{ not json', 'utf-8');
    expect(readUpdateState()).toEqual({ lastCheck: null, lastResult: null });
  });
});

describe('writeUpdateState（patch 合并）', () => {
  test('分两次写 lastCheck / lastResult 互不覆盖', () => {
    writeUpdateState({ lastCheck: '2026-07-28T00:00:00.000Z' });
    writeUpdateState({
      lastResult: {
        outcome: 'updated',
        at: '2026-07-28T01:00:00.000Z',
        from: '0.3.0',
        to: '0.4.0',
      },
    });
    const state = readUpdateState();
    expect(state.lastCheck).toBe('2026-07-28T00:00:00.000Z');
    expect(state.lastResult?.outcome).toBe('updated');
    expect(state.lastResult?.to).toBe('0.4.0');
  });

  test('文件权限 0600（非 Windows）', () => {
    if (process.platform === 'win32') return;
    writeUpdateState({ lastCheck: '2026-07-28T00:00:00.000Z' });
    const mode = fs.statSync(updateStatePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
