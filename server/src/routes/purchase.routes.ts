import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/purchase.controller';

// ============================================================
// /api/purchases —— 现仅保留 Supplier（供应商）端点
//
// 【Round 3B-3-5-6a · Legacy Purchase Backend Retirement】
// 已删除的 legacy 采购单单据路由共 6 条（全部无调用方，前端已于 Round 3B-3-5-5
// 迁至 `/api/purchase-orders`，见 purchaseOrder.routes.ts）：
//   列表 / 创建（根路径）· 详情 / 更新 / 删除（单条路径）· 状态流转（子路径）
//
// 保留的 Supplier 端点：无 V1.0 supplier 模块，采购单表单（供应商下拉 / 快捷新增）
// 仍依赖它们。因单条路径类路由（含状态流转子路径）均已删除，`/suppliers` 不再存在
// 被动态段捕获的可能 —— 本轮之后本 router 只注册静态路径。
// ============================================================

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 采购管理
 *   description: 供应商管理（采购单请使用 /api/purchase-orders）
 */

/**
 * @swagger
 * /api/purchases/suppliers:
 *   get:
 *     tags: [采购管理]
 *     summary: 供应商列表（供选择）
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 供应商列表
 */
router.get('/suppliers', ctrl.listSuppliers);

/**
 * @swagger
 * /api/purchases/suppliers:
 *   post:
 *     tags: [采购管理]
 *     summary: 新增供应商
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               contact: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               remark: { type: string }
 *     responses:
 *       200:
 *         description: 新增成功
 */
router.post('/suppliers', ctrl.createSupplier);

export default router;
