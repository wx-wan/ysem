import { Request, Response, NextFunction } from "express";
import { success, error } from "../utils/response";
import { activityLogger } from "../lib/activity-logger";
import { AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";

// 单据类型
export type OrderType = "QUOTE" | "SAMPLE" | "ORDER" | "PRODUCTION" | "SHIPPED";
// 审批态
export type OrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

// 生成单据号（按类型前缀）
async function genOrderNo(type: OrderType): Promise<string> {
  const prefix = type === "QUOTE" ? "Q" : type === "SAMPLE" ? "S" : type === "PRODUCTION" ? "P" : type === "SHIPPED" ? "H" : "O";
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const count = await prisma.order.count({ where: { type } });
  return `${prefix}-${ymd}-${String(count + 1).padStart(3, "0")}`;
}

// 当前用户是否该类型的审批人
async function isApprover(type: OrderType, userId?: string): Promise<boolean> {
  if (!userId) return false;
  const cfg = await prisma.approvalConfig.findUnique({ where: { type } });
  if (!cfg || !cfg.enabled || !cfg.approverIds) return false;
  try {
    const ids: string[] = JSON.parse(cfg.approverIds);
    return ids.includes(userId);
  } catch {
    return false;
  }
}

// ========== 单据列表（按 type 筛选） ==========
export const list = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const userRole = req.roleCode;
    const {
      keyword,
      type,
      status,
      customerId,
      pipelineId,
      startDate,
      endDate,
      page = "1",
      pageSize = "20",
    } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};

    if (userRole !== "admin") {
      where.customer = { ownerId: userId };
    }
    if (customerId) where.customerId = String(customerId);
    if (type) where.type = String(type);
    if (status) where.status = String(status);
    if (pipelineId) where.pipelineId = String(pipelineId);
    if (keyword) {
      where.OR = [
        { orderNo: { contains: String(keyword) } },
        { title: { contains: String(keyword) } },
        { customer: { companyName: { contains: String(keyword) } } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(String(startDate));
      if (endDate) where.createdAt.lte = new Date(String(endDate));
    }

    const [list, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { id: true, companyName: true, contactName: true, ownerId: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const agg = await prisma.order.aggregate({
      where,
      _sum: { amountCNY: true },
      _count: true,
    });

    success(res, {
      list,
      total,
      page: Number(page),
      pageSize: take,
      totalAmount: agg._sum.amountCNY || 0,
      totalCount: agg._count,
    });
  } catch (err) {
    next(err);
  }
};

// ========== 单据详情 ==========
export const getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true, ownerId: true } },
      },
    });
    if (!order) return error(res, "单据不存在", 404);
    success(res, order);
  } catch (err) {
    next(err);
  }
};

// ========== 创建单据（报价 / 打样 / 正式订单） ==========
export const create = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const roleCode = req.roleCode;
    const {
      type = "ORDER",
      title,
      customerId,
      orderNo,
      orderDate,
      amountCNY,
      depositAmount,
      depositPaid,
      deliveryDate,
      paymentTerms,
      status,
      stage,
      targetType,
      targetId,
      pipelineId,
      items,
      currency,
      remark,
    } = req.body;

    if (!customerId) return error(res, "请选择客户", 400);
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return error(res, "客户不存在", 404);

    // 公海客户（ownerId 为 null）需要先认领
    const isPublic = !customer.ownerId;
    if (isPublic && type === "ORDER") return error(res, "该客户尚未认领，请先认领后再下单", 400);
    if (customer.ownerId !== userId && roleCode !== "admin") {
      return error(res, "无权为该客户操作，请先认领", 403);
    }

    const finalType = (["QUOTE", "SAMPLE", "ORDER", "PRODUCTION", "SHIPPED"].includes(type) ? type : "ORDER") as OrderType;
    const finalOrderNo = orderNo || (await genOrderNo(finalType));

    // 金额合计：若未传 amountCNY 但传了 items，则按 items 计算
    let finalAmount = amountCNY !== undefined ? (amountCNY ? Number(amountCNY) : null) : null;
    if (finalAmount === null && items) {
      try {
        const arr = typeof items === "string" ? JSON.parse(items) : items;
        if (Array.isArray(arr)) {
          finalAmount = arr.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
        }
      } catch { /* ignore */ }
    }

    const order = await prisma.order.create({
      data: {
        type: finalType,
        orderNo: finalOrderNo,
        title: title || finalOrderNo,
        customerId,
        orderDate,
        amountCNY: finalAmount,
        currency: currency || "CNY",
        depositAmount: depositAmount ? Number(depositAmount) : null,
        depositPaid: depositPaid || false,
        deliveryDate,
        paymentTerms,
        status: (status as OrderStatus) || "DRAFT",
        stage: stage || (finalType === "ORDER" ? "DEPOSIT" : null),
        targetType,
        targetId,
        pipelineId,
        items: items ? (typeof items === "string" ? items : JSON.stringify(items)) : null,
        remark,
        createdBy: userId,
      },
    });

    // 记录到客户活动日志 & 全局操作日志
    const username = req.username!;
    const typeLabel = finalType === "QUOTE" ? "报价单" : finalType === "SAMPLE" ? "打样单" : "订单";
    await activityLogger.log({
      userId,
      username,
      action: finalType === "QUOTE" ? "QUOTE_CREATED" : finalType === "SAMPLE" ? "SAMPLE_CREATED" : "ORDER_CREATED",
      module: "order",
      targetId: order.id,
      target: finalOrderNo,
      detail: `新增${typeLabel}${finalOrderNo ? `：${finalOrderNo}` : ''}`,
      customerId,
    });

    success(res, order, "创建成功");
  } catch (err) {
    next(err);
  }
};

