import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerLevel, IntentLevel } from "@prisma/client";
import { success, error } from "../utils/response";
import { activityLogger } from "../lib/activity-logger";
import { AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";
import { getNextNumber } from "../lib/numberSequence";
import { applyScope, includePublicSea, publicSeaScope, roleScope } from "../utils/scope";
import { BUSINESS_TYPE } from "../lib/business-type";
import { deriveStages, type PipelineStage } from "../utils/pipelineStage";
import {
  INTENT_LEVEL_ORDER,
  deriveCustomerIntentLevel,
  deriveCustomerIntentLevels,
  withCustomerIntent,
} from "../utils/customerIntent";
import * as XLSX from "xlsx";


// ========== V1.0 首次下单时间（firstOrderAt）查询语义 ==========
// 旧模型为字符串首单日期列，用 `startsWith(年)` / `not: ""` 表达年份与空值；
// V1.0 为 firstOrderAt(DateTime?)，必须改用日期区间 + null 谓词（禁止字符串语义）。

/** 当年首次下单：year-01-01 <= firstOrderAt < (year+1)-01-01（按服务端本地日历年度） */
const firstOrderAtInYear = (year: number) => ({
  gte: new Date(year, 0, 1),
  lt: new Date(year + 1, 0, 1),
});

/** 老客户：有首次下单时间且早于本年度（等价旧「非空且不以今年开头」） */
const firstOrderAtBeforeYear = (year: number) => ({
  not: null,
  lt: new Date(year, 0, 1),
});

// 辅助：获取客户销售订单聚合数据（V1.0：SalesOrder.totalAmountCny = 本币金额）
type OrderAgg = { totalAmount: number; lastOrderDate: string | null };
const getOrderAggregates = async (customerIds: string[]): Promise<Record<string, OrderAgg>> => {
  if (customerIds.length === 0) return {};
  const agg = await prisma.salesOrder.groupBy({
    by: ["customerId"],
    _sum: { totalAmountCny: true },
    _max: { orderDate: true },
    where: { customerId: { in: customerIds } },
  });
  const map: Record<string, OrderAgg> = {};
  for (const row of agg) {
    map[row.customerId] = {
      // 对外维持 number 契约：totalAmountCny 为 Decimal → 显式转 number
      totalAmount: Number(row._sum.totalAmountCny ?? 0),
      lastOrderDate: row._max.orderDate ? row._max.orderDate.toISOString() : null,
    };
  }
  return map;
};

// 辅助：获取客户商机金额聚合数据
type PipelineAgg = { pipelineAmount: number };
const getPipelineAggregates = async (customerIds: string[]): Promise<Record<string, PipelineAgg>> => {
  if (customerIds.length === 0) return {};
  const agg = await prisma.opportunity.groupBy({
    by: ["customerId"],
    _sum: { estimatedAmount: true },
    where: { customerId: { in: customerIds } },
  });
  const map: Record<string, PipelineAgg> = {};
  for (const row of agg) {
    if (!row.customerId) continue;
    map[row.customerId] = {
      pipelineAmount: Number(row._sum.estimatedAmount ?? 0),
    };
  }
  return map;
};

/**
 * 构建 `intentBreakdown`（D-INTENT v2）。
 *
 * 保持既有稀疏结构 `[{ level, count }]`（仅返回 count > 0 的等级；顺序 = 业务等级由低到高），
 * 唯一新增：末位「无意向」条目 —— 无商机 / 全部商机 intentLevel 为 null 时派生结果为 `null`，
 * 其 level 即 `null`（前端类型 `level: IntentLevel | null` 已兼容）。
 * 数据来源为**派生计数**（商机意向聚合），不读取 legacy 列 `Customer.intentLevel`。
 */
const buildIntentBreakdown = (
  counts: Map<IntentLevel, number>,
  noIntentCount: number,
): { level: IntentLevel | null; count: number }[] => {
  const rows: { level: IntentLevel | null; count: number }[] = INTENT_LEVEL_ORDER.map((level) => ({
    level: level as IntentLevel | null,
    count: counts.get(level) ?? 0,
  })).filter((row) => row.count > 0);
  if (noIntentCount > 0) rows.push({ level: null, count: noIntentCount });
  return rows;
};

// 统计维度
const getCustomerStats = async (ownerId?: string) => {
  const currentYear = new Date().getFullYear();
  let where: any;
  let totalWhere: any;

  if (ownerId) {
    where = { ownerId };
    totalWhere = { ownerId };
  } else {
    // 管理员视图：排除公海客户（ownerId 为 null）
    where = { ownerId: { not: null } };
    totalWhere = {};
  }

  const [total, newCustomers, oldCustomers, keyAccounts, intentGroups, noIntentCount] = await Promise.all([
    prisma.customer.count({ where: totalWhere }),
    prisma.customer.count({
      where: {
        ...where,
        firstOrderAt: firstOrderAtInYear(currentYear),
        isKeyAccount: false,
      },
    }),
    prisma.customer.count({
      where: {
        ...where,
        isKeyAccount: false,
        firstOrderAt: firstOrderAtBeforeYear(currentYear),
      },
    }),
    prisma.customer.count({
      where: { ...where, isKeyAccount: true },
    }),
    // D-INTENT v2（读时派生）Q1：商机侧 (customerId, intentLevel) 批量聚合 —— 单次 groupBy，无 N+1，
    // 不再读取 legacy 列 Customer.intentLevel，也不再以 isKeyAccount 作为过滤条件。
    prisma.opportunity.groupBy({
      by: ["customerId", "intentLevel"],
      where: { customer: where },
      _count: true,
    }),
    // D-INTENT v2 Q2：无意向客户 = 无商机 ∨ 全部商机 intentLevel 均为 null
    prisma.customer.count({
      where: { ...where, opportunities: { none: { intentLevel: { not: null } } } },
    }),
  ]);

  // 内存聚合：customerId → 最高意向（与列表/详情共用同一 primitive，口径完全一致）
  const derivedIntentByCustomer = deriveCustomerIntentLevels(intentGroups);
  const derivedIntentCounts = new Map<IntentLevel, number>();
  for (const level of derivedIntentByCustomer.values()) {
    if (level === null) continue;
    derivedIntentCounts.set(level, (derivedIntentCounts.get(level) ?? 0) + 1);
  }

  // 无订单客户（V1.0：firstOrderAt 为 null）
  const noOrder = await prisma.customer.count({
    where: {
      ...where,
      firstOrderAt: null,
      isKeyAccount: false,
    },
  });

  return {
    total,
    newCount: newCustomers,
    oldCount: oldCustomers,
    noOrderCount: noOrder,
    keyCount: keyAccounts,
    intentBreakdown: buildIntentBreakdown(derivedIntentCounts, noIntentCount),
  };
};

// 辅助：计算未成交 / 已成交各子筛选的客户数量（基于给定 scope，如 ownerId）
const getSubFilterCounts = async (baseWhere: any) => {
  const currentYear = new Date().getFullYear();
  const noOrderWhere = { ...baseWhere, salesOrders: { none: {} } };
  const doneWhere = { ...baseWhere, salesOrders: { some: {} } };
  const [A, B, C, D, none, newC, oldC] = await Promise.all([
    prisma.customer.count({ where: { ...noOrderWhere, opportunities: { some: { intentLevel: "READY" } } } }),
    prisma.customer.count({ where: { ...noOrderWhere, AND: [{ opportunities: { some: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "READY" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, AND: [{ opportunities: { some: { intentLevel: "MEDIUM" } } }, { opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, opportunities: { some: {} }, AND: [{ opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "MEDIUM" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, opportunities: { none: {} } } }),
    prisma.customer.count({ where: { ...doneWhere, firstOrderAt: firstOrderAtInYear(currentYear) } }),
    prisma.customer.count({ where: { ...doneWhere, firstOrderAt: firstOrderAtBeforeYear(currentYear) } }),
  ]);
  return {
    noOrderBreakdown: { '': A + B + C + D + none, A, B, C, D, none },
    doneBreakdown: { '': newC + oldC, new: newC, old: oldC },
  };
};

// ========== 获取我的私海客户 ==========
export const listMy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { keyword, type, country, page = "1", pageSize = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const currentYear = new Date().getFullYear();

    // 数据范围：按当前用户角色过滤（管理员看全部，普通用户按 ALL/DEPT/SELF 三档）
    // 公海视图仅返回无负责人的客户；其余视图 = 范围数据 + 公海（公海数据对集团开放）
    const isPublic = type === "public";
    const scope = isPublic ? publicSeaScope() : includePublicSea(await roleScope(req));
    const andConditions: any[] = scope && Object.keys(scope).length > 0 ? [scope] : [];

    // 关键词搜索
    if (keyword) {
      andConditions.push({
        OR: [
          { companyName: { contains: String(keyword) } },
          { contactName: { contains: String(keyword) } },
          { email: { contains: String(keyword) } },
          { phone: { contains: String(keyword) } },
        ],
      });
    }

    // 国家筛选
    if (country) {
      andConditions.push({ country: String(country) });
    }

    // 类型筛选（probability 现在直接存储采购意向文案，按字符串精确匹配等级）
    // V1.0：Customer.orders → Customer.salesOrders；旧字符串首单日期 → firstOrderAt(日期区间)
    if (type === "key") {
      andConditions.push({ isKeyAccount: true });
    } else if (type === "noOrder") {
      andConditions.push({ salesOrders: { none: {} } });
    } else if (type === "noOrder-none") {
      // 待开发：未成交且无商机记录
      andConditions.push({ salesOrders: { none: {} }, opportunities: { none: {} } });
    } else if (type === "noOrder-A") {
      andConditions.push({ salesOrders: { none: {} }, opportunities: { some: { intentLevel: "READY" } } });
    } else if (type === "noOrder-B") {
      andConditions.push({ salesOrders: { none: {} }, AND: [{ opportunities: { some: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "READY" } } }] });
    } else if (type === "noOrder-C") {
      andConditions.push({ salesOrders: { none: {} }, AND: [{ opportunities: { some: { intentLevel: "MEDIUM" } } }, { opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }] });
    } else if (type === "noOrder-D") {
      // 低意向：未成交 + 有商机记录 + 非 A/B/C 意向（排除待开发客户）
      andConditions.push({ salesOrders: { none: {} }, opportunities: { some: {} }, AND: [{ opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "MEDIUM" } } }] });
    } else if (type === "done") {
      andConditions.push({ salesOrders: { some: {} } });
    } else if (type === "done-new") {
      andConditions.push({ salesOrders: { some: {} }, firstOrderAt: firstOrderAtInYear(currentYear) });
    } else if (type === "done-old") {
      andConditions.push({
        salesOrders: { some: {} },
        firstOrderAt: firstOrderAtBeforeYear(currentYear),
      });
    }

    const where: any = { AND: andConditions };

    const [list, total, stats, subFilterCounts] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: [{ firstOrderAt: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { salesOrders: true, opportunities: true } },
          opportunities: { select: { intentLevel: true } },
        },
      }),
      prisma.customer.count({ where }),
      getCustomerStats(userId),
      getSubFilterCounts({ ownerId: userId }),
    ]);

    // 针对当前筛选条件的全量聚合（来自商机记录，非分页）
    // V1.0：订单金额取 SalesOrder.totalAmountCny（本币），不使用旧订单金额列
    const [estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg] = await Promise.all([
      prisma.opportunity.aggregate({
        where: { customer: where },
        _sum: { estimatedAmount: true },
      }),
      prisma.salesOrder.aggregate({
        where: { customer: where },
        _sum: { totalAmountCny: true },
      }),
      prisma.opportunity.groupBy({
        by: ['intentLevel'],
        where: { customer: where },
        _sum: { estimatedAmount: true },
        _count: true,
      }),
      // 新客户成交金额
      prisma.salesOrder.aggregate({
        where: {
          customer: {
            AND: [
              ...(where.AND || []),
              { firstOrderAt: firstOrderAtInYear(currentYear) },
              { isKeyAccount: false },
            ],
          },
        },
        _sum: { totalAmountCny: true },
      }),
      // 老客户成交金额
      prisma.salesOrder.aggregate({
        where: {
          customer: {
            AND: [
              ...(where.AND || []),
              { isKeyAccount: false },
              { firstOrderAt: firstOrderAtBeforeYear(currentYear) },
            ],
          },
        },
        _sum: { totalAmountCny: true },
      }),
    ]);

    const contractBreakdown = [
      { type: '新客户', amount: Number(newAmountAgg._sum.totalAmountCny ?? 0) },
      { type: '老客户', amount: Number(oldAmountAgg._sum.totalAmountCny ?? 0) },
    ];

    const [orderAgg, pipelineAgg] = await Promise.all([
      getOrderAggregates(list.map((c) => c.id)),
      getPipelineAggregates(list.map((c) => c.id)),
    ]);
    const enriched = list.map((c) =>
      // D-INTENT v2：Customer.intentLevel 以商机最高意向**派生值**覆盖（不读 legacy 存储列）
      withCustomerIntent({
        ...c,
        totalAmount: orderAgg[c.id]?.totalAmount || 0,
        lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
        pipelineAmount: pipelineAgg[c.id]?.pipelineAmount || 0,
      }),
    );

    success(res, { list: enriched, total, page: Number(page), pageSize: take, stats, ...subFilterCounts, estimatedAmount: estimatedAgg._sum.estimatedAmount || 0, totalContractAmount: Number(totalAmountAgg._sum.totalAmountCny ?? 0), estimatedBreakdown, contractBreakdown });
  } catch (err) {
    next(err);
  }
};

