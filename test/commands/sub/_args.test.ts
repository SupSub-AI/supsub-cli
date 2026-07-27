// commands/sub/_args 纯函数：normalizeType / parseSourceId / requireExclusive
import { describe, expect, test } from 'bun:test';
import {
  normalizeType,
  parsePage,
  parsePageSize,
  parseSourceId,
  requireExclusive,
  requireOneOf,
} from '../../../src/commands/sub/_args.ts';

describe('commands/sub/_args - normalizeType', () => {
  test('MP 大写直接通过', () => {
    expect(normalizeType('MP')).toBe('MP');
  });

  test('WEBSITE 大写直接通过', () => {
    expect(normalizeType('WEBSITE')).toBe('WEBSITE');
  });

  test('X 大写直接通过（推特）', () => {
    expect(normalizeType('X')).toBe('X');
  });

  test('小写自动 toUpperCase 后通过', () => {
    expect(normalizeType('mp')).toBe('MP');
    expect(normalizeType('website')).toBe('WEBSITE');
    expect(normalizeType('x')).toBe('X');
  });

  test('两端空白被 trim', () => {
    expect(normalizeType('  mp  ')).toBe('MP');
    expect(normalizeType('  x  ')).toBe('X');
  });

  test('非法值抛出 INVALID_ARGS', () => {
    let caught: unknown;
    try {
      normalizeType('blog');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('blog');
  });

  test('空串抛出 INVALID_ARGS', () => {
    expect(() => normalizeType('')).toThrow();
  });

  test('TWITTER 仍被拒绝（推特只接受 X，不接受 TWITTER）', () => {
    let caught: unknown;
    try {
      normalizeType('TWITTER');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
  });
});

describe('commands/sub/_args - parseSourceId', () => {
  test('正整数字符串解析为 number', () => {
    expect(parseSourceId('42')).toBe(42);
  });

  test('零抛出 INVALID_ARGS', () => {
    let caught: unknown;
    try {
      parseSourceId('0');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
  });

  test('负数抛出 INVALID_ARGS', () => {
    expect(() => parseSourceId('-3')).toThrow();
  });

  test('小数抛出 INVALID_ARGS（非整数）', () => {
    expect(() => parseSourceId('3.14')).toThrow();
  });

  test('非数字字符串抛出 INVALID_ARGS', () => {
    let caught: unknown;
    try {
      parseSourceId('abc');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('abc');
  });
});

describe('commands/sub/_args - requireExclusive', () => {
  test('两者都未设置时不抛', () => {
    expect(() => requireExclusive({}, ['all', 'unread'], '互斥')).not.toThrow();
  });

  test('仅其一时不抛', () => {
    expect(() => requireExclusive({ all: true }, ['all', 'unread'], '互斥')).not.toThrow();
    expect(() => requireExclusive({ unread: true }, ['all', 'unread'], '互斥')).not.toThrow();
  });

  test('两者都设置时抛 INVALID_ARGS 携带自定义 message', () => {
    let caught: unknown;
    try {
      requireExclusive({ all: true, unread: true }, ['all', 'unread'], '--all 与 --unread 互斥');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toBe('--all 与 --unread 互斥');
  });

  test('两者都为 falsy（空串/0/false）时不抛', () => {
    expect(() => requireExclusive({ all: false, unread: 0 }, ['all', 'unread'], 'x')).not.toThrow();
  });
});

describe('commands/sub/_args - requireOneOf', () => {
  test('两者都未设置时抛 INVALID_ARGS 携带自定义 message', () => {
    let caught: unknown;
    try {
      requireOneOf({}, ['contentId', 'all'], '必须指定其一');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toBe('必须指定其一');
  });

  test('仅其一时不抛', () => {
    expect(() => requireOneOf({ contentId: 'abc' }, ['contentId', 'all'], 'x')).not.toThrow();
    expect(() => requireOneOf({ all: true }, ['contentId', 'all'], 'x')).not.toThrow();
  });

  test('两者都设置时不抛（互斥由 requireExclusive 负责）', () => {
    expect(() =>
      requireOneOf({ contentId: 'abc', all: true }, ['contentId', 'all'], 'x'),
    ).not.toThrow();
  });
});

describe('commands/sub/_args - parsePage', () => {
  test('正整数通过', () => {
    expect(parsePage('1')).toBe(1);
    expect(parsePage('37')).toBe(37);
  });

  test('零 / 负数 / 小数 / 非数字抛 INVALID_ARGS', () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      let caught: unknown;
      try {
        parsePage(bad);
      } catch (e) {
        caught = e;
      }
      expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    }
  });
});

describe('commands/sub/_args - parsePageSize', () => {
  test('边界 1 与 100 通过', () => {
    expect(parsePageSize('1')).toBe(1);
    expect(parsePageSize('100')).toBe(100);
    expect(parsePageSize('20')).toBe(20);
  });

  test('0 / 101 / 小数 / 非数字抛 INVALID_ARGS', () => {
    for (const bad of ['0', '101', '2.5', 'abc']) {
      let caught: unknown;
      try {
        parsePageSize(bad);
      } catch (e) {
        caught = e;
      }
      expect((caught as { code: string }).code).toBe('INVALID_ARGS');
      expect((caught as { message: string }).message).toContain(bad);
    }
  });
});
