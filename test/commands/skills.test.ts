// commands/skills + lib/skills-state + lib/skills-check + lib/skills-sync：
// 状态文件读写、漂移检测（含跳过规则）、syncSkills（注入 fake runner）、命令路径。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { registerSkills } from '../../src/commands/skills.ts';
import { CURRENT_VERSION } from '../../src/lib/self-update.ts';
import {
  checkSkillsDrift,
  formatDriftNotice,
  shouldSkipSkillsCheck,
} from '../../src/lib/skills-check.ts';
import {
  readSkillsState,
  readSyncedVersion,
  skillsStatePath,
  writeSkillsState,
} from '../../src/lib/skills-state.ts';
import {
  buildSkillsAddArgs,
  OFFICIAL_SKILLS,
  type SyncRunner,
  setSkillsSyncRunner,
  syncSkills,
} from '../../src/lib/skills-sync.ts';

/** 删掉状态文件，保证每个用例从「未同步」干净起步（tmp 配置目录全测试共享） */
function clearState(): void {
  try {
    fs.rmSync(skillsStatePath(), { force: true });
  } catch {
    /* ignore */
  }
}

/** 临时清空会触发跳过的 env，让漂移检测在 CI 里也能确定性地跑 */
function withDriftEnabled<T>(fn: () => T): T {
  const saved = {
    CI: process.env.CI,
    CONTINUOUS_INTEGRATION: process.env.CONTINUOUS_INTEGRATION,
    SUPSUB_NO_SKILLS_NOTIFIER: process.env.SUPSUB_NO_SKILLS_NOTIFIER,
  };
  delete process.env.CI;
  delete process.env.CONTINUOUS_INTEGRATION;
  delete process.env.SUPSUB_NO_SKILLS_NOTIFIER;
  try {
    return fn();
  } finally {
    if (saved.CI !== undefined) process.env.CI = saved.CI;
    if (saved.CONTINUOUS_INTEGRATION !== undefined)
      process.env.CONTINUOUS_INTEGRATION = saved.CONTINUOUS_INTEGRATION;
    if (saved.SUPSUB_NO_SKILLS_NOTIFIER !== undefined)
      process.env.SUPSUB_NO_SKILLS_NOTIFIER = saved.SUPSUB_NO_SKILLS_NOTIFIER;
  }
}

beforeEach(() => {
  clearState();
  setSkillsSyncRunner(undefined);
});
afterEach(() => {
  clearState();
  setSkillsSyncRunner(undefined);
});

describe('lib/skills-state - 读写往返', () => {
  test('writeSkillsState → readSkillsState 往返一致', () => {
    writeSkillsState({
      version: '0.3.0',
      skills: ['supsub-auth', 'supsub-sub'],
      scope: 'global',
      syncedAt: '2026-06-29T00:00:00.000Z',
    });
    const state = readSkillsState();
    expect(state).not.toBeNull();
    expect(state?.version).toBe('0.3.0');
    expect(state?.skills).toEqual(['supsub-auth', 'supsub-sub']);
    expect(state?.scope).toBe('global');
    expect(readSyncedVersion()).toBe('0.3.0');
  });

  test('无文件 → readSkillsState 返回 null', () => {
    expect(readSkillsState()).toBeNull();
    expect(readSyncedVersion()).toBeNull();
  });

  test('损坏 JSON → 返回 null', () => {
    fs.writeFileSync(skillsStatePath(), '{ not json', 'utf-8');
    expect(readSkillsState()).toBeNull();
  });
});

describe('lib/skills-check - 漂移检测', () => {
  test('无状态（冷启动）→ 不提示', () => {
    withDriftEnabled(() => {
      expect(checkSkillsDrift(CURRENT_VERSION)).toBeNull();
    });
  });

  test('已同步版本与当前一致 → 不提示', () => {
    writeSkillsState({
      version: CURRENT_VERSION,
      skills: ['supsub-auth'],
      scope: 'global',
      syncedAt: '2026-06-29T00:00:00.000Z',
    });
    withDriftEnabled(() => {
      expect(checkSkillsDrift(CURRENT_VERSION)).toBeNull();
    });
  });

  test('已同步版本落后 → 返回漂移信息', () => {
    writeSkillsState({
      version: '0.1.0',
      skills: ['supsub-auth'],
      scope: 'global',
      syncedAt: '2026-06-29T00:00:00.000Z',
    });
    withDriftEnabled(() => {
      const drift = checkSkillsDrift('0.3.2');
      expect(drift).not.toBeNull();
      expect(drift?.current).toBe('0.1.0');
      expect(drift?.target).toBe('0.3.2');
      expect(formatDriftNotice(drift as { current: string; target: string })).toContain(
        'supsub skills sync',
      );
    });
  });

  test('v 前缀归一化：v0.3.2 == 0.3.2 → 不提示', () => {
    writeSkillsState({
      version: 'v0.3.2',
      skills: ['supsub-auth'],
      scope: 'global',
      syncedAt: '2026-06-29T00:00:00.000Z',
    });
    withDriftEnabled(() => {
      expect(checkSkillsDrift('0.3.2')).toBeNull();
    });
  });

  test('SUPSUB_NO_SKILLS_NOTIFIER 真值 → 跳过', () => {
    const saved = process.env.SUPSUB_NO_SKILLS_NOTIFIER;
    process.env.SUPSUB_NO_SKILLS_NOTIFIER = '1';
    try {
      expect(shouldSkipSkillsCheck('0.3.2')).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.SUPSUB_NO_SKILLS_NOTIFIER;
      else process.env.SUPSUB_NO_SKILLS_NOTIFIER = saved;
    }
  });

  test('CI 环境 → 跳过', () => {
    const saved = process.env.CI;
    process.env.CI = 'true';
    try {
      expect(shouldSkipSkillsCheck('0.3.2')).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CI;
      else process.env.CI = saved;
    }
  });

  test('空 / 0.0.0 版本 → 跳过', () => {
    withDriftEnabled(() => {
      expect(shouldSkipSkillsCheck('')).toBe(true);
      expect(shouldSkipSkillsCheck('0.0.0')).toBe(true);
    });
  });
});

