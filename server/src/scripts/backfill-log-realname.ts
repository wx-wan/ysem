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

  // 说明：旧 ProductActivity 已在 V1.0 删除，产品/组合操作统一落 OperationLog，
  // 因此本脚本不再处理产品操作记录（上方 OperationLog 段落已覆盖该场景）。
  console.log(`操作日志：回填 ${opUpdated} / ${opLogs.length}`);
  console.log(`客户活动：回填 ${custUpdated} / ${custActs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
