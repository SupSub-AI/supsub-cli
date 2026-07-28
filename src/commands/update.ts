// packages/cli/src/commands/update.ts
import type { Command } from 'commander';
import { KEEP_VERSIONS } from '../lib/auto-update.ts';
import type { ErrorEnvelope } from '../lib/errors.ts';
import { isErrorEnvelope } from '../lib/errors.ts';
import {
  detectInstallMethod,
  type InstallMethod,
  installNativeVersion,
  planRollback,
  planUpdateStrategy,
  pruneVersions,
  switchToVersion,
  type UpdateStrategy,
} from '../lib/install-layout.ts';
import { checkForUpdate, performUpdate, type UpdateCheck } from '../lib/self-update.ts';
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

/**
 * update 的动作决策（纯函数，便于单测钉死行为矩阵）。输入三个已知量，输出「是否要动
 * 二进制 + 是否走 native 安装路径 + 是否构成 manual→native 迁移」。
 *
 * 0.4.3 收敛点：被困手装用户（`strategy === 'migrate-to-native'`）**即使已是最新、未加
 * `--force` 也要执行一次安装以完成迁移**——让「跑一次 update 必上 native 轨道」成立。
 * 而 native / npm / dev 在已是最新且非 `--force` 时一律 `doBinaryWork=false`（走早退、只
 * 校正 skills），绝不让普通用户每次 update 都产生下载。
 */
export type UpdateAction = {
  /** 是否需要下载 / 安装二进制（false = 走「已是最新」早退，仅校正本地 skills） */
  doBinaryWork: boolean;
  /** 走 native 安装路径（装到 versions/ + 切 symlink）还是原地覆盖 */
  goesNative: boolean;
  /** 本次是否构成「manual → native」的布局迁移 */
  migrated: boolean;
};

export function decideUpdateAction(input: {
  hasUpdate: boolean;
  force: boolean;
  strategy: UpdateStrategy;
}): UpdateAction {
  const { hasUpdate, force, strategy } = input;
  const migrated = strategy === 'migrate-to-native';
  const goesNative = strategy === 'native' || strategy === 'migrate-to-native';
  // 需要动二进制的三种情形：有新版本 / 强制重装 / 被困手装用户需迁移（即使已是最新）。
  const doBinaryWork = hasUpdate || force || migrated;
  return { doBinaryWork, goesNative, migrated };
}

/** runUpdate 的可注入依赖（默认接真实实现；测试注入 fake，不连网、不落真实文件） */
export type RunUpdateDeps = {
  /** 查最新版本（默认 checkForUpdate 查 npm registry） */
  check?: () => Promise<UpdateCheck>;
  /** 判定迁移前的安装方式（默认 detectInstallMethod，读运行中的真实二进制） */
  detectMethod?: () => InstallMethod;
  /** 安装策略（默认 planUpdateStrategy，读运行中的真实二进制 + symlink 位） */
  planStrategy?: () => UpdateStrategy;
  /** native 安装动作：装到 versions/ + 切 symlink + 清理旧版（默认真实实现） */
  installNative?: (version: string) => Promise<void>;
  /** 原地覆盖动作（默认 performUpdate） */
  performInPlace?: (version: string) => Promise<unknown>;
  /** skills 同步（默认 runSkillsSync） */
  syncSkills?: (version: string, force: boolean) => Promise<SkillsOutcome>;
};

/** native 安装路径的默认动作：装到 versions/<latest> → 原子切 symlink → 清理旧版本。 */
async function defaultInstallNative(version: string): Promise<void> {
  // 下载 + 落盘（installNativeVersion）全部成功后，才用 switchToVersion 原子换 symlink。
  // 迁移场景下 symlink 位当前是普通文件，rename 会原子地用 symlink 覆盖它；中途任一步
  // 失败都发生在换 symlink 之前，那个普通文件原样健在（不会出现半残）。
  await installNativeVersion(version);
  switchToVersion(version);
  pruneVersions(KEEP_VERSIONS);
}

