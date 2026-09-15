import { Response } from 'express';
import { success, error } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';

// ============================================================
// 供应商（Supplier）领域
//
// 【Round 3B-3-5-6a · Legacy Purchase Backend Retirement】
// 本文件原承载「legacy 统一采购单 CRUD」（挂载于本路由文件的根路径），该部分已随
// V1.0 `PurchaseOrder`（`/api/purchase-orders`，见 purchaseOrder.controller.ts）
// 的落地与前端迁移（Round 3B-3-5-5）全部删除：
//   - 6 个采购单 handler：列表 / 详情 / 创建 / 更新 / 状态流转 / 删除
//   - 5 个专用 helper：旧状态机常量、旧明细类型、旧明细解析、旧金额汇总、旧编号生成
//   - 旧语义：JSON 明细持久化、旧本位币冗余字段、按日计数递增的旧编号生成
//     （其前缀与 ProductionOrder 的编号前缀冲突，删除即消除该冲突源）
//   被删标识符可从 git 历史（commit 8652a45 之前的版本）完整还原。
//
// 保留：Supplier API —— 无 V1.0 supplier 模块，且 `createSupplier` 已为 V1.0 语义
//（NumberSequence `SUP` + 事务内分配编号，不产生编号空洞）。
//
// 注意：`Supplier` 端点仍挂在 `/api/purchases/suppliers`（路由文件保持原前缀），
// 本轮不迁移其路径（无对应 V1.0 模块，迁移属独立 slice）。
// ============================================================

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
    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const supplierNo = await getNextNumber(tx, 'SUP');

      return tx.supplier.create({
        data: {
          supplierNo,
          name: String(name).trim(),
          contact: contact || null,
          phone: phone || null,
          address: address || null,
          remark: remark || null,
          createdBy: req.userId || null,
        },
      });
    });
    success(res, { item });
  } catch (e) {
    error(res, '新增供应商失败');
  }
};
