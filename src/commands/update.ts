// packages/cli/src/commands/update.ts
import type { Command } from 'commander';
import { KEEP_VERSIONS } from '../lib/auto-update.ts';
import type { ErrorEnvelope } from '../lib/errors.ts';
import { isErrorEnvelope } from '../lib/errors.ts';
import {
  detectInstallMethod,
  installNativeVersion,
  planRollback,
  pruneVersions,
  switchToVersion,
} from '../lib/install-layout.ts';
import { checkForUpdate, performUpdate } from '../lib/self-update.ts';
import { readSkillsState } from '../lib/skills-state.ts';
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
 * 项目 ./.agents/skills（或全局 ~/.claude/skills）里不会自动跟着走，这里补上同步。best-effort——skills 同步失败
 * 不影响「二进制已更新」这个既成事实，只降级为一条警告。
 */
async function runSkillsSync(targetVersion: string, force: boolean): Promise<SkillsOutcome> {
  const state = readSkillsState();
  if (!force && state?.version === targetVersion) {
    return { action: 'in_sync' };
  }
  try {
    // 沿用上次同步的范围：老用户装在哪（global / project）就同步到哪，不要把全局
    // 用户悄悄改成项目级、或反过来。从未同步过（state 为 null）则走默认 project。
    const result = await withSpinner(`同步 skills 到 v${targetVersion}…`, () =>
      syncSkills({ version: targetVersion, scope: state?.scope }),
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

/**
 * 回滚：把 native 安装的 symlink 重指到上一个留存版本（不重新下载，symlink 重指即可）。
 * 仅 native 安装支持——npm 安装没有版本并存，只能 `npm i -g @supsub/cli@<version>`。
 *
 * 「不可回滚」拆成两种如实文案（旧实现把它们混成「本地仅保留了当前版本」，在「明明留存着
 * 多个版本、只是当前已是最旧」时是**事实错误**，会让用户误以为版本目录被误删去查 prune）：
 * - `ROLLBACK_NO_HISTORY`：本地确实只有一个版本；
 * - `ROLLBACK_AT_OLDEST`：本地有多个版本，但当前已是最旧、没有更旧的可退。
 * 两种错误的 `data` 都带上留存版本列表与当前版本，JSON 调用方可据 `code`/`data` 区分。
 */
async function handleRollback(fmt: string | undefined): Promise<void> {
  const method = detectInstallMethod();
  if (method !== 'native') {
    throw {
      code: 'UPDATE_FAILED',
      message:
        '回滚仅支持 native 安装（~/.local 版本并存布局）。npm 安装请用 `npm i -g @supsub/cli@<version>` 指定版本',
      status: 0,
    } satisfies ErrorEnvelope;
  }

  const plan = planRollback();
  const list = (vs: string[]): string => vs.map((v) => `v${v}`).join(', ');

  if (plan.kind === 'only-one') {
    throw {
      code: 'ROLLBACK_NO_HISTORY',
      message: `本地只有当前版本${plan.current ? ` v${plan.current}` : ''}，没有可回滚的历史版本`,
      status: 0,
      data: { current: plan.current, installed: plan.installed },
    } satisfies ErrorEnvelope;
  }
  if (plan.kind === 'at-oldest') {
    throw {
      code: 'ROLLBACK_AT_OLDEST',
      message: `当前 v${plan.current} 已是本地最旧的留存版本，没有更旧的版本可回滚（本地留存：${list(plan.installed)}）`,
      status: 0,
      data: { current: plan.current, installed: plan.installed },
    } satisfies ErrorEnvelope;
  }

  switchToVersion(plan.target);
  output(
    { rolledBack: true, version: plan.target, from: plan.current, installed: plan.installed },
    fmt,
    () => {
      process.stdout.write(`✅ 已回滚到 v${plan.target}（symlink 已重指，下次启动生效）\n`);
    },
  );
}

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .alias('upgrade')
    .description('检查并更新 supsub 到最新版本（自更新，含本地 skills 同步）')
    .option('--check', '只检查是否有新版本，不实际更新')
    .option('--force', '即使已是最新也重新下载安装（修复损坏的 binary）')
    .option('--skip-skills', '本次更新不同步本地 skills')
    .option('--rollback', '回滚到上一个留存版本（仅 native 安装，重指 symlink，不重新下载）')
    .action(
      async (opts: {
        check?: boolean;
        force?: boolean;
        skipSkills?: boolean;
        rollback?: boolean;
      }) => {
        const fmt = program.opts().output as string | undefined;

        // --rollback：不查网络、不下载，直接重指 symlink。
        if (opts.rollback) {
          await handleRollback(fmt);
          return;
        }

        await runUpdate(opts, fmt);
      },
    );
}

/** update 主流程（检查 → 下载安装 → 同步 skills），抽出来让 rollback 分支更清晰 */
async function runUpdate(
  opts: { check?: boolean; force?: boolean; skipSkills?: boolean },
  fmt: string | undefined,
): Promise<void> {
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

  // 下载并安装二进制：
  // - native 安装：装到 versions/<latest> 再原子切 symlink，保留最近 N 个版本供回滚；
  // - npm / 其他：沿用原地暂存 + 原子 rename 覆盖（无版本并存）。
  const method = detectInstallMethod();
  await withSpinner(`下载并安装 v${latest}…`, async () => {
    if (method === 'native') {
      await installNativeVersion(latest);
      switchToVersion(latest);
      pruneVersions(KEEP_VERSIONS);
    } else {
      await performUpdate(latest);
    }
  });

  // 二进制已更新，接着把本地 skills 同步到新版本（best-effort）
  const skills = opts.skipSkills
    ? ({ action: 'in_sync' } as SkillsOutcome)
    : await runSkillsSync(latest, opts.force ?? false);

  output({ current, latest, hasUpdate, updated: true, method, skills }, fmt, () => {
    const from = current === latest ? `v${latest}（重新安装）` : `v${current} → v${latest}`;
    const suffix = method === 'native' ? '（下次启动生效）' : '';
    process.stdout.write(`✅ 已更新 ${from}${suffix}\n`);
    printSkillsHint(skills);
  });
}
