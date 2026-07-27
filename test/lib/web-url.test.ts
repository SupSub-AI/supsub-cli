// lib/web-url：Web 基址优先级（SUPSUB_WEB_URL > API 基址）与分享链接拼装
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setCliApiUrl } from '../../src/lib/api-url.ts';
import { getWebUrl, shareUrl } from '../../src/lib/web-url.ts';

describe('lib/web-url', () => {
  let originalWeb: string | undefined;
  let originalApi: string | undefined;

  beforeEach(() => {
    originalWeb = process.env.SUPSUB_WEB_URL;
    originalApi = process.env.SUPSUB_API_URL;
    delete process.env.SUPSUB_WEB_URL;
    delete process.env.SUPSUB_API_URL;
    setCliApiUrl(undefined);
  });

  afterEach(() => {
    if (originalWeb === undefined) delete process.env.SUPSUB_WEB_URL;
    else process.env.SUPSUB_WEB_URL = originalWeb;
    if (originalApi === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApi;
    setCliApiUrl(undefined);
  });

  test('默认回落到 API 基址', () => {
    expect(getWebUrl()).toBe('https://supsub.net');
  });

  test('SUPSUB_WEB_URL 优先于 API 基址', () => {
    process.env.SUPSUB_API_URL = 'http://localhost:3000';
    process.env.SUPSUB_WEB_URL = 'https://web.example.com';
    expect(getWebUrl()).toBe('https://web.example.com');
  });

  test('未设 SUPSUB_WEB_URL 时跟随 --api-url（本地联调链接指向本地）', () => {
    setCliApiUrl('http://localhost:3000');
    expect(getWebUrl()).toBe('http://localhost:3000');
  });

  test('去掉尾部斜杠，避免拼出双斜杠', () => {
    process.env.SUPSUB_WEB_URL = 'https://web.example.com///';
    expect(shareUrl('abc123')).toBe('https://web.example.com/s/abc123');
  });

  test('分享链接路径是 /s/<code>（2026-07 实测确认）', () => {
    expect(shareUrl('dw1q8H2Jii')).toBe('https://supsub.net/s/dw1q8H2Jii');
  });
});
