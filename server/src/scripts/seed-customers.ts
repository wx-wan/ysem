import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 先查找第一个用户作为 owner（测试数据归属）
  const firstUser = await prisma.user.findFirst({ where: { status: "ACTIVE" } });
  const ownerId = firstUser?.id || undefined;

  const customers = [
    {
      companyName: "Global Home Solutions",
      contactName: "Michael Chen",
      email: "mchen@globalhome.com",
      phone: "+1 312 555 0192",
      country: "美国",
      tags: "战略客户,年框协议,亚马逊",
      isKeyAccount: true,
      intentLevel: "READY" as const,
      ownerId,
    },
    {
      companyName: "Nordic Living AB",
      contactName: "Erik Lindström",
      email: "erik@nordicliving.se",
      phone: "+46 8 555 0234",
      country: "瑞典",
      tags: "战略客户,北欧市场",
      isKeyAccount: true,
      intentLevel: "READY" as const,
      ownerId,
    },
    {
      companyName: "Maison Beauté SARL",
      contactName: "Sophie Dupont",
      email: "sdupont@maisonbeaute.fr",
      phone: "+33 1 55 00 12 34",
      country: "法国",
      tags: "高端品牌,定制包装",
      isKeyAccount: false,
      intentLevel: "HIGH" as const,
      ownerId,
    },
    {
      companyName: "LifeSpace Japan Co.",
      contactName: "田中一郎",
      email: "tanaka@lifespace.jp",
      phone: "+81 3 5555 0123",
      country: "日本",
      tags: "品质严格,JIS标准",
      isKeyAccount: true,
      intentLevel: "READY" as const,
      ownerId,
    },
    {
      companyName: "Casa Bella S.r.l.",
      contactName: "Marco Rossi",
      email: "mrossi@casabella.it",
      phone: "+39 02 5500 1234",
      country: "意大利",
      tags: "设计风格,样品频繁",
      isKeyAccount: false,
      intentLevel: "MEDIUM" as const,
      ownerId,
    },
    {
      companyName: "BricoMarché France",
      contactName: "Jean-Pierre Martin",
      email: "jp.martin@bricomarche.fr",
      phone: "+33 4 72 00 56 78",
      country: "法国",
      tags: "连锁超市,大批量",
      isKeyAccount: false,
      intentLevel: "HIGH" as const,
      ownerId,
    },
    {
      companyName: "HomeStyle Australia",
      contactName: "Sarah Williams",
      email: "swilliams@homestyle.au",
      phone: "+61 2 5550 1234",
      country: "澳大利亚",
      tags: "打样多,潜力客户",
      isKeyAccount: false,
      intentLevel: "MEDIUM" as const,
      ownerId,
    },
    {
      companyName: "Tokyo Living Space",
      contactName: "山田花子",
      email: "yamada@tokyoliving.jp",
      phone: "+81 3 6666 0456",
      country: "日本",
      tags: "新客户,快消品",
      isKeyAccount: false,
      intentLevel: "LOW" as const,
      ownerId,
    },
  ];

  for (const c of customers) {
    const existing = await prisma.customer.findFirst({
      where: { companyName: c.companyName },
    });
    if (existing) {
      console.log(`已存在: ${c.companyName}`);
      continue;
    }

    await prisma.customer.create({
      data: {
        companyName: c.companyName,
        contactName: c.contactName,
        email: c.email,
        phone: c.phone,
        country: c.country,
        tags: c.tags,
        isKeyAccount: c.isKeyAccount,
        intentLevel: c.intentLevel,
        source: "MANUAL",
        ownerId: c.ownerId,
      },
    });
    console.log(`创建成功: ${c.companyName}`);
  }

  console.log("\n客户种子数据插入完成！");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
