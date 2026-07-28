// lib/deep-read-store：本地精读缓存的读写、账号隔离、并发安全
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import {
  currentUserKey,
  type DeepReadEntry,
  deepReadRootDir,
  entryKey,
  entryPaths,
  listEntries,
  readEntry,
  removeEntry,
  writeEntry,
} from '../../src/lib/deep-read-store.ts';
import { setTestCredential } from '../_helpers/credential.ts';
import { makeJwt } from '../_helpers/jwt.ts';

function entry(overrides: Partial<DeepReadEntry> = {}): DeepReadEntry {
  return {
    sourceType: 'MP',
    contentId: 'cid-1',
    title: '测试文章',
    requestedAt: 1_700_000_000_000,
    status: 'done',
    checkedAt: 1_700_000_001_000,
    content: { essence: '一句话本质', quality: { grade: '高', comment: '很好' } },
    ...overrides,
  };
}

describe('lib/deep-read-store', () => {
  beforeEach(async () => {
    await setTestCredential('sk_store_test');
  });

  afterEach(async () => {
    await setTestCredential(undefined);
    await fs.rm(deepReadRootDir(), { recursive: true, force: true });
  });

  test('entryKey 对不同 contentId 稳定且互不相同', () => {
    const a = entryKey('MP', 'abc');
    expect(a).toBe(entryKey('MP', 'abc'));
    expect(a).not.toBe(entryKey('MP', 'abd'));
    // sourceType 参与命名，且被规范成大写
    expect(entryKey('mp', 'abc')).toBe(a);
    expect(entryKey('WEBSITE', 'abc')).not.toBe(a);
  });

  test('contentId 里的路径字符不会逃出缓存目录', async () => {
    const paths = await entryPaths('MP', '../../etc/passwd');
    expect(paths.json).not.toContain('..');
    expect(paths.json.endsWith('.json')).toBe(true);
  });

  test('写入后能读回，done 状态额外落一份 .md', async () => {
    const paths = await writeEntry(entry(), (e) => `# ${e.title}\n`);
    const back = await readEntry('MP', 'cid-1');
    expect(back?.title).toBe('测试文章');
    expect(back?.content?.essence).toBe('一句话本质');
    expect(await fs.readFile(paths.md, 'utf-8')).toBe('# 测试文章\n');
  });

  test('pending 不写 .md（还没有正文可渲染）', async () => {
    const paths = await writeEntry(
      entry({ status: 'pending', content: undefined }),
      (e) => `# ${e.title}\n`,
    );
    expect(await fs.exists(paths.md)).toBe(false);
  });

  test('同一篇重复写是覆盖，不会产生第二条记录', async () => {
    await writeEntry(entry());
    await writeEntry(entry({ title: '改了标题' }));
    const all = await listEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('改了标题');
  });

  test('并发写不同条目不会互相丢失（一条一文件的设计意图）', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writeEntry(entry({ contentId: `cid-${i}`, requestedAt: 1_700_000_000_000 + i })),
      ),
    );
    expect(await listEntries()).toHaveLength(8);
  });

  test('listEntries 按发起时间倒序', async () => {
    await writeEntry(entry({ contentId: 'old', requestedAt: 1000 }));
    await writeEntry(entry({ contentId: 'new', requestedAt: 2000 }));
    const all = await listEntries();
    expect(all.map((e) => e.contentId)).toEqual(['new', 'old']);
  });

  test('损坏的 json 被跳过，不影响其它条目', async () => {
    await writeEntry(entry());
    const { json } = await entryPaths('MP', 'broken');
    await fs.writeFile(json, '{ not json', 'utf-8');
    const all = await listEntries();
    expect(all).toHaveLength(1);
  });

  test('removeEntry 删掉 json + md，重复删返回 false', async () => {
    await writeEntry(entry(), () => '# x\n');
    expect(await removeEntry('MP', 'cid-1')).toBe(true);
    expect(await readEntry('MP', 'cid-1')).toBeUndefined();
    expect(await removeEntry('MP', 'cid-1')).toBe(false);
  });

  test('不同账号落到不同子目录，互相看不见', async () => {
    await setTestCredential(makeJwt({ id: 101 }));
    await writeEntry(entry({ contentId: 'a' }));
    const keyA = await currentUserKey();

    await setTestCredential(makeJwt({ id: 202 }));
    const keyB = await currentUserKey();
    expect(keyB).not.toBe(keyA);
    expect(await listEntries()).toHaveLength(0);

    await setTestCredential(makeJwt({ id: 101 }));
    expect(await listEntries()).toHaveLength(1);
  });

  test('JWT 能解出 id 时目录名用 id，非 JWT 凭证退化为哈希', async () => {
    await setTestCredential(makeJwt({ id: 101 }));
    expect(await currentUserKey()).toBe('u101');

    await setTestCredential('sk_plain_key');
    expect(await currentUserKey()).toMatch(/^k[0-9a-f]{16}$/);
  });
});
