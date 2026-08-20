import { Request, Response, NextFunction } from "express";
import { success, error } from "../utils/response";
import { activityLogger } from "../lib/activity-logger";
import { AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";
import * as XLSX from "xlsx";

// 辅助：生成客户编号 CUS-{YYMMDD}-{当天序号}
const generateCustomerCode = async (): Promise<string> => {
  const d = new Date();
  const datePart = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const count = await prisma.customer.count({
    where: { customerCode: { startsWith: `CUS-${datePart}-` } },
  });
  return `CUS-${datePart}-${count + 1}`;
};

// 辅助：获取客户订单聚合数据
type OrderAgg = { totalAmount: number; lastOrderDate: string | null };
const getOrderAggregates = async (customerIds: string[]): Promise<Record<string, OrderAgg>> => {
  if (customerIds.length === 0) return {};
  const agg = await prisma.order.groupBy({
    by: ["customerId"],
    _sum: { amountCNY: true },
    _max: { orderDate: true },
    where: { customerId: { in: customerIds } },
  });
  const map: Record<string, OrderAgg> = {};
  for (const row of agg) {
    map[row.customerId] = {
      totalAmount: row._sum.amountCNY || 0,
      lastOrderDate: row._max.orderDate || null,
    };
  }
  return map;
};

// 辅助：获取客户商机金额聚合数据
type PipelineAgg = { pipelineAmount: number };
const getPipelineAggregates = async (customerIds: string[]): Promise<Record<string, PipelineAgg>> => {
  if (customerIds.length === 0) return {};
  const agg = await prisma.salesPipeline.groupBy({
    by: ["customerId"],
    _sum: { estimatedAmount: true },
    where: { customerId: { in: customerIds } },
  });
  const map: Record<string, PipelineAgg> = {};
  for (const row of agg) {
    if (!row.customerId) continue;
    map[row.customerId] = {
      pipelineAmount: row._sum.estimatedAmount || 0,
    };
  }
  return map;
};

// 统计维度
const getCustomerStats = async (ownerId?: string) => {
  const currentYear = new Date().getFullYear().toString();
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
        firstOrderDate: { startsWith: currentYear },
        isKeyAccount: false,
      },
    }),
    prisma.customer.count({
      where: {
        ...where,
        isKeyAccount: false,
        AND: [
          { firstOrderDate: { not: null } },
          { firstOrderDate: { not: "" } },
          { firstOrderDate: { not: { startsWith: currentYear } } },
        ],
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

  // 无订单客户
  const noOrder = await prisma.customer.count({
    where: {
      ...where,
      OR: [
        { firstOrderDate: null },
        { firstOrderDate: "" },
      ],
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
  const currentYear = new Date().getFullYear().toString();
  const noOrderWhere = { ...baseWhere, orders: { none: {} } };
  const doneWhere = { ...baseWhere, orders: { some: {} } };
  const [A, B, C, D, none, newC, oldC] = await Promise.all([
    prisma.customer.count({ where: { ...noOrderWhere, pipelines: { some: { probability: "准成交" } } } }),
    prisma.customer.count({ where: { ...noOrderWhere, AND: [{ pipelines: { some: { probability: "高意向" } } }, { pipelines: { none: { probability: "准成交" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, AND: [{ pipelines: { some: { probability: "中意向" } } }, { pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, pipelines: { some: {} }, AND: [{ pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }, { pipelines: { none: { probability: "中意向" } } }] } }),
    prisma.customer.count({ where: { ...noOrderWhere, pipelines: { none: {} } } }),
    prisma.customer.count({ where: { ...doneWhere, firstOrderDate: { startsWith: currentYear } } }),
    prisma.customer.count({ where: { ...doneWhere, AND: [{ firstOrderDate: { not: null } }, { firstOrderDate: { not: "" } }, { firstOrderDate: { not: { startsWith: currentYear } } }] } }),
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

    const currentYear = new Date().getFullYear().toString();

    // 公海客户条件（仅无负责人）
    const publicSeaFilter = [{ ownerId: null }];

    // "公海客户"：仅公海；其余类型仅展示我的客户
    const isPublic = type === "public";
    const andConditions: any[] = isPublic
      ? [{ OR: publicSeaFilter }]
      : [{ ownerId: userId }];

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
    if (type === "key") {
      andConditions.push({ isKeyAccount: true });
    } else if (type === "noOrder") {
      andConditions.push({ orders: { none: {} } });
    } else if (type === "noOrder-none") {
      // 待开发：未成交且无商机记录
      andConditions.push({ orders: { none: {} }, pipelines: { none: {} } });
    } else if (type === "noOrder-A") {
      andConditions.push({ orders: { none: {} }, pipelines: { some: { probability: "准成交" } } });
    } else if (type === "noOrder-B") {
      andConditions.push({ orders: { none: {} }, AND: [{ pipelines: { some: { probability: "高意向" } } }, { pipelines: { none: { probability: "准成交" } } }] });
    } else if (type === "noOrder-C") {
      andConditions.push({ orders: { none: {} }, AND: [{ pipelines: { some: { probability: "中意向" } } }, { pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }] });
    } else if (type === "noOrder-D") {
      // 低意向：未成交 + 有商机记录 + 非 A/B/C 意向（排除待开发客户）
      andConditions.push({ orders: { none: {} }, pipelines: { some: {} }, AND: [{ pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }, { pipelines: { none: { probability: "中意向" } } }] });
    } else if (type === "done") {
      andConditions.push({ orders: { some: {} } });
    } else if (type === "done-new") {
      andConditions.push({ orders: { some: {} }, firstOrderDate: { startsWith: currentYear } });
    } else if (type === "done-old") {
      andConditions.push({
        orders: { some: {} },
        AND: [
          { firstOrderDate: { not: null } },
          { firstOrderDate: { not: "" } },
          { firstOrderDate: { not: { startsWith: currentYear } } },
        ],
      });
    }

    const where: any = { AND: andConditions };

    const [list, total, stats, subFilterCounts] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: [{ firstOrderDate: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { orders: true, pipelines: true } },
          pipelines: { select: { probability: true } },
        },
      }),
      prisma.customer.count({ where }),
      getCustomerStats(userId),
      getSubFilterCounts({ ownerId: userId }),
    ]);

    // 针对当前筛选条件的全量聚合（来自商机记录，非分页）
    const [estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg] = await Promise.all([
      prisma.salesPipeline.aggregate({
        where: { customer: where },
        _sum: { estimatedAmount: true },
      }),
      prisma.order.aggregate({
        where: { customer: where },
        _sum: { amountCNY: true },
      }),
      prisma.salesPipeline.groupBy({
        by: ['probability'],
        where: { customer: where },
        _sum: { estimatedAmount: true },
        _count: true,
      }),
      // 新客户成交金额
      prisma.order.aggregate({
        where: {
          customer: {
            AND: [
              ...(where.AND || []),
              { firstOrderDate: { startsWith: currentYear } },
              { isKeyAccount: false },
            ],
          },
        },
        _sum: { amountCNY: true },
      }),
      // 老客户成交金额
      prisma.order.aggregate({
        where: {
          customer: {
            AND: [
              ...(where.AND || []),
              { isKeyAccount: false },
              { firstOrderDate: { not: null } },
              { firstOrderDate: { not: "" } },
              { firstOrderDate: { not: { startsWith: currentYear } } },
            ],
          },
        },
        _sum: { amountCNY: true },
      }),
    ]);

    const contractBreakdown = [
      { type: '新客户', amount: newAmountAgg._sum.amountCNY || 0 },
      { type: '老客户', amount: oldAmountAgg._sum.amountCNY || 0 },
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

    success(res, { list: enriched, total, page: Number(page), pageSize: take, stats, ...subFilterCounts, estimatedAmount: estimatedAgg._sum.estimatedAmount || 0, totalContractAmount: totalAmountAgg._sum.amountCNY || 0, estimatedBreakdown, contractBreakdown });
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
        orderBy: [{ firstOrderDate: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { orders: true } },
          pipelines: { select: { probability: true } },
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

// ========== 管理员：查看所有客户（按业务员分组） ==========
export const listAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { keyword, ownerId, type, country, page = "1", pageSize = "20" } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);
    const currentYear = new Date().getFullYear().toString();

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
    if (type === "key") {
      andConditions.push({ isKeyAccount: true });
    } else if (type === "noOrder") {
      andConditions.push({ orders: { none: {} } });
    } else if (type === "noOrder-none") {
      // 待开发：未成交且无商机记录
      andConditions.push({ orders: { none: {} }, pipelines: { none: {} } });
    } else if (type === "noOrder-A") {
      andConditions.push({ orders: { none: {} }, pipelines: { some: { probability: "准成交" } } });
    } else if (type === "noOrder-B") {
      andConditions.push({ orders: { none: {} }, AND: [{ pipelines: { some: { probability: "高意向" } } }, { pipelines: { none: { probability: "准成交" } } }] });
    } else if (type === "noOrder-C") {
      andConditions.push({ orders: { none: {} }, AND: [{ pipelines: { some: { probability: "中意向" } } }, { pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }] });
    } else if (type === "noOrder-D") {
      // 低意向：未成交 + 有商机记录 + 非 A/B/C 意向（排除待开发客户）
      andConditions.push({ orders: { none: {} }, pipelines: { some: {} }, AND: [{ pipelines: { none: { probability: "准成交" } } }, { pipelines: { none: { probability: "高意向" } } }, { pipelines: { none: { probability: "中意向" } } }] });
    } else if (type === "done") {
      andConditions.push({ orders: { some: {} } });
    } else if (type === "done-new") {
      andConditions.push({ orders: { some: {} }, firstOrderDate: { startsWith: currentYear } });
    } else if (type === "done-old") {
      andConditions.push({
        orders: { some: {} },
        AND: [
          { firstOrderDate: { not: null } },
          { firstOrderDate: { not: "" } },
          { firstOrderDate: { not: { startsWith: currentYear } } },
        ],
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
        orderBy: [{ firstOrderDate: "desc" }, { createdAt: "desc" }],
        include: {
          owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
          _count: { select: { orders: true, pipelines: true } },
          pipelines: { select: { probability: true } },
        },
      }),
      prisma.customer.count({ where }),
      // 获取所有业务员列表及其客户分布（排除管理员）
      prisma.user.findMany({
        where: {
          status: "ACTIVE",
          role: { code: { not: "admin" } },
        },
        select: {
          id: true,
          username: true,
          realName: true,
          _count: { select: { customers: true } },
          customers: {
            where: { isKeyAccount: true },
            select: { id: true },
          },
        },
      }),
      getSubFilterCounts(listAllScope),
    ]);

    // 针对当前筛选条件的全量聚合（来自商机记录，非分页）
    const [estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg] = await Promise.all([
      prisma.salesPipeline.aggregate({
        where: { customer: where as any },
        _sum: { estimatedAmount: true },
      }),
      prisma.order.aggregate({
        where: { customer: where as any },
        _sum: { amountCNY: true },
      }),
      prisma.salesPipeline.groupBy({
        by: ['probability'],
        where: { customer: where as any },
        _sum: { estimatedAmount: true },
        _count: true,
      }),
      // 新客户成交金额
      prisma.order.aggregate({
        where: {
          customer: {
            AND: [
              ...(andConditions.length > 0 ? andConditions : []),
              { firstOrderDate: { startsWith: currentYear } },
              { isKeyAccount: false },
            ],
          },
        },
        _sum: { amountCNY: true },
      }),
      // 老客户成交金额
      prisma.order.aggregate({
        where: {
          customer: {
            AND: [
              ...(andConditions.length > 0 ? andConditions : []),
              { isKeyAccount: false },
              { firstOrderDate: { not: null } },
              { firstOrderDate: { not: "" } },
              { firstOrderDate: { not: { startsWith: currentYear } } },
            ],
          },
        },
        _sum: { amountCNY: true },
      }),
    ]);

    const contractBreakdown = [
      { type: '新客户', amount: newAmountAgg._sum.amountCNY || 0 },
      { type: '老客户', amount: oldAmountAgg._sum.amountCNY || 0 },
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
      customerCount: u._count.customers,
      keyCount: u.customers.length,
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
          firstOrderDate: { startsWith: currentYear },
          isKeyAccount: false,
          ...withOwnerWhere,
        },
      }),
      prisma.customer.count({
        where: {
          isKeyAccount: false,
          ...withOwnerWhere,
          AND: [
            { firstOrderDate: { not: null } },
            { firstOrderDate: { not: "" } },
            { firstOrderDate: { not: { startsWith: currentYear } } },
          ],
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
      totalContractAmount: totalAmountAgg._sum.amountCNY || 0,
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
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
        orders: { orderBy: { createdAt: "desc" } },
        pipelines: {
          orderBy: { createdAt: "desc" },
          include: { assignee: { select: { id: true, username: true, realName: true } } },
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

// ========== 创建客户 ==========
export const create = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const username = req.username!;
    const { companyName, contactName, email, phone, country, source, notes, ownerId, isKeyAccount, tags, intentLevel, estimatedAmount } =
      req.body;

    if (!companyName) return error(res, "公司名称不能为空", 400);

    // 如果 ownerId 传入 null 则放入公海；未传入则归当前用户
    let finalOwnerId: string | null = userId;
    if (ownerId !== undefined) {
      finalOwnerId = ownerId; // null 就直接是 null（公海）
    }

    const customer = await prisma.customer.create({
      data: {
        customerCode: await generateCustomerCode(),
        companyName,
        contactName,
        email,
        phone,
        country,
        source: source || "MANUAL",
        notes,
        ownerId: finalOwnerId,
        isKeyAccount: isKeyAccount || false,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        intentLevel: isKeyAccount ? intentLevel || null : null,
        estimatedAmount: estimatedAmount ?? null,
      },
    });

    await activityLogger.log({
      userId,
      username,
      action: "CREATED",
      module: "customer",
      targetId: customer.id,
      target: companyName,
      detail: `创建客户：${companyName}`,
      customerId: customer.id,
    });

    success(res, customer, "创建成功");
  } catch (err) {
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
    const { companyName, contactName, englishName, position, email, phone, wechat, country, region, customerLevel, source, notes, ownerId, isKeyAccount, tags, intentLevel, firstOrderDate, estimatedAmount } =
      req.body;

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
    if (tags !== undefined) {
      const newTags = Array.isArray(tags) ? tags.join(',') : tags;
      if (newTags !== (existing.tags || '')) changes.push(`标签已更新`);
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        companyName: companyName ?? existing.companyName,
        contactName: contactName !== undefined ? contactName : existing.contactName,
        englishName: englishName !== undefined ? englishName : existing.englishName,
        position: position !== undefined ? position : existing.position,
        email: email !== undefined ? email : existing.email,
        phone: phone !== undefined ? phone : existing.phone,
        wechat: wechat !== undefined ? wechat : existing.wechat,
        country: country !== undefined ? country : existing.country,
        region: region !== undefined ? region : existing.region,
        customerLevel: customerLevel !== undefined ? customerLevel : existing.customerLevel,
        source: source ?? existing.source,
        notes: notes !== undefined ? notes : existing.notes,
        ownerId: ownerId !== undefined ? ownerId : existing.ownerId,
        isKeyAccount: isKeyAccount ?? existing.isKeyAccount,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.join(',') : tags) : existing.tags,
        intentLevel: isKeyAccount === false ? null : (intentLevel !== undefined ? intentLevel : existing.intentLevel),
        firstOrderDate: firstOrderDate !== undefined ? firstOrderDate : existing.firstOrderDate,
        estimatedAmount: estimatedAmount !== undefined ? estimatedAmount : existing.estimatedAmount,
      },
    });

    if (changes.length > 0) {
      await activityLogger.log({
        userId,
        username,
        action: "UPDATED",
        module: "customer",
        targetId: id,
        target: existing.companyName,
        detail: changes.join("；"),
        customerId: id,
      });
    }

    success(res, customer, "更新成功");
  } catch (err) {
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
      targetId: id,
      target: customer.companyName,
      detail: `${username} 认领了该客户`,
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
      targetId: id,
      target: customer.companyName,
      detail: `${username} 释放该客户到公海`,
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
      targetId: id,
      target: customer.companyName,
      detail: `${username} 将客户从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」`,
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
      首次下单日期: "firstOrderDate",
    };

    const username = req.username!;
    let created = 0;
    let failed = 0;

    for (const row of rows) {
      const data: any = { source: "EXCEL", ownerId: null };
      for (const [key, value] of Object.entries(row)) {
        const mapped = fieldMap[key] || fieldMap[key.toLowerCase()] || null;
        if (mapped) {
          if (mapped === "isKeyAccount") {
            data[mapped] = ["是", "yes", "true", "1"].includes(String(value).toLowerCase());
          } else {
            data[mapped] = value;
          }
        }
      }
      if (!data.companyName) {
        failed++;
        continue;
      }

      try {
        data.customerCode = await generateCustomerCode();
        await prisma.customer.create({ data });
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
    const { tags } = req.body;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return error(res, "客户不存在", 404);

    if (existing.ownerId !== userId && roleCode !== 'admin') {
      return error(res, "无权编辑该客户", 403);
    }

    const newTags = Array.isArray(tags) ? tags.join(',') : (tags || '');

    const customer = await prisma.customer.update({
      where: { id },
      data: { tags: newTags },
    });

    if (newTags !== (existing.tags || '')) {
      await activityLogger.log({
        userId,
        username,
        action: "UPDATED",
        module: "customer",
        targetId: id,
        target: existing.companyName,
        detail: "更新客户标签",
        customerId: id,
      });
    }

    success(res, customer, "标签更新成功");
  } catch (err) {
    next(err);
  }
};

// ========== 报告统计 ==========

export const getReportStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const roleCode = req.roleCode;
    const isAdmin = roleCode === "admin" || roleCode === "ADMIN";

    // 销售管道权限
    const pipelineWhere: any = {};
    if (!isAdmin) {
      pipelineWhere.OR = [{ assignedTo: userId }, { assignedTo: null }];
    }

    // 客户权限
    const customerWhere: any = isAdmin ? {} : { ownerId: userId };

    const currentYear = new Date().getFullYear().toString();

    // 并行查询
    const [
      leadCount,
      opportunityCount,
      sampleOrderCount,
      pipelineOrderCount,
      shippedOrderCount,
      newCustomerCount,
      oldCustomerCount,
      newCustomerOrders,
      oldCustomerOrders,
    ] = await Promise.all([
      prisma.salesPipeline.count({ where: { ...pipelineWhere, stage: "LEAD" } }),
      prisma.salesPipeline.count({ where: { ...pipelineWhere, stage: "OPPORTUNITY" } }),
      // 订单 7 阶段中"下打样单"阶段的订单数（取代原 SAMPLE 阶段）
      prisma.order.count({ where: { status: "SAMPLE_ORDER" } }),
      prisma.salesPipeline.count({ where: { ...pipelineWhere, stage: "ORDER" } }),
      prisma.order.count({ where: { status: "SHIPPED" } }),
      prisma.customer.count({
        where: { ...customerWhere, firstOrderDate: { startsWith: currentYear } },
      }),
      prisma.customer.count({
        where: {
          ...customerWhere,
          AND: [
            { firstOrderDate: { not: null } },
            { firstOrderDate: { not: "" } },
            { firstOrderDate: { not: { startsWith: currentYear } } },
          ],
        },
      }),
      prisma.order.findMany({
        where: {
          customer: { ...customerWhere, firstOrderDate: { startsWith: currentYear } },
          amountCNY: { not: null },
        },
        select: { amountCNY: true },
      }),
      prisma.order.findMany({
        where: {
          customer: {
            ...customerWhere,
            AND: [
              { firstOrderDate: { not: null } },
              { firstOrderDate: { not: "" } },
              { firstOrderDate: { not: { startsWith: currentYear } } },
            ],
          },
          amountCNY: { not: null },
        },
        select: { amountCNY: true },
      }),
    ]);

    const newCustomerAmount = newCustomerOrders.reduce((s, o) => s + (o.amountCNY || 0), 0);
    const oldCustomerAmount = oldCustomerOrders.reduce((s, o) => s + (o.amountCNY || 0), 0);

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