/** update 主流程（检查 → 决策 → 下载安装 → 同步 skills），抽出来让 rollback 分支更清晰 */
export async function runUpdate(
  opts: { check?: boolean; force?: boolean; skipSkills?: boolean },
  fmt: string | undefined,
  deps: RunUpdateDeps = {},
): Promise<void> {
  const check = deps.check ?? checkForUpdate;
  const detectMethod = deps.detectMethod ?? detectInstallMethod;
  const planStrategy = deps.planStrategy ?? planUpdateStrategy;
  const installNative = deps.installNative ?? defaultInstallNative;
  const performInPlace = deps.performInPlace ?? performUpdate;
  const doSkillsSync = deps.syncSkills ?? runSkillsSync;

  const { current, latest, hasUpdate } = await withSpinner('检查更新…', () => check());

  // --check：只读语义——任何情况下都不下载、不迁移、不动 skills（在算 strategy 之前就返回，
  // 结构上保证 --check 永不触发迁移）。
  if (opts.check) {
    output({ current, latest, hasUpdate, updated: false, migrated: false }, fmt, () => {
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

  // 安装策略与动作决策必须在「已是最新早退」之前算出：被困手装用户即使已是最新也要迁移收敛。
  const method = detectMethod(); // 迁移前的安装方式（JSON 里如实报告，manual 会显示 manual）
  const strategy = planStrategy();
  const { doBinaryWork, goesNative, migrated } = decideUpdateAction({
    hasUpdate,
    force: opts.force ?? false,
    strategy,
  });

  // 无需动二进制（已是最新、非 --force、且非待迁移）：二进制不动，只校正本地 skills（可能落后）。
  // native / npm / dev 的快路径由此保持——绝不产生下载。
  if (!doBinaryWork) {
    const skills = opts.skipSkills
      ? ({ action: 'in_sync' } as SkillsOutcome)
      : await doSkillsSync(current, false);
    output(
      {
        current,
        latest,
        hasUpdate: false,
        updated: false,
        method,
        strategy,
        migrated: false,
        skills,
      },
      fmt,
      () => {
        process.stdout.write(`✅ 已是最新版本 v${current}\n`);
        printSkillsHint(skills);
      },
    );
    return;
  }

  // 下载并安装二进制。目标版本 = latest（已是最新但要迁移 / --force 重装时 latest === current）。
  // 安装动作由 strategy 决定（见 install-layout.planUpdateStrategy）：
  // - native / migrate-to-native：走 native 路径（装到 versions/ 再原子切 symlink）；迁移场景
  //   下 symlink 位当前是普通文件，会被 symlink 原子替换，一次性迁到版本并存布局；
  // - in-place：npm / 手拷到别处的 manual——原地暂存 + 原子 rename 覆盖（无版本并存）。
  await withSpinner(`下载并安装 v${latest}…`, async () => {
    if (goesNative) {
      await installNative(latest);
    } else {
      await performInPlace(latest);
    }
  });

  // 二进制已更新，接着把本地 skills 同步到目标版本（best-effort）
  const skills = opts.skipSkills
    ? ({ action: 'in_sync' } as SkillsOutcome)
    : await doSkillsSync(latest, opts.force ?? false);

  // 输出语义诚实：`updated` = 版本是否变化（current → latest）；`migrated` = 布局是否变化。
  // 两者独立——被困手装用户在已是最新时迁移，updated=false 而 migrated=true。
  output(
    { current, latest, hasUpdate, updated: hasUpdate, method, strategy, migrated, skills },
    fmt,
    () => {
      if (migrated && !hasUpdate) {
        // 版本没变但布局变了：已是最新，同时完成了 manual → native 的迁移。
        process.stdout.write(
          `✅ 已是最新（v${current}），已迁移到 native 布局（版本并存 + 可回滚），后台自动更新自此生效（下次启动）\n`,
        );
      } else {
        const from = hasUpdate ? `v${current} → v${latest}` : `v${latest}（重新安装）`;
        const suffix = goesNative ? '（下次启动生效）' : '';
        process.stdout.write(`✅ 已更新 ${from}${suffix}\n`);
        if (migrated) {
          process.stdout.write(
            '📦 已迁移到 native 布局（版本并存 + 可回滚），后台自动更新自此生效（下次启动）\n',
          );
        }
      }
      printSkillsHint(skills);
    },
  );
}
