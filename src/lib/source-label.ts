// packages/cli/src/lib/source-label.ts
// sourceType → 中文标签，供表格渲染。分组成员可能含网页端加入的
// PODCAST / NEWSLETTER 类型，比订阅命令的 MP|WEBSITE|X 三值枚举宽。

export function sourceKindLabel(sourceType: string): string {
  const t = sourceType.toUpperCase();
  if (t === 'MP') return '公众号';
  if (t === 'WEBSITE') return '网站';
  if (t === 'X') return '推特';
  if (t === 'PODCAST') return '播客';
  if (t === 'NEWSLETTER') return '通讯';
  return sourceType;
}
