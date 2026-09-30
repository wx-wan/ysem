/**
 * V1.2 · 暂存客户不入客户库 —— 存量数据迁移
 *
 * 背景（规则变更）：**暂存（未建档）线索不再创建 Customer 行**，客户信息只存在线索快照
 * （`Lead.customerSnapshot` + `Lead.draftCustomerName`）；只有「建档」时才在客户库创建正式客户。
 * 旧实现会把暂存线索的客户写成 `Customer.draft = true` 的草稿行 —— 本脚本把它清干净：
 *
 *   1. 暂存线索**仍引用**草稿客户（`Lead.customerId` → `Customer.draft = true`）：
 *      把客户档案写入该线索快照（含暂存名占用键），并解除 `customerId` 关联
 *      （信息不丢，只是从客户库挪到线索快照里）；
 *   2. **孤立草稿客户**（没有任何线索引用）：删除 —— 它已无归属，留着就是「未建档客户
 *      出现在客户库」；创建痕迹保留在操作日志中（`创建客户：xxx`）；
 *   3. 已建档线索**缺快照**（历史数据，建档早于快照规则）：用其客户档案回填一版，
 *      使「未确认期间快照随线索更新刷新 / 确认时冻结」的口径对历史数据同样成立；
 *   4. 残留的暂存占用键（已关联客户却仍留 `draftCustomerName`）：清空。
 *
 * 用法：
 *   npx tsx prisma/scripts/migrate-draft-customers.ts            # dry-run（默认，只打印计划）
 *   npx tsx prisma/scripts/migrate-draft-customers.ts --apply     # 实际写库
 *
 * 幂等：草稿客户处理完即不再存在；已建档线索已有快照则跳过；可安全重复执行。
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  refreshLeadCustomerSnapshotOperation,
  writeLeadDraftSnapshotOperation,
} from '../../src/operations/lead.operations';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const log = (s: string) => console.log(s);

async function main() {
  log(`模式：${APPLY ? 'APPLY（实际写库）' : 'DRY-RUN（只打印计划）'}\n`);

  // ---------- 1) 草稿客户：迁移到线索快照 / 删除孤立体 ----------
  const draftCustomers = await prisma.customer.findMany({
    where: { draft: true },
    select: {
      id: true,
      customerNo: true,
      companyName: true,
      contactName: true,
      contactMethods: true,
      email: true,
      phone: true,
      country: true,
      customerType: true,
      ownerId: true,
      channelId: true,
      shopId: true,
    },
  });

  let movedToSnapshot = 0;
  let keptForFiled = 0;
  let removedOrphans = 0;

  for (const c of draftCustomers) {
    const leads = await prisma.lead.findMany({
      where: { customerId: c.id },
      select: { id: true, leadNo: true, customerLocked: true },
    });

    if (!leads.length) {
      log(`[孤立草稿客户] ${c.customerNo} ${c.companyName} → 删除（无任何线索引用）`);
      if (APPLY) await prisma.customer.delete({ where: { id: c.id } });
      removedOrphans += 1;
      continue;
    }

    // 被「已建档」线索引用属于历史异常：保留客户行，仅回填客户档案快照
    const filed = leads.filter((l) => l.customerLocked);
    for (const l of filed) {
      log(`[异常·已建档却指向草稿客户] 线索 ${l.leadNo} ← ${c.companyName} → 回填快照并保留客户`);
      if (APPLY) await refreshLeadCustomerSnapshotOperation(l.id, c.id);
      keptForFiled += 1;
    }

    // 暂存线索：客户信息搬进快照，解除客户关联
    for (const l of leads.filter((x) => !x.customerLocked)) {
      log(`[暂存线索] ${l.leadNo} ← 草稿客户 ${c.companyName} → 写入线索快照并解除客户关联`);
      if (APPLY) {
        await writeLeadDraftSnapshotOperation(l.id, {
          companyName: c.companyName,
          contactName: c.contactName,
          contactMethods: c.contactMethods,
          email: c.email,
          phone: c.phone,
          country: c.country,
          customerType: c.customerType,
          ownerId: c.ownerId,
          channelId: c.channelId,
          shopId: c.shopId,
        });
        await prisma.lead.update({ where: { id: l.id }, data: { customerId: null } });
      }
      movedToSnapshot += 1;
    }

    // 仍有已建档线索引用 → 不能删（外键 SetNull 会打断这些线索的客户关联）
    if (filed.length) continue;
    if (APPLY) await prisma.customer.delete({ where: { id: c.id } });
  }

  // ---------- 2) 已建档线索缺快照（历史数据回填） ----------
  const missing = await prisma.lead.findMany({
    where: {
      customerId: { not: null },
      customerSnapshot: { equals: Prisma.DbNull },
    },
    select: { id: true, leadNo: true, customerId: true },
  });
  for (const l of missing) {
    log(`[已建档·补快照] ${l.leadNo} ← 客户档案`);
    if (APPLY) await refreshLeadCustomerSnapshotOperation(l.id, l.customerId);
  }

  // ---------- 3) 清理残留暂存占用键（已关联客户却仍占名） ----------
  const stale = await prisma.lead.findMany({
    where: { customerId: { not: null }, draftCustomerName: { not: null } },
    select: { id: true, leadNo: true, draftCustomerName: true },
  });
  for (const l of stale) {
    log(`[清理] 已关联客户的线索 ${l.leadNo} 残留暂存名「${l.draftCustomerName}」→ 清空`);
    if (APPLY) await prisma.lead.update({ where: { id: l.id }, data: { draftCustomerName: null } });
  }

  log(
    `\n小计：草稿客户 ${draftCustomers.length} 条 → 搬迁至快照 ${movedToSnapshot} 条线索、` +
      `保留（异常引用）${keptForFiled} 处、删除孤立 ${removedOrphans} 条；补写快照 ${missing.length} 条；清理残留占用键 ${stale.length} 条`,
  );
  if (!APPLY) log('\n（DRY-RUN 未写库；确认无误后加 --apply 执行）');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
