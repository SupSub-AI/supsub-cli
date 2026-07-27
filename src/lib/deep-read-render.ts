// packages/cli/src/lib/deep-read-render.ts
// 精读结果的两种呈现：落盘的 Markdown 文件 + 终端表格模式的卡片。
//
// 体积说明（2026-07-27 实测）：一份 v1 精读结果整体只有 4~6KB
// （杂谈 3 节 4.4KB / 技术长文 5 节 5.6KB），不是当初担心的「几十 KB 炸弹」，
// 所以默认就把正文一起给出；`--brief` 是给批量场景（一次十几篇）用的省略档。

import kleur from 'kleur';
import type { DeepReadEntry } from './deep-read-store.ts';
import { formatDate } from './format-date.ts';
import type { DeepReadContent } from './types.ts';

/** 精简形态：丢掉正文 sections，保留卡片四件套（本质 / 成色 / 要点 / 批注） */
export function briefContent(content: DeepReadContent | undefined): DeepReadContent | undefined {
  if (!content) return undefined;
  const { body: _body, ...rest } = content;
  return rest;
}

/**
 * 渲染成 Markdown 文件内容。
 *
 * sections 的 `{title, markdown}` 拼成 `## title` + 正文是**可逆**的，
 * 所以不必在 .json 之外再存一份结构化副本；.md 同时就是给用户的交付物
 * （`--out` 直接拷它，agent 也能用 Read/Grep 分段读，不用 CLI 再加切片参数）。
 */
export function renderMarkdown(entry: DeepReadEntry): string {
  const c = entry.content ?? {};
  const lines: string[] = [];

  lines.push(`# ${entry.title ?? entry.contentId}`);
  lines.push('');
  const meta: string[] = [];
  if (entry.sourceName) meta.push(entry.sourceName);
  meta.push(entry.sourceType);
  meta.push(`精读于 ${formatDate(Math.floor((entry.checkedAt || Date.now()) / 1000))}`);
  lines.push(`> ${meta.join(' · ')}`);
  if (entry.url) lines.push(`>`, `> 原文：${entry.url}`);
  lines.push('');

  if (c.essence) {
    lines.push('## 一句话本质', '', c.essence, '');
  }
  if (c.quality) {
    lines.push('## 干货成色', '', `**${c.quality.grade}** —— ${c.quality.comment}`, '');
  }
  if (c.keyPoints?.length) {
    lines.push('## 核心要点', '');
    for (const p of c.keyPoints) lines.push(`- ${p}`);
    lines.push('');
  }
  if (c.body?.sections?.length) {
    lines.push('## 正文', '');
    for (const s of c.body.sections) {
      lines.push(`### ${s.title}`, '', s.markdown, '');
    }
  }
  if (c.annotations) {
    const a = c.annotations;
    lines.push('## 编辑批注', '');
    if (a.background) lines.push(`- **背景**：${a.background}`);
    if (a.stance) lines.push(`- **立场与倾向**：${a.stance}`);
    if (a.credibility) {
      lines.push(`- **来源可信度**：${a.credibility.grade} —— ${a.credibility.reason}`);
    }
    if (a.weakestLink) lines.push(`- **最弱一环**：${a.weakestLink}`);
    lines.push('');
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/** 等级上色：高=绿 / 中=黄 / 低=红，其余原样 */
function gradeColor(grade: string): string {
  if (grade.includes('高')) return kleur.green(grade);
  if (grade.includes('中')) return kleur.yellow(grade);
  if (grade.includes('低')) return kleur.red(grade);
  return grade;
}

function writeWrapped(label: string, text: string, indent = '  '): void {
  process.stdout.write(`${indent}${kleur.dim(label)} ${text}\n`);
}

/** 终端卡片（table 模式）。brief=true 时不打正文 */
export function renderCard(entry: DeepReadEntry, opts: { brief?: boolean } = {}): void {
  const c = entry.content ?? {};
  const out = process.stdout;

  out.write(`${kleur.bold(entry.title ?? entry.contentId)}\n`);
  const meta = [entry.sourceName, entry.sourceType, entry.url].filter(Boolean).join(' · ');
  if (meta) out.write(`${kleur.dim(meta)}\n`);
  out.write('\n');

  if (c.essence) {
    out.write(`${kleur.bold('一句话本质')}\n  ${c.essence}\n\n`);
  }
  if (c.quality) {
    out.write(
      `${kleur.bold('干货成色')}  ${gradeColor(c.quality.grade)}\n  ${c.quality.comment}\n\n`,
    );
  }
  if (c.keyPoints?.length) {
    out.write(`${kleur.bold('核心要点')}\n`);
    c.keyPoints.forEach((p, i) => {
      out.write(`  ${i + 1}. ${p}\n`);
    });
    out.write('\n');
  }
  if (!opts.brief && c.body?.sections?.length) {
    out.write(`${kleur.bold('正文')}\n`);
    for (const s of c.body.sections) {
      out.write(`\n  ${kleur.underline(s.title)}\n`);
      for (const line of s.markdown.split('\n')) out.write(`  ${line}\n`);
    }
    out.write('\n');
  }
  if (c.annotations) {
    const a = c.annotations;
    out.write(`${kleur.bold('编辑批注')}\n`);
    if (a.background) writeWrapped('背景    ', a.background);
    if (a.stance) writeWrapped('立场    ', a.stance);
    if (a.credibility) {
      writeWrapped('可信度  ', `${gradeColor(a.credibility.grade)} —— ${a.credibility.reason}`);
    }
    if (a.weakestLink) writeWrapped('最弱一环', a.weakestLink);
    out.write('\n');
  }
}