// ========== 更新单据 ==========
export const update = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      title,
      orderNo,
      orderDate,
      amountCNY,
      depositAmount,
      depositPaid,
      deliveryDate,
      paymentTerms,
      status,
      stage,
      targetType,
      targetId,
      pipelineId,
      items,
      currency,
      remark,
    } = req.body;

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "单据不存在", 404);

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (orderNo !== undefined) data.orderNo = orderNo;
    if (orderDate !== undefined) data.orderDate = orderDate;
    if (amountCNY !== undefined) data.amountCNY = amountCNY ? Number(amountCNY) : null;
    if (depositAmount !== undefined) data.depositAmount = depositAmount ? Number(depositAmount) : null;
    if (depositPaid !== undefined) data.depositPaid = depositPaid;
    if (deliveryDate !== undefined) data.deliveryDate = deliveryDate;
    if (paymentTerms !== undefined) data.paymentTerms = paymentTerms;
    if (status !== undefined) data.status = status;
    if (stage !== undefined) data.stage = stage;
    if (targetType !== undefined) data.targetType = targetType;
    if (targetId !== undefined) data.targetId = targetId;
    if (pipelineId !== undefined) data.pipelineId = pipelineId;
    if (items !== undefined) data.items = items ? (typeof items === "string" ? items : JSON.stringify(items)) : null;
    if (currency !== undefined) data.currency = currency;
    if (remark !== undefined) data.remark = remark;

    const order = await prisma.order.update({ where: { id }, data });

    const changes: string[] = [];
    if (orderNo && orderNo !== existing.orderNo) changes.push("单号");
    if (amountCNY !== undefined && Number(amountCNY) !== existing.amountCNY) changes.push("金额");
    if (status && status !== existing.status) changes.push("状态");
    if (changes.length > 0) {
      const username = req.username!;
      await activityLogger.log({
        userId: req.userId!,
        username,
        action: "ORDER_UPDATED",
        module: "order",
        targetId: id,
        target: existing.orderNo || id,
        detail: `修改了单据「${existing.orderNo}」的${changes.join("、")}`,
        customerId: existing.customerId,
      });
    }

    success(res, order, "更新成功");
  } catch (err) {
    next(err);
  }
};

// ========== 提交审批 ==========
export const submit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "单据不存在", 404);
    if (existing.status !== "DRAFT") return error(res, "仅草稿状态可提交", 400);

    const order = await prisma.order.update({
      where: { id },
      data: { status: "SUBMITTED" },
    });
    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: "ORDER_SUBMITTED",
      module: "order",
      targetId: id,
      target: existing.orderNo || id,
      detail: `提交了单据「${existing.orderNo}」审批`,
      customerId: existing.customerId,
    });
    success(res, order, "已提交审批");
  } catch (err) {
    next(err);
  }
};

// ========== 审批通过 ==========
export const approve = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "单据不存在", 404);
    if (existing.status !== "SUBMITTED") return error(res, "仅已提交状态可审批", 400);

    const ok = await isApprover(existing.type as OrderType, req.userId);
    if (!ok) return error(res, "您不是该类型的审批人", 403);

    const order = await prisma.order.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: "ORDER_APPROVED",
      module: "order",
      targetId: id,
      target: existing.orderNo || id,
      detail: `审批通过了单据「${existing.orderNo}」`,
      customerId: existing.customerId,
    });
    success(res, order, "审批通过");
  } catch (err) {
    next(err);
  }
};

// ========== 审批驳回 ==========
export const reject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "单据不存在", 404);
    if (existing.status !== "SUBMITTED") return error(res, "仅已提交状态可审批", 400);

    const ok = await isApprover(existing.type as OrderType, req.userId);
    if (!ok) return error(res, "您不是该类型的审批人", 403);

    const order = await prisma.order.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: "ORDER_REJECTED",
      module: "order",
      targetId: id,
      target: existing.orderNo || id,
      detail: `驳回了单据「${existing.orderNo}」`,
      customerId: existing.customerId,
    });
    success(res, order, "已驳回");
  } catch (err) {
    next(err);
  }
};

