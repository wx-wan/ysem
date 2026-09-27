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

  // 说明：客户活动日志（CustomerActivity）已从 V1.0 整合进 OperationLog（按 customerId 捞出），
  // 故上方 OperationLog 段落已覆盖客户相关记录的姓名回填；旧 ProductActivity 亦已删除。
  console.log(`操作日志：回填 ${opUpdated} / ${opLogs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
