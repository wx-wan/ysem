/**
 * V1.1 · lead-fk-only —— 一次性数据回填（**必须在删列迁移之前执行**）
 *
 * 背景：`Lead` 的客户类列（companyName / contactName / contactMethods / email / phone /
 * country / customerType）与 `LeadItem` 的产品类列（productName / craftIds / audienceId /
 * categoryId / sizeL / sizeW / sizeH / weight）即将下线。历史数据里存在「只填了文本、
 * 尚未关联主数据」的线索，直接删列会**永久丢失**这些信息，因此先回填：
 *
 *   1. 客户：companyName 非空且 customerId 为空 → 归一（trim + 大小写不敏感）匹配既有
 *      Customer，命中即复用，否则建档（CUS- 编号），然后回填 Lead.customerId
 *   2. 产品：productName 非空且 productId 为空 → 同理匹配 / 建档（PRD- 编号 + SKU），
 *      回填 LeadItem.productId
 *   3. 规格合并：已关联产品的明细，把线索里的工艺 / 受众 / 品类 / 长宽高 / 克重
 *      **补写进产品中缺失的项**（只补空，绝不覆盖产品已有值）
 *   4. 数量：Lead.quantity 与 LeadItem.quantity 不一致时以线索标量为准（删列前收敛）
 *
 * 用法：
 *   npx tsx prisma/scripts/backfill-lead-fk.ts            # dry-run（默认，只打印计划）
 *   npx tsx prisma/scripts/backfill-lead-fk.ts --apply     # 实际写库
 *
 * 幂等：已有关联（customerId / productId 非空）的行不再处理；
 *      旧列已被迁移删除时对应阶段自动跳过，脚本可安全重复执行。
 *
 * 注意：本脚本用 `$queryRaw` 读取**旧列** —— Prisma Client 已按新 schema 生成，
 * 不再认识这些列，因此不能走 Prisma 字段访问。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCustomerAggregate } from '../../src/operations/customer.operations';
import { createProductOperation } from '../../src/operations/product.operations';
import { buildProductCreateData } from '../../src/services/product.service';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type LegacyLead = {
  id: string;
  leadNo: string;
  companyName: string | null;
  contactName: string | null;
  contactMethods: unknown;
  email: string | null;
  phone: string | null;
  country: string | null;
  customerType: string | null;
  channelId: string | null;
  shopId: string | null;
  ownerId: string | null;
  quantity: number | null;
};

type LegacyItem = {
  id: string;
  leadId: string;
  productName: string | null;
  productId: string | null;
  quantity: number;
  craftIds: string[] | null;
  audienceId: string | null;
  categoryId: string | null;
  sizeL: number | null;
  sizeW: number | null;
  sizeH: number | null;
  weight: number | null;
};

const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  console.log(s);
};

/** 旧列是否仍然存在（迁移执行后应为 false） */
async function hasColumns(table: string, columns: string[]): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
      AND column_name = ANY(${columns})
  `;
  return rows.length > 0;
}

async function findCustomerByName(name: string) {
  return prisma.customer.findFirst({
    where: { companyName: { equals: name, mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });
}

async function findProductByName(name: string) {
  return prisma.product.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
}

async function phaseCustomer(): Promise<void> {
  log('\n[1/4] 客户回填（Lead.customerId 为空但有公司名）');
  if (!(await hasColumns('Lead', ['companyName']))) {
    log('  · 旧列 companyName 不存在，跳过');
    return;
  }
  const rows = await prisma.$queryRaw<LegacyLead[]>`
    SELECT id, "leadNo", "companyName", "contactName", "contactMethods", email, phone, country,
           "customerType", "channelId", "shopId", "ownerId", quantity
    FROM "Lead"
    WHERE "customerId" IS NULL AND "companyName" IS NOT NULL AND btrim("companyName") <> ''
    ORDER BY "createdAt"
  `;
  log(`  · 待处理 ${rows.length} 条`);
  for (const r of rows) {
    const name = (r.companyName ?? '').trim();
    const existing = await findCustomerByName(name);
    if (existing) {
      log(`  · ${r.leadNo} → 复用客户 ${existing.companyName} (${existing.id})`);
      if (APPLY) {
        await prisma.lead.update({ where: { id: r.id }, data: { customerId: existing.id } });
      }
    } else {
      log(`  · ${r.leadNo} → 新建客户「${name}」`);
      if (APPLY) {
        const customer = await createCustomerAggregate({
          companyName: name,
          contactName: r.contactName ?? null,
          contactMethods: (r.contactMethods ?? null) as never,
          email: r.email ?? null,
          phone: r.phone ?? null,
          country: r.country ?? null,
          customerType: r.customerType ?? null,
          channelId: r.channelId ?? null,
          shopId: r.shopId ?? null,
          source: 'MANUAL',
          ownerId: r.ownerId ?? null,
        });
        await prisma.lead.update({ where: { id: r.id }, data: { customerId: customer.id } });
      }
    }
  }
}

async function phaseProduct(): Promise<void> {
  log('\n[2/4] 产品回填（LeadItem.productId 为空但有产品名）');
  if (!(await hasColumns('LeadItem', ['productName']))) {
    log('  · 旧列 productName 不存在，跳过');
    return;
  }
  const rows = await prisma.$queryRaw<LegacyItem[]>`
    SELECT i.id, i."leadId", i."productName", i."productId", i.quantity,
           i."craftIds", i."audienceId", i."categoryId", i."sizeL", i."sizeW", i."sizeH", i.weight
    FROM "LeadItem" i
    WHERE i."productId" IS NULL AND i."productName" IS NOT NULL AND btrim(i."productName") <> ''
  `;
  log(`  · 待处理 ${rows.length} 条`);
  for (const r of rows) {
    const name = (r.productName ?? '').trim();
    const existing = await findProductByName(name);
    if (existing) {
      log(`  · item ${r.id} → 复用产品 ${existing.name} (${existing.id})`);
      if (APPLY) {
        await prisma.leadItem.update({ where: { id: r.id }, data: { productId: existing.id } });
      }
      continue;
    }
    log(`  · item ${r.id} → 新建产品「${name}」`);
    if (!APPLY) continue;
    const lead = await prisma.lead.findUnique({ where: { id: r.leadId }, select: { ownerId: true } });
    const craftIds = Array.isArray(r.craftIds) ? r.craftIds : [];
    const audienceId = r.audienceId ?? null;
    const data = await buildProductCreateData(
      {
        name,
        craftIds,
        audienceId,
        categoryId: r.categoryId ?? null,
        sizeL: r.sizeL ?? null,
        sizeW: r.sizeW ?? null,
        sizeH: r.sizeH ?? null,
        weight: r.weight ?? null,
      },
      { userId: undefined, roleCode: undefined },
    );
    const product = await createProductOperation({
      data: { ...data, ownerId: lead?.ownerId ?? null },
      craftIds,
      audienceId,
      hasFullContext: Boolean(craftIds.length && audienceId),
    });
    await prisma.leadItem.update({ where: { id: r.id }, data: { productId: product.id } });
  }
}

async function phaseSpecs(): Promise<void> {
  log('\n[3/4] 规格合并（线索明细 → 产品，仅补产品缺失项，不覆盖）');
  if (!(await hasColumns('LeadItem', ['craftIds']))) {
    log('  · 旧列 craftIds 不存在，跳过');
    return;
  }
  const rows = await prisma.$queryRaw<LegacyItem[]>`
    SELECT i.id, i."leadId", i."productName", i."productId", i.quantity,
           i."craftIds", i."audienceId", i."categoryId", i."sizeL", i."sizeW", i."sizeH", i.weight
    FROM "LeadItem" i
    WHERE i."productId" IS NOT NULL
  `;
  for (const r of rows) {
    if (!r.productId) continue;
    const p = await prisma.product.findUnique({
      where: { id: r.productId },
      select: {
        id: true,
        name: true,
        audienceId: true,
        categoryId: true,
        sizeL: true,
        sizeW: true,
        sizeH: true,
        weight: true,
        crafts: { select: { productCraftId: true } },
      },
    });
    if (!p) continue;
    const patch: Record<string, unknown> = {};
    if (!p.audienceId && r.audienceId) patch.audienceId = r.audienceId;
    if (!p.categoryId && r.categoryId) patch.categoryId = r.categoryId;
    if (p.sizeL == null && r.sizeL != null) patch.sizeL = r.sizeL;
    if (p.sizeW == null && r.sizeW != null) patch.sizeW = r.sizeW;
    if (p.sizeH == null && r.sizeH != null) patch.sizeH = r.sizeH;
    if (p.weight == null && r.weight != null) patch.weight = r.weight;
    const existingCraftIds = new Set(p.crafts.map((c) => c.productCraftId));
    const missingCrafts = (Array.isArray(r.craftIds) ? r.craftIds : []).filter(
      (id) => !existingCraftIds.has(id),
    );
    if (!Object.keys(patch).length && !missingCrafts.length) continue;
    log(
      `  · 产品 ${p.name} (${p.id}) ← ${JSON.stringify(patch)}` +
        (missingCrafts.length ? ` + 工艺 ${missingCrafts.join(',')}` : ''),
    );
    if (!APPLY) continue;
    await prisma.product.update({
      where: { id: p.id },
      data: {
        ...patch,
        ...(missingCrafts.length
          ? { crafts: { create: missingCrafts.map((id) => ({ productCraft: { connect: { id } } })) } }
          : {}),
      },
    });
  }
}

async function phaseQuantity(): Promise<void> {
  log('\n[4/4] 数量收敛（Lead.quantity → LeadItem.quantity）');
  if (!(await hasColumns('Lead', ['quantity']))) {
    log('  · 旧列 Lead.quantity 不存在，跳过');
    return;
  }
  const rows = await prisma.$queryRaw<{ itemId: string; leadNo: string; itemQty: number; leadQty: number }[]>`
    SELECT i.id AS "itemId", l."leadNo", i.quantity AS "itemQty", l.quantity AS "leadQty"
    FROM "LeadItem" i JOIN "Lead" l ON l.id = i."leadId"
    WHERE l.quantity IS NOT NULL AND l.quantity <> i.quantity
  `;
  log(`  · 不一致 ${rows.length} 条`);
  for (const r of rows) {
    log(`  · ${r.leadNo}：明细 ${r.itemQty} → 线索标量 ${r.leadQty}`);
    if (APPLY) {
      await prisma.leadItem.update({ where: { id: r.itemId }, data: { quantity: r.leadQty } });
    }
  }
}

async function main(): Promise<void> {
  log('=========================================');
  log(`  V1.1 lead-fk-only 数据回填 ${APPLY ? '【APPLY 实际写库】' : '【DRY-RUN 只读预览】'}`);
  log('=========================================');
  await phaseCustomer();
  await phaseProduct();
  await phaseSpecs();
  await phaseQuantity();
  log('\n=========================================');
  log(APPLY ? '  ✓ 回填完成' : '  · DRY-RUN 结束（未写库）；确认无误后加 --apply 执行');
  log('=========================================');
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
