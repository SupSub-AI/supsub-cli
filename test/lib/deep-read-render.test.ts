// lib/deep-read-render：Markdown 落盘渲染与 --brief 裁剪
import { describe, expect, test } from 'bun:test';
import { briefContent, renderMarkdown } from '../../src/lib/deep-read-render.ts';
import type { DeepReadEntry } from '../../src/lib/deep-read-store.ts';
import type { DeepReadContent } from '../../src/lib/types.ts';

const CONTENT: DeepReadContent = {
  essence: '一句话本质',
  quality: { grade: '高', comment: '干货密度极高' },
  keyPoints: ['要点一', '要点二'],
  body: {
    sections: [
      { title: '第一节', markdown: '第一节正文' },
      { title: '第二节', markdown: '第二节正文' },
    ],
  },
  annotations: {
    background: '背景说明',
    stance: '立场说明',
    credibility: { grade: '中', reason: '信源部分可查' },
    weakestLink: '最弱一环说明',
  },
};

const ENTRY: DeepReadEntry = {
  sourceType: 'MP',
  contentId: 'cid',
  title: '测试标题',
  sourceName: '量子位',
  url: 'https://example.com/a',
  requestedAt: 1_700_000_000_000,
  status: 'done',
  checkedAt: 1_700_000_060_000,
  content: CONTENT,
};

describe('lib/deep-read-render', () => {
  test('渲染出完整的五段结构', () => {
    const md = renderMarkdown(ENTRY);
    expect(md).toContain('# 测试标题');
    expect(md).toContain('## 一句话本质');
    expect(md).toContain('## 干货成色');
    expect(md).toContain('## 核心要点');
    expect(md).toContain('## 正文');
    expect(md).toContain('## 编辑批注');
  });

  test('sections 按顺序渲染成 ### 小节，正文原样保留', () => {
    const md = renderMarkdown(ENTRY);
    expect(md.indexOf('### 第一节')).toBeLessThan(md.indexOf('### 第二节'));
    expect(md).toContain('第一节正文');
  });

  test('带上来源与原文链接，便于事后回溯', () => {
    const md = renderMarkdown(ENTRY);
    expect(md).toContain('量子位 · MP');
    expect(md).toContain('原文：https://example.com/a');
  });

  test('字段缺失时不渲染对应段落，也不抛错', () => {
    const md = renderMarkdown({ ...ENTRY, content: { essence: '只有本质' } });
    expect(md).toContain('## 一句话本质');
    expect(md).not.toContain('## 正文');
    expect(md).not.toContain('## 编辑批注');
  });

  test('没有标题时退化为 contentId，不产生空标题行', () => {
    const md = renderMarkdown({ ...ENTRY, title: undefined });
    expect(md.startsWith('# cid')).toBe(true);
  });

  test('briefContent 只丢正文，卡片四件套全留', () => {
    const brief = briefContent(CONTENT);
    expect(brief?.body).toBeUndefined();
    expect(brief?.essence).toBe('一句话本质');
    expect(brief?.quality?.grade).toBe('高');
    expect(brief?.keyPoints).toHaveLength(2);
    expect(brief?.annotations?.weakestLink).toBe('最弱一环说明');
  });

  test('briefContent(undefined) 返回 undefined', () => {
    expect(briefContent(undefined)).toBeUndefined();
  });
});
