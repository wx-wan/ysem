import { Response } from 'express';
import { z } from 'zod';
import { Currency, Prisma, QuotationStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope, productVisibilityWhere, projectProductRows } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { getNextNumber } from '../lib/numberSequence';
import {
  BASE_CURRENCY,
  DECIMAL_PRECISION,
  normalizeRate,
  round,
  toCny,
  toDecimal,
} from '../utils/currency';

// ============================================================
// 报价领域（V1.0）
//
// 履约链：Opportunity → Quotation → QuotationItem[] → SalesOrder
//  - Quotation 是唯一的正式报价实体，**不得**回退到 Order(type=QUOTE) / SalesPipeline；
//  - 明细一律落 QuotationItem（结构化），**不得**使用 JSON item / 旧 OrderItem；
//  - 产品来源恒为 V1.0 Product，**不得**使用 SingleProduct / LeadProduct。
//
// 已 Deferred（不在本轮）：
//  - quotationNo 走 NumberSequence runtime（当前沿用 sales.controller 的「按日最大序号 +1」做法）
//  - customerSnapshot（ADR-04）形状未定，无消费方，暂不写入
//  - parentId 版本链行为未定，暂不写入
// ============================================================

/** 明细关联产品的公开字段（DQ-3=C 投影白名单；内部授权字段不得进入响应） */
const QUOTATION_ITEM_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

/** 产品关联 select：含内部授权字段，响应前必须经 withProductVisibility 投影 */
const QUOTATION_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  visibility: true,
  createdBy: true,
  visibleUsers: { select: { userId: true } },
} as const;

/** 读取侧（DQ-3=C）：明细关联产品按可见性投影（不可见 ⇒ product=null 且快照 productName=null） */
const withProductVisibility = <T>(req: AuthRequest, record: T): T => {
  const rec = record as Record<string, unknown>;
  return {
    ...rec,
    items: projectProductRows(
      req,
      (rec.items ?? []) as Record<string, unknown>[],
      QUOTATION_ITEM_PRODUCT_FIELDS,
      { nameField: 'productName' },
    ),
  } as T;
};

/** 列表 / 详情统一 include：客户、商机、明细（含产品） */
const QUOTATION_INCLUDE: Prisma.QuotationInclude = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
  items: {
    include: { product: { select: QUOTATION_ITEM_PRODUCT_SELECT } },
    orderBy: { sort: 'asc' },
  },
};

/** 报价状态 → 状态时间戳字段（V1.0 状态机） */
const STATUS_TIME_FIELD: Partial<
  Record<QuotationStatus, 'submittedAt' | 'sentAt' | 'acceptedAt' | 'rejectedAt'>
> = {
  SUBMITTED: 'submittedAt',
  SENT: 'sentAt',
  ACCEPTED: 'acceptedAt',
  REJECTED: 'rejectedAt',
};

/** 金额入参：JSON number 或 string，一律经 Decimal 归一，禁止 JS number 参与运算 */
const amountSchema = z.union([z.number(), z.string()]);
type AmountInput = number | string;

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productName: z.string().optional(),
  productSku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  craft: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  quantity: amountSchema.optional(),
  unit: z.string().optional(),
  unitPrice: amountSchema.optional(),
  amount: amountSchema.optional(),
  costPrice: amountSchema.optional().nullable(),
  leadTime: z.number().int().optional().nullable(),
  remark: z.string().optional().nullable(),
  sort: z.number().int().optional(),
});

export type QuotationItemInput = z.infer<typeof itemSchema>;

