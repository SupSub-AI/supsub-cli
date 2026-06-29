// packages/cli/src/commands/sub/add.ts
import type { Command } from 'commander';
import { addMp } from '../../api/mp.ts';
import { addSub } from '../../api/subscription.ts';
import type { ErrorEnvelope } from '../../lib/errors.ts';
import { output } from '../../ui/output.ts';
import { withSpinner } from '../../ui/spinner.ts';
import { printTable } from '../../ui/table.ts';
import { normalizeType, parseSourceId } from './_args.ts';

export function registerSubAdd(parent: Command): void {
  parent
    .command('add')
    .description('添加订阅')
    .option('--source-id <id>', '信息源 ID（与 --mp-id 二选一；走全站搜索得到的内部 sourceId）')
    .option(
      '--mp-id <mpId>',
      '公众号 mpId（与 --source-id 二选一；走 mp search 拿到的微信原生 ID）',
    )
    .option(
      '--type <type>',
      '信息源类型：MP|WEBSITE|X（X=推特）。配合 --source-id 必填；配合 --mp-id 可省略，默认 MP',
    )
    .option(
      '--group <gid>',
      '分组 ID（可多次指定）',
      (val: string, prev: string[]) => {
        return [...(prev ?? []), val];
      },
      [] as string[],
    )
    .action(async (opts: { sourceId?: string; mpId?: string; type?: string; group: string[] }) => {
      const globalOpts = (parent.parent?.opts() ?? {}) as { output?: string };
      const fmt = globalOpts.output;

      if (!opts.sourceId && !opts.mpId) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '必须指定 --source-id 或 --mp-id 之一',
        } satisfies ErrorEnvelope;
      }
      if (opts.sourceId && opts.mpId) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '--source-id 与 --mp-id 互斥，仅能指定一个',
        } satisfies ErrorEnvelope;
      }

      const groupIds = opts.group && opts.group.length > 0 ? opts.group.map(Number) : undefined;
      if (groupIds?.some(Number.isNaN)) {
        throw {
          code: 'INVALID_ARGS',
          status: 0,
          message: '--group 必须是有效的数字',
        } satisfies ErrorEnvelope;
      }

      const data = await withSpinner('提交订阅…', () =>
        opts.mpId
          ? runMpIdPath(opts.mpId, opts.type, groupIds)
          : runSourceIdPath(opts.sourceId as string, opts.type, groupIds),
      );

      output({ message: data.message }, fmt, (d) => {
        printTable({
          headers: ['结果'],
          rows: [[d.message]],
        });
      });
    });
}

async function runMpIdPath(
  mpId: string,
  rawType: string | undefined,
  groupIds: number[] | undefined,
): Promise<{ message: string }> {
  if (rawType !== undefined) {
    const sourceType = normalizeType(rawType);
    if (sourceType !== 'MP') {
      throw {
        code: 'INVALID_ARGS',
        status: 0,
        message: '--mp-id 仅支持 --type MP',
      } satisfies ErrorEnvelope;
    }
  }
  return addMp({
    mpId,
    ...(groupIds ? { groupIds } : {}),
  });
}

async function runSourceIdPath(
  rawSourceId: string,
  rawType: string | undefined,
  groupIds: number[] | undefined,
): Promise<{ message: string }> {
  if (!rawType) {
    throw {
      code: 'INVALID_ARGS',
      status: 0,
      message: '--source-id 必须配合 --type 使用',
    } satisfies ErrorEnvelope;
  }
  const sourceType = normalizeType(rawType);
  const sourceId = parseSourceId(rawSourceId);
  return addSub({
    sourceType,
    sourceId,
    ...(groupIds ? { groupIds } : {}),
  });
}
