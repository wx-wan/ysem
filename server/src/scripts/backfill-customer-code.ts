import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function datePart(d: Date): string {
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function main() {
  // 按创建时间升序取出所有无编号的客户
  const customers = await prisma.customer.findMany({
    where: { customerCode: null },
    orderBy: { createdAt: "asc" },
  });

  // 按创建日期累计序号
  const seqByDate: Record<string, number> = {};

  let updated = 0;
  for (const c of customers) {
    const dp = datePart(c.createdAt);
    seqByDate[dp] = (seqByDate[dp] || 0) + 1;
    const code = `CUS-${dp}-${seqByDate[dp]}`;
    try {
      await prisma.customer.update({ where: { id: c.id }, data: { customerCode: code } });
      updated++;
    } catch (err) {
      console.error(`跳过 ${c.id}（可能编号冲突）:`, err);
    }
  }

  console.log(`已补录客户编号：${updated} / ${customers.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
