// packages/cli/src/lib/format-date.ts
// 发布时间格式化。后端 publishedAt 有两种形态：Unix 秒级时间戳（数字）或
// "YYYY-MM-DD HH:mm:ss" 字符串，取决于后端版本，这里统一兼容。
//
// 收编自 sub/contents.ts 与 focus/contents.ts 的两份重复实现（同 source-label.ts 的做法）。

/** 将 publishedAt 格式化为 "YYYY-MM-DD HH:mm" */
export function formatDate(val: unknown): string {
  if (typeof val === 'number') {
    // Unix 时间戳（秒）
    const d = new Date(val * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }
  if (typeof val === 'string') return val.slice(0, 16);
  return String(val);
}