// ========== 获取公海客户 ==========
export const listPublic = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { keyword, country, page = "1", pageSize = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const publicOwnerFilter = [{ ownerId: null }];

    let where: any;
    if (keyword) {
      const keywordFilter = [
        { companyName: { contains: String(keyword) } },
        { contactName: { contains: String(keyword) } },
        { country: { contains: String(keyword) } },
      ];
      where = {
        AND: [
          { OR: publicOwnerFilter },
          { OR: keywordFilter },
        ],
      };
    } else {
      where = { OR: publicOwnerFilter };
    }
    if (country) where.country = String(country);

    const [list, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: [{ firstOrderAt: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { salesOrders: true } },
          opportunities: { select: { intentLevel: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    const orderAgg = await getOrderAggregates(list.map((c) => c.id));
    const enriched = list.map((c) =>
      // D-INTENT v2：Customer.intentLevel 以商机最高意向**派生值**覆盖（不读 legacy 存储列）
      withCustomerIntent({
        ...c,
        totalAmount: orderAgg[c.id]?.totalAmount || 0,
        lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
      }),
    );

    success(res, { list: enriched, total, page: Number(page), pageSize: take });
  } catch (err) {
    next(err);
  }
};

// ========== 轻量归属查询（线索表单 onBlur 去重 / 归属判定专用） ==========
/**
 * GET /customers/ownership?companyName=xxx
 *
 * 跨全员检索（刻意**不套数据权限 scope**），按公司名称精确匹配，
 * 仅返回归属状态码 + 命中客户主键 + 负责人姓名，**绝不返回任何具体客户资料**。
 *
 * 设计要点（与 listAll / listPublic 的本质区别）：
 *  - 不套 `roleScope / includePublicSea` ⇒ 普通用户也能检测到「某公司已被他人建档」，
 *    否则会误判为未建档进而导致重复建档（违背去重初衷）；
 *  - 只 `select` 主键 + 负责人，避免拉取全量客户列表（原前端每次 onBlur 拉取最多 400 条完整记录）；
 *  - 返回 `code` 枚举：NOT_FOUND（未建档）/ OWNED_BY_ME（本人已建档）/
 *    OWNED_BY_OTHER（他人负责，附 ownerName）/ IN_PUBLIC_SEA（公海）。
 */
export const checkOwnership = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const name = (req.query.companyName as string | undefined)?.trim();
    if (!name) return error(res, "companyName required", 400);

    // 注意：**不套用 roleScope**，跨全员检索；companyName 已有索引，精确匹配高效。
    const hit = await prisma.customer.findFirst({
      where: { companyName: name },
      select: {
        id: true,
        ownerId: true,
        owner: { select: { realName: true, username: true } },
      },
    });

    if (!hit) {
      return success(res, { code: "NOT_FOUND" });
    }

    let code: "OWNED_BY_ME" | "OWNED_BY_OTHER" | "IN_PUBLIC_SEA";
    let ownerName: string | undefined;
    if (!hit.ownerId) {
      code = "IN_PUBLIC_SEA";
    } else if (hit.ownerId === req.userId) {
      code = "OWNED_BY_ME";
    } else {
      code = "OWNED_BY_OTHER";
      ownerName = hit.owner?.realName || hit.owner?.username;
    }
    return success(res, { code, customerId: hit.id, ownerName });
  } catch (err) {
    next(err);
  }
};

// ========== 客户下拉选项：我的私海 + 公海；管理员为全部 ==========
export const listOptions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where: any = await roleScope(req);
    const list = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        customerNo: true,
        email: true,
        phone: true,
        country: true,
        customerType: true,
        channelId: true,
        shopId: true,
        contactMethods: true,
        ownerId: true,
      },
      orderBy: { companyName: "asc" },
    });
    success(res, list);
  } catch (err) {
    next(err);
  }
};

