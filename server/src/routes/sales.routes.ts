import { Router } from 'express';
import {
  getOpportunities, getOpportunity,
  updateOpportunity, deleteOpportunity, batchDelete,
  getAssignUsers, getByCustomer, getByProduct, getSalesLogs,
} from '../controllers/sales.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 销售管理
 *   description: 销售管道管理
 */

/**
 * @swagger
 * /api/sales/assign-users:
 *   get:
 *     tags: [销售管理]
 *     summary: 获取可分配用户列表
 *     responses:
 *       200:
 *         description: 用户列表
 */
router.get('/assign-users', getAssignUsers);

/**
 * @swagger
 * /api/sales:
 *   get:
 *     tags: [销售管理]
 *     summary: 获取销售列表
 *     responses:
 *       200:
 *         description: 销售记录列表
 */
router.get('/', getOpportunities);

router.get('/by-customer/:customerId', getByCustomer);

router.get('/by-product/:productId', getByProduct);

router.get('/:id/logs', getSalesLogs);

router.get('/:id', getOpportunity);

// 商机**不支持创建**：`POST /api/sales` 已下线，唯一创建入口是「线索确认」
// `POST /api/leads/:id/confirm`（客户与来源线索由线索派生）。
// 商机同样不支持 Excel 导入（`POST /api/sales/import` 已下线）。

router.put('/:id', updateOpportunity);

/**
 * @swagger
 * /api/sales/{id}/stage:
 *   patch:
 *     tags: [销售管理]
 *     summary: 更新销售阶段
 *     responses:
 *       200:
 *         description: 更新成功
 */
/**
 * @swagger
 * /api/sales/batch:
 *   delete:
 *     tags: [销售管理]
 *     summary: 批量删除销售记录
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: 批量删除成功
 */
router.delete('/batch', batchDelete);

router.delete('/:id', deleteOpportunity);

export default router;
