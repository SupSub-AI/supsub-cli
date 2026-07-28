// packages/cli/src/commands/doctor.ts
// `supsub doctor`：安装 / 更新自检入口。静默后台自动更新必须配一个可查证的出口——
// 出了问题（没升级、升级失败、PATH 不对）用户能一眼看清「装的是哪种、真实路径在哪、
// symlink 指向谁、本地留了哪些版本、上次检查时间与结果、~/.local/bin 在不在 PATH、
// skills 同步状态」。遵循 output() 双模式：json 给 agent 解析，table 给人看。

import type { Command } from 'commander';
import { readConfig } from '../config/store.ts';
import { channelFromConfig } from '../lib/auto-update.ts';
import { formatDate } from '../lib/format-date.ts';
import {
  detectInstallMethod,
  getBinDir,
  type InstallMethod,
  isBinDirOnPath,
  listInstalledVersions,
  readLinkedVersion,
  symlinkPath,
} from '../lib/install-layout.ts';
import { CURRENT_VERSION, resolveRealBinary } from '../lib/self-update.ts';
import { checkSkillsDrift } from '../lib/skills-check.ts';
import { readSkillsState } from '../lib/skills-state.ts';
import { readUpdateState } from '../lib/update-state.ts';
import { output } from '../ui/output.ts';
import { printTable } from '../ui/table.ts';

/** 安装方式的中文说明 */
function describeMethod(method: InstallMethod): string {
  switch (method) {
    case 'native':
      return 'native（~/.local 版本并存，自动更新）';
    case 'npm':
      return 'npm（包管理器全局目录，手动更新）';
    case 'dev':
      return 'dev（bun 跑源码）';
    case 'manual':
      return 'manual（手装独立二进制，手动更新；若在 ~/.local/bin 下次 supsub update 会自动迁到 native）';
  }
}

/** 把上次更新结果压成一行人类可读文案 */
function describeLastResult(result: ReturnType<typeof readUpdateState>['lastResult']): string {
  if (!result) return '（尚无记录）';
  const at = result.at ? formatDate(result.at) : '';
  switch (result.outcome) {
    case 'updated':
      return `已更新 v${result.from} → v${result.to}（${at}）`;
    case 'up-to-date':
      return `已是最新 v${result.latest ?? CURRENT_VERSION}（${at}）`;
    case 'gated':
      return `有新版 v${result.latest} 但被门限拦下：${result.reason}（${at}）`;
    case 'failed':
      return `失败：${result.reason ?? '未知原因'}（${at}）`;
  }
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('安装 / 更新自检：版本、安装方式、symlink、留存版本、上次更新检查、PATH、skills')
    .action(async () => {
      const fmt = program.opts().output as string | undefined;

      const realBinary = resolveRealBinary();
      const method = detectInstallMethod(realBinary);
      const isNative = method === 'native';
      const binDir = getBinDir();
      const link = isNative ? symlinkPath() : null;
      const linkTarget = isNative ? readLinkedVersion() : null;
      const installedVersions = isNative ? listInstalledVersions() : [];
      const onPath = isNative ? isBinDirOnPath(binDir) : null;

      const updateState = readUpdateState();
      const cfg = await readConfig();
      const channel = channelFromConfig(cfg);

      const skillsState = readSkillsState();
      const drift = checkSkillsDrift();

      const data = {
        version: CURRENT_VERSION,
        realBinary,
        installMethod: method,
        symlink: link,
        symlinkVersion: linkTarget,
        installedVersions,
        binDir,
        binDirOnPath: onPath,
        autoUpdate: {
          channel,
          minimumVersion: cfg.minimumVersion ?? null,
          disabled: Boolean(process.env.SUPSUB_DISABLE_AUTOUPDATER),
          lastCheck: updateState.lastCheck,
          lastResult: updateState.lastResult,
        },
        skills: {
          syncedVersion: skillsState?.version ?? null,
          scope: skillsState?.scope ?? null,
          syncedAt: skillsState?.syncedAt ?? null,
          drift: drift !== null,
        },
      };

      output(data, fmt, (d) => {
        const rows: (string | number | boolean)[][] = [
          ['当前版本', `v${d.version}`],
          ['真实路径', d.realBinary],
          ['安装方式', describeMethod(d.installMethod)],
        ];
        if (isNative) {
          rows.push(['symlink', d.symlink ?? '-']);
          rows.push(['symlink 指向', d.symlinkVersion ? `v${d.symlinkVersion}` : '（未建立）']);
          rows.push([
            '留存版本',
            d.installedVersions.length
              ? d.installedVersions.map((v) => `v${v}`).join(', ')
              : '（无）',
          ]);
          rows.push([`${d.binDir} 在 PATH`, d.binDirOnPath ? '✅ 是' : '⚠ 否（需手动加入 PATH）']);
        }
        rows.push(['自动更新通道', d.autoUpdate.channel]);
        if (d.autoUpdate.minimumVersion)
          rows.push(['最低版本门限', `v${d.autoUpdate.minimumVersion}`]);
        rows.push([
          '后台自动更新',
          d.installMethod === 'native'
            ? d.autoUpdate.disabled
              ? '已被 SUPSUB_DISABLE_AUTOUPDATER 关闭'
              : '开启'
            : '不适用（仅 native 安装）',
        ]);
        rows.push([
          '上次检查时间',
          d.autoUpdate.lastCheck ? formatDate(d.autoUpdate.lastCheck) : '（从未检查）',
        ]);
        rows.push(['上次更新结果', describeLastResult(d.autoUpdate.lastResult)]);
        rows.push([
          'skills 同步',
          d.skills.syncedVersion === null
            ? '未通过 supsub 同步'
            : d.skills.drift
              ? `⚠ 落后（本地 v${d.skills.syncedVersion}，运行 supsub skills sync）`
              : `✅ v${d.skills.syncedVersion}`,
        ]);
        printTable({ headers: ['项目', '值'], rows, columnWidths: [20, 56] });
      });
    });
}