describe('lib/skills-sync - buildSkillsAddArgs', () => {
  test('global 带 -g，project 不带', () => {
    const g = buildSkillsAddArgs('global');
    expect(g[0]).toBe('-y');
    expect(g).toContain('skills');
    expect(g).toContain('add');
    expect(g).toContain('-g');
    const p = buildSkillsAddArgs('project');
    expect(p).not.toContain('-g');
  });
});

describe('lib/skills-sync - syncSkills（注入 fake runner）', () => {
  test('成功 → 写状态并返回结果', async () => {
    let calledArgs: string[] = [];
    const runner: SyncRunner = async (args) => {
      calledArgs = args;
      return { stdout: 'Added 5 skills', stderr: '' };
    };
    setSkillsSyncRunner(runner);
    const result = await syncSkills(
      { version: '0.9.0', scope: 'global' },
      () => new Date('2026-06-29T12:00:00.000Z'),
    );
    expect(result.version).toBe('0.9.0');
    expect(result.scope).toBe('global');
    expect(result.skills).toEqual([...OFFICIAL_SKILLS]);
    expect(calledArgs).toContain('-g');
    // 状态已落盘
    const state = readSkillsState();
    expect(state?.version).toBe('0.9.0');
    expect(state?.syncedAt).toBe('2026-06-29T12:00:00.000Z');
  });

  test('npx 缺失（ENOENT）→ 抛 SKILLS_TOOL_NOT_FOUND，不写状态', async () => {
    const runner: SyncRunner = async () => {
      const err = new Error('spawn npx ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    setSkillsSyncRunner(runner);
    let caught: unknown;
    try {
      await syncSkills({ version: '0.9.0' });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code: string }).code).toBe('SKILLS_TOOL_NOT_FOUND');
    expect(readSkillsState()).toBeNull();
  });
});

describe('commands/skills - 命令路径（mock runner，捕获 stdout）', () => {
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

  function buildProgram(): Command {
    const program = new Command();
    program
      .name('supsub')
      .option('-o, --output <fmt>', '输出格式：table|json', 'table')
      .exitOverride();
    registerSkills(program);
    return program;
  }

  test('skills list --output json → 5 个 skill', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'skills', 'list']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.length).toBe(OFFICIAL_SKILLS.length);
    expect(parsed.data.map((s: { name: string }) => s.name)).toEqual([...OFFICIAL_SKILLS]);
  });

  test('skills status --output json → 未同步时 syncedVersion=null', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'skills', 'status']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.data.cliVersion).toBe(CURRENT_VERSION);
    expect(parsed.data.syncedVersion).toBeNull();
    expect(parsed.data.inSync).toBe(false);
  });

  test('skills sync --output json（注入 runner）→ 默认 project 范围、synced=true 并写状态', async () => {
    let calledArgs: string[] | null = null;
    setSkillsSyncRunner(async (args) => {
      calledArgs = args;
      return { stdout: 'ok', stderr: '' };
    });
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'skills', 'sync']);
    const parsed = JSON.parse(stdoutOutput);
    expect(calledArgs).not.toBeNull();
    // 默认不带 -g：仅装到当前项目，不污染全局
    expect(calledArgs as unknown as string[]).not.toContain('-g');
    expect(parsed.data.synced).toBe(true);
    expect(parsed.data.scope).toBe('project');
    expect(parsed.data.version).toBe(CURRENT_VERSION);
    expect(readSkillsState()?.scope).toBe('project');
    expect(readSyncedVersion()).toBe(CURRENT_VERSION);
  });

  test('skills sync --global → 带 -g、范围 global', async () => {
    let calledArgs: string[] | null = null;
    setSkillsSyncRunner(async (args) => {
      calledArgs = args;
      return { stdout: 'ok', stderr: '' };
    });
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'skills', 'sync', '--global']);
    const parsed = JSON.parse(stdoutOutput);
    expect(calledArgs as unknown as string[]).toContain('-g');
    expect(parsed.data.scope).toBe('global');
    expect(readSkillsState()?.scope).toBe('global');
  });

  test('skills sync 已是最新（非 force）→ 跳过 runner，upToDate=true', async () => {
    writeSkillsState({
      version: CURRENT_VERSION,
      skills: [...OFFICIAL_SKILLS],
      // 默认范围为 project：状态需与默认 scope 一致才算「已是最新」可跳过
      scope: 'project',
      syncedAt: '2026-06-29T00:00:00.000Z',
    });
    let called = false;
    setSkillsSyncRunner(async () => {
      called = true;
      return { stdout: 'ok', stderr: '' };
    });
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'skills', 'sync']);
    const parsed = JSON.parse(stdoutOutput);
    expect(called).toBe(false);
    expect(parsed.data.upToDate).toBe(true);
  });
});
