// packages/cli/src/commands/update.ts
import type { Command } from 'commander';
import { isErrorEnvelope } from '../lib/errors.ts';
import { checkForUpdate, performUpdate } from '../lib/self-update.ts';
import { readSyncedVersion } from '../lib/skills-state.ts';
import { type SyncResult, syncSkills } from '../lib/skills-sync.ts';
import { output } from '../ui/output.ts';
import { withSpinner } from '../ui/spinner.ts';
import { printTable } from '../ui/table.ts';

/** update 命令里同步 skills 的结果（折叠进输出 / JSON 的 skills 字段） */
type SkillsOutcome =
  | { action: 'in_sync' }
  | { action: 'synced'; result: SyncResult }
  | { action: 'failed'; message: string };

/**
 * 自更新顺带把本地 skills 同步到目标版本：CLI 自更新只换二进制，skills 装在
 * ~/.claude/skills 里不会自动跟着走，这里补上同步。best-effort——skills 同步失败
 * 不影响「二进制已更新」这个既成事实，只降级为一条警告。
 */
async function runSkillsSync(targetVersion: string, force: boolean): Promise<SkillsOutcome> {
  if (!force && readSyncedVersion() === targetVersion) {
    return { action: 'in_sync' };
  }
  try {
    const result = await withSpinner(`同步 skills 到 v${targetVersion}…`, () =>
      syncSkills({ version: targetVersion }),
    );
    return { action: 'synced', result };
  } catch (err) {
    const message = isErrorEnvelope(err) ? err.message : String(err);
    return { action: 'failed', message };
  }
}

/** table 模式下，把 skills 同步结果渲染成一行提示 */
function printSkillsHint(outcome: SkillsOutcome): void {
  switch (outcome.action) {
    case 'in_sync':
      return;
    case 'synced':
      process.stdout.write(
        `✅ skills 已同步（${outcome.result.skills.length} 个 → v${outcome.result.version}）\n`,
      );
      return;
    case 'failed':
      process.stderr.write(`⚠ skills 同步失败：${outcome.message}\n`);
      process.stderr.write('  可稍后手动重试：supsub skills sync\n');
      return;
  }
}

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('检查并更新 supsub 到最新版本（自更新，含本地 skills 同步）')
    .option('--check', '只检查是否有新版本，不实际更新')
    .option('--force', '即使已是最新也重新下载安装（修复损坏的 binary）')
    .option('--skip-skills', '本次更新不同步本地 skills')
    .action(async (opts: { check?: boolean; force?: boolean; skipSkills?: boolean }) => {
      const fmt = program.opts().output as string | undefined;

      const { current, latest, hasUpdate } = await withSpinner('检查更新…', () => checkForUpdate());

      // --check：只报告，不下载、不动 skills
      if (opts.check) {
        output({ current, latest, hasUpdate, updated: false }, fmt, () => {
          printTable({
            headers: ['字段', '值'],
            rows: [
              ['当前版本', current],
              ['最新版本', latest],
              ['可更新', hasUpdate ? `是（运行 supsub update 升级到 v${latest}）` : '否'],
            ],
          });
        });
        return;
      }

      // 已最新且非强制：二进制无需动，但仍校正本地 skills（可能落后）
      if (!hasUpdate && !opts.force) {
        const skills = opts.skipSkills
          ? ({ action: 'in_sync' } as SkillsOutcome)
          : await runSkillsSync(current, false);
        output({ current, latest, hasUpdate: false, updated: false, skills }, fmt, () => {
          process.stdout.write(`✅ 已是最新版本 v${current}\n`);
          printSkillsHint(skills);
        });
        return;
      }

      // 下载并原地替换二进制
      await withSpinner(`下载并安装 v${latest}…`, () => performUpdate(latest));

      // 二进制已更新，接着把本地 skills 同步到新版本（best-effort）
      const skills = opts.skipSkills
        ? ({ action: 'in_sync' } as SkillsOutcome)
        : await runSkillsSync(latest, opts.force ?? false);

      output({ current, latest, hasUpdate, updated: true, skills }, fmt, () => {
        const from = current === latest ? `v${latest}（重新安装）` : `v${current} → v${latest}`;
        process.stdout.write(`✅ 已更新 ${from}\n`);
        printSkillsHint(skills);
      });
    });
}
