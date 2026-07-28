// commands/update + lib/self-update：纯函数 + checkForUpdate（mock fetch）+ update --check 命令路径
// + 0.4.3 收敛：decideUpdateAction 行为矩阵、runUpdate（注入依赖）在「已是最新」时的迁移与快路径。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  decideUpdateAction,
  type RunUpdateDeps,
  registerUpdate,
  runUpdate,
} from '../../src/commands/update.ts';
import type { UpdateStrategy } from '../../src/lib/install-layout.ts';
import {
  installNativeVersion,
  readLinkedVersion,
  switchToVersion,
  symlinkPath,
} from '../../src/lib/install-layout.ts';
import {
  buildDownloadUrl,
  CURRENT_VERSION,
  checkForUpdate,
  compareSemver,
  detectPlatform,
} from '../../src/lib/self-update.ts';

describe('lib/self-update - compareSemver', () => {
  test('a 比 b 新返回 >0', () => {
    expect(compareSemver('0.3.0', '0.2.6')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.3.1', '0.3.0')).toBeGreaterThan(0);
  });
  test('a 比 b 旧返回 <0', () => {
    expect(compareSemver('0.2.6', '0.3.0')).toBeLessThan(0);
  });
  test('相等返回 0（含 v 前缀与 prerelease 尾巴）', () => {
    expect(compareSemver('0.3.0', '0.3.0')).toBe(0);
    expect(compareSemver('v0.3.0', '0.3.0')).toBe(0);
    expect(compareSemver('0.3.0-beta.1', '0.3.0')).toBe(0);
  });
});

describe('lib/self-update - detectPlatform / buildDownloadUrl', () => {
  test('detectPlatform 返回当前平台的资产命名段', () => {
    const info = detectPlatform();
    expect(['darwin', 'linux', 'windows']).toContain(info.platform);
    expect(['amd64', 'arm64']).toContain(info.arch);
    expect([info.ext]).toContainEqual(info.platform === 'windows' ? '.zip' : '.tar.gz');
    expect(info.binaryName).toBe(info.platform === 'windows' ? 'supsub.exe' : 'supsub');
  });

  test('buildDownloadUrl 拼出 GitHub Release 资产地址', () => {
    const info = detectPlatform();
    const url = buildDownloadUrl('0.3.0', info);
    expect(url).toBe(
      `https://github.com/SupSub-AI/supsub-cli/releases/download/v0.3.0/supsub-cli_0.3.0_${info.platform}_${info.arch}${info.ext}`,
    );
  });
});

describe('lib/self-update - checkForUpdate（mock fetch）', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockRegistry(version: string): void {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('registry.npmjs.org/@supsub/cli/latest');
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  test('registry 版本更高 → hasUpdate=true', async () => {
    mockRegistry('99.0.0');
    const r = await checkForUpdate();
    expect(r.current).toBe(CURRENT_VERSION);
    expect(r.latest).toBe('99.0.0');
    expect(r.hasUpdate).toBe(true);
  });

  test('registry 版本不高于当前 → hasUpdate=false', async () => {
    mockRegistry('0.0.1');
    const r = await checkForUpdate();
    expect(r.hasUpdate).toBe(false);
  });

  test('registry 非 2xx → 抛 SERVER_ERROR', async () => {
    globalThis.fetch = async (): Promise<Response> => new Response('nope', { status: 503 });
    let caught: unknown;
    try {
      await checkForUpdate();
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('SERVER_ERROR');
  });
});

describe('commands/update - update --check（不下载，mock fetch）', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    stdoutOutput = '';
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    globalThis.fetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ version: '99.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
  });
  afterEach(() => {
    process.stdout.write = originalStdout;
    globalThis.fetch = originalFetch;
  });

  function buildProgram(): Command {
    const program = new Command();
    program
      .name('supsub')
      .option('-o, --output <fmt>', '输出格式：table|json', 'table')
      .exitOverride();
    registerUpdate(program);
    return program;
  }

  test('--check --output json 只报告版本、updated=false', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'update', '--check']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.current).toBe(CURRENT_VERSION);
    expect(parsed.data.latest).toBe('99.0.0');
    expect(parsed.data.hasUpdate).toBe(true);
    expect(parsed.data.updated).toBe(false);
    // --check 只读：绝不迁移
    expect(parsed.data.migrated).toBe(false);
  });
});

