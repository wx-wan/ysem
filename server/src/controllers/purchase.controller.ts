import { Response } from 'express';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as supplierService from '../services/supplier.service';
import { error, success } from '../utils/response';

/**
 * Supplier Controller —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * 职责（仅此）：HTTP request/response、参数解析、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/supplier.service.ts`（Business）
 * / `operations/procurement.operations.ts`（Operation）
 * / `repositories/supplier.repository.ts`（Data）。API Contract 保持不变。
 *
 * 【历史说明（保留）】本文件原承载「legacy 统一采购单 CRUD」，已随 V1.0 `PurchaseOrder`
 * （`/api/purchase-orders`）落地与前端迁移全部删除；现存仅为 Supplier API，
 * 端点仍挂在 `/api/purchases/suppliers`（路由前缀保持原样）。
 */

// 供应商下拉/搜索（供采购表单选择）
export const listSuppliers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    success(res, { items: await supplierService.list(keyword) });
  } catch {
    // 既有行为：失败统一 `error(res, msg)` 且**使用其默认码 400**
    error(res, '获取供应商列表失败');
  }
};

// 新增供应商
export const createSupplier = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await supplierService.create(req.body || {}, req.userId ?? null);
    success(res, { item });
  } catch (err) {
    if (err instanceof DomainError) {
      error(res, err.message, err.code);
      return;
    }
    error(res, '新增供应商失败');
  }
};
