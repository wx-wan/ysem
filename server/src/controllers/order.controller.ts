import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { success, error } from "../utils/response";

const prisma = new PrismaClient();

// ========== 订单列表 ==========
export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    const userRole = (req as any).roleCode;
    const {
      keyword,
      status,
      customerId,
      startDate,
      endDate,
      page = "1",
      pageSize = "20",
    } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};

    // 非管理员只能看自己客户下的订单
    if (userRole !== "admin") {
      where.customer = { ownerId: userId };
    }
    if (customerId) where.customerId = String(customerId);
    if (status) where.status = String(status);
    if (keyword) {
      where.OR = [
        { orderNo: { contains: String(keyword) } },
        { customer: { companyName: { contains: String(keyword) } } },
      ];
    }
    if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) where.orderDate.gte = String(startDate);
      if (endDate) where.orderDate.lte = String(endDate);
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

    // 汇总金额
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

// ========== 订单详情 ==========
export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true, ownerId: true } },
      },
    });
    if (!order) return error(res, "订单不存在", 404);
    success(res, order);
  } catch (err) {
    next(err);
  }
};

// ========== 创建订单 ==========
export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    const {
      customerId,
      orderNo,
      orderDate,
      amountCNY,
      deliveryDate,
      paymentTerms,
      status,
      notes,
    } = req.body;

    if (!customerId) return error(res, "请选择客户", 400);

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return error(res, "客户不存在", 404);

    const order = await prisma.order.create({
      data: {
        customerId,
        orderNo,
        orderDate,
        amountCNY: amountCNY ? Number(amountCNY) : null,
        deliveryDate,
        paymentTerms,
        status: status || "PENDING",
        notes,
        createdBy: userId,
      },
    });

    // 自动更新客户首次下单日期（取最早的订单日期）
    if (orderDate) {
      const earliestOrder = await prisma.order.findFirst({
        where: { customerId },
        orderBy: { orderDate: "asc" },
      });
      if (earliestOrder?.orderDate) {
        await prisma.customer.update({
          where: { id: customerId },
          data: { firstOrderDate: earliestOrder.orderDate },
        });
      }
    }

    // 记录到客户活动日志
    await prisma.customerActivity.create({
      data: {
        customerId,
        action: "UPDATED",
        detail: `新增订单${orderNo ? `：${orderNo}` : ""}，金额 ¥${(amountCNY || 0).toLocaleString()}`,
        createdBy: (req as any).username,
      },
    });

    success(res, order, "创建成功");
  } catch (err) {
    next(err);
  }
};

// ========== 更新订单 ==========
export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      orderNo,
      orderDate,
      amountCNY,
      deliveryDate,
      paymentTerms,
      status,
      notes,
    } = req.body;

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "订单不存在", 404);

    const order = await prisma.order.update({
      where: { id },
      data: {
        orderNo: orderNo ?? existing.orderNo,
        orderDate: orderDate !== undefined ? orderDate : existing.orderDate,
        amountCNY: amountCNY !== undefined ? Number(amountCNY) : existing.amountCNY,
        deliveryDate: deliveryDate !== undefined ? deliveryDate : existing.deliveryDate,
        paymentTerms: paymentTerms !== undefined ? paymentTerms : existing.paymentTerms,
        status: status ?? existing.status,
        notes: notes !== undefined ? notes : existing.notes,
      },
    });

    // 如果订单日期变化，重新计算客户的 firstOrderDate
    if (orderDate && orderDate !== existing.orderDate) {
      const earliestOrder = await prisma.order.findFirst({
        where: { customerId: existing.customerId },
        orderBy: { orderDate: "asc" },
      });
      if (earliestOrder?.orderDate) {
        await prisma.customer.update({
          where: { id: existing.customerId },
          data: { firstOrderDate: earliestOrder.orderDate },
        });
      }
    }

    success(res, order, "更新成功");
  } catch (err) {
    next(err);
  }
};

// ========== 删除订单 ==========
export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return error(res, "订单不存在", 404);

    await prisma.order.delete({ where: { id } });

    // 删除后重新计算客户的 firstOrderDate
    const earliestOrder = await prisma.order.findFirst({
      where: { customerId: existing.customerId },
      orderBy: { orderDate: "asc" },
    });
    await prisma.customer.update({
      where: { id: existing.customerId },
      data: { firstOrderDate: earliestOrder?.orderDate || null },
    });

    success(res, null, "删除成功");
  } catch (err) {
    next(err);
  }
};

// ========== 某客户的订单列表 ==========
export const listByCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId } = req.params;
    const orders = await prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });
    success(res, orders);
  } catch (err) {
    next(err);
  }
};