describe('decideUpdateAction - 行为矩阵（纯函数，钉死快路径与迁移收敛）', () => {
  const S: UpdateStrategy[] = ['native', 'in-place', 'migrate-to-native'];

  test('已是最新 + 非 force：仅 migrate 需要动二进制，native/in-place 走早退（不下载）', () => {
    for (const strategy of S) {
      const a = decideUpdateAction({ hasUpdate: false, force: false, strategy });
      expect(a.doBinaryWork).toBe(strategy === 'migrate-to-native');
    }
  });

  test('有新版本：三档都要动二进制', () => {
    for (const strategy of S) {
      expect(decideUpdateAction({ hasUpdate: true, force: false, strategy }).doBinaryWork).toBe(
        true,
      );
    }
  });

  test('--force：即使已是最新，三档都要动二进制（重装）', () => {
    for (const strategy of S) {
      expect(decideUpdateAction({ hasUpdate: false, force: true, strategy }).doBinaryWork).toBe(
        true,
      );
    }
  });

  test('goesNative：native / migrate 为 true，in-place 为 false', () => {
    expect(
      decideUpdateAction({ hasUpdate: true, force: false, strategy: 'native' }).goesNative,
    ).toBe(true);
    expect(
      decideUpdateAction({ hasUpdate: true, force: false, strategy: 'migrate-to-native' })
        .goesNative,
    ).toBe(true);
    expect(
      decideUpdateAction({ hasUpdate: true, force: false, strategy: 'in-place' }).goesNative,
    ).toBe(false);
  });

  test('migrated：仅 migrate-to-native 为 true', () => {
    for (const strategy of S) {
      expect(decideUpdateAction({ hasUpdate: false, force: false, strategy }).migrated).toBe(
        strategy === 'migrate-to-native',
      );
    }
  });
});