// ========== 管理员：查看所有客户（按业务员分组） ==========
export const listAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { keyword, ownerId, type, country, page = "1", pageSize = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);
    const currentYear = new Date().getFullYear();

    const where: any = {};
    const andConditions: any[] = [];

    if (keyword) {
      andConditions.push({
        OR: [
          { companyName: { contains: String(keyword) } },
          { contactName: { contains: String(keyword) } },
        ],
      });
    }
    if (country) andConditions.push({ country: String(country) });

    if (type === "public") {
      // 公海客户：仅 ownerId 为 null
      andConditions.push({ ownerId: null });
    } else if (ownerId) {
      andConditions.push({ ownerId: String(ownerId) });
    } else {
      // 团队客户（已认领）：排除公海
      andConditions.push({ ownerId: { not: null } });
    }

    // 类型筛选（probability 现在直接存储采购意向文案，按字符串精确匹配等级）
    // V1.0：Customer.orders → Customer.salesOrders；旧字符串首单日期 → firstOrderAt(日期区间)
    if (type === "key") {
      andConditions.push({ isKeyAccount: true });
    } else if (type === "noOrder") {
      andConditions.push({ salesOrders: { none: {} } });
    } else if (type === "noOrder-none") {
      // 待开发：未成交且无商机记录
      andConditions.push({ salesOrders: { none: {} }, opportunities: { none: {} } });
    } else if (type === "noOrder-A") {
      andConditions.push({ salesOrders: { none: {} }, opportunities: { some: { intentLevel: "READY" } } });
    } else if (type === "noOrder-B") {
      andConditions.push({ salesOrders: { none: {} }, AND: [{ opportunities: { some: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "READY" } } }] });
    } else if (type === "noOrder-C") {
      andConditions.push({ salesOrders: { none: {} }, AND: [{ opportunities: { some: { intentLevel: "MEDIUM" } } }, { opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }] });
    } else if (type === "noOrder-D") {
      // 低意向：未成交 + 有商机记录 + 非 A/B/C 意向（排除待开发客户）
      andConditions.push({ salesOrders: { none: {} }, opportunities: { some: {} }, AND: [{ opportunities: { none: { intentLevel: "READY" } } }, { opportunities: { none: { intentLevel: "HIGH" } } }, { opportunities: { none: { intentLevel: "MEDIUM" } } }] });
    } else if (type === "done") {
      andConditions.push({ salesOrders: { some: {} } });
    } else if (type === "done-new") {
      andConditions.push({ salesOrders: { some: {} }, firstOrderAt: firstOrderAtInYear(currentYear) });
    } else if (type === "done-old") {
      andConditions.push({
        salesOrders: { some: {} },
        firstOrderAt: firstOrderAtBeforeYear(currentYear),
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const listAllScope = ownerId ? { ownerId: String(ownerId) } : { ownerId: { not: null } };
    const [list, total, assignees, subFilterCounts] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: [{ firstOrderAt: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { salesOrders: true, opportunities: true } },
          opportunities: { select: { intentLevel: true } },
        },
      }),
      prisma.customer.count({ where }),
      // 获取所有业务员列表及其客户分布（排除管理员）
      // V1.0：Customer.owner 的反向关系名为 User.ownedCustomers（旧 User.customers 已不存在）
      prisma.user.findMany({
        where: {
          status: "ACTIVE",
          role: { code: { not: "admin" } },
        },
        select: {
          id: true,
          username: true,
          realName: true,
          _count: { select: { ownedCustomers: true } },
          ownedCustomers: {
            where: { isKeyAccount: true },
            select: { id: true },
          },
        },
      }),
      getSubFilterCounts(listAllScope),
    ]);

    // 针对当前筛选条件的全量聚合（来自商机记录，非分页）
    // V1.0：订单金额取 SalesOrder.totalAmountCny（本币），不使用旧订单金额列
    const [estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg] = await Promise.all([
      prisma.opportunity.aggregate({
        where: { customer: where as any },
        _sum: { estimatedAmount: true },
      }),
      prisma.salesOrder.aggregate({
        where: { customer: where as any },
        _sum: { totalAmountCny: true },
      }),
      prisma.opportunity.groupBy({
        by: ['intentLevel'],
        where: { customer: where as any },
        _sum: { estimatedAmount: true },
        _count: true,
      }),
      // 新客户成交金额
      prisma.salesOrder.aggregate({
        where: {
          customer: {
            AND: [
              ...(andConditions.length > 0 ? andConditions : []),
              { firstOrderAt: firstOrderAtInYear(currentYear) },
              { isKeyAccount: false },
            ],
          },
        },
        _sum: { totalAmountCny: true },
      }),
      // 老客户成交金额
      prisma.salesOrder.aggregate({
        where: {
          customer: {
            AND: [
              ...(andConditions.length > 0 ? andConditions : []),
              { isKeyAccount: false },
              { firstOrderAt: firstOrderAtBeforeYear(currentYear) },
            ],
          },
        },
        _sum: { totalAmountCny: true },
      }),
    ]);

    const contractBreakdown = [
      { type: '新客户', amount: Number(newAmountAgg._sum.totalAmountCny ?? 0) },
      { type: '老客户', amount: Number(oldAmountAgg._sum.totalAmountCny ?? 0) },
    ];

    const [orderAgg, pipelineAgg] = await Promise.all([
      getOrderAggregates(list.map((c) => c.id)),
      getPipelineAggregates(list.map((c) => c.id)),
    ]);
    const enriched = list.map((c) =>
      // D-INTENT v2：Customer.intentLevel 以商机最高意向**派生值**覆盖（不读 legacy 存储列）
      withCustomerIntent({
        ...c,
        totalAmount: orderAgg[c.id]?.totalAmount || 0,
        lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
        pipelineAmount: pipelineAgg[c.id]?.pipelineAmount || 0,
      }),
    );

    const ownerStats = assignees.map((u) => ({
      id: u.id,
      username: u.username,
      realName: u.realName,
      customerCount: u._count.ownedCustomers,
      keyCount: u.ownedCustomers.length,
    }));

    // 公海统计（仅 ownerId 为 null）
    const publicWhere: any = { ownerId: null };
    const publicCount = await prisma.customer.count({ where: publicWhere });

    // 排除公海的统计条件
    const withOwnerWhere: any = { ownerId: { not: null } };

    // 总统计
    const [totalAll, newAll, oldAll, keyAll] = await Promise.all([
      prisma.customer.count(),
      prisma.customer.count({
        where: {
          firstOrderAt: firstOrderAtInYear(currentYear),
          isKeyAccount: false,
          ...withOwnerWhere,
        },
      }),
      prisma.customer.count({
        where: {
          isKeyAccount: false,
          ...withOwnerWhere,
          firstOrderAt: firstOrderAtBeforeYear(currentYear),
        },
      }),
      prisma.customer.count({ where: { isKeyAccount: true } }),
    ]);

    success(res, {
      list: enriched,
      total,
      page: Number(page),
      pageSize: take,
      ownerStats,
      publicCount,
      ...subFilterCounts,
      stats: { total: totalAll, newCount: newAll, oldCount: oldAll, keyCount: keyAll },
      estimatedAmount: estimatedAgg._sum.estimatedAmount || 0,
      totalContractAmount: Number(totalAmountAgg._sum.totalAmountCny ?? 0),
      estimatedBreakdown,
      contractBreakdown,
    });
  } catch (err) {
    next(err);
  }
};

