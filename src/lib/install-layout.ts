// packages/cli/src/lib/install-layout.ts
// native 安装布局：把各版本二进制并存于用户目录，用 symlink 原子切换当前版本。
// 对标 Claude Code 的安装架构——装在用户目录永不需要 sudo；版本并存可回滚；
// symlink 切换是原子操作（先写临时 symlink，再 rename 覆盖），保证任一时刻
// PATH 上的 `supsub` 要么指向旧版、要么指向新版，绝不出现半残状态。
//
// 布局：
//   <dataDir>/versions/<version>/supsub          各版本二进制并存
//   <binDir>/supsub -> <dataDir>/versions/<version>/supsub   PATH 上的 symlink
//
// 默认 dataDir = ~/.local/share/supsub、binDir = ~/.local/bin（遵循 XDG 习惯）。
// 可用 SUPSUB_DATA_DIR / SUPSUB_BIN_DIR 覆盖：测试隔离用，高级用户自定义安装位置也用。
//
// 为什么 symlink 目标用**绝对路径**而非布局图里的相对写法：dataDir / binDir 可被
// 环境变量各自覆盖到任意（甚至不同根）目录，相对路径在这种组合下会算错；绝对路径
// 始终正确，代价只是「整体迁移家目录后需重建 symlink」——native 安装本就不该被搬。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ErrorEnvelope } from './errors.ts';
import { compareSemver, downloadBinary, resolveRealBinary } from './self-update.ts';

/** 各平台可执行文件名（native 安装当前仅 macOS / Linux，Windows 保留 npm 路径） */
const BINARY_NAME = process.platform === 'win32' ? 'supsub.exe' : 'supsub';

/** native 安装的数据根目录（各版本二进制并存于此），默认 ~/.local/share/supsub */
export function getDataDir(): string {
  const override = process.env.SUPSUB_DATA_DIR;
  if (override && override.trim() !== '') return override;
  return path.join(os.homedir(), '.local', 'share', 'supsub');
}

/** PATH 上 symlink 所在目录，默认 ~/.local/bin */
export function getBinDir(): string {
  const override = process.env.SUPSUB_BIN_DIR;
  if (override && override.trim() !== '') return override;
  return path.join(os.homedir(), '.local', 'bin');
}

/** 版本并存根目录 <dataDir>/versions */
export function versionsRoot(): string {
  return path.join(getDataDir(), 'versions');
}

/** 某版本的目录 <dataDir>/versions/<version> */
export function versionDir(version: string): string {
  return path.join(versionsRoot(), version);
}

/** 某版本的可执行文件路径 */
export function versionBinary(version: string): string {
  return path.join(versionDir(version), BINARY_NAME);
}

/** PATH 上的 symlink 路径 <binDir>/supsub */
export function symlinkPath(): string {
  return path.join(getBinDir(), BINARY_NAME);
}

/**
 * 尽力把路径解析成「真实路径」：能 realpath 就 realpath；路径尚不存在时，
 * 逐级向上找到最近的存在祖先做 realpath，再把剩余尾巴拼回来。
 *
 * 为什么需要它：detectInstallMethod 要比较「realpath 过的当前二进制路径」与
 * 「由环境变量拼出的 versionsRoot」。若数据目录的某级祖先本身是 symlink
 * （如 macOS 的 /tmp → /private/tmp，或家目录被 symlink），一边解析过、一边没解析，
 * 字符串前缀比对就会漏判 native。两边都过一遍 realpath 才能可靠比较。
 */
function realpathBestEffort(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    /* 路径不存在，向上找存在的祖先 */
  }
  const tail: string[] = [];
  let cur = abs;
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) return abs; // 到根还没找到，放弃解析
    tail.unshift(path.basename(cur));
    cur = parent;
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      /* 继续向上 */
    }
  }
}

/** 安装方式：native（~/.local 版本并存）/ npm（包管理器全局目录）/ dev（bun 跑源码） */
export type InstallMethod = 'native' | 'npm' | 'dev';

/**
 * 判定当前运行的二进制是哪种安装方式。
 * - native：真实路径落在 versions/ 下（唯一自动更新的安装方式）。
 * - dev：真实可执行文件是 bun / node 本体（`bun run src/index.ts` 源码直跑）。
 * - npm：其余情况（装在包管理器全局 bin、或手动放置的独立二进制）。
 */
export function detectInstallMethod(realBin: string = resolveRealBinary()): InstallMethod {
  // 两边都过一遍 realpath，避免「一边解析了 symlink 祖先、一边没解析」导致漏判。
  const real = realpathBestEffort(realBin);
  const root = realpathBestEffort(versionsRoot());
  if (real === root || real.startsWith(root + path.sep)) return 'native';
  const base = path.basename(real).toLowerCase();
  if (base === 'bun' || base === 'bun.exe' || base === 'node' || base === 'node.exe') return 'dev';
  return 'npm';
}

