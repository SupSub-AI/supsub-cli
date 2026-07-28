// packages/cli/src/config/store.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type Config = {
  /** 设备授权得到的访问令牌（accessToken），CLI 的主凭证。 */
  access_token?: string;
  /** 设备授权得到的刷新令牌（refreshToken），用于后续续期。 */
  refresh_token?: string;
  /**
   * 历史遗留字段：旧版本的 `--api-key` 登录会写入这里。
   * 现已不再读取、也不再写入，保留声明只是为了让 clearAuth 能清掉老配置里的残留。
   */
  api_key?: string;
  client_id?: string;
  /**
   * 临时鉴权来源：用户从浏览器 DevTools 复制的
   * `Authorization: Bearer <token>` 中的 token，手动写入。
   * 仅在 access_token 缺失时回落使用，401 时与其一同被清除。
   */
  bearer_token?: string;
  /**
   * 后台自动更新通道（对标 Claude Code 的 channel）：
   * - `latest`（默认）：跟随最新版本，patch/minor/major 都自动升。
   * - `stable`：只自动升 **patch**；minor/major 仍需手动 `supsub update`。
   * 仅影响 native 安装的后台静默更新；手动 `supsub update` 不受此约束。
   */
  autoUpdateChannel?: 'latest' | 'stable';
  /**
   * 自动更新版本门限（对标 Claude Code 的 minimumVersion）：
   * 后台自动更新的目标版本不得低于此值。用于「钉住不回退到某个已知有问题的低版本」。
   */
  minimumVersion?: string;
};

/**
 * 配置目录路径解析。每次调用都重新读 env，方便测试用 SUPSUB_CONFIG_DIR
 * 把整个 CLI 隔离到 tmp 目录里，不污染用户真实 ~/.supsub。
 *
 * 导出供 skills 状态文件（skills-state.json）等其他模块复用同一套目录解析，
 * 避免各处重复读取 SUPSUB_CONFIG_DIR / homedir。
 */
export function getConfigDir(): string {
  const override = process.env.SUPSUB_CONFIG_DIR;
  if (override && override.trim() !== '') {
    return override;
  }
  return path.join(os.homedir(), '.supsub');
}

function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * 读取配置文件；文件不存在返回 {}
 */
export async function readConfig(): Promise<Config> {
  try {
    const content = await fs.readFile(getConfigFile(), 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

/**
 * 合并写入配置（patch 方式，不整体覆盖）
 * 写入前确保目录存在（0700），写文件后设置权限 0600
 */
export async function writeConfig(patch: Partial<Config>): Promise<void> {
  const configDir = getConfigDir();
  const configFile = getConfigFile();

  // 确保目录存在
  await fs.mkdir(configDir, { recursive: true });
  // chmod 0700（非 Windows）
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(configDir, 0o700);
    } catch {
      // 静默忽略
    }
  }

  // 读取现有配置并合并
  const existing = await readConfig();
  const merged = { ...existing, ...patch };

  await fs.writeFile(configFile, JSON.stringify(merged, null, 2), 'utf-8');

  // chmod 0600（非 Windows）
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(configFile, 0o600);
    } catch {
      // 静默忽略
    }
  }
}

/**
 * 清除认证信息（删除 access_token、refresh_token、client_id、bearer_token，
 * 以及老配置里可能残留的 api_key）
 */
export async function clearAuth(): Promise<void> {
  const configDir = getConfigDir();
  const configFile = getConfigFile();
  const existing = await readConfig();
  const {
    access_token: _at,
    refresh_token: _rt,
    api_key: _a,
    client_id: _c,
    bearer_token: _b,
    ...rest
  } = existing;
  // 如果文件不存在或没有认证字段，直接返回
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(rest, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(configFile, 0o600);
    } catch {
      // 静默忽略
    }
  }
}
