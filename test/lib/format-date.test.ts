// lib/format-date：兼容 Unix 秒级时间戳与字符串两种 publishedAt 形态
import { describe, expect, test } from 'bun:test';
import { formatDate } from '../../src/lib/format-date.ts';

describe('lib/format-date', () => {
  test('数字按 Unix 秒解析为 "YYYY-MM-DD HH:mm"', () => {
    expect(formatDate(1784790480)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('月/日/时/分补零', () => {
    // 2026-01-02 03:04 本地时间
    const ts = Math.floor(new Date(2026, 0, 2, 3, 4).getTime() / 1000);
    expect(formatDate(ts)).toBe('2026-01-02 03:04');
  });

  test('字符串形态截到分钟（后端另一种返回形态）', () => {
    expect(formatDate('2025-06-18 11:49:46')).toBe('2025-06-18 11:49');
  });

  test('其他类型兜底转字符串，不抛异常', () => {
    expect(formatDate(null)).toBe('null');
    expect(formatDate(undefined)).toBe('undefined');
  });
});
