/**
 * 一次性数据清理脚本：将 SalesPipeline.probability 由旧的数值(%)转换为采购意向文案。
 * 等级映射（与前端 intentLevel.ts 保持一致）：
 *   >=90 => 准成交(A)，>=60 => 高意向(B)，>=30 => 中意向(C)，其余 => 低意向(D)
 * 已为文案(准成交/高意向/中意向/低意向)或空值保持不变。
 *
 * 运行：npm run cleanup:probability
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LABELS = ['准成交', '高意向', '中意向', '低意向'] as const;
type Label = (typeof LABELS)[number];

function toLabel(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const v = raw.trim();
    if (v === '') return null;
    if ((LABELS as readonly string[]).includes(v)) return v; // 已是文案
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return gradeFromNumber(n);
  }
  if (typeof raw === 'number') return gradeFromNumber(raw);
  return null;
}

function gradeFromNumber(n: number): Label {
  if (n >= 90) return '准成交';
  if (n >= 60) return '高意向';
  if (n >= 30) return '中意向';
  return '低意向';
}

async function main() {
  const rows = await prisma.salesPipeline.findMany({
    select: { id: true, probability: true },
  });

  let updated = 0;
  for (const row of rows) {
    const next = toLabel(row.probability);
    // probability 现已是 String?：原数值会被读出为 number 或 string
    const current = (row.probability as unknown) as number | string | null;
    const same =
      current == null
        ? next == null
        : (LABELS as readonly string[]).includes(String(current)) && String(current) === next;
    if (same) continue;
    await prisma.salesPipeline.update({
      where: { id: row.id },
      data: { probability: next },
    });
    updated += 1;
  }

  console.log(`[cleanup-probability] 共 ${rows.length} 条，已更新 ${updated} 条。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