/**
 * 列出本地已安装（含可执行文件）的版本，按 semver 从新到旧排序。
 * 目录不存在 / 读取失败一律返回空数组。
 */
export function listInstalledVersions(): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(versionsRoot());
  } catch {
    return [];
  }
  return entries
    .filter((v) => {
      try {
        return fs.statSync(versionBinary(v)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => compareSemver(b, a));
}

/**
 * 读取 symlink 当前指向的版本号（从目标路径 .../versions/<version>/supsub 反解）。
 * symlink 不存在 / 指向非法路径返回 null。
 */
export function readLinkedVersion(): string | null {
  const link = symlinkPath();
  let target: string;
  try {
    target = fs.readlinkSync(link);
  } catch {
    return null;
  }
  const resolved = path.resolve(path.dirname(link), target);
  const parent = path.basename(path.dirname(resolved));
  return parent || null;
}

/**
 * 原子切换 PATH 上的 `supsub` symlink 指向某个已安装版本：
 * 先在同目录写一个临时 symlink，再 `rename` 覆盖旧 symlink——rename 是原子的，
 * 任一时刻 symlink 要么指旧、要么指新，不会出现「删了旧的还没建新的」的空窗。
 */
export function switchToVersion(version: string): void {
  if (process.platform === 'win32') {
    throw {
      code: 'UPDATE_FAILED',
      message: 'Windows 暂不支持 native 安装的版本切换，请使用 npm 安装并更新',
      status: 0,
    } satisfies ErrorEnvelope;
  }
  const bin = versionBinary(version);
  if (!fs.existsSync(bin)) {
    throw {
      code: 'UPDATE_FAILED',
      message: `版本 v${version} 未安装，无法切换`,
      status: 0,
    } satisfies ErrorEnvelope;
  }
  const binDir = getBinDir();
  fs.mkdirSync(binDir, { recursive: true });
  const link = symlinkPath();
  const tmp = path.join(binDir, `.supsub-link-${process.pid}`);
  try {
    fs.rmSync(tmp, { force: true });
  } catch {
    /* 忽略残留清理失败 */
  }
  fs.symlinkSync(bin, tmp);
  fs.renameSync(tmp, link);
}

/**
 * 下载并把某版本二进制安装到 versions/<version>/supsub（不切换 symlink）。
 * 复用 self-update.downloadBinary 的下载/解压逻辑，只是落点改为版本并存目录。
 * 返回安装好的可执行文件路径。
 */
export async function installNativeVersion(version: string): Promise<string> {
  const { binaryPath, tmpDir } = await downloadBinary(version);
  try {
    const dir = versionDir(version);
    fs.mkdirSync(dir, { recursive: true });
    const dest = versionBinary(version);
    fs.copyFileSync(binaryPath, dest);
    if (process.platform !== 'win32') {
      fs.chmodSync(dest, 0o755);
    }
    return dest;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 忽略临时目录清理失败 */
    }
  }
}

/**
 * 清理旧版本，只保留最新的 `keep` 个（外加当前 symlink 指向的版本，避免把正在用的删掉）。
 * 返回被删除的版本号列表。
 */
export function pruneVersions(keep = 3): string[] {
  const versions = listInstalledVersions(); // 从新到旧
  const linked = readLinkedVersion();
  const protectedSet = new Set<string>(versions.slice(0, keep));
  if (linked) protectedSet.add(linked);

  const removed: string[] = [];
  for (const v of versions) {
    if (protectedSet.has(v)) continue;
    try {
      fs.rmSync(versionDir(v), { recursive: true, force: true });
      removed.push(v);
    } catch {
      /* 单个版本清理失败不阻断其余清理 */
    }
  }
  return removed;
}

/**
 * 取「上一个可回滚版本」：symlink 当前指向版本的下一个更旧版本。
 * 无 symlink 时回退到第二新的已安装版本；没有更旧版本返回 null。
 */
export function previousInstalledVersion(): string | null {
  const versions = listInstalledVersions(); // 从新到旧
  const linked = readLinkedVersion();
  if (linked) {
    const idx = versions.indexOf(linked);
    if (idx >= 0) return versions[idx + 1] ?? null;
  }
  return versions[1] ?? null;
}

/** binDir 是否已在 PATH 中（用于安装后提示用户是否需要手动加 PATH） */
export function isBinDirOnPath(binDir: string = getBinDir()): boolean {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const target = path.resolve(binDir);
  return pathEnv.split(sep).some((p) => p.trim() !== '' && path.resolve(p) === target);
}
