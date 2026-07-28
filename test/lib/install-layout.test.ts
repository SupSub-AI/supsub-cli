// lib/install-layout：安装方式判定、版本并存列举、symlink 原子切换、旧版本清理、
// 回滚目标、PATH 判断、迁移策略与「装到 versions/ + 切 symlink」的落盘链路。
// 用 SUPSUB_DATA_DIR / SUPSUB_BIN_DIR 把布局隔离到 tmp，不碰真实 ~/.local。
// （installNativeVersion 的真实网络下载通过注入假下载器规避，不连网。）
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectInstallMethod,
  installNativeVersion,
  isBinDirOnPath,
  listInstalledVersions,
  planRollback,
  planUpdateStrategy,
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
  test('真实路径含 node_modules（包管理器全局 bin）→ npm', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/@supsub/cli/bin/supsub')).toBe('npm');
  });
  test('独立普通二进制（非 versions/ / 非 bun·node / 无 node_modules）→ manual', () => {
    // 0.4.0 之前 curl 装的普通文件、手动 cp 到某处的 binary，都归 manual。
    expect(detectInstallMethod('/usr/local/bin/supsub')).toBe('manual');
    expect(detectInstallMethod('/home/alice/.local/bin/supsub')).toBe('manual');
    // 语义翻转记录：直接跑 dist/supsub 现在判 manual（原先判 npm）。
    expect(detectInstallMethod('/repo/dist/supsub')).toBe('manual');
  });
});

describe('planUpdateStrategy', () => {
  test('native 布局 → native', () => {
    const bin = versionBinary('0.4.0');
    expect(planUpdateStrategy(bin)).toBe('native');
  });

  test('普通文件恰在 native symlink 位（被困手装用户）→ migrate-to-native', () => {
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, '#!/bin/sh\necho fake\n', { mode: 0o755 });
    // 前提：这个普通文件确实被判为 manual
    expect(detectInstallMethod(link)).toBe('manual');
    expect(planUpdateStrategy(link)).toBe('migrate-to-native');
  });

  test('手拷到别处（不在 bin 位）的普通文件 → in-place（不迁移）', () => {
    const stray = path.join(tmpRoot, 'usr-local-bin', 'supsub');
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, 'x', { mode: 0o755 });
    expect(detectInstallMethod(stray)).toBe('manual');
    expect(planUpdateStrategy(stray)).toBe('in-place');
  });

  test('npm 包（node_modules）→ in-place（不迁移，避免 PATH 遮蔽与包残留）', () => {
    expect(planUpdateStrategy('/usr/local/lib/node_modules/@supsub/cli/bin/supsub')).toBe(
      'in-place',
    );
  });

  test('Windows 平台一律不迁移（native 布局仅 macOS/Linux）→ in-place', () => {
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, 'x', { mode: 0o755 });
    // 即便普通文件恰在 bin 位，win32 也走原地覆盖
    expect(planUpdateStrategy(link, 'win32')).toBe('in-place');
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

describe('planRollback', () => {
  test('存在更旧版本 → ok，target 是更旧的一版', () => {
    makeVersion('0.3.0');
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    switchToVersion('0.5.0');
    const plan = planRollback();
    expect(plan.kind).toBe('ok');
    if (plan.kind === 'ok') {
      expect(plan.target).toBe('0.4.0');
      expect(plan.current).toBe('0.5.0');
      expect(plan.installed).toEqual(['0.5.0', '0.4.0', '0.3.0']);
    }
  });

  test('本地只有一个版本 → only-one（不谎称有历史版本）', () => {
    makeVersion('0.5.0');
    switchToVersion('0.5.0');
    const plan = planRollback();
    expect(plan.kind).toBe('only-one');
    if (plan.kind === 'only-one') {
      expect(plan.current).toBe('0.5.0');
      expect(plan.installed).toEqual(['0.5.0']);
    }
  });

  test('有多个版本但当前已是最旧 → at-oldest（之前被误并入 only-one 的分支）', () => {
    makeVersion('0.3.0');
    makeVersion('0.4.0');
    makeVersion('0.5.0');
    switchToVersion('0.3.0'); // 指向最旧
    const plan = planRollback();
    expect(plan.kind).toBe('at-oldest');
    if (plan.kind === 'at-oldest') {
      expect(plan.current).toBe('0.3.0');
      // 留存列表如实带出更新的版本，供用户自查（不会以为被误删）
      expect(plan.installed).toEqual(['0.5.0', '0.4.0', '0.3.0']);
    }
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

describe('迁移落盘链路：装到 versions/ + symlink 覆盖普通文件（注入假下载器，不连网）', () => {
  /** 假下载器：在临时目录造一个可辨识的假二进制，模拟 downloadBinary 的产物 */
  function fakeDownloader(marker: string) {
    return async (_v: string): Promise<{ binaryPath: string; tmpDir: string }> => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supsub-fakedl-'));
      const binaryPath = path.join(tmpDir, 'supsub');
      fs.writeFileSync(binaryPath, `#!/bin/sh\necho ${marker}\n`, { mode: 0o755 });
      return { binaryPath, tmpDir };
    };
  }

  test('被困手装用户：bin 位普通文件 → 迁移后被 symlink 原子替换、指向 versions/', async () => {
    // 造一个「被困手装用户」：bin 位是普通文件（非 symlink、不在 versions/ 下）
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, '#!/bin/sh\necho OLD_MANUAL\n', { mode: 0o755 });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false); // 迁移前是普通文件
    expect(planUpdateStrategy(link)).toBe('migrate-to-native');

    // 走 update 的 goesNative 分支：装到 versions/ → 切 symlink
    const dest = await installNativeVersion('0.5.0', fakeDownloader('NEW_050'));
    expect(dest).toBe(versionBinary('0.5.0'));
    expect(fs.existsSync(versionBinary('0.5.0'))).toBe(true);
    switchToVersion('0.5.0');

    // 迁移后：bin 位从普通文件变成 symlink，指向 versions/0.5.0/supsub
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readLinkedVersion()).toBe('0.5.0');
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(versionBinary('0.5.0')));
    // 迁移后 detect 判为 native（穿透 symlink 落在 versions/ 下）
    expect(detectInstallMethod(link)).toBe('native');
    // symlink 指向的内容是新版本（不再是旧的普通文件内容）
    expect(fs.readFileSync(fs.realpathSync(link), 'utf8')).toContain('NEW_050');
  });

  test('switchToVersion 对「普通文件占位」也能 rename 原子覆盖（非旧 symlink）', () => {
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, 'plain', { mode: 0o755 });
    fs.mkdirSync(versionDir('0.5.0'), { recursive: true });
    fs.writeFileSync(versionBinary('0.5.0'), '#!/bin/sh\necho v050\n', { mode: 0o755 });
    switchToVersion('0.5.0');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readLinkedVersion()).toBe('0.5.0');
  });

  test('中途下载/落盘失败：不触碰 bin 位的普通文件（原样健在，未提前换 symlink）', async () => {
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, 'ORIGINAL', { mode: 0o755 });

    let threw = false;
    try {
      await installNativeVersion('0.5.0', async () => {
        throw new Error('下载炸了');
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // 关键：换 symlink 尚未发生，普通文件必须原样健在
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(link, 'utf8')).toBe('ORIGINAL');
    // versions/0.5.0 也没建立（下载失败发生在拷贝之前）
    expect(fs.existsSync(versionBinary('0.5.0'))).toBe(false);
  });
});
