/**
 * 老数据回填 —— 同步首次合作日期
 *
 * 逻辑：取每个客户下最早订单的 orderDate，写入 customer.firstOrderDate。
 * 本脚本可用 `npx ts-node src/scripts/backfill-firstOrderDate.ts` 在 server 目录执行。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("========================================");
  console.log("  回填客户首次合作日期 (firstOrderDate)");
  console.log("========================================\n");

  // 查出所有客户
  const customers = await prisma.customer.findMany({
    select: { id: true, companyName: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const c of customers) {
    // 找到该客户最早的一条订单（按 orderDate 升序）
    const earliest = await prisma.order.findFirst({
      where: { customerId: c.id },
      orderBy: { orderDate: "asc" },
      select: { orderDate: true },
    });

    const firstDate = earliest?.orderDate || null;

    if (firstDate) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { firstOrderDate: firstDate },
      });
      updated++;
      console.log(`  ✓ ${c.companyName} → ${firstDate}`);
    } else {
      skipped++;
      console.log(`  - ${c.companyName} → 无订单，跳过`);
    }
  }

  console.log(`\n========================================`);
  console.log(`  完成：已更新 ${updated} 条，跳过 ${skipped} 条`);
  console.log(`========================================`);
}

main()
  .catch((e) => {
    console.error("❌ 回填失败：", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
