// commands/doctor：json 输出的字段形态。测试环境下（bun 跑源码）安装方式判为 dev，
// 故 native 相关字段为空/缺省；重点校验版本、安装方式、自动更新通道、skills 三块存在。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerDoctor } from '../../src/commands/doctor.ts';
import { CURRENT_VERSION } from '../../src/lib/self-update.ts';

describe('commands/doctor - json 输出', () => {
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
    registerDoctor(program);
    return program;
  }

  test('doctor --output json → 含版本 / 安装方式 / 自动更新 / skills', async () => {
    const program = buildProgram();
    await program.parseAsync(['node', 'supsub', '--output', 'json', 'doctor']);
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.success).toBe(true);
    expect(parsed.data.version).toBe(CURRENT_VERSION);
    expect(['native', 'npm', 'dev']).toContain(parsed.data.installMethod);
    expect(typeof parsed.data.realBinary).toBe('string');
    // 自动更新块：默认通道 latest
    expect(parsed.data.autoUpdate.channel).toBe('latest');
    expect(parsed.data.autoUpdate).toHaveProperty('lastCheck');
    expect(parsed.data.autoUpdate).toHaveProperty('lastResult');
    // skills 块
    expect(parsed.data.skills).toHaveProperty('syncedVersion');
    expect(parsed.data).toHaveProperty('installedVersions');
  });
});
