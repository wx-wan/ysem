import { Request, Response } from 'express';
import { success, error } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { roleScope } from '../utils/scope';

// 采购单状态机：DRAFT(草稿) → ORDERED(已下单) → PARTIAL(部分到货) → ARRIVED(已到货)；DRAFT/ORDERED/PARTIAL 可取消
const STATUS_FLOW: Record<string, string[]> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIAL', 'ARRIVED', 'CANCELLED'],
  PARTIAL: ['ARRIVED', 'CANCELLED'],
  ARRIVED: [],
  CANCELLED: [],
};

export interface PurchaseItem {
  productId?: string;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  remark?: string;
}

const parseItems = (raw: unknown): PurchaseItem[] => {
  if (Array.isArray(raw)) return raw as PurchaseItem[];
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as PurchaseItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const calcAmount = (items: PurchaseItem[]): number =>
  items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

// 辅助：生成采购单号 PO-{YYMMDD}-{当天序号}
const generatePurchaseNo = async (): Promise<string> => {
  const d = new Date();
  const datePart = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const count = await prisma.purchaseOrder.count({
    where: { purchaseNo: { startsWith: `PO-${datePart}-` } },
  });
  return `PO-${datePart}-${count + 1}`;
};

// 列表（含统计卡）
export const getPurchases = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = String(req.query.keyword || '').trim();
    const status = String(req.query.status || '');
    const supplierId = String(req.query.supplierId || '');
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');

    const scope = await roleScope(req, { field: 'ownerId' });
    const where: Record<string, unknown> = { ...scope };

    if (keyword) {
      where.OR = [
        { purchaseNo: { contains: keyword } },
        { supplier: { name: { contains: keyword } } },
      ];
    }
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (startDate) where.purchaseDate = { gte: startDate };
    if (endDate) where.purchaseDate = { ...(where.purchaseDate as object), lte: endDate };

    const [items, total, stats] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { supplier: { select: { id: true, name: true, contact: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.aggregate({
        where: { ...scope, status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { amountCNY: true },
      }),
    ]);

    // 待入库（已下单 + 部分到货）
    const pendingCount = await prisma.purchaseOrder.count({
      where: { ...scope, status: { in: ['ORDERED', 'PARTIAL'] } },
    });

    success(res, {
      items,
      total,
      stats: {
        total: stats._count,
        pending: pendingCount,
        amountCNY: stats._sum.amountCNY || 0,
      },
    });
  } catch (e) {
    error(res, '获取采购单列表失败');
  }
};

// 详情
export const getPurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await roleScope(req, { field: 'ownerId' });
    const item = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, ...scope },
      include: { supplier: true },
    });
    if (!item) {
      error(res, '采购单不存在或无权访问', 404);
      return;
    }
    success(res, { item });
  } catch (e) {
    error(res, '获取采购单详情失败');
  }
};

// 创建
export const createPurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { supplierId, purchaseDate, status, remark } = req.body || {};
    const items = parseItems(req.body?.items);
    if (items.length === 0) {
      error(res, '请至少添加一条采购明细', 400);
      return;
    }
    const purchaseNo = await generatePurchaseNo();
    const item = await prisma.purchaseOrder.create({
      data: {
        purchaseNo,
        supplierId: supplierId || null,
        purchaseDate: purchaseDate || null,
        status: status === 'ORDERED' ? 'ORDERED' : 'DRAFT',
        items: JSON.stringify(items),
        amountCNY: calcAmount(items),
        remark: remark || null,
        ownerId: req.userId || null,
        createdBy: req.userId || null,
      },
    });
    activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName || '',
      action: '创建采购单',
      module: '采购管理',
      targetId: item.id,
      target: item.purchaseNo || '',
      detail: `创建采购单 ${item.purchaseNo}（${items.length} 条明细）`,
      ip: req.ip,
    });
    success(res, { item });
  } catch (e) {
    error(res, '创建采购单失败');
  }
};

