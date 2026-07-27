// commands/group/_args 纯函数：parseGroupId / normalizeGroupSubsType
import { describe, expect, test } from 'bun:test';
import { normalizeGroupSubsType, parseGroupId } from '../../../src/commands/group/_args.ts';

describe('commands/group/_args - parseGroupId', () => {
  test('纯数字原样通过（string 形态）', () => {
    expect(parseGroupId('1182')).toBe('1182');
  });

  test('uuid 形态原样通过（兼容后端未来切换）', () => {
    expect(parseGroupId('0260f97e-fdf5-4b4a-b885-5a7f54caa222')).toBe(
      '0260f97e-fdf5-4b4a-b885-5a7f54caa222',
    );
  });

  test('两端空白被 trim', () => {
    expect(parseGroupId('  7  ')).toBe('7');
  });

  test('空串 / 纯空白抛 INVALID_ARGS', () => {
    for (const bad of ['', '   ']) {
      let caught: unknown;
      try {
        parseGroupId(bad);
      } catch (e) {
        caught = e;
      }
      expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    }
  });
});

describe('commands/group/_args - normalizeGroupSubsType', () => {
  test('五值白名单大写通过', () => {
    for (const t of ['MP', 'WEBSITE', 'X', 'PODCAST', 'NEWSLETTER']) {
      expect(normalizeGroupSubsType(t)).toBe(t);
    }
  });

  test('小写自动 toUpperCase 后通过', () => {
    expect(normalizeGroupSubsType('podcast')).toBe('PODCAST');
    expect(normalizeGroupSubsType('newsletter')).toBe('NEWSLETTER');
    expect(normalizeGroupSubsType('mp')).toBe('MP');
  });

  test('非法值抛 INVALID_ARGS 且 message 含原始输入', () => {
    let caught: unknown;
    try {
      normalizeGroupSubsType('rss');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('INVALID_ARGS');
    expect((caught as { message: string }).message).toContain('rss');
  });
});