// ========== 客户详情（含订单列表） ==========
export const getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // F-3C4-05：客户详情必须施加**规范化客户读取边界**（与 listMy 非 public 分支同口径）：
    //   includePublicSea(roleScope) ⇒ SELF/DEPT = 本人/本部门 ∪ 公海；ALL/admin = 全量。
    //   ⇒ 他人所属客户不可见（404），公海客户按既有公海规则可见。
    // scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
    const customer = await prisma.customer.findFirst({
      where: applyScope(
        { id: req.params.id },
        includePublicSea(await roleScope(req)),
      ),
      include: {
        owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
        // V1.0：Customer.orders → Customer.salesOrders；按 SalesOrder 实际 schema 选取字段
        // 【Round 3C-2-1 · P0-1】additive 扩投影：补齐 Customer Domain 所需字段（items / remark /
        // paidAmountCny / opportunityId）。属最小必要投影，不返回 SalesOrderItem 全字段。
        // 旧 Order 的 type / stage / 打样-生产-出运时间轴字段在 V1.0 **无对应且不恢复**（见 3C-2-0 §18 P0-2）：
        //   · 旧 type=SAMPLE   → V1.0 由 `sampleOrderId` 表达（独立打样域）
        //   · 旧 type=SHIPPED  → V1.0 由 `status === 'SHIPPED'` 表达
        //   · 旧 pipelineId    → V1.0 由 `opportunityId` 表达
        salesOrders: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            orderNo: true,
            status: true,
            currency: true,
            totalAmount: true,
            totalAmountCny: true,
            paidAmountCny: true, // 已收累计（Payment direction=IN + status=CONFIRMED 汇总回写）
            orderDate: true,
            deliveryDate: true,
            sampleOrderId: true,
            quotationId: true,
            opportunityId: true, // V1.0 canonical（旧 Order.pipelineId 的对应字段）
            remark: true, // CustomerOverview 品类分布提取依赖
            items: {
              // 订单明细（最小必要投影）
              orderBy: { sort: "asc" },
              select: {
                id: true,
                lineNo: true,
                productId: true,
                productName: true,
                spec: true,
                quantity: true,
                unit: true,
                unitPrice: true,
                amount: true,
                currency: true,
              },
            },
            createdAt: true,
          },
        },
        opportunities: {
          orderBy: { createdAt: "desc" },
          include: { owner: { select: { id: true, username: true, realName: true } } },
        },
        activities: {
          orderBy: { createdAt: "asc" },
          take: 50,
        },
      },
    });
    if (!customer) return error(res, "客户不存在", 404);
    // D-INTENT v2：响应中的 intentLevel 一律为**派生值**（opportunities 已 include，零额外查询）
    success(res, withCustomerIntent(customer));
  } catch (err) {
    next(err);
  }
};

// ========== V1.0 写入入参校验（zod）==========
// 原则：Schema → Zod → Controller → Prisma 语义一致；非法 enum / 类型 / 日期 → 400，
// 不得让非法值进入 Prisma 变成 500。未知字段（含 legacy estimatedAmount）被 zod 忽略。

/** tags 归一：null / undefined → []；字符串按 `,` / `，` 拆分；数组逐项 trim 去空 */
const tagsField = z
  .union([z.array(z.string()), z.string(), z.null()])
  .optional()
  .transform((value): string[] => {
    if (value === null || value === undefined) return [];
    const list = Array.isArray(value) ? value : value.split(/[,，]/);
    return list.map((item) => item.trim()).filter((item) => item.length > 0);
  });

/** 主图入参：新字段 coverImage 优先，兼容旧字段名 images（数组取首个非空字符串） */
const coverImageField = z.union([z.string(), z.array(z.string()), z.null()]).optional();

