// api/deep-read：分享精读时必须带 creatorType=agent，让服务端能清晰区分
// 「CLI/agent 生成的分享」与网页端人工分享。mock fetch 捕获实际发出的请求体断言。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { shareDeepRead } from '../../src/api/deep-read.ts';
import { setTestCredential } from '../_helpers/credential.ts';

describe('api/deep-read - shareDeepRead 带 creatorType=agent', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SUPSUB_API_URL;
    process.env.SUPSUB_API_URL = 'http://fake-host';
    await setTestCredential('sk_test_share');
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.SUPSUB_API_URL;
    else process.env.SUPSUB_API_URL = originalApiUrl;
    await setTestCredential(undefined);
  });

  test('POST /api/deep-reads/share 的请求体含 sourceType/contentId/creatorType=agent', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedMethod = init?.method ?? '';
      capturedBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      return new Response(JSON.stringify({ shareCode: 'abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await shareDeepRead({ sourceType: 'MP', contentId: 'c-42' });

    expect(res.shareCode).toBe('abc123');
    expect(capturedMethod).toBe('POST');
    expect(capturedUrl).toContain('/api/deep-reads/share');
    // 关键：CLI 分享一律标记为 agent 来源
    expect(capturedBody).toEqual({ sourceType: 'MP', contentId: 'c-42', creatorType: 'agent' });
  });
});
