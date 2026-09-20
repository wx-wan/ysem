import { Response } from 'express';
import { z } from 'zod';
import {
  Currency,
  Prisma,
  PurchaseItemStatus,
  PurchaseStatus,
  PurchaseType,
} from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import {
  BASE_CURRENCY,
  DECIMAL_PRECISION,
  DecimalInput,
  normalizeRate,
  round,
  toCny,
  toDecimal,
} from '../utils/currency';

// ============================================================
// 采购领域（V1.0）
//
// 采购单是独立实体：向供应商的采购 / 外发需求，**不是** SalesOrder / ProductionOrder / Shipment。
//  - 统一使用 V1.0 PurchaseOrder / PurchaseOrderItem（**不得**回退到 items JSON / amountCNY）；
//  - 明细一律落 PurchaseOrderItem 关系表，**不得** `JSON.stringify(items)`；
//  - 成本归集链：SalesOrderItem → ProductionOrderItem → PurchaseOrderItem → PurchaseOrder（ADR-14）。
//
// 【服务端权威派生字段（P0）】
//   PurchaseOrderItem.amount  = quantity × unitPrice（Decimal，客户端传入被忽略）
//   PurchaseOrder.totalAmount = Σ(PurchaseOrderItem.amount)
//   PurchaseOrder.totalAmountCny = totalAmount × rateToCny（无汇率 → NULL，**不伪造**）
//
// 已 Deferred（不在本轮）：
//  - purchaseNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法，格式 PR-yyyyMMdd-0001）
//  - 审批流转（全局 approval.controller 仍为 legacy）
//  - Supplier 独立 V1.0 API（/api/purchases/suppliers 保持 legacy 原样）
//  - PurchaseOrder → Profit 成本自动归集（ADR-14 闭环）
//  - arrivedQty → PurchaseItemStatus 自动同步
//  - 旧 /api/purchases 与 legacy purchase.controller 清理（Order 五拆收尾之后）
// ============================================================

/** 列表 / 详情统一 include：供应商、来源销售订单 / 生产工单、明细 */
const PURCHASE_ORDER_INCLUDE: Prisma.PurchaseOrderInclude = {
  supplier: { select: { id: true, supplierNo: true, name: true, contact: true, phone: true } },
  salesOrder: { select: { id: true, orderNo: true, status: true } },
  productionOrder: { select: { id: true, productionNo: true, status: true } },
  items: { orderBy: { lineNo: 'asc' } },
};

/** 数值入参：JSON number 或 string，一律经 Decimal 归一 */
const amountSchema = z.union([z.number(), z.string()]);

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productionOrderItemId: z.string().optional().nullable(),
  itemName: z.string().min(1, '采购明细名称不能为空'),
  spec: z.string().optional().nullable(),
  quantity: amountSchema,
  unit: z.string().optional(),
  unitPrice: amountSchema,
  // 兼容入参：金额由服务端按 quantity × unitPrice 权威计算，客户端传入值被忽略
  amount: amountSchema.optional(),
  currency: z.nativeEnum(Currency).optional().nullable(),
  arrivedQty: amountSchema.optional(),
  status: z.nativeEnum(PurchaseItemStatus).optional(),
  remark: z.string().optional().nullable(),
});

export type PurchaseOrderItemInput = z.infer<typeof itemSchema>;

