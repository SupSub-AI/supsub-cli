// packages/cli/src/lib/web-url.ts
// Web 站点基地址解析。与 api-url.ts 分开维护：两者优先级来源不同
// （API 基址有 `--api-url` 全局 flag，Web 基址只认环境变量），
// 混在一起会让「改了 --api-url 却没改 web 域名」这类问题更难查。

import { getApiUrl } from './api-url.ts';

/**
 * 解析 Web 站点基地址（用于拼精读分享链接等给人点的 URL）。
 *
 * 优先级（从高到低）：
 * 1. `SUPSUB_WEB_URL` 环境变量
 * 2. 回落到 API 基地址（生产环境 web 与 API 同源，都是 https://supsub.net）
 *
 * 本地联调把 `--api-url` 指到 localhost 时，分享链接会跟着指向 localhost —— 这是
 * 有意的：本地 API 生成的 shareCode 在生产站上本来就查不到。若确实需要拆开，
 * 用 SUPSUB_WEB_URL 显式覆盖。
 *
 * 函数化（不缓存到模块顶层）是为了测试能动态切 env，对齐 getApiUrl() 的约定。
 */
export function getWebUrl(): string {
  const override = process.env.SUPSUB_WEB_URL;
  if (override && override.trim() !== '') {
    return override.trim().replace(/\/+$/, '');
  }
  return getApiUrl().replace(/\/+$/, '');
}

/**
 * 拼精读分享页链接。路径 `/s/<code>` 为 2026-07-27 实测确认
 * （/share/、/deep-read/ 等均 404，只有 /s/ 返回 200）。
 */
export function shareUrl(shareCode: string): string {
  return `${getWebUrl()}/s/${shareCode}`;
}
