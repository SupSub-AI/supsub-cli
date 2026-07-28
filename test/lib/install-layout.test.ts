// lib/install-layout：安装方式判定、版本并存列举、symlink 原子切换、旧版本清理、
// 回滚目标、PATH 判断。用 SUPSUB_DATA_DIR / SUPSUB_BIN_DIR 把布局隔离到 tmp，
// 不碰真实 ~/.local。（installNativeVersion 需真网络下载，不在此单测。）
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectInstallMethod,
  isBinDirOnPath,
  listInstalledVersions,
  previousInstalledVersion,
  pruneVersions,
  readLinkedVersion,
  switchToVersion,
  symlinkPath,
  versionBinary,
  versionDir,
  versionsRoot,
} from '../../src/lib/install-layout.ts';

let tmpRoot: string;
let savedData: string | undefined;
let savedBin: string | undefined;

/** 造一个「已安装版本」：建目录 + 写一个可执行的假二进制 */
function makeVersion(v: string): void {
  fs.mkdirSync(versionDir(v), { recursive: true });
  fs.writeFileSync(versionBinary(v), '#!/bin/sh\necho fake\n', { mode: 0o755 });
}

beforeEach(() => {
  savedData = process.env.SUPSUB_DATA_DIR;
  savedBin = process.env.SUPSUB_BIN_DIR;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supsub-layout-'));
  process.env.SUPSUB_DATA_DIR = path.join(tmpRoot, 'share', 'supsub');
  process.env.SUPSUB_BIN_DIR = path.join(tmpRoot, 'bin');
});

afterEach(() => {
  if (savedData === undefined) delete process.env.SUPSUB_DATA_DIR;
  else process.env.SUPSUB_DATA_DIR = savedData;
  if (savedBin === undefined) delete process.env.SUPSUB_BIN_DIR;
  else process.env.SUPSUB_BIN_DIR = savedBin;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('detectInstallMethod', () => {
  test('真实路径落在 versions/ 下 → native', () => {
    const bin = versionBinary('0.4.0');
    expect(detectInstallMethod(bin)).toBe('native');
  });
  test('可执行文件是 bun / node 本体 → dev', () => {
    expect(detectInstallMethod('/opt/homebrew/bin/bun')).toBe('dev');
    expect(detectInstallMethod('/usr/local/bin/node')).toBe('dev');
  });
  test('其他路径（包管理器全局 bin）→ npm', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/@supsub/cli/bin/supsub')).toBe('npm');
  });
});

describe('listInstalledVersions', () => {
  test('无 versions 目录 → 空数组', () => {
    expect(listInstalledVersions()).toEqual([]);
  });
  test('按 semver 从新到旧排序，且过滤掉没有二进制的目录', () => {
    makeVersion('0.3.0');
    makeVersion('0.10.0');
    makeVersion('0.3.6');
    // 一个只有目录、没有二进制的版本，应被过滤
    fs.mkdirSync(versionDir('0.9.9'), { recursive: true });
    expect(listInstalledVersions()).toEqual(['0.10.0', '0.3.6', '0.3.0']);
  });
});

describe('switchToVersion + readLinkedVersion', () => {
  test('切换后 symlink 指向对应版本，可反解版本号', () => {
    makeVersion('0.4.0');
    switchToVersion('0.4.0');
    expect(fs.lstatSync(symlinkPath()).isSymbolicLink()).toBe(true);
    expect(readLinkedVersion()).toBe('0.4.0');
    // symlink 指向真实存在的二进制
    expect(fs.realpathSync(symlinkPath())).toBe(fs.realpathSync(versionBinary('0.4.0')));
  });

  test('对已存在的 symlink 原子覆盖（切到新版本）', () => {
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    switchToVersion('0.4.0');
    switchToVersion('0.5.0');
    expect(readLinkedVersion()).toBe('0.5.0');
  });

  test('切到未安装版本 → 抛 UPDATE_FAILED', () => {
    let caught: unknown;
    try {
      switchToVersion('9.9.9');
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('UPDATE_FAILED');
  });

  test('无 symlink 时 readLinkedVersion 返回 null', () => {
    expect(readLinkedVersion()).toBeNull();
  });
});

describe('pruneVersions', () => {
  test('保留最新 N 个 + 当前 symlink 指向版本，删掉更旧的', () => {
    for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0']) makeVersion(v);
    // symlink 指向一个较旧的版本，验证它即使不在最新 N 内也被保护
    switchToVersion('0.1.0');
    const removed = pruneVersions(3).sort();
    // 最新 3 个：0.5.0 0.4.0 0.3.0；外加被 symlink 保护的 0.1.0。删掉 0.2.0。
    expect(removed).toEqual(['0.2.0']);
    expect(listInstalledVersions().sort()).toEqual(['0.1.0', '0.3.0', '0.4.0', '0.5.0']);
    // 被保护的当前版本仍在
    expect(fs.existsSync(versionBinary('0.1.0'))).toBe(true);
  });

  test('版本数不超过 keep → 不删任何东西', () => {
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    expect(pruneVersions(3)).toEqual([]);
  });
});

describe('previousInstalledVersion', () => {
  test('返回 symlink 指向版本的下一个更旧版本', () => {
    makeVersion('0.3.0');
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    switchToVersion('0.5.0');
    expect(previousInstalledVersion()).toBe('0.4.0');
  });
  test('symlink 指向最旧版本 → 无可回滚版本，返回 null', () => {
    makeVersion('0.5.0');
    switchToVersion('0.5.0');
    expect(previousInstalledVersion()).toBeNull();
  });
  test('无 symlink → 回退到第二新的版本', () => {
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    expect(previousInstalledVersion()).toBe('0.4.0');
  });
});

describe('isBinDirOnPath', () => {
  test('PATH 含 binDir → true；不含 → false', () => {
    const dir = path.join(tmpRoot, 'somebin');
    const saved = process.env.PATH;
    try {
      process.env.PATH = `/usr/bin:${dir}:/bin`;
      expect(isBinDirOnPath(dir)).toBe(true);
      process.env.PATH = '/usr/bin:/bin';
      expect(isBinDirOnPath(dir)).toBe(false);
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('布局路径拼接', () => {
  test('versionsRoot / versionDir / versionBinary / symlinkPath 落在覆盖目录下', () => {
    expect(versionsRoot()).toBe(path.join(process.env.SUPSUB_DATA_DIR as string, 'versions'));
    expect(versionDir('1.2.3')).toBe(path.join(versionsRoot(), '1.2.3'));
    expect(versionBinary('1.2.3')).toBe(path.join(versionDir('1.2.3'), 'supsub'));
    expect(symlinkPath()).toBe(path.join(process.env.SUPSUB_BIN_DIR as string, 'supsub'));
  });
});