const createSchema = z.object({
  salesOrderId: z.string().optional().nullable(),
  productionOrderId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  expectedArrivalAt: z.string().optional().nullable(),
  arrivedAt: z.string().optional().nullable(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  purchaseType: z.nativeEnum(PurchaseType).optional(),
  ownerId: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  keyword: z.string().optional(),
  search: z.string().optional(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  supplierId: z.string().optional(),
  salesOrderId: z.string().optional(),
  productionOrderId: z.string().optional(),
  purchaseType: z.nativeEnum(PurchaseType).optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

/**
 * 解析汇率（冻结语义 rateToCny：1 单位原币 = X CNY）。
 *  - 本位币 CNY：恒为 1（定义性汇率，非伪造）
 *  - 其余币种：入参优先，其次取 DailyExchangeRate 最近一期
 *  - 都取不到：返回 null —— 不猜测、不按 1 兜底
 */
async function resolveExchangeRate(
  currency: Currency,
  input?: DecimalInput,
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

/** 关联实体存在性校验（一次批量查询，避免逐行 N+1） */
async function assertRefsExist(
  req: AuthRequest,
  input: {
    supplierId?: string | null;
    salesOrderId?: string | null;
    productionOrderId?: string | null;
  },
): Promise<{ ok: true } | { ok: false; status: 404; message: string }> {
  // Supplier = 共享采购主数据（DQ-4=A）：仅校验存在性，**不施加** owner 数据范围。
  if (input.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true },
    });
    if (!supplier) return { ok: false, status: 404, message: '供应商不存在' };
  }
  // SalesOrder / ProductionOrder = 业务归属对象（P5-REF-01=ACCEPT）：
  // 引用必须落在当前用户 ownerId 数据范围内；scope 外与不存在同响应 404（无存在性泄露）。
  if (input.salesOrderId) {
    const salesOrder = await prisma.salesOrder.findFirst({
      where: applyScope({ id: input.salesOrderId }, await roleScope(req, { field: 'ownerId' })),
      select: { id: true },
    });
    if (!salesOrder) return { ok: false, status: 404, message: '销售订单不存在' };
  }
  if (input.productionOrderId) {
    const productionOrder = await prisma.productionOrder.findFirst({
      where: applyScope({ id: input.productionOrderId }, await roleScope(req, { field: 'ownerId' })),
      select: { id: true },
    });
    if (!productionOrder) return { ok: false, status: 404, message: '生产工单不存在' };
  }
  return { ok: true };
}

interface ParsedItemsOk {
  ok: true;
  data: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[];
  total: Prisma.Decimal;
}
interface ParsedItemsFail {
  ok: false;
  status: 400 | 404;
  message: string;
}

/**
 * 采购明细解析（ADR-14 快照 + 服务端权威金额）。
 *
 * 快照：itemName / spec / quantity / unit / unitPrice / amount / currency 全部落入明细自身，
 * 历史采购价与名称不依赖 Product 后续变化（Product 仅做存在性校验，不复制数据）。
 * 金额：amount = quantity × unitPrice（全程 Decimal，客户端传入的 amount 被忽略）。
 * 币种：一张采购单只允许一种币种；明细未提供时继承单据币种，显式不一致 → 400。
 *
 * @param preserveByLine 更新时按 lineNo 保留既有行级状态（arrivedQty / status），避免无意重置
 */
/**
 * 明细解析与行级校验（含生产明细存在性）。
 *
 * `db` 必须是**事务客户端**：本函数会读取 ProductionOrderItem（成本归集链宿主，
 * 受 `lockProductionOrderItems` 行锁保护），必须在加锁之后、于同一事务内执行，
 * 否则并发删除生产明细时 FK 的 `onDelete: SetNull` 会在校验通过后静默解绑。
 */
async function parseItems(
  raw: PurchaseOrderItemInput[] | undefined,
  currency: Currency,
  db: Prisma.TransactionClient,
  preserveByLine?: Map<number, { arrivedQty: Prisma.Decimal; status: PurchaseItemStatus }>,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) {
    return { ok: true, data: [], total: new Prisma.Decimal(0) };
  }

  // 币种一致性（不支持一张单多币种混算）
  for (const [index, item] of raw.entries()) {
    if (item.currency && item.currency !== currency) {
      return {
        ok: false,
        status: 400,
        message: `第 ${index + 1} 行明细币种（${item.currency}）与采购单币种（${currency}）不一致`,
      };
    }
  }

  // 关联主数据存在性（批量）
  const productIds = Array.from(
    new Set(raw.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  );
  if (productIds.length > 0) {
    const found = await db.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) {
      return { ok: false, status: 404, message: '产品不存在' };
    }
  }

  const prodItemIds = Array.from(
    new Set(raw.map((i) => i.productionOrderItemId).filter((v): v is string => Boolean(v))),
  );
  const prodItems = prodItemIds.length
    ? await db.productionOrderItem.findMany({
        where: { id: { in: prodItemIds } },
        select: { id: true, productionOrderId: true },
      })
    : [];
  if (prodItems.length !== prodItemIds.length) {
    return { ok: false, status: 404, message: '生产明细不存在' };
  }
  const prodItemById = new Map(prodItems.map((i) => [i.id, i]));

  const data: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[] = [];
  let total = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    const lineNo = index + 1;

    const quantity = round(item.quantity, DECIMAL_PRECISION.quantity);
    if (!quantity || quantity.lte(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细数量不合法` };
    }
    const unitPrice = round(item.unitPrice, DECIMAL_PRECISION.unitPrice);
    if (!unitPrice || unitPrice.lt(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细单价不合法` };
    }

    // 服务端权威金额：amount = quantity × unitPrice（不采纳客户端传入的 amount）
    const amount = quantity
      .times(unitPrice)
      .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

    const preserved = preserveByLine?.get(lineNo);
    const arrivedQty =
      item.arrivedQty !== undefined
        ? round(item.arrivedQty, DECIMAL_PRECISION.quantity) ?? new Prisma.Decimal(0)
        : preserved?.arrivedQty ?? new Prisma.Decimal(0);
    if (arrivedQty.lt(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细到货数量不合法` };
    }

    data.push({
      lineNo,
      productId: item.productId ?? null,
      productionOrderItemId: item.productionOrderItemId ?? null,
      itemName: item.itemName,
      spec: item.spec ?? null,
      quantity,
      unit: item.unit ?? 'PCS',
      unitPrice,
      amount,
      currency,
      arrivedQty,
      status: item.status ?? preserved?.status ?? PurchaseItemStatus.PENDING,
      remark: item.remark ?? null,
    });

    total = total.plus(amount);
  }

  return {
    ok: true,
    data,
    total: total.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
  };
}

/** 明细中的 productionOrderItemId 必须属于同一生产工单（防跨工单错绑） */
function assertProductionItemBinding(
  raw: PurchaseOrderItemInput[] | undefined,
  productionOrderId: string | null,
  prodItemById: Map<string, { id: string; productionOrderId: string }>,
): { ok: true } | { ok: false; message: string } {
  if (!productionOrderId || !raw) return { ok: true };
  for (const [index, item] of raw.entries()) {
    if (!item.productionOrderItemId) continue;
    const prodItem = prodItemById.get(item.productionOrderItemId);
    if (prodItem && prodItem.productionOrderId !== productionOrderId) {
      return {
        ok: false,
        message: `第 ${index + 1} 行明细的生产明细不属于指定生产工单`,
      };
    }
  }
  return { ok: true };
}

/**
 * 数据范围（ALL / DEPT / SELF）。
 * PurchaseOrder.ownerId 为标量（无 User relation）→ 可直接复用 field 级 scope，无需 relation。
 * 未引入公海语义（采购不属于公海业务）。
 */
async function scopedWhere(
  req: AuthRequest,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return applyScope(base, await roleScope(req, { field: 'ownerId' }));
}

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 依赖明细的 productionOrderItem 映射（用于跨工单校验，同时复用存在性结果） */
async function loadProductionItems(
  raw: PurchaseOrderItemInput[] | undefined,
  db: Prisma.TransactionClient,
): Promise<Map<string, { id: string; productionOrderId: string }>> {
  const ids = Array.from(
    new Set((raw ?? []).map((i) => i.productionOrderItemId).filter((v): v is string => Boolean(v))),
  );
  if (ids.length === 0) return new Map();
  const rows = await db.productionOrderItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, productionOrderId: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/** 事务内业务规则违例（明细校验 / 跨工单错绑）→ 由 handler 按携带的 status 返回 */
class PurchaseOrderRuleError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * 锁定受影响的 ProductionOrderItem 行（并发硬化 · PurchaseOrder 侧镜像）。
 *
 * 目的：把「成本归集链引用校验（存在性 / 跨工单绑定）→ 明细重建 / 写入」纳入同一临界区。
 * 否则并发删除生产明细时，FK `onDelete: SetNull` 会在校验通过后**静默解绑**引用。
 *
 * 为什么 FOR UPDATE 足够：PostgreSQL 插入带 FK 引用的行时对父行请求 FOR KEY SHARE，
 *   与 FOR UPDATE 冲突 ⇒ 并发 INSERT 阻塞至本事务提交；提交后父行若已删除，
 *   对方 FK 校验失败 → P2003 → 应用层显式 4xx。
 *
 * 约束（不得放宽）：
 *   · 只锁 `ProductionOrderItem`（真正被共享的资源，而非 PurchaseOrder / PurchaseOrderItem）；
 *   · 必须 `ORDER BY id ASC`（确定性顺序，消除 AB/BA 循环等待）；
 *   · 必须在**调用方的事务**内执行；
 *   · 入参先 Set 去重 + 过滤空值；空数组直接返回（不得生成 `IN ()`）。
 */
async function lockProductionOrderItems(
  tx: Prisma.TransactionClient,
  productionOrderItemIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(
    new Set(productionOrderItemIds.filter((v): v is string => Boolean(v))),
  ).sort();
  if (ids.length === 0) return;

  await tx.$queryRaw`
    SELECT id
    FROM "ProductionOrderItem"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id ASC
    FOR UPDATE
  `;
}

// ============ 列表 ============
export const listPurchaseOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    const keyword = query.keyword ?? query.search;
    const base: Record<string, unknown> = {};
    if (query.status) base.status = query.status;
    if (query.supplierId) base.supplierId = query.supplierId;
    if (query.salesOrderId) base.salesOrderId = query.salesOrderId;
    if (query.productionOrderId) base.productionOrderId = query.productionOrderId;
    if (query.purchaseType) base.purchaseType = query.purchaseType;
    if (keyword) {
      base.OR = [
        { purchaseNo: { contains: keyword } },
        { remark: { contains: keyword } },
        { supplier: { name: { contains: keyword } } },
      ];
    }

    const where = await scopedWhere(req, base);

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: PURCHASE_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    success(res, { list, total, page: pageNum, pageSize: pageSizeNum });
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============
export const getPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.purchaseOrder.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      include: PURCHASE_ORDER_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '采购单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（事务：单据 + 明细 + 汇总，原子） ============
export const createPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const refs = await assertRefsExist(req, body);
    if (!refs.ok) {
      fail(res, refs.status, refs.message);
      return;
    }

    // P5-OWN-01（F-NEW-03）：显式指定业务归属人时必须落在当前用户数据范围内，
    // 且**先于事务与任何写入**（与 update 侧同款校验；形态与 quotation / salesOrder /
    // productionOrder / sampleOrder 一致）。`undefined` / `null` 均表示未指定 → 下方 `?? req.userId`。
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

    const currency = body.currency ?? Currency.CNY;
    const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);

    // 编号分配、成本归集链引用校验与业务写入同事务：
    //   必须**先锁定 ProductionOrderItem（id ASC）**再做存在性 / 跨工单绑定校验与明细写入，
    //   否则并发删除生产明细时 FK 的 onDelete: SetNull 会在校验通过后静默解绑（镜像 TOCTOU）。
    let createdItemCount = 0;
    const item = await prisma.$transaction(async (tx) => {
      await lockProductionOrderItems(tx, (body.items ?? []).map((i) => i.productionOrderItemId));

      const parsed = await parseItems(body.items, currency, tx);
      if (!parsed.ok) {
        throw new PurchaseOrderRuleError(parsed.message, parsed.status);
      }

      const prodItemById = await loadProductionItems(body.items, tx);
      const binding = assertProductionItemBinding(body.items, body.productionOrderId ?? null, prodItemById);
      if (!binding.ok) {
        throw new PurchaseOrderRuleError(binding.message, 400);
      }

      const totalAmount = parsed.total;
      const totalAmountCny = toCny(totalAmount, exchangeRate);
      createdItemCount = parsed.data.length;

      const purchaseNo = await getNextNumber(tx, 'PR');

      return tx.purchaseOrder.create({
        data: {
          purchaseNo,
          salesOrderId: body.salesOrderId ?? null,
          productionOrderId: body.productionOrderId ?? null,
          supplierId: body.supplierId ?? null,
          purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
          status: body.status ?? PurchaseStatus.DRAFT,
          expectedArrivalAt: body.expectedArrivalAt ? new Date(body.expectedArrivalAt) : null,
          arrivedAt: body.arrivedAt ? new Date(body.arrivedAt) : null,
          currency,
          exchangeRate,
          totalAmount,
          totalAmountCny,
          purchaseType: body.purchaseType ?? PurchaseType.MATERIAL,
          ownerId: body.ownerId ?? req.userId ?? null,
          remark: body.remark ?? null,
          createdBy: req.userId ?? null,
          ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
        },
        include: PURCHASE_ORDER_INCLUDE,
      });
    });

    // 采购单不属于 Customer 生命周期事件 → 不写 CustomerActivity（不传 customerId）
    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PURCHASE_ORDER,
      businessId: item.id,
      businessNo: item.purchaseNo,
      summary: `${req.username ?? ''} 创建了采购单「${item.purchaseNo}」（${createdItemCount} 条明细）`,
      ip: req.ip,
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof PurchaseOrderRuleError) {
      fail(res, e.status, e.message);
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '采购单号冲突，请重试');
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '采购单关联数据冲突');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（事务：单据 + 明细重建 + 汇总重算，原子） ============
export const updatePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.purchaseOrder.findFirst({
      where: await scopedWhere(req, { id }),
      select: {
        id: true,
        purchaseNo: true,
        currency: true,
        totalAmount: true,
        productionOrderId: true,
        salesOrderId: true,
        supplierId: true,
      },
    });
    if (!existing) {
      fail(res, 404, '采购单不存在');
      return;
    }

    const refs = await assertRefsExist(req, {
      supplierId: rest.supplierId !== undefined ? rest.supplierId : existing.supplierId,
      salesOrderId: rest.salesOrderId !== undefined ? rest.salesOrderId : existing.salesOrderId,
      productionOrderId:
        rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId,
    });
    if (!refs.ok) {
      fail(res, refs.status, refs.message);
      return;
    }

    // D-C4-B（Option B，UPDATE）：改派归属必须通过数据范围校验，且**先于任何写入**
    // （含下方 `prisma.$transaction` 内的明细重建与 PurchaseOrder 更新）。
    // 故本校验置于事务之外、与其它前置校验同段（形态与 quotation / salesOrder / sampleOrder 一致）。
    if (rest.ownerId !== undefined) {
      if (
        !(await prisma.user.findFirst({
          where: applyScope({ id: rest.ownerId }, await roleScope(req, { field: 'id' })),
          select: { id: true },
        }))
      ) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }

    const currency = rest.currency ?? existing.currency;
    const nextProductionOrderId =
      rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId;

    let parsedItems: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[] | null =
      null;
    let parsedTotal: Prisma.Decimal | null = null;

    // 明细重建 + 引用校验（存在性 / 跨工单绑定）必须整体原子，且**先锁定受影响 ProductionOrderItem**：
    //   BEGIN → read old PurchaseOrderItem（取旧引用 id）
    //         → lock ProductionOrderItem(旧 ∪ 新, id ASC)
    //         → parseItems / loadProductionItems / assertProductionItemBinding
    //         → deleteMany/create items → update PurchaseOrder → COMMIT
    // 若先校验再锁（或校验留在事务外），并发删除生产明细时 FK 的 onDelete: SetNull 会静默解绑。
    // 说明：PurchaseOrderItem **没有入向外键**（成本归集链的外键在其自身 productionOrderItemId 上，
    // 指向 ProductionOrderItem），因此重建明细不会破坏任何反向引用；
    // 唯一的行级数据丢失风险（arrivedQty / status）由 preserveByLine 按 lineNo 保留。
    const item = await prisma.$transaction(async (tx) => {
      // 既有明细：lineNo → 行级状态（arrivedQty / status 保留），并取得旧引用 id 用于加锁
      const existingItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: existing.id },
        select: {
          id: true,
          lineNo: true,
          arrivedQty: true,
          status: true,
          productionOrderItemId: true,
        },
      });
      const preserveByLine = new Map(
        existingItems.map((i) => [i.lineNo, { arrivedQty: i.arrivedQty, status: i.status }]),
      );

      // 先锁「旧引用 ∪ 新引用」的全部 ProductionOrderItem（单批 Set 去重 + id ASC）
      await lockProductionOrderItems(tx, [
        ...existingItems.map((i) => i.productionOrderItemId),
        ...(rest.items ?? []).map((i) => i.productionOrderItemId),
      ]);

      if (rest.items !== undefined) {
        const parsed = await parseItems(rest.items, currency, tx, preserveByLine);
        if (!parsed.ok) {
          throw new PurchaseOrderRuleError(parsed.message, parsed.status);
        }
        const prodItemById = await loadProductionItems(rest.items, tx);
        const binding = assertProductionItemBinding(rest.items, nextProductionOrderId ?? null, prodItemById);
        if (!binding.ok) {
          throw new PurchaseOrderRuleError(binding.message, 400);
        }
        parsedItems = parsed.data;
        parsedTotal = parsed.total;
      }

      const data: Prisma.PurchaseOrderUncheckedUpdateInput = { updatedBy: req.userId ?? null };

      if (rest.salesOrderId !== undefined) data.salesOrderId = rest.salesOrderId;
      if (rest.productionOrderId !== undefined) data.productionOrderId = rest.productionOrderId;
      if (rest.supplierId !== undefined) data.supplierId = rest.supplierId;
      if (rest.purchaseDate !== undefined) {
        data.purchaseDate = rest.purchaseDate ? new Date(rest.purchaseDate) : null;
      }
      if (rest.status !== undefined) data.status = rest.status;
      if (rest.expectedArrivalAt !== undefined) {
        data.expectedArrivalAt = rest.expectedArrivalAt ? new Date(rest.expectedArrivalAt) : null;
      }
      if (rest.arrivedAt !== undefined) {
        data.arrivedAt = rest.arrivedAt ? new Date(rest.arrivedAt) : null;
      }
      if (rest.currency !== undefined) data.currency = currency;
      if (rest.purchaseType !== undefined) data.purchaseType = rest.purchaseType;
      if (rest.ownerId !== undefined) data.ownerId = rest.ownerId;
      if (rest.remark !== undefined) data.remark = rest.remark;

      if (parsedItems) {
        data.items = { deleteMany: {}, create: parsedItems };
      }

      // 金额/汇率重算：明细重建 或 币种/汇率变化 时统一按 rateToCny 重算三件套
      if (parsedTotal !== null || rest.currency !== undefined || rest.exchangeRate !== undefined) {
        const totalAmount = parsedTotal ?? toDecimal(existing.totalAmount) ?? new Prisma.Decimal(0);
        // 币种 / 汇率变化时按 rateToCny 重新取汇（与 Quotation / SalesOrder 的既有口径一致）
        const exchangeRate =
          rest.exchangeRate !== undefined
            ? await resolveExchangeRate(currency, rest.exchangeRate)
            : await resolveExchangeRate(currency, null);
        data.totalAmount = totalAmount;
        data.exchangeRate = exchangeRate;
        data.totalAmountCny = toCny(totalAmount, exchangeRate);
      }

      return tx.purchaseOrder.update({
        where: { id: existing.id },
        data,
        include: PURCHASE_ORDER_INCLUDE,
      });
    });

    // 采购单不属于 Customer 生命周期事件 → 不写 CustomerActivity（不传 customerId）
    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PURCHASE_ORDER,
      businessId: item.id,
      businessNo: item.purchaseNo,
      summary: `${req.username ?? ''} 更新了采购单「${item.purchaseNo}」`,
      ip: req.ip,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof PurchaseOrderRuleError) {
      fail(res, e.status, e.message);
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '采购明细已被下游单据引用，无法重建明细');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============
export const removePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.purchaseOrder.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      select: { id: true, purchaseNo: true },
    });
    if (!existing) {
      fail(res, 404, '采购单不存在');
      return;
    }

    // PurchaseOrder → SalesOrder / Supplier / Payment 为 Restrict，明细为 Cascade：
    // 存在下游引用时由数据库拒绝（不自行改变 relation）。
    await prisma.purchaseOrder.delete({ where: { id: existing.id } });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PURCHASE_ORDER,
      businessId: existing.id,
      businessNo: existing.purchaseNo,
      summary: `${req.username ?? ''} 删除了采购单「${existing.purchaseNo}」`,
      ip: req.ip,
    });

    success(res, null, '删除成功');
  } catch (e) {
    if (isForeignKeyError(e)) {
      fail(res, 409, '该采购单存在收付款等下游单据，无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
