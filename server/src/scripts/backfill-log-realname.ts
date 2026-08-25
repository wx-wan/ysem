import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

type UserRef = { id: string; username: string; realName: string };

async function main() {
  // 加载全部用户索引
  const users = (await prisma.user.findMany({
    select: { id: true, username: true, realName: true },
  })) as UserRef[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const byName = new Map(users.map((u) => [u.username, u]));

  const pickRealName = (userId?: string | null, username?: string | null): string | null => {
    if (userId) {
      const u = byId.get(userId);
      if (u?.realName) return u.realName;
    }
    if (username) {
      const u = byName.get(username);
      if (u?.realName) return u.realName;
    }
    return null;
  };

  // 1. 全局操作日志：userId / username 关联
  const opLogs = await prisma.operationLog.findMany({
    where: { realName: null },
    select: { id: true, userId: true, username: true },
  });
  let opUpdated = 0;
  for (const log of opLogs) {
    const rn = pickRealName(log.userId, log.username);
    if (rn) {
      await prisma.operationLog.update({ where: { id: log.id }, data: { realName: rn } });
      opUpdated++;
    }
  }

  // 2. 客户活动日志：createdBy 为用户名
  const custActs = await prisma.customerActivity.findMany({
    where: { realName: null },
    select: { id: true, createdBy: true },
  });
  let custUpdated = 0;
  for (const a of custActs) {
    const rn = pickRealName(null, a.createdBy);
    if (rn) {
      await prisma.customerActivity.update({ where: { id: a.id }, data: { realName: rn } });
      custUpdated++;
    }
  }

  // 3. 产品操作记录：operator 为用户名、createdBy 为 userId
  const prodActs = await prisma.productActivity.findMany({
    where: { realName: null },
    select: { id: true, operator: true, createdBy: true },
  });
  let prodUpdated = 0;
  for (const a of prodActs) {
    const rn = pickRealName(a.createdBy, a.operator);
    if (rn) {
      await prisma.productActivity.update({ where: { id: a.id }, data: { realName: rn } });
      prodUpdated++;
    }
  }

  console.log(`操作日志：回填 ${opUpdated} / ${opLogs.length}`);
  console.log(`客户活动：回填 ${custUpdated} / ${custActs.length}`);
  console.log(`产品操作：回填 ${prodUpdated} / ${prodActs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
