import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CustomerLevel, IntentLevel, LeadSource } from "@prisma/client";
import { success, error } from "../utils/response";
import { activityLogger } from "../lib/activity-logger";
import { AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";
import { getNextNumber } from "../lib/numberSequence";
import { applyScope, includePublicSea, publicSeaScope, roleScope } from "../utils/scope";
import { BUSINESS_TYPE } from "../lib/business-type";
import { deriveStages, type PipelineStage } from "../utils/pipelineStage";
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

  const [total, newCustomers, oldCustomers, keyAccounts, intentStats] = await Promise.all([
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
    prisma.customer.groupBy({
      by: ["intentLevel"],
      where: { ...where, isKeyAccount: true, intentLevel: { not: null } },
      _count: true,
    }),
  ]);

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
    intentBreakdown: intentStats.map((i) => ({
      level: i.intentLevel,
      count: i._count,
    })),
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
    const enriched = list.map((c) => ({
      ...c,
      totalAmount: orderAgg[c.id]?.totalAmount || 0,
      lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
      pipelineAmount: pipelineAgg[c.id]?.pipelineAmount || 0,
    }));

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
    const enriched = list.map((c) => ({
      ...c,
      totalAmount: orderAgg[c.id]?.totalAmount || 0,
      lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
    }));

    success(res, { list: enriched, total, page: Number(page), pageSize: take });
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
    const enriched = list.map((c) => ({
      ...c,
      totalAmount: orderAgg[c.id]?.totalAmount || 0,
      lastOrderDate: orderAgg[c.id]?.lastOrderDate || null,
      pipelineAmount: pipelineAgg[c.id]?.pipelineAmount || 0,
    }));

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
    success(res, customer);
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

const customerCreateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200),
  contactName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().max(100).nullish(),
  customerType: z.string().trim().max(100).nullish(),
  source: z.nativeEnum(LeadSource).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  intentLevel: z.nativeEnum(IntentLevel).nullish(),
  coverImage: coverImageField,
  images: coverImageField,
});

const customerUpdateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200).optional(),
  englishName: z.string().trim().max(200).nullish(),
  contactName: z.string().trim().max(100).nullish(),
  position: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  wechat: z.string().trim().max(100).nullish(),
  country: z.string().trim().max(100).nullish(),
  region: z.string().trim().max(100).nullish(),
  customerLevel: z.nativeEnum(CustomerLevel).optional(),
  customerType: z.string().trim().max(100).nullish(),
  source: z.nativeEnum(LeadSource).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  intentLevel: z.nativeEnum(IntentLevel).nullish(),
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
  source: z.nativeEnum(LeadSource).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  isKeyAccount: z.boolean().optional(),
  intentLevel: z.nativeEnum(IntentLevel).nullish(),
  firstOrderAt: dateField,
});

// ========== 创建客户 ==========
export const create = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const username = req.username!;
    // V1.0 入参校验：非法 enum / 类型 / tags → 400；未知字段（含 legacy estimatedAmount）被忽略
    const body = customerCreateSchema.parse(req.body);

    // 如果 ownerId 传入 null 则放入公海；未传入则归当前用户
    const finalOwnerId: string | null = body.ownerId !== undefined ? body.ownerId : userId;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const customer = await prisma.$transaction(async (tx) => {
      const customerNo = await getNextNumber(tx, "CUS");

      return tx.customer.create({
        data: {
          customerNo,
          companyName: body.companyName,
          contactName: body.contactName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          country: body.country ?? null,
          customerType: body.customerType ?? null,
          coverImage: normalizeCoverImage(body) ?? null,
          source: body.source ?? "MANUAL",
          notes: body.notes ?? null,
          ownerId: finalOwnerId,
          isKeyAccount: body.isKeyAccount ?? false,
          // V1.0：Customer.tags 为 PG 原生数组（String[]），不接受逗号字符串
          tags: body.tags ?? [],
          intentLevel: body.isKeyAccount ? body.intentLevel ?? null : null,
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

    success(res, customer, "创建成功");
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
      position,
      email,
      phone,
      wechat,
      country,
      region,
      customerLevel,
      customerType,
      source,
      notes,
      ownerId,
      isKeyAccount,
      tags,
      intentLevel,
    } = body;

    // 主图：coverImage 优先，images 仅作兼容输入
    const coverImage = normalizeCoverImage(body);
    // 首次下单日期：firstOrderAt（V1.0）优先，兼容旧入参别名；内部只写 firstOrderAt
    const firstOrderAt = body.firstOrderAt !== undefined ? body.firstOrderAt : body.firstOrderDate;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以编辑
    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权编辑该客户，请先认领", 403);
    }

    const changes: string[] = [];
    if (companyName && companyName !== existing.companyName) changes.push(`公司名: ${existing.companyName} → ${companyName}`);
    if (isKeyAccount !== undefined && isKeyAccount !== existing.isKeyAccount) {
      const a = existing.isKeyAccount ? "取消重点" : "标记为重点";
      changes.push(`${a}客户`);
    }
    if (intentLevel && intentLevel !== existing.intentLevel)
      changes.push(`意向等级: ${existing.intentLevel || "无"} → ${intentLevel}`);
    if (tags !== undefined && !sameTags(tags, existing.tags)) changes.push(`标签已更新`);

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        // V1.0：仅写入 Customer 标量；未传字段（undefined）不出现在 data 中 → 保持原值
        ...(companyName !== undefined ? { companyName } : {}),
        ...(contactName !== undefined ? { contactName } : {}),
        ...(englishName !== undefined ? { englishName } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(wechat !== undefined ? { wechat } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(region !== undefined ? { region } : {}),
        ...(coverImage !== undefined ? { coverImage } : {}),
        ...(customerLevel !== undefined ? { customerLevel } : {}),
        ...(customerType !== undefined ? { customerType } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(isKeyAccount !== undefined ? { isKeyAccount } : {}),
        // V1.0：Customer.tags 为 PG 原生数组（String[]）
        ...(tags !== undefined ? { tags } : {}),
        intentLevel: isKeyAccount === false ? null : intentLevel !== undefined ? intentLevel : existing.intentLevel,
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

    success(res, customer, "更新成功");
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
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以删除
    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权删除该客户", 403);
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

    const customer = await prisma.customer.findUnique({ where: { id } });
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

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return error(res, "客户不存在", 404);

    // 公海客户：仅 ownerId 为 null
    if (!customer.ownerId) {
      return error(res, "该客户已在公海", 400);
    }

    // 只有客户归属人或管理员可以释放
    if (customer.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权释放该客户", 403);
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

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { owner: { select: { id: true, realName: true } } },
    });
    if (!customer) return error(res, "客户不存在", 404);

    // 只有客户归属人或管理员可以转交
    if (customer.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权转交该客户", 403);
    }

    if (!newOwnerId) return error(res, "请选择新负责人", 400);

    const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!newOwner || newOwner.status !== 'ACTIVE') {
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
      来源: "source",
      source: "source",
      备注: "notes",
      notes: "notes",
      重点客户: "isKeyAccount",
      意向等级: "intentLevel",
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
              source: parsedRow.data.source ?? "EXCEL",
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

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return error(res, "客户不存在", 404);

    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权编辑该客户", 403);
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

    success(res, customer, "标签更新成功");
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