const createSchema = z.object({
  opportunityId: z.string().min(1, '商机不能为空'),
  customerId: z.string().optional().nullable(),
  title: z.string().min(1, '报价标题不能为空'),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  totalAmount: amountSchema.optional(),
  validUntil: z.string().optional().nullable(),
  status: z.nativeEnum(QuotationStatus).optional(),
  tradeTerms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  leadTime: z.number().int().optional().nullable(),
  portOfLoading: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有报价单读写都必须经此条件，杜绝越权访问。
 * Quotation 有直接 ownerId（非经关联继承），故不传 relation。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId' }));
}

/**
 * 解析汇率（冻结语义 rateToCny：1 单位原币 = X CNY）。
 *  - 本位币 CNY：恒为 1（定义性汇率，非伪造）
 *  - 其余币种：入参优先，其次取 DailyExchangeRate 最近一期
 *  - 都取不到：返回 null —— 不猜测、不按 1 兜底
 */
async function resolveExchangeRate(
  currency: Currency,
  input?: AmountInput | null,
): Promise<Prisma.Decimal | null> {
  if (currency === BASE_CURRENCY) return new Prisma.Decimal(1);
  const normalized = normalizeRate(input ?? null, 'rateToCny');
  if (normalized) return normalized;
  const latest = await prisma.dailyExchangeRate.findFirst({
    where: { currencyCode: currency },
    orderBy: { date: 'desc' },
    select: { rateToCny: true },
  });
  return toDecimal(latest?.rateToCny ?? null);
}

interface ParsedItemsOk {
  ok: true;
  data: Prisma.QuotationItemUncheckedCreateWithoutQuotationInput[];
  total: Prisma.Decimal | null;
}
interface ParsedItemsFail {
  ok: false;
  message: string;
}

/**
 * 明细解析 + 产品快照（ADR-04）。
 *
 * 快照权威：调用方显式传入的快照值 > Product 当前值。
 * Product 后续改名不会回溯修改已落库的 QuotationItem。
 * Product 无 `spec` / `craft` 列，故这几项只取入参，不做推断（Schema limitation）。
 */
async function parseItems(
  req: AuthRequest,
  raw: QuotationItemInput[] | undefined,
  currency: Currency,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) return { ok: true, data: [], total: null };

  const productIds = Array.from(
    new Set(raw.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  );
  const products = productIds.length
    ? await prisma.product.findMany({
        // 引用侧（DQ-3=C）：产品引用必须落在 caller 可见范围内（保持单次批量查询，不引入 N+1）
        where: { id: { in: productIds }, ...productVisibilityWhere(req) },
        select: { id: true, name: true, sku: true, packaging: true },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const data: Prisma.QuotationItemUncheckedCreateWithoutQuotationInput[] = [];
  let total = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    const product = item.productId ? productById.get(item.productId) : undefined;
    // 引用侧（DQ-3=C）：指定 productId 但产品不存在 / 不在 caller 可见范围 ⇒ **同结果**
    // （不可见与不存在文案一致，不引入 Product existence oracle）
    if (item.productId && !product) {
      return { ok: false, message: `第 ${index + 1} 条明细产品不存在` };
    }
    const productName = item.productName ?? product?.name;
    if (!productName) {
      return { ok: false, message: `第 ${index + 1} 条明细缺少产品名称` };
    }

    const quantity = round(item.quantity ?? 1, DECIMAL_PRECISION.quantity);
    const unitPrice = round(item.unitPrice ?? 0, DECIMAL_PRECISION.unitPrice);
    if (!quantity || !unitPrice) {
      return { ok: false, message: `第 ${index + 1} 条明细数量 / 单价不合法` };
    }

    // V1.0：amount = quantity × unitPrice（全程 Decimal，不引入 JS number）
    const amount =
      round(item.amount, DECIMAL_PRECISION.amount) ??
      quantity
        .times(unitPrice)
        .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

    data.push({
      productId: item.productId ?? null,
      productName,
      productSku: item.productSku ?? product?.sku ?? null,
      spec: item.spec ?? null,
      craft: item.craft ?? null,
      size: item.size ?? null,
      packaging: item.packaging ?? product?.packaging ?? null,
      quantity,
      unit: item.unit ?? 'PCS',
      unitPrice,
      amount,
      currency,
      costPrice: round(item.costPrice ?? null, DECIMAL_PRECISION.unitPrice),
      leadTime: item.leadTime ?? null,
      remark: item.remark ?? null,
      sort: item.sort ?? index,
    });

    total = total.plus(amount);
  }

  return {
    ok: true,
    data,
    total: total.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
  };
}

// ============ 列表 ============
export const listQuotations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { opportunityId, customerId, status, productId, page = 1, pageSize = 50 } = req.query as Record<string, any>;
    let where: Record<string, unknown> = {};
    if (opportunityId) where.opportunityId = opportunityId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    // 按产品过滤（additive）：命中报价明细 QuotationItem.productId；不改变 scope / 分页 / 排序
    if (productId) where.items = { some: { productId: String(productId) } };

    // 数据范围：ALL / DEPT / SELF（ownerId）；Quotation 不存在公海语义，不并入 publicSea
    where = applyScope(where, await roleScope(req, { field: 'ownerId' }));

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: QUOTATION_INCLUDE,
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.quotation.count({ where }),
    ]);
    // 读取侧（DQ-3=C）：明细中不可见 PRIVATE 产品的属性不得进入响应
    success(res, {
      list: list.map((row) => withProductVisibility(req, row)),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============
export const getQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.quotation.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: QUOTATION_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '报价不存在');
      return;
    }
    // 读取侧（DQ-3=C）：明细中不可见 PRIVATE 产品的属性不得进入响应
    success(res, withProductVisibility(req, item));
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（同一商机自动递增版本号） ============
export const createQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    // V1.0：Quotation.customerId 必填，未传时取商机所属客户（Quotation 1:1 归属 Opportunity.customer）
    // 数据范围：商机引用必须落在当前用户 ownerId 范围内（scope 外与不存在同文案）
    // scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
    const opportunity = await prisma.opportunity.findFirst({
      where: applyScope({ id: body.opportunityId }, await roleScope(req, { field: 'ownerId' })),
      select: { id: true, customerId: true, title: true },
    });
    if (!opportunity) {
      fail(res, 400, '商机不存在');
      return;
    }
    const customerId = body.customerId ?? opportunity.customerId;
    if (!customerId) {
      fail(res, 400, '客户不能为空');
      return;
    }

    const currency = body.currency ?? Currency.USD;
    const parsed = await parseItems(req, body.items, currency);
    if (!parsed.ok) {
      fail(res, 400, parsed.message);
      return;
    }

    // 总金额：显式入参优先，其次取明细汇总（V1.0 Quotation.totalAmount NOT NULL）
    const totalAmount = round(body.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total;
    if (!totalAmount) {
      fail(res, 400, '报价金额不能为空');
      return;
    }

    const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
    const totalAmountCny = toCny(totalAmount, exchangeRate);

    const max = await prisma.quotation.aggregate({
      where: { opportunityId: body.opportunityId },
      _max: { version: true },
    });
    const version = (max._max.version ?? 0) + 1;
    const status = body.status ?? QuotationStatus.DRAFT;

    // D-C4-B（Option B，CREATE）：显式指定业务归属时，目标用户必须在本用户数据范围内
    // （ALL/admin → 任意合法用户；DEPT → 本部门及下级成员；SELF → 仅本人）。
    // 未提供（undefined / null）时下方 `?? req.userId` 归当前用户，不进入显式校验。
    if (body.ownerId !== undefined && body.ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: applyScope({ id: body.ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true },
      });
      if (!owner) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const quotationNo = await getNextNumber(tx, 'QUO');

      return tx.quotation.create({
        data: {
          quotationNo,
          title: body.title,
          version,
          currency,
          exchangeRate,
          totalAmount,
          totalAmountCny,
          tradeTerms: body.tradeTerms ?? null,
          paymentTerms: body.paymentTerms ?? null,
          leadTime: body.leadTime ?? null,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          portOfLoading: body.portOfLoading ?? null,
          status,
          ...(STATUS_TIME_FIELD[status]
            ? { [STATUS_TIME_FIELD[status] as string]: new Date() }
            : {}),
          notes: body.notes ?? null,
          ownerId: body.ownerId ?? req.userId ?? null,
          createdBy: req.userId ?? null,
          opportunity: { connect: { id: body.opportunityId } },
          customer: { connect: { id: customerId } },
          ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
        },
        include: QUOTATION_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'quotation',
      businessType: BUSINESS_TYPE.QUOTATION,
      businessId: item.id,
      businessNo: item.quotationNo,
      summary: `${req.username ?? ''} 创建了报价「${item.title}」（${item.quotationNo}）`,
      ip: req.ip,
      customerId,
    });

    // 读取侧（DQ-3=C）：明细中不可见 PRIVATE 产品的属性不得进入响应
    created(res, withProductVisibility(req, item));
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新 ============
export const updateQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    // 数据范围：目标报价单本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    const existing = await prisma.quotation.findFirst({
      where: await scopedWhere(req, id),
      select: { id: true, quotationNo: true, title: true, currency: true, totalAmount: true, customerId: true },
    });
    if (!existing) {
      fail(res, 404, '报价不存在');
      return;
    }

    const currency = rest.currency ?? existing.currency;
    const data: Prisma.QuotationUpdateInput = {};
    let totalAmount: Prisma.Decimal | null = null;

    if (rest.items !== undefined) {
      const parsed = await parseItems(req, rest.items, currency);
      if (!parsed.ok) {
        fail(res, 400, parsed.message);
        return;
      }
      // 明细整表重建（deleteMany + create），保证与入参完全一致
      data.items = { deleteMany: {}, create: parsed.data };
      totalAmount = round(rest.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total ?? toDecimal(existing.totalAmount);
    } else if (rest.totalAmount !== undefined) {
      totalAmount = round(rest.totalAmount, DECIMAL_PRECISION.amount);
    }

    if (rest.opportunityId) {
      // 数据范围：商机引用必须落在当前用户 ownerId 范围内（scope 外与不存在同文案）
      // scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
      const opportunity = await prisma.opportunity.findFirst({
        where: applyScope({ id: rest.opportunityId }, await roleScope(req, { field: 'ownerId' })),
        select: { id: true, customerId: true, title: true },
      });

      if (!opportunity) {
        fail(res, 400, '商机不存在');
        return;
      }

      data.opportunity = { connect: { id: rest.opportunityId } };
    }
    if (rest.customerId) data.customer = { connect: { id: rest.customerId } };
    if (rest.title !== undefined) data.title = rest.title;
    if (rest.currency !== undefined) data.currency = rest.currency;
    if (rest.validUntil !== undefined) {
      data.validUntil = rest.validUntil ? new Date(rest.validUntil) : null;
    }
    if (rest.status !== undefined) {
      data.status = rest.status;
      const timeField = STATUS_TIME_FIELD[rest.status];
      if (timeField) data[timeField] = new Date();
    }
    if (rest.notes !== undefined) data.notes = rest.notes;
    if (rest.tradeTerms !== undefined) data.tradeTerms = rest.tradeTerms;
    if (rest.paymentTerms !== undefined) data.paymentTerms = rest.paymentTerms;
    if (rest.leadTime !== undefined) data.leadTime = rest.leadTime;
    if (rest.portOfLoading !== undefined) data.portOfLoading = rest.portOfLoading;
    // D-C4-B（Option B，UPDATE）：改派归属必须通过数据范围校验，且**先于任何写入**。
    // Quotation **无公海语义**，故 `null`（含 ''）一律拒绝。
    if (rest.ownerId !== undefined) {
      if (
        rest.ownerId === null ||
        rest.ownerId === '' ||
        !(await prisma.user.findFirst({
          where: applyScope({ id: rest.ownerId }, await roleScope(req, { field: 'id' })),
          select: { id: true },
        }))
      ) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }
    if (rest.ownerId !== undefined) data.ownerId = rest.ownerId;
    data.updatedBy = req.userId ?? null;

    // 币种 / 汇率 / 金额任一变化时，按 rateToCny 重算三件套（缺失汇率 → 置 null，不伪造）
    if (totalAmount || rest.currency !== undefined || rest.exchangeRate !== undefined) {
      if (totalAmount) data.totalAmount = totalAmount;
      const exchangeRate = await resolveExchangeRate(currency, rest.exchangeRate);
      data.exchangeRate = exchangeRate;
      data.totalAmountCny = toCny(totalAmount ?? existing.totalAmount, exchangeRate);
    }

    const item = await prisma.quotation.update({
      where: { id },
      data,
      include: QUOTATION_INCLUDE,
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'quotation',
      businessType: BUSINESS_TYPE.QUOTATION,
      businessId: item.id,
      businessNo: item.quotationNo,
      summary: `${req.username ?? ''} 更新了报价「${item.title}」（${item.quotationNo}）`,
      ip: req.ip,
      customerId: item.customerId,
    });

    // 读取侧（DQ-3=C）：明细中不可见 PRIVATE 产品的属性不得进入响应
    success(res, withProductVisibility(req, item), '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============
export const removeQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 数据范围：目标报价单本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    const existing = await prisma.quotation.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, quotationNo: true, title: true, customerId: true },
    });
    if (!existing) {
      fail(res, 404, '报价不存在');
      return;
    }
    await prisma.quotation.delete({ where: { id: req.params.id } });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'quotation',
      businessType: BUSINESS_TYPE.QUOTATION,
      businessId: existing.id,
      businessNo: existing.quotationNo,
      summary: `${req.username ?? ''} 删除了报价「${existing.title}」（${existing.quotationNo}）`,
      ip: req.ip,
      customerId: existing.customerId,
    });

    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