// 更新（仅草稿/已下单可编辑）
export const updatePurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await roleScope(req, { field: 'ownerId' });
    const exist = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!exist) {
      error(res, '采购单不存在或无权访问', 404);
      return;
    }
    if (!['DRAFT', 'ORDERED'].includes(exist.status)) {
      error(res, '当前状态不可编辑（仅草稿/已下单可修改）', 400);
      return;
    }
    const { supplierId, purchaseDate, remark } = req.body || {};
    const items = parseItems(req.body?.items);
    if (items.length === 0) {
      error(res, '请至少保留一条采购明细', 400);
      return;
    }
    const item = await prisma.purchaseOrder.update({
      where: { id: exist.id },
      data: {
        supplierId: supplierId || null,
        purchaseDate: purchaseDate || null,
        items: JSON.stringify(items),
        amountCNY: calcAmount(items),
        remark: remark || null,
      },
    });
    activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName || '',
      action: '更新采购单',
      module: '采购管理',
      targetId: item.id,
      target: item.purchaseNo || '',
      detail: `更新采购单 ${item.purchaseNo}`,
      ip: req.ip,
    });
    success(res, { item });
  } catch (e) {
    error(res, '更新采购单失败');
  }
};

// 状态流转
export const changePurchaseStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await roleScope(req, { field: 'ownerId' });
    const exist = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!exist) {
      error(res, '采购单不存在或无权访问', 404);
      return;
    }
    const newStatus = String(req.body?.status || '');
    const allowed = STATUS_FLOW[exist.status] || [];
    if (!allowed.includes(newStatus)) {
      error(res, `非法状态流转：${exist.status} → ${newStatus}`, 400);
      return;
    }
    const item = await prisma.purchaseOrder.update({
      where: { id: exist.id },
      data: { status: newStatus },
    });
    const STATUS_TEXT: Record<string, string> = {
      DRAFT: '草稿',
      ORDERED: '已下单',
      PARTIAL: '部分到货',
      ARRIVED: '已到货',
      CANCELLED: '已取消',
    };
    activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName || '',
      action: '采购单状态变更',
      module: '采购管理',
      targetId: item.id,
      target: item.purchaseNo || '',
      detail: `采购单 ${item.purchaseNo} 状态变更为「${STATUS_TEXT[newStatus] || newStatus}」`,
      ip: req.ip,
    });
    success(res, { item });
  } catch (e) {
    error(res, '采购单状态变更失败');
  }
};

// 删除（仅草稿/已取消）
export const deletePurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await roleScope(req, { field: 'ownerId' });
    const exist = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, ...scope },
    });
    if (!exist) {
      error(res, '采购单不存在或无权访问', 404);
      return;
    }
    if (!['DRAFT', 'CANCELLED'].includes(exist.status)) {
      error(res, '仅草稿/已取消的采购单可删除', 400);
      return;
    }
    await prisma.purchaseOrder.delete({ where: { id: exist.id } });
    activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName || '',
      action: '删除采购单',
      module: '采购管理',
      targetId: exist.id,
      target: exist.purchaseNo || '',
      detail: `删除采购单 ${exist.purchaseNo}`,
      ip: req.ip,
    });
    success(res, { deleted: true });
  } catch (e) {
    error(res, '删除采购单失败');
  }
};

// ========== 供应商 ==========

// 供应商下拉/搜索（供采购表单选择）
export const listSuppliers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const where = keyword
      ? { OR: [{ name: { contains: keyword } }, { contact: { contains: keyword } }] }
      : {};
    const items = await prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    success(res, { items });
  } catch (e) {
    error(res, '获取供应商列表失败');
  }
};

// 新增供应商
export const createSupplier = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, contact, phone, address, remark } = req.body || {};
    if (!name || !String(name).trim()) {
      error(res, '供应商名称不能为空', 400);
      return;
    }
    const item = await prisma.supplier.create({
      data: {
        name: String(name).trim(),
        contact: contact || null,
        phone: phone || null,
        address: address || null,
        remark: remark || null,
        createdBy: req.userId || null,
      },
    });
    success(res, { item });
  } catch (e) {
    error(res, '新增供应商失败');
  }
};