/** 日期解析：Date / 日期字符串 / Excel 序列号 → Date；null 与 '' → null；无法解析 → 'invalid' */
function parseDateInput(value: unknown): Date | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid' : value;
  if (typeof value === 'number') {
    // Excel 1900 日期系统序列号（如 46265 → 2026-09-14）
    if (!Number.isFinite(value) || value <= 0 || value > 60000) return 'invalid';
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed;
  }
  return 'invalid';
}

/** 日期字段：未传 → undefined（保持原值）；null / '' → null（清空）；解析失败 → 400 */
const dateField = z
  .union([z.string(), z.number(), z.date(), z.null()])
  .optional()
  .refine((value) => value === undefined || parseDateInput(value) !== 'invalid', {
    message: '日期格式不正确',
  })
  .transform((value) => (value === undefined ? undefined : (parseDateInput(value) as Date | null)));

/** 主图归一：coverImage 优先，images 仅作兼容输入；两者都不会同时写入 */
function normalizeCoverImage(input: { coverImage?: unknown; images?: unknown }): string | null | undefined {
  const pick = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
      return typeof first === 'string' ? first.trim() : null;
    }
    if (typeof value === 'string') return value.trim() || null;
    return undefined;
  };
  const fromCoverImage = pick(input.coverImage);
  return fromCoverImage !== undefined ? fromCoverImage : pick(input.images);
}

/** tags 语义比较（顺序无关，均为 string[]） */
function sameTags(a: string[], b: string[] | null | undefined): boolean {
  const left = [...a].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

// F-CRM-CHANNEL：拆分组合来源值（与 lead.controller.splitSourceKey 同语义）
// sourceKey = JSON `{channelId, shopId}`，入库前拆为独立列；解析失败回退显式 channelId/shopId。
function splitSourceKey(raw?: string | null): { channelId?: string | null; shopId?: string | null } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { channelId?: string; shopId?: string };
    if (parsed && typeof parsed === 'object') {
      return { channelId: parsed.channelId ?? null, shopId: parsed.shopId ?? null };
    }
  } catch {
    /* 非 JSON 则忽略，回退到显式 channelId/shopId */
  }
  return {};
}

// 校验渠道/平台引用合法性（存在 + ACTIVE + 父子一致性），失败写 400 并返回 false
async function validateChannelShopCustomer(
  res: Response,
  channelId: string | null | undefined,
  shopId: string | null | undefined,
): Promise<boolean> {
  if (channelId) {
    const ch = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, status: true } });
    if (!ch || ch.status !== 'ACTIVE') {
      error(res, '来源渠道不存在', 400);
      return false;
    }
  }
  if (shopId) {
    const shop = await prisma.channel.findUnique({ where: { id: shopId }, select: { id: true, parentId: true, status: true } });
    if (!shop || shop.status !== 'ACTIVE') {
      error(res, '来源平台不存在', 400);
      return false;
    }
    if (channelId && shop.parentId !== channelId) {
      error(res, '来源平台不属于所选来源渠道', 400);
      return false;
    }
  }
  return true;
}

const customerCreateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200),
  contactName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().max(100).nullish(),
  industry: z.string().trim().max(100).nullish(), // 所属行业（非必填）
  website: z.string().trim().max(500).nullish(), // 公司官网（非必填）
  customerType: z.string().trim().max(100).nullish(),
  // F-CRM-CHANNEL：承接线索转客户带入的渠道·平台组合来源（与 Lead.channelId/shopId 同义）
  sourceKey: z.string().trim().max(500).nullish(),
  channelId: z.string().trim().max(50).nullish(),
  shopId: z.string().trim().max(50).nullish(),
  // 联系方式（与 Lead.contactMethods 一致：[{tool, account}] 数组）
  contactMethods: z.any().nullish(),
  // D-SOURCE-2：Customer.source 由 API 业务语义固定为 MANUAL ⇒ create 不接受 source 入参
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，**不再接受人工输入**（无 intentLevel 入参）
  coverImage: coverImageField,
  images: coverImageField,
});

const customerUpdateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200).optional(),
  englishName: z.string().trim().max(200).nullish(),
  industry: z.string().trim().max(100).nullish(), // 所属行业（非必填）
  website: z.string().trim().max(500).nullish(), // 公司官网（非必填）
  contactName: z.string().trim().max(100).nullish(),
  position: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  wechat: z.string().trim().max(100).nullish(),
  country: z.string().trim().max(100).nullish(),
  region: z.string().trim().max(100).nullish(),
  customerLevel: z.nativeEnum(CustomerLevel).optional(),
  customerType: z.string().trim().max(100).nullish(),
  // F-CRM-CHANNEL：编辑时也允许改写渠道·平台组合来源
  sourceKey: z.string().trim().max(500).nullish(),
  channelId: z.string().trim().max(50).nullish(),
  shopId: z.string().trim().max(50).nullish(),
  contactMethods: z.any().nullish(),
  // D-SOURCE-4：普通 update 不得修改 Customer.source ⇒ 不接受 source 入参
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，**不再接受人工输入/修改**（无 intentLevel 入参）
  // 首次下单日期：V1.0 字段 firstOrderAt 优先（下方末键为 1D 保留的旧入参兼容别名）
  firstOrderAt: dateField,
  firstOrderDate: dateField,
  coverImage: coverImageField,
  images: coverImageField,
});

/** Excel 导入逐行校验（非法 enum / 日期 → 该行失败并计入 failed，不产生 500） */
const customerImportSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空'),
  contactName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().max(100).nullish(),
  // D-SOURCE-3：Excel 导入的 source 由 API 业务语义固定为 EXCEL ⇒ 不接受「来源 / source」列
  notes: z.string().trim().max(2000).nullish(),
  isKeyAccount: z.boolean().optional(),
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，Excel 导入不接受该列
  firstOrderAt: dateField,
});

