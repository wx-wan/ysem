import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

/**
 * 历史遗留 diff 中 Date 字段的展示修复（一次性回刷）
 * --------------------------------------------------
 * 旧版本（operation-diff 未对 Date 归一化、期望交期未配 formatter）会产生两类脏数据：
 *   1. 旧值为 Prisma 查出的 Date 对象，经 JSON.stringify 落入 beforeText → 形如 `"2026-09-28T16:00:00.000Z"`（带引号）
 *   2. 新值为前端提交的 ISO 字符串，落入 afterText → 形如 `2026-09-28T16:00:00.000Z`（不带引号）
 * 二者本是同一时刻，却显示成两种样子，且未格式化为日期。
 *
 * 本脚本扫描 OperationLog 的全部 diff（含客户相关记录，已整合进 OperationLog），对其中的 ISO 时间戳
 * （含两端多余的引号）按业务时区 Asia/Shanghai 重排为 `YYYY-MM-DD`，使其与新版日志一致。
 * 非时间戳字符串（如「空」、名称、价格）不受影响；已格式化的 `YYYY-MM-DD` 不会被二次处理（幂等）。
 */

interface DiffItemRaw {
  field?: string;
  label?: string;
  before?: unknown;
  after?: unknown;
  beforeText?: unknown;
  afterText?: unknown;
}

const ISO_DT = /^\s*"?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)"?\s*$/;

const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 若字符串是 ISO 时间戳（两端可能带引号）则重排为 YYYY-MM-DD，否则原样返回 */
function reformatIfDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const m = value.match(ISO_DT);
  if (!m) return value;
  const d = new Date(m[1]);
  if (Number.isNaN(d.getTime())) return value;
  return shanghaiDate.format(d); // e.g. 2026-09-29
}

/**
 * 处理一条 diff JSON：重排日期文本，并剔除 beforeText === afterText 的「无体感变更」条目。
 * 返回值三态（避免 null 二义性）：
 *   undefined → 无任何变化，不需要写回
 *   null      → 条目全部被剔除，应将 diff 置为 NULL
 *   string    → 重写后的新 diff JSON
 */
function fixDiffJson(raw: string | null | undefined): string | null | undefined {
  if (!raw) return undefined;
  let arr: DiffItemRaw[];
  try {
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    return undefined; // 损坏的 JSON 不处理
  }
  if (!arr.length) return undefined;

  let changed = false;
  const fixed = arr
    .map((it) => {
      const beforeText = reformatIfDate(it.beforeText);
      const afterText = reformatIfDate(it.afterText);
      if (beforeText !== it.beforeText || afterText !== it.afterText) {
        changed = true;
        return { ...it, beforeText, afterText };
      }
      return it;
    })
    // 旧 bug（Date vs 字符串误判变更）留下的「同值 → 同值」条目：用户体感无变化，剔除
    .filter((it) => {
      const keep = !(typeof it.beforeText === "string" && typeof it.afterText === "string" && it.beforeText === it.afterText);
      if (!keep) changed = true;
      return keep;
    });

  if (!changed) return undefined;
  if (!fixed.length) return null; // 全部条目被剔除 → diff 置空
  return JSON.stringify(fixed);
}

async function backfill(model: "operationLog") {
  const table = prisma.operationLog;
  const rows = await table.findMany({
    where: { diff: { not: null } },
    select: { id: true, diff: true },
  });

  let updated = 0;
  let cleared = 0;
  for (const row of rows) {
    const newDiff = fixDiffJson(row.diff as string | null);
    if (newDiff === undefined) continue;
    await table.update({ where: { id: row.id }, data: { diff: newDiff } });
    if (newDiff === null) cleared++;
    updated++;
  }
  console.log(`${model}：处理 ${updated} / ${rows.length}（其中清空 ${cleared} 条）`);
  return { updated, total: rows.length };
}

async function main() {
  await backfill("operationLog");
  console.log("diff 日期回刷完成");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
