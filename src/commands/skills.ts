// packages/cli/src/commands/skills.ts
// `supsub skills` 命令组：把本仓库的 Agent Skills 同步到本地、查看同步状态、列出 skills。
// 解决「CLI / skills 发版后，用户本地 skills 没跟着更新」——sync 负责拉新，status
// 负责暴露漂移，list 负责自查。

import type { Command } from 'commander';
import { CURRENT_VERSION } from '../lib/self-update.ts';
import { checkSkillsDrift } from '../lib/skills-check.ts';
import { readSkillsState } from '../lib/skills-state.ts';
import {
  OFFICIAL_SKILLS,
  SKILL_DESCRIPTIONS,
  type SyncResult,
  syncSkills,
} from '../lib/skills-sync.ts';
import { output } from '../ui/output.ts';
import { withSpinner } from '../ui/spinner.ts';
import { printTable } from '../ui/table.ts';

function globalFmt(group: Command): string | undefined {
  return group.parent?.opts().output as string | undefined;
}

/** supsub skills sync —— 同步本地 skills 到当前 CLI 版本 */
function registerSkillsSync(group: Command): void {
  group
    .command('sync')
    .description('把本仓库的 skills 同步/更新到本地 agent 配置')
    .option(
      '--global',
      '安装到全局（~/.claude/skills，对所有项目可见），默认仅装到当前项目（./.agents/skills）',
    )
    .option('--force', '即使本地已是当前版本也重新同步')
    .action(async (opts: { global?: boolean; force?: boolean }) => {
      const fmt = globalFmt(group);
      const scope = opts.global ? 'global' : 'project';

      // 已同步且非强制：直接告知，省去一次 npx 子进程
      const state = readSkillsState();
      const alreadySynced =
        !opts.force &&
        state !== null &&
        state.version === CURRENT_VERSION &&
        state.scope === scope &&
        state.skills.length > 0;

      if (alreadySynced) {
        output({ synced: false, upToDate: true, version: CURRENT_VERSION, scope }, fmt, () => {
          process.stdout.write(`✅ 本地 skills 已是最新 v${CURRENT_VERSION}（${scope}）\n`);
        });
        return;
      }

      const result = await withSpinner(`同步 skills 到 v${CURRENT_VERSION}…`, () =>
        syncSkills({ scope, version: CURRENT_VERSION }),
      );

      output(
        { synced: true, upToDate: false, ...result },
        fmt,
        (r: SyncResult & { synced: boolean }) => {
          process.stdout.write(
            `✅ 已同步 ${r.skills.length} 个 skills 到 v${r.version}（${r.scope}）：${r.skills.join(', ')}\n`,
          );
        },
      );
    });
}

/** supsub skills status —— 查看本地同步版本 vs 当前 CLI 版本，是否漂移 */
function registerSkillsStatus(group: Command): void {
  group
    .command('status')
    .description('查看本地 skills 同步状态（是否与当前 CLI 版本一致）')
    .action(() => {
      const fmt = globalFmt(group);
      const state = readSkillsState();
      const drift = checkSkillsDrift();
      const inSync = state !== null && state.version === CURRENT_VERSION;

      const data = {
        cliVersion: CURRENT_VERSION,
        syncedVersion: state?.version ?? null,
        scope: state?.scope ?? null,
        syncedAt: state?.syncedAt ?? null,
        inSync,
        drift: drift !== null,
      };

      output(data, fmt, (d) => {
        printTable({
          headers: ['字段', '值'],
          rows: [
            ['CLI 版本', d.cliVersion],
            ['本地 skills 版本', d.syncedVersion ?? '（从未通过 supsub 同步）'],
            ['安装范围', d.scope ?? '-'],
            ['同步时间', d.syncedAt ?? '-'],
            [
              '状态',
              d.syncedVersion === null
                ? '未同步（运行 supsub skills sync）'
                : d.inSync
                  ? '✅ 已同步'
                  : `⚠ 落后，运行 supsub skills sync 升级到 v${d.cliVersion}`,
            ],
          ],
        });
      });
    });
}

/** supsub skills list —— 列出本仓库提供的 skills */
function registerSkillsList(group: Command): void {
  group
    .command('list')
    .description('列出本仓库提供的 skills')
    .action(() => {
      const fmt = globalFmt(group);
      const data = OFFICIAL_SKILLS.map((name) => ({
        name,
        description: SKILL_DESCRIPTIONS[name] ?? '',
      }));
      output(data, fmt, (rows) => {
        printTable({
          headers: ['skill', '说明'],
          rows: rows.map((r) => [r.name, r.description]),
          columnWidths: [18, 48],
        });
        process.stdout.write(`(${rows.length} skills)\n`);
      });
    });
}

export function registerSkills(program: Command): void {
  const group = program.command('skills').description('Agent Skills 同步与查看');
  registerSkillsSync(group);
  registerSkillsStatus(group);
  registerSkillsList(group);
}