// ========== 创建客户 ==========
export const create = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const username = req.username!;
    // V1.0 入参校验：非法 enum / 类型 / tags → 400；未知字段（含 legacy estimatedAmount）被忽略
    const body = customerCreateSchema.parse(req.body);

    // F-CRM-CHANNEL：来源拆分（sourceKey 优先于显式 channelId/shopId），并校验引用合法性
    const fromSourceKey = splitSourceKey(body.sourceKey);
    const channelId = fromSourceKey.channelId !== undefined ? fromSourceKey.channelId : (body.channelId ?? null);
    const shopId = fromSourceKey.shopId !== undefined ? fromSourceKey.shopId : (body.shopId ?? null);
    if (!(await validateChannelShopCustomer(res, channelId, shopId))) return;

    // 如果 ownerId 传入 null 则放入公海；未传入则归当前用户
    const finalOwnerId: string | null = body.ownerId !== undefined ? body.ownerId : userId;

    // F-NEW-20b / DQ-8-A（= F-NEW-20 同规则）：显式非空 `ownerId` 属**请求可控的 ownership mutation**，
    // 目标用户必须「存在 + ACTIVE + ∈ caller dataScope」，且必须**先于**事务与任何写入
    // （authorization before mutation）。`null` = 公海、`undefined` = 归当前用户，均不触发校验。
    if (body.ownerId !== undefined && body.ownerId !== null) {
      const targetOwner = await prisma.user.findFirst({
        where: applyScope({ id: body.ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true, status: true },
      });
      if (!targetOwner) {
        return error(res, "业务归属人不存在或无权限指派", 400);
      }
      if (targetOwner.status !== 'ACTIVE') {
        return error(res, "目标用户不存在或已停用", 400);
      }
    }

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const customer = await prisma.$transaction(async (tx) => {
      const customerNo = await getNextNumber(tx, "CUS");

      return tx.customer.create({
        data: {
          customerNo,
          companyName: body.companyName,
          contactName: body.contactName ?? null,
          industry: body.industry ?? null,
          website: body.website ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          country: body.country ?? null,
          customerType: body.customerType ?? null,
          channelId: channelId ?? null,
          shopId: shopId ?? null,
          contactMethods: body.contactMethods ?? null,
          coverImage: normalizeCoverImage(body) ?? null,
          // D-SOURCE-2：手工创建由 API 业务语义固定为 MANUAL（显式赋值，不依赖 DB default）
          source: "MANUAL",
          notes: body.notes ?? null,
          ownerId: finalOwnerId,
          isKeyAccount: body.isKeyAccount ?? false,
          // V1.0：Customer.tags 为 PG 原生数组（String[]），不接受逗号字符串
          tags: body.tags ?? [],
          // D-INTENT v2：intentLevel 由商机读时派生 ⇒ 创建时不写入（legacy 列不再接受人工赋值）
        },
      });
    });

    await activityLogger.log({
      userId,
      username,
      action: "CREATED",
      module: "customer",
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: customer.id,
      businessNo: customer.customerNo,
      summary: `创建客户：${body.companyName}`,
      customerId: customer.id,
    });

    // D-INTENT v2：新建客户必然没有关联商机 ⇒ 派生意向为 null（D-INTENT-4 的最小、确定性结果；
    // 不为此额外查询 Opportunity，也不读取 legacy 列）
    success(res, { ...customer, intentLevel: null }, "创建成功");
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(res, err.errors.map((e) => e.message).join("；"), 400);
    }
    next(err);
  }
};

// ========== 更新客户 ==========
export const update = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const username = req.username!;
    const userId = req.userId!;
    const roleCode = req.roleCode;
    // V1.0 入参校验：非法 enum / 类型 / 日期 → 400；未知字段（含 legacy estimatedAmount）被忽略
    const body = customerUpdateSchema.parse(req.body);
    const {
      companyName,
      contactName,
      englishName,
      industry,
      website,
      position,
      email,
      phone,
      wechat,
      country,
      region,
      customerLevel,
      customerType,
      notes,
      ownerId,
      isKeyAccount,
      tags,
    } = body;

    // 主图：coverImage 优先，images 仅作兼容输入
    const coverImage = normalizeCoverImage(body);
    // 首次下单日期：firstOrderAt（V1.0）优先，兼容旧入参别名；内部只写 firstOrderAt
    const firstOrderAt = body.firstOrderAt !== undefined ? body.firstOrderAt : body.firstOrderDate;

    // BC-8-2（DQ-8-C）：目标客户必须落在调用方客户可见范围（owner ∪ 公海 ∪ admin/ALL）；
    // scope 外与不存在同为 404 `客户不存在`（移除「存在但非本人」403 oracle）。
    const existing = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
      // D-INTENT v2：复用**既有**响应/授权查询结构附带商机意向投影（不新增查询、不产生 N+1），
      // 供本 handler 的响应返回派生意向；商机集合不被本 handler 修改。
      include: { opportunities: { select: { intentLevel: true } } },
    });
    if (!existing) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以编辑（不可操作时与不存在同响应，不泄露存在性）
    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "客户不存在", 404);
    }

    // F-NEW-20 / DQ-8-A（= BC-8-1 同规则）：`ownerId` 与 transfer 的 `newOwnerId` 同属
    // Customer ownership mutation ⇒ 显式非空用户必须通过**同一**目标用户授权
    // （存在 + ACTIVE + ∈ caller dataScope），且必须**先于** customer.update（authorization before mutation）。
    // `null` = 进入公海（既有契约，不校验）；`undefined` = 不注入、保留原值（不校验）。
    if (ownerId !== undefined && ownerId !== null) {
      const targetOwner = await prisma.user.findFirst({
        where: applyScope({ id: ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true, status: true },
      });
      if (!targetOwner) {
        return error(res, "业务归属人不存在或无权限指派", 400);
      }
      if (targetOwner.status !== 'ACTIVE') {
        return error(res, "目标用户不存在或已停用", 400);
      }
    }

    const changes: string[] = [];
    if (companyName && companyName !== existing.companyName) changes.push(`公司名: ${existing.companyName} → ${companyName}`);
    if (isKeyAccount !== undefined && isKeyAccount !== existing.isKeyAccount) {
      const a = existing.isKeyAccount ? "取消重点" : "标记为重点";
      changes.push(`${a}客户`);
    }
    // D-INTENT v2：Customer.intentLevel 已非人工字段 ⇒ 不再记录「意向等级变更」日志
    // （Opportunity.intentLevel 的维护与留痕不受本规则影响）
    if (tags !== undefined && !sameTags(tags, existing.tags)) changes.push(`标签已更新`);

    // F-CRM-CHANNEL：编辑时来源组合（sourceKey 优先；否则显式 channelId/shopId；否则保留原值），
    // 先与持久值补齐构成有效组合再校验父子一致性，最后整体落库。
    const fromSourceKey = splitSourceKey(body.sourceKey);
    let effChannelId = existing.channelId;
    let effShopId = existing.shopId;
    if (fromSourceKey.channelId !== undefined) effChannelId = fromSourceKey.channelId;
    else if (body.channelId !== undefined) effChannelId = body.channelId;
    if (fromSourceKey.shopId !== undefined) effShopId = fromSourceKey.shopId;
    else if (body.shopId !== undefined) effShopId = body.shopId;
    if (!(await validateChannelShopCustomer(res, effChannelId, effShopId))) return;

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        // V1.0：仅写入 Customer 标量；未传字段（undefined）不出现在 data 中 → 保持原值
        ...(companyName !== undefined ? { companyName } : {}),
        ...(contactName !== undefined ? { contactName } : {}),
        ...(englishName !== undefined ? { englishName } : {}),
        ...(industry !== undefined ? { industry } : {}),
        ...(website !== undefined ? { website } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(wechat !== undefined ? { wechat } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(region !== undefined ? { region } : {}),
        ...(coverImage !== undefined ? { coverImage } : {}),
        ...(customerLevel !== undefined ? { customerLevel } : {}),
        ...(customerType !== undefined ? { customerType } : {}),
        channelId: effChannelId ?? null,
        shopId: effShopId ?? null,
        ...(body.contactMethods !== undefined ? { contactMethods: body.contactMethods ?? null } : {}),
        // D-SOURCE-4：普通 update 不写 source（该字段不可由普通 Customer API 修改）
        ...(notes !== undefined ? { notes } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(isKeyAccount !== undefined ? { isKeyAccount } : {}),
        // V1.0：Customer.tags 为 PG 原生数组（String[]）
        ...(tags !== undefined ? { tags } : {}),
        // D-INTENT v2：不再写入 intentLevel（系统派生字段；isKeyAccount 与客户意向完全解耦）
        // V1.0：字段为 firstOrderAt（DateTime?）；不再写入旧字符串列
        ...(firstOrderAt !== undefined ? { firstOrderAt } : {}),
      },
    });

    if (changes.length > 0) {
      await activityLogger.log({
        userId,
        username,
        action: "UPDATED",
        module: "customer",
        businessType: BUSINESS_TYPE.CUSTOMER,
        businessId: id,
        businessNo: customer.customerNo,
        summary: changes.join("；"),
        customerId: id,
      });
    }

    // D-INTENT v2：响应 intentLevel 为派生值（本 handler 不修改商机集合，故复用已读取的 opportunities）
    success(res, { ...customer, intentLevel: deriveCustomerIntentLevel(existing.opportunities) }, "更新成功");
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(res, err.errors.map((e) => e.message).join("；"), 400);
    }
    next(err);
  }
};

