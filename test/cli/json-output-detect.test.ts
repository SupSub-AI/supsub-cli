// cli/index：isJsonOutput —— 决定 skills 漂移提示是否静默
// 背景：提示写的是 stderr，但 agent 侧 Bash 工具会合并 stdout/stderr，
// 实测出现过 agent 把「skills 版本不一致」当成结论转述给用户，故 json 模式下完全不打印。
import { describe, expect, test } from 'bun:test';
import { isJsonOutput } from '../../src/cli/index.ts';

describe('cli/isJsonOutput', () => {
  test('-o json / --output json 分离写法命中', () => {
    expect(isJsonOutput(['sub', 'list', '-o', 'json'])).toBe(true);
    expect(isJsonOutput(['sub', 'list', '--output', 'json'])).toBe(true);
  });

  test('--output=json / -o=json 等号写法命中', () => {
    expect(isJsonOutput(['--output=json', 'unread'])).toBe(true);
    expect(isJsonOutput(['-o=json', 'unread'])).toBe(true);
  });

  test('全局 flag 在子命令之前也命中', () => {
    expect(isJsonOutput(['-o', 'json', 'group', 'subs', '--id', '9'])).toBe(true);
  });

  test('table 模式 / 未指定 → 不命中（人类用户仍应看到提示）', () => {
    expect(isJsonOutput(['sub', 'list'])).toBe(false);
    expect(isJsonOutput(['sub', 'list', '-o', 'table'])).toBe(false);
  });

  test('json 只是某个参数的值时不误判', () => {
    expect(isJsonOutput(['search', 'json'])).toBe(false);
    expect(isJsonOutput(['search', '--type', 'json'])).toBe(false);
  });
});
