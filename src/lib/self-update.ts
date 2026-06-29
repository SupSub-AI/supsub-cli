// packages/cli/src/lib/self-update.ts
// supsub 自更新逻辑：查询 npm registry 最新版本，从 GitHub Release 下载对应平台
// 的预编译 binary，原地替换正在运行的可执行文件。
//
// 为什么不走 http/client.ts 的 request()：
// - 目标 host 是 registry.npmjs.org / github.com，不是 supsub API，且无需鉴权，
//   也不应触发 401 → clearAuth。与 api/auth.ts 里 device 端点同理，独立 fetch。
// - 下载 URL 规则与 scripts/postinstall.cjs 保持一致（同一套 Release 资产命名）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import type { ErrorEnvelope } from './errors.ts';

/** 当前安装的版本（编译进 binary 的 package.json version） */
export const CURRENT_VERSION: string = pkg.version;

type PlatformInfo = {
  /** Release 资产里的 OS 段：darwin | linux | windows */
  platform: string;
  /** Release 资产里的 arch 段：amd64 | arm64 */
  arch: string;
  /** 压缩包后缀：.tar.gz | .zip */
  ext: string;
  /** 解压后的可执行文件名：supsub | supsub.exe */
  binaryName: string;
};

/**
 * 从 package.json#repository.url 解析出 `owner/repo`（与 postinstall 的 REPO 同源）。
 * 导出供 skills-sync 复用：`npx skills add <owner/repo>` 与 Release 资产同一来源。
 */
export function getRepoSlug(): string {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  const m = raw.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (!m?.[1]) {
    throw {
      code: 'UPDATE_FAILED',
      message: '无法解析仓库地址，无法定位 Release 资产',
      status: 0,
    } satisfies ErrorEnvelope;
  }
  return m[1];
}

/** 探测当前平台/架构，映射到 Release 资产命名（与 postinstall.cjs 完全一致） */
export function detectPlatform(): PlatformInfo {
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const archMap: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };
  const p = platformMap[os.platform()];
  const a = archMap[os.arch()];
  if (!p || !a) {
    throw {
      code: 'UPDATE_FAILED',
      message: `不支持的平台：${os.platform()}/${os.arch()}`,
      status: 0,
    } satisfies ErrorEnvelope;
  }
  return {
    platform: p,
    arch: a,
    ext: p === 'windows' ? '.zip' : '.tar.gz',
    binaryName: p === 'windows' ? 'supsub.exe' : 'supsub',
  };
}

/** 拼出某版本对应平台资产的下载地址 */
export function buildDownloadUrl(version: string, info: PlatformInfo): string {
  const asset = `supsub-cli_${version}_${info.platform}_${info.arch}${info.ext}`;
  return `https://github.com/${getRepoSlug()}/releases/download/v${version}/${asset}`;
}

/**
 * 比较两个 semver（仅取 major.minor.patch，忽略 prerelease 尾巴）。
 * 返回 >0 表示 a 比 b 新，<0 表示更旧，0 表示相等。
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const core = v.replace(/^v/, '').split('-')[0] ?? '0';
    return core.split('.').map((n) => Number.parseInt(n, 10) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** 解析当前正在运行的真实 binary 路径（穿透 PATH 上的 symlink） */
function resolveCurrentBinary(): string {
  try {
    return fs.realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

export type UpdateCheck = {
  current: string;
  latest: string;
  hasUpdate: boolean;
};

/** GET npm registry，拿 latest dist-tag 的版本号 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const url = `https://registry.npmjs.org/${pkg.name}/latest`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw {
      code: 'NETWORK_ERROR',
      message: '无法连接 npm registry 检查更新，请稍后重试',
      status: 0,
      data: String(err),
    } satisfies ErrorEnvelope;
  }
  if (!res.ok) {
    throw {
      code: 'SERVER_ERROR',
      message: `检查更新失败（HTTP ${res.status}）`,
      status: res.status,
    } satisfies ErrorEnvelope;
  }
  const body = (await res.json()) as { version?: string };
  if (!body.version) {
    throw {
      code: 'SERVER_ERROR',
      message: 'npm registry 未返回版本号',
      status: 0,
    } satisfies ErrorEnvelope;
  }
  return {
    current: CURRENT_VERSION,
    latest: body.version,
    hasUpdate: compareSemver(body.version, CURRENT_VERSION) > 0,
  };
}

/** 解压压缩包到 destDir（复用系统 tar / PowerShell，与 postinstall 一致） */
function extractArchive(archivePath: string, destDir: string, info: PlatformInfo): void {
  if (info.platform === 'windows') {
    execFileSync(
      'powershell',
      ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`],
      { stdio: 'ignore' },
    );
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', destDir, info.binaryName], { stdio: 'ignore' });
  }
}

/** 把替换阶段的 fs 错误映射为友好的 ErrorEnvelope（权限不足是最常见的失败） */
function mapReplaceError(err: unknown, binDir: string): ErrorEnvelope {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'EACCES' || e?.code === 'EPERM') {
    return {
      code: 'UPDATE_PERMISSION_DENIED',
      message: `无写入权限：${binDir}。请改用包管理器更新（npm i -g ${pkg.name}@latest）或加 sudo 重试`,
      status: 0,
    };
  }
  return {
    code: 'UPDATE_FAILED',
    message: `替换可执行文件失败：${e?.message ?? String(err)}`,
    status: 0,
  };
}

/**
 * 下载指定版本并原地替换当前 binary，返回被替换的真实路径。
 * 替换采用「同目录暂存 + 原子 rename」：rename 可覆盖正在运行的可执行文件，
 * 且同目录避免跨文件系统 EXDEV。
 */
export async function performUpdate(version: string): Promise<string> {
  const info = detectPlatform();
  const realBin = resolveCurrentBinary();
  const binDir = path.dirname(realBin);
  const url = buildDownloadUrl(version, info);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supsub-update-'));
  const staged = path.join(binDir, `.supsub-update-${process.pid}`);

  try {
    // 1. 下载
    const archivePath = path.join(tmpDir, `archive${info.ext}`);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (err) {
      throw {
        code: 'NETWORK_ERROR',
        message: '下载更新包失败，请检查网络后重试',
        status: 0,
        data: String(err),
      } satisfies ErrorEnvelope;
    }
    if (!res.ok) {
      throw {
        code: 'SERVER_ERROR',
        message: `下载更新包失败（HTTP ${res.status}）：${url}`,
        status: res.status,
      } satisfies ErrorEnvelope;
    }
    fs.writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

    // 2. 解压
    try {
      extractArchive(archivePath, tmpDir, info);
    } catch (err) {
      throw {
        code: 'UPDATE_FAILED',
        message: `解压更新包失败：${(err as Error)?.message ?? String(err)}`,
        status: 0,
      } satisfies ErrorEnvelope;
    }
    const newBin = path.join(tmpDir, info.binaryName);
    if (!fs.existsSync(newBin)) {
      throw {
        code: 'UPDATE_FAILED',
        message: '更新包内未找到 supsub 可执行文件',
        status: 0,
      } satisfies ErrorEnvelope;
    }

    // 3. 同目录暂存 + 原子覆盖
    try {
      fs.copyFileSync(newBin, staged);
      fs.chmodSync(staged, 0o755);
      fs.renameSync(staged, realBin);
    } catch (err) {
      try {
        fs.rmSync(staged, { force: true });
      } catch {
        /* 忽略残留清理失败 */
      }
      throw mapReplaceError(err, binDir);
    }

    return realBin;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 忽略临时目录清理失败 */
    }
  }
}