describe('runUpdate - 收敛：已是最新时迁移执行 + 其余档位快路径不变（注入依赖，不连网）', () => {
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;

  beforeEach(() => {
    stdoutOutput = '';
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });
  afterEach(() => {
    process.stdout.write = originalStdout;
  });

  /** 采集本次 runUpdate 的安装动作调用与 JSON 输出 */
  type Calls = { native: string[]; inplace: string[] };
  function harness(over: Partial<RunUpdateDeps> = {}): { calls: Calls; deps: RunUpdateDeps } {
    const calls: Calls = { native: [], inplace: [] };
    const deps: RunUpdateDeps = {
      check: async () => ({ current: '0.4.2', latest: '0.4.2', hasUpdate: false }),
      detectMethod: () => 'manual',
      planStrategy: () => 'migrate-to-native',
      installNative: async (v: string) => {
        calls.native.push(v);
      },
      performInPlace: async (v: string) => {
        calls.inplace.push(v);
        return 'ok';
      },
      syncSkills: async () => ({ action: 'in_sync' as const }),
      ...over,
    };
    return { calls, deps };
  }

  test('已是最新 + migrate → 执行 native 安装（装当前 latest）、updated=false、migrated=true', async () => {
    const { calls, deps } = harness();
    await runUpdate({}, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false); // 版本没变
    expect(d.migrated).toBe(true); // 布局变了
    expect(d.strategy).toBe('migrate-to-native');
    expect(d.method).toBe('manual');
    expect(calls.native).toEqual(['0.4.2']); // 迁移执行：装了当前 latest
    expect(calls.inplace).toEqual([]);
  });

  test('已是最新 + native → 早退、零下载', async () => {
    const { calls, deps } = harness({
      detectMethod: () => 'native' as const,
      planStrategy: () => 'native' as UpdateStrategy,
    });
    await runUpdate({}, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false);
    expect(d.migrated).toBe(false);
    expect(calls.native).toEqual([]); // 关键：没有任何安装/下载
    expect(calls.inplace).toEqual([]);
  });

  test('已是最新 + npm → 早退、零下载', async () => {
    const { calls, deps } = harness({
      detectMethod: () => 'npm' as const,
      planStrategy: () => 'in-place' as UpdateStrategy,
    });
    await runUpdate({}, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false);
    expect(calls.native).toEqual([]);
    expect(calls.inplace).toEqual([]);
  });

  test('--check + migrate 策略 → 只读：不安装、migrated=false，且不问 planStrategy', async () => {
    let strategyAsked = false;
    const { calls, deps } = harness({
      planStrategy: () => {
        strategyAsked = true;
        return 'migrate-to-native' as UpdateStrategy;
      },
    });
    await runUpdate({ check: true }, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false);
    expect(d.migrated).toBe(false);
    expect(calls.native).toEqual([]);
    expect(strategyAsked).toBe(false); // --check 在算 strategy 之前就返回
  });

  test('有新版本 + native → 安装、updated=true、migrated=false', async () => {
    const { calls, deps } = harness({
      check: async () => ({ current: '0.4.1', latest: '0.4.2', hasUpdate: true }),
      detectMethod: () => 'native' as const,
      planStrategy: () => 'native' as UpdateStrategy,
    });
    await runUpdate({}, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(true);
    expect(d.migrated).toBe(false);
    expect(calls.native).toEqual(['0.4.2']);
  });

  test('有新版本 + npm → 原地覆盖、updated=true', async () => {
    const { calls, deps } = harness({
      check: async () => ({ current: '0.4.1', latest: '0.4.2', hasUpdate: true }),
      detectMethod: () => 'npm' as const,
      planStrategy: () => 'in-place' as UpdateStrategy,
    });
    await runUpdate({}, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(true);
    expect(calls.inplace).toEqual(['0.4.2']);
    expect(calls.native).toEqual([]);
  });

  test('--force 已是最新 + native → 重装，但 updated=false（版本没变）', async () => {
    const { calls, deps } = harness({
      detectMethod: () => 'native' as const,
      planStrategy: () => 'native' as UpdateStrategy,
    });
    await runUpdate({ force: true }, 'json', deps);
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false); // 版本没变
    expect(calls.native).toEqual(['0.4.2']); // 但确实重装了
  });
});

describe('runUpdate - 已是最新 + migrate：假下载器真迁移（普通文件 → symlink，经 runUpdate）', () => {
  let tmpRoot: string;
  let savedData: string | undefined;
  let savedBin: string | undefined;
  let stdoutOutput: string;
  let originalStdout: typeof process.stdout.write;

  beforeEach(() => {
    savedData = process.env.SUPSUB_DATA_DIR;
    savedBin = process.env.SUPSUB_BIN_DIR;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supsub-converge-'));
    process.env.SUPSUB_DATA_DIR = path.join(tmpRoot, 'share', 'supsub');
    process.env.SUPSUB_BIN_DIR = path.join(tmpRoot, 'bin');
    stdoutOutput = '';
    originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutOutput += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });
  afterEach(() => {
    process.stdout.write = originalStdout;
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

  test('已是最新时 update 也把 bin 位普通文件原子替换成 symlink（假下载器）', async () => {
    // 被困手装用户：native 的 symlink 位是普通文件
    const link = symlinkPath();
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(link, '#!/bin/sh\necho OLD_MANUAL\n', { mode: 0o755 });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);

    // 假下载器：不连网，产出一个可辨识的假二进制
    const fakeDownloader = async (_v: string): Promise<{ binaryPath: string; tmpDir: string }> => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supsub-fakedl-'));
      const binaryPath = path.join(tmpDir, 'supsub');
      fs.writeFileSync(binaryPath, '#!/bin/sh\necho NEW_042\n', { mode: 0o755 });
      return { binaryPath, tmpDir };
    };

    await runUpdate({}, 'json', {
      check: async () => ({ current: '0.4.2', latest: '0.4.2', hasUpdate: false }),
      detectMethod: () => 'manual',
      planStrategy: () => 'migrate-to-native',
      // 真安装动作，但下载走假下载器：装到 versions/ + 切 symlink
      installNative: async (v: string) => {
        await installNativeVersion(v, fakeDownloader);
        switchToVersion(v);
      },
      syncSkills: async () => ({ action: 'in_sync' }),
    });

    // 迁移完成：普通文件被 symlink 原子替换，指向 versions/0.4.2
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readLinkedVersion()).toBe('0.4.2');
    const d = JSON.parse(stdoutOutput).data;
    expect(d.updated).toBe(false);
    expect(d.migrated).toBe(true);
  });
});