// ========== 删除单据 ==========
export const remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "单据不存在", 404);

    await prisma.order.delete({ where: { id } });

    const username = req.username!;
    await activityLogger.log({
      userId: req.userId!,
      username,
      action: "ORDER_DELETED",
      module: "order",
      targetId: id,
      target: existing.orderNo || id,
      detail: `删除了单据「${existing.orderNo}」`,
      customerId: existing.customerId,
    });

    success(res, null, "删除成功");
  } catch (err) {
    next(err);
  }
};

// ========== 某客户的单据列表 ==========
export const listByCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId } = req.params;
    const { type } = req.query;
    const where: any = { customerId };
    if (type) where.type = String(type);
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    success(res, orders);
  } catch (err) {
    next(err);
  }
};

// ========== 付款单（收款记录） ==========
export const listPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId, customerId } = req.query;
    const where: any = {};
    if (orderId) where.orderId = String(orderId);
    if (customerId) where.customerId = String(customerId);
    const list = await prisma.paymentRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { id: true, companyName: true } }, order: { select: { id: true, orderNo: true, title: true } } },
    });
    success(res, list);
  } catch (err) {
    next(err);
  }
};

export const createPayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { orderId, payDate, amount, ratio, method, status, remark } = req.body;
    if (!orderId) return error(res, "请选择关联单据", 400);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return error(res, "关联单据不存在", 404);
    const rec = await prisma.paymentRecord.create({
      data: {
        orderId,
        customerId: order.customerId,
        paymentNo: `P-${Date.now()}`,
        payDate,
        amount: amount !== undefined ? Number(amount) : null,
        ratio: ratio !== undefined ? Number(ratio) : null,
        method,
        status: status || "RECEIVED",
        remark,
        createdBy: userId,
      },
    });
    success(res, rec, "创建成功");
  } catch (err) {
    next(err);
  }
};

export const updatePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { payDate, amount, ratio, method, status, remark } = req.body;
    const data: any = {};
    if (payDate !== undefined) data.payDate = payDate;
    if (amount !== undefined) data.amount = amount ? Number(amount) : null;
    if (ratio !== undefined) data.ratio = ratio ? Number(ratio) : null;
    if (method !== undefined) data.method = method;
    if (status !== undefined) data.status = status;
    if (remark !== undefined) data.remark = remark;
    const rec = await prisma.paymentRecord.update({ where: { id }, data });
    success(res, rec, "更新成功");
  } catch (err) {
    next(err);
  }
};

export const removePayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.paymentRecord.delete({ where: { id: req.params.id } });
    success(res, null, "删除成功");
  } catch (err) {
    next(err);
  }
};

// ========== 利润单（利润核算） ==========
export const listProfits = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId, customerId } = req.query;
    const where: any = {};
    if (orderId) where.orderId = String(orderId);
    if (customerId) where.customerId = String(customerId);
    const list = await prisma.profitRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { id: true, companyName: true } }, order: { select: { id: true, orderNo: true, title: true } } },
    });
    success(res, list);
  } catch (err) {
    next(err);
  }
};

export const createProfit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { orderId, revenue, cost, currency, remark } = req.body;
    if (!orderId) return error(res, "请选择关联单据", 400);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return error(res, "关联单据不存在", 404);
    const rev = revenue !== undefined ? Number(revenue) : 0;
    const cst = cost !== undefined ? Number(cost) : 0;
    const rec = await prisma.profitRecord.create({
      data: {
        orderId,
        customerId: order.customerId,
        profitNo: `PR-${Date.now()}`,
        revenue: rev || null,
        cost: cst || null,
        profit: rev - cst,
        margin: rev > 0 ? ((rev - cst) / rev) * 100 : null,
        currency: currency || "CNY",
        remark,
        createdBy: userId,
      },
    });
    success(res, rec, "创建成功");
  } catch (err) {
    next(err);
  }
};

export const updateProfit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { revenue, cost, currency, remark } = req.body;
    const data: any = {};
    if (revenue !== undefined) data.revenue = revenue ? Number(revenue) : null;
    if (cost !== undefined) data.cost = cost ? Number(cost) : null;
    if (currency !== undefined) data.currency = currency;
    if (remark !== undefined) data.remark = remark;
    const existing = await prisma.profitRecord.findUnique({ where: { id } });
    if (existing) {
      const rev = data.revenue !== undefined ? data.revenue : existing.revenue;
      const cst = data.cost !== undefined ? data.cost : existing.cost;
      if (rev !== null && cst !== null) {
        data.profit = rev - cst;
        data.margin = rev > 0 ? ((rev - cst) / rev) * 100 : null;
      }
    }
    const rec = await prisma.profitRecord.update({ where: { id }, data });
    success(res, rec, "更新成功");
  } catch (err) {
    next(err);
  }
};

export const removeProfit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.profitRecord.delete({ where: { id: req.params.id } });
    success(res, null, "删除成功");
  } catch (err) {
    next(err);
  }
};
