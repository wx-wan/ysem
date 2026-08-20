import { PrismaClient } from "@prisma/client";

// 使用 .env 中的 DATABASE_URL（开发与生产统一指向 PostgreSQL）
const prisma = new PrismaClient();

// 品类关键词 -> 用于订单备注，便于概览「品类分布」识别
const CATEGORIES = [
  "服务器",
  "存储设备",
  "网络设备",
  "电源及配件",
  "网络安全",
  "外设显示器",
  "软件服务",
];

// 生成 YYYY-MM-DD 格式的日期（相对于今天往前偏移 months 个月 + 随机天数）
function dateOffset(monthsAgo: number, dayOfMonth = 15): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(dayOfMonth);
  return d.toISOString().slice(0, 10);
}

// 每个客户的订单规模与金额档位（用于造出差异化的概览数据）
const ORDER_PLANS: Record<
  string,
  { count: number; baseAmount: number; cats: string[]; spread: number[] }
> = {
  "Global Home Solutions": {
    count: 9,
    baseAmount: 86000,
    cats: ["服务器", "存储设备", "网络设备"],
    spread: [2, 3, 4, 5, 6, 7, 9, 11, 13],
  },
  "Nordic Living AB": {
    count: 6,
    baseAmount: 52000,
    cats: ["网络设备", "电源及配件", "外设显示器"],
    spread: [1, 3, 5, 7, 9, 12],
  },
  "Maison Beauté SARL": {
    count: 4,
    baseAmount: 38000,
    cats: ["软件服务", "网络安全"],
    spread: [2, 4, 8, 11],
  },
  "LifeSpace Japan Co.": {
    count: 7,
    baseAmount: 64000,
    cats: ["服务器", "存储设备", "电源及配件"],
    spread: [1, 2, 4, 6, 8, 10, 12],
  },
  "Casa Bella S.r.l.": {
    count: 3,
    baseAmount: 29000,
    cats: ["网络设备", "外设显示器"],
    spread: [3, 6, 10],
  },
  "BricoMarché France": {
    count: 8,
    baseAmount: 72000,
    cats: ["服务器", "网络设备", "存储设备", "电源及配件"],
    spread: [1, 2, 3, 5, 7, 8, 10, 12],
  },
  "HomeStyle Australia": {
    count: 5,
    baseAmount: 33000,
    cats: ["软件服务", "电源及配件"],
    spread: [2, 5, 7, 9, 11],
  },
  "Tokyo Living Space": {
    count: 2,
    baseAmount: 18000,
    cats: ["网络设备", "软件服务"],
    spread: [4, 9],
  },
};

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
      intentLevel: "准成交" as const,
      notes: "年度框架协议客户，采购以服务器与存储设备为主，付款稳定。",
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
      intentLevel: "准成交" as const,
      notes: "北欧市场核心代理，网络与外设需求持续增长。",
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
      intentLevel: "高意向" as const,
      notes: "高端品牌客户，关注软件服务与网络安全合规。",
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
      intentLevel: "准成交" as const,
      notes: "日系品质要求严格，服务器与存储设备为主要品类。",
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
      intentLevel: "中意向" as const,
      notes: "设计风格导向，网络设备与外设显示器需求稳定。",
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
      intentLevel: "高意向" as const,
      notes: "连锁超市大批量采购，服务器/网络/存储/电源全品类覆盖。",
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
      intentLevel: "中意向" as const,
      notes: "潜力客户，软件服务与电源配件采购逐步上量。",
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
      intentLevel: "低意向" as const,
      notes: "新开发客户，网络与软件服务初步试单。",
      ownerId,
    },
  ];

  let createdCount = 0;

  for (const c of customers) {
    let customer = await prisma.customer.findFirst({
      where: { companyName: c.companyName },
      include: { orders: true },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          companyName: c.companyName,
          contactName: c.contactName,
          email: c.email,
          phone: c.phone,
          country: c.country,
          tags: c.tags,
          isKeyAccount: c.isKeyAccount,
          intentLevel: c.intentLevel,
          notes: c.notes,
          source: "MANUAL",
          ownerId: c.ownerId,
        },
        include: { orders: true },
      });
      console.log(`创建成功: ${c.companyName}`);
      createdCount++;
    } else {
      console.log(`已存在: ${c.companyName}`);
    }

    // 已存在订单则跳过，避免重复造数
    if (customer.orders.length > 0) {
      console.log(`  - 已有 ${customer.orders.length} 笔订单，跳过造数`);
      continue;
    }

    const plan = ORDER_PLANS[c.companyName];
    if (!plan) continue;

    const orderNoBase = `SO-${customer.id.slice(0, 4).toUpperCase()}`;
    let earliestDate = "";
    const createdOrders: { orderDate: string; amountCNY: number; notes: string; status: string }[] = [];

    for (let i = 0; i < plan.count; i++) {
      const monthsAgo = plan.spread[i] ?? i + 1;
      const day = 5 + ((i * 7) % 20); // 分散到月内不同日期
      const orderDate = dateOffset(monthsAgo, day);
      // 金额在 baseAmount 上下浮动 ±30%
      const jitter = 0.7 + (i % 5) * 0.15;
      const amount = Math.round((plan.baseAmount * jitter) / 100) * 100;
      const cat = plan.cats[i % plan.cats.length];
      const notes = `${cat}采购订单，含${cat}相关配件与耗材。`;
      const status = monthsAgo <= 1 ? "CONFIRMED" : "DELIVERED";

      createdOrders.push({ orderDate, amountCNY: amount, notes, status });

      if (!earliestDate || orderDate < earliestDate) earliestDate = orderDate;
    }

    await prisma.order.createMany({
      data: createdOrders.map((o, idx) => ({
        customerId: customer.id,
        orderNo: `${orderNoBase}-${String(idx + 1).padStart(3, "0")}`,
        orderDate: o.orderDate,
        amountCNY: o.amountCNY,
        status: o.status,
        paymentTerms: "T/T 30% 预付款",
        notes: o.notes,
        createdBy: ownerId,
      })),
    });

    // 回填首次下单日期（直接写库，绕过 API 的自动计算）
    if (earliestDate) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { firstOrderDate: earliestDate },
      });
    }

    // 造几条客户活动日志（便于活动记录 tab 有数据）
    const activities = [
      { action: "CREATED", detail: "客户创建" },
      { action: "KEY_TOGGLE", detail: c.isKeyAccount ? "标记为重点客户" : "取消重点客户标记" },
      { action: "INTENT_CHANGE", detail: `采购意向调整为「${c.intentLevel}」` },
    ];
    await prisma.customerActivity.createMany({
      data: activities.map((a, idx) => ({
        customerId: customer!.id,
        action: a.action as any,
        detail: a.detail,
        createdBy: ownerId ?? "",
      })) as any,
    });

    console.log(
      `  - 已插入 ${createdOrders.length} 笔订单，首单日期 ${earliestDate}，活动日志 ${activities.length} 条`
    );
  }

  console.log("\n客户及订单种子数据插入完成！");
  if (createdCount > 0) {
    console.log(`新增客户 ${createdCount} 个。`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
