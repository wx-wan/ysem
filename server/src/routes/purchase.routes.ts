import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/purchase.controller';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 采购管理
 *   description: 采购单管理、供应商管理
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

/**
 * @swagger
 * /api/purchases:
 *   get:
 *     tags: [采购管理]
 *     summary: 采购单列表（含统计）
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, ORDERED, PARTIAL, ARRIVED, CANCELLED] }
 *       - in: query
 *         name: supplierId
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string }
 *       - in: query
 *         name: endDate
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 采购单列表与统计
 */
router.get('/', ctrl.getPurchases);

/**
 * @swagger
 * /api/purchases:
 *   post:
 *     tags: [采购管理]
 *     summary: 创建采购单
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               supplierId: { type: string }
 *               purchaseDate: { type: string }
 *               items: { type: array, description: 明细 [{productId,name,spec,quantity,unitPrice}] }
 *               remark: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', ctrl.createPurchase);

/**
 * @swagger
 * /api/purchases/{id}:
 *   get:
 *     tags: [采购管理]
 *     summary: 采购单详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 采购单详情
 */
router.get('/:id', ctrl.getPurchase);

/**
 * @swagger
 * /api/purchases/{id}:
 *   put:
 *     tags: [采购管理]
 *     summary: 更新采购单（仅草稿/已下单）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:id', ctrl.updatePurchase);

/**
 * @swagger
 * /api/purchases/{id}/status:
 *   patch:
 *     tags: [采购管理]
 *     summary: 采购单状态流转
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ORDERED, PARTIAL, ARRIVED, CANCELLED] }
 *     responses:
 *       200:
 *         description: 状态变更成功
 */
router.patch('/:id/status', ctrl.changePurchaseStatus);

/**
 * @swagger
 * /api/purchases/{id}:
 *   delete:
 *     tags: [采购管理]
 *     summary: 删除采购单（仅草稿/已取消）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/:id', ctrl.deletePurchase);

export default router;