// ========== 删除客户 ==========
export const remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const roleCode = req.roleCode;
    // BC-8-2（DQ-8-C）：scoped 目标解析；scope 外与不存在同为 404（不泄露存在性）
    const existing = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
    });
    if (!existing) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以删除（不可操作时与不存在同响应）
    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "客户不存在", 404);
    }

    await prisma.customer.delete({ where: { id } });
    success(res, null, "删除成功");
  } catch (err) {
    next(err);
  }
};

// ========== 认领客户（公海 → 私海） ==========
export const claim = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const username = req.username!;
    const { id } = req.params;

    // BC-8-2（DQ-8-C）：公海客户对全体已认证用户可见（公海语义保留 ⇒ 仍可达「可认领」分支）；
    // 他人已认领且不在 caller scope 的客户 → 404（不泄露存在性）。
    const customer = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
    });
    if (!customer) return error(res, "客户不存在", 404);

    // 公海客户：仅 ownerId 为 null
    const isPublic = !customer.ownerId;
    if (!isPublic) return error(res, "该客户已被认领", 400);

    await prisma.customer.update({
      where: { id },
      data: { ownerId: userId },
    });

    await activityLogger.log({
      userId,
      username,
      action: "CLAIM",
      module: "customer",
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: id,
      businessNo: customer.customerNo,
      summary: `${username} 认领了该客户`,
      customerId: id,
    });

    success(res, null, "认领成功");
  } catch (err) {
    next(err);
  }
};

// ========== 释放客户（私海 → 公海） ==========
export const release = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const username = req.username!;
    const userId = req.userId!;
    const roleCode = req.roleCode;
    const { id } = req.params;

    // BC-8-2（DQ-8-C）：scoped 目标解析（公海并入 ⇒ 公海客户仍可见，「已在公海」业务分支保持可达）
    const customer = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
    });
    if (!customer) return error(res, "客户不存在", 404);

    // 公海客户：仅 ownerId 为 null
    if (!customer.ownerId) {
      return error(res, "该客户已在公海", 400);
    }

    // 只有客户归属人或管理员可以释放（不可操作时与不存在同响应，不泄露存在性）
    if (customer.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "客户不存在", 404);
    }

    await prisma.customer.update({
      where: { id },
      data: { ownerId: null, isKeyAccount: false },
    });

    await activityLogger.log({
      userId,
      username,
      action: "RELEASE",
      module: "customer",
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: id,
      businessNo: customer.customerNo,
      summary: `${username} 释放该客户到公海`,
      customerId: id,
    });

    success(res, null, "释放成功");
  } catch (err) {
    next(err);
  }
};

// ========== 转交客户（管理员操作） ==========
export const transfer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { newOwnerId } = req.body;
    const username = req.username!;
    const userId = req.userId!;
    const roleCode = req.roleCode;

    // BC-8-2（DQ-8-C）：scoped 目标解析；不可操作时与不存在同响应 404。
    const customer = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
      include: { owner: { select: { id: true, realName: true } } },
    });
    if (!customer) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以转交（3C-8-1a 裁定：actor gate = owner | admin，保持不变）
    if (customer.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "客户不存在", 404);
    }

    if (!newOwnerId) return error(res, "请选择新负责人", 400);

    // BC-8-1（DQ-8-A）：目标用户必须 存在 + ACTIVE + ∈ caller dataScope；
    // admin 仅 bypass dataScope（不豁免存在性/ACTIVE）。不使用裸 findUnique 作为授权判据。
    const newOwner = await prisma.user.findFirst({
      where: applyScope({ id: newOwnerId }, await roleScope(req, { field: 'id' })),
      select: { id: true, status: true, username: true, realName: true },
    });
    if (!newOwner) {
      return error(res, "业务归属人不存在或无权限指派", 400);
    }
    if (newOwner.status !== 'ACTIVE') {
      return error(res, "目标用户不存在或已停用", 400);
    }

    const oldOwnerName = customer.owner?.realName || '未分配';

    await prisma.customer.update({
      where: { id },
      data: { ownerId: newOwnerId },
    });

    await activityLogger.log({
      userId,
      username,
      action: "TRANSFERRED",
      module: "customer",
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: id,
      businessNo: customer.customerNo,
      summary: `${username} 将客户从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」`,
      customerId: id,
    });

    success(res, null, "转交成功");
  } catch (err) {
    next(err);
  }
};

// ========== Excel 导入 ==========
export const importExcel = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) return error(res, "请上传文件", 400);

    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    const fieldMap: Record<string, string> = {
      公司名称: "companyName",
      公司名: "companyName",
      company: "companyName",
      联系人: "contactName",
      contact: "contactName",
      邮箱: "email",
      email: "email",
      电话: "phone",
      phone: "phone",
      国家: "country",
      country: "country",
      // D-SOURCE-3：移除 Excel「来源 / source」映射（source 不再由 Excel 决定）
      备注: "notes",
      notes: "notes",
      重点客户: "isKeyAccount",
      // D-INTENT v2：Customer.intentLevel 为系统派生字段 ⇒ 移除 Excel「意向等级」导入映射（避免死字段）
      // V1.0：Customer 字段为 firstOrderAt（DateTime?），不再写旧字符串列
      首次下单日期: "firstOrderAt",
    };

    const username = req.username!;
    let created = 0;
    let failed = 0;

    for (const row of rows) {
      const raw: Record<string, unknown> = { source: "EXCEL" };
      for (const [key, value] of Object.entries(row)) {
        const mapped = fieldMap[key] || fieldMap[key.toLowerCase()] || null;
        if (mapped) {
          if (mapped === "isKeyAccount") {
            raw[mapped] = ["是", "yes", "true", "1"].includes(String(value).toLowerCase());
          } else {
            raw[mapped] = value;
          }
        }
      }
      // V1.0：逐行校验（缺必填 / 非法 enum / 非法日期 → 该行失败，不产生 500）
      const parsedRow = customerImportSchema.safeParse(raw);
      if (!parsedRow.success) {
        failed++;
        continue;
      }

      try {
        // 编号分配与业务写入同事务：逐行独立事务，保留导入的部分成功语义
        await prisma.$transaction(async (tx) => {
          const customerNo = await getNextNumber(tx, "CUS");
          return tx.customer.create({
            data: {
              customerNo,
              companyName: parsedRow.data.companyName,
              contactName: parsedRow.data.contactName ?? null,
              email: parsedRow.data.email ?? null,
              phone: parsedRow.data.phone ?? null,
              country: parsedRow.data.country ?? null,
              // D-SOURCE-3：导入客户由 API 业务语义固定为 EXCEL
              source: "EXCEL",
              notes: parsedRow.data.notes ?? null,
              ownerId: null, // V1.0：导入客户默认进公海
              isKeyAccount: parsedRow.data.isKeyAccount ?? false,
              // V1.0：firstOrderAt（DateTime?）；Excel 序列号 / 日期字符串均可
              firstOrderAt: parsedRow.data.firstOrderAt ?? null,
            },
          });
        });
        created++;
      } catch {
        failed++;
      }
    }

    success(res, { created, failed }, `导入完成：成功 ${created} 条，失败 ${failed} 条`);
  } catch (err) {
    next(err);
  }
};

// ========== 国家列表 ==========
export const getCountries = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.customer.findMany({
      select: { country: true },
      where: { country: { not: null } },
      distinct: ["country"],
    });
    const countries = result.map((r) => r.country).filter(Boolean);
    success(res, countries);
  } catch (err) {
    next(err);
  }
};

// ========== 报告统计 ==========

// ========== 更新客户标签 ==========
export const updateTags = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const username = req.username!;
    const userId = req.userId!;
    const roleCode = req.roleCode;
    // V1.0 入参校验：tags 归一为 string[]（字符串兼容，按 `,` / `，` 拆分）
    const { tags } = z.object({ tags: tagsField }).parse(req.body);

    // BC-8-2（DQ-8-C）：scoped 目标解析；scope 外与不存在同为 404（不泄露存在性）
    const existing = await prisma.customer.findFirst({
      where: applyScope({ id }, includePublicSea(await roleScope(req))),
      // D-INTENT v2：复用既有查询附带商机意向投影（不新增查询），供响应返回派生意向
      include: { opportunities: { select: { intentLevel: true } } },
    });
    if (!existing) return error(res, "客户不存在", 404);

    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "客户不存在", 404);
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: { tags },
    });

    if (!sameTags(tags, existing.tags)) {
      await activityLogger.log({
        userId,
        username,
        action: "UPDATED",
        module: "customer",
        businessType: BUSINESS_TYPE.CUSTOMER,
        businessId: id,
        businessNo: customer.customerNo,
        summary: "更新客户标签",
        customerId: id,
      });
    }

    // D-INTENT v2：响应 intentLevel 为派生值（本 handler 不修改商机集合）
    success(res, { ...customer, intentLevel: deriveCustomerIntentLevel(existing.opportunities) }, "标签更新成功");
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(res, err.errors.map((e) => e.message).join("；"), 400);
    }
    next(err);
  }
};

// ========== 报告统计 ==========

export const getReportStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const roleCode = req.roleCode;
    const isAdmin = roleCode === "admin" || roleCode === "ADMIN";

    // 销售管道权限：按角色数据范围过滤（含公海）
    const opportunityWhere: any = isAdmin ? {} : await roleScope(req, { field: 'ownerId' });

    // 客户权限：按角色数据范围过滤（统计口径不含公海）
    const customerWhere: any = isAdmin ? {} : await roleScope(req);

    const currentYear = new Date().getFullYear();

    // 并行查询
    const [
      allOpportunities,
      sampleOrderCount,
      shippedOrderCount,
      newCustomerCount,
      oldCustomerCount,
      newCustomerOrders,
      oldCustomerOrders,
    ] = await Promise.all([
      // 商机阶段为派生值：先取全量管道，再按派生阶段计数
      prisma.opportunity.findMany({
        where: opportunityWhere,
        select: { id: true, leadId: true },
      }),
      // V1.0：「下打样单」阶段由 SampleOrder 承载（SalesOrder 无 SAMPLE_ORDER 状态）
      prisma.sampleOrder.count(),
      // V1.0：SalesOrderStatus.SHIPPED
      prisma.salesOrder.count({ where: { status: "SHIPPED" } }),
      prisma.customer.count({
        where: { ...customerWhere, firstOrderAt: firstOrderAtInYear(currentYear) },
      }),
      prisma.customer.count({
        where: {
          ...customerWhere,
          firstOrderAt: firstOrderAtBeforeYear(currentYear),
        },
      }),
      // V1.0：订单金额取 SalesOrder.totalAmountCny（本币），不使用旧订单金额列
      prisma.salesOrder.findMany({
        where: {
          customer: { ...customerWhere, firstOrderAt: firstOrderAtInYear(currentYear) },
          totalAmountCny: { not: null },
        },
        select: { totalAmountCny: true },
      }),
      prisma.salesOrder.findMany({
        where: {
          customer: {
            ...customerWhere,
            firstOrderAt: firstOrderAtBeforeYear(currentYear),
          },
          totalAmountCny: { not: null },
        },
        select: { totalAmountCny: true },
      }),
    ]);

    const newCustomerAmount = newCustomerOrders.reduce((s, o) => s + Number(o.totalAmountCny ?? 0), 0);
    const oldCustomerAmount = oldCustomerOrders.reduce((s, o) => s + Number(o.totalAmountCny ?? 0), 0);

    // 按派生阶段统计商机数量
    const stageMap = await deriveStages(allOpportunities);
    const stageCount = (s: PipelineStage) =>
      [...stageMap.values()].filter((v) => v === s).length;
    const opportunityCount = stageCount('OPPORTUNITY');
    const pipelineOrderCount = stageCount('ORDER') + stageCount('SHIPPED');
    // 线索数：来源线索（Lead 未转商机）仍由独立的 Lead 统计口径提供，此处沿用管道层面的线索阶段计数
    const leadCount = stageCount('LEAD') + opportunityCount + pipelineOrderCount;

    // 转化率
    const leadToOpportunity = leadCount > 0
      ? Math.round((opportunityCount / leadCount) * 100)
      : 0;
    const opportunityToNext = opportunityCount > 0
      ? Math.round(((sampleOrderCount + pipelineOrderCount) / opportunityCount) * 100)
      : 0;
    // 下打样单 → 出货 转化率
    const sampleToOrder = sampleOrderCount > 0
      ? Math.round((shippedOrderCount / sampleOrderCount) * 100)
      : 0;
    const leadToOrder = leadCount > 0
      ? Math.round((pipelineOrderCount / leadCount) * 100)
      : 0;

    success(res, {
      leadCount,
      opportunityCount,
      sampleOrderCount,
      pipelineOrderCount,
      newCustomerCount,
      oldCustomerCount,
      newCustomerAmount,
      oldCustomerAmount,
      leadToOpportunity,
      opportunityToNext,
      sampleToOrder,
      leadToOrder,
    });
  } catch (err) {
    next(err);
  }
};
