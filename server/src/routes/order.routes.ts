import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/order.controller";

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 订单管理
 *   description: 订单 CRUD
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     tags: [订单管理]
 *     summary: 获取订单列表
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 订单列表（分页）
 */
router.get("/", ctrl.list);

/**
 * @swagger
 * /api/orders/customer/{customerId}:
 *   get:
 *     tags: [订单管理]
 *     summary: 按客户查询订单
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 该客户的订单列表
 */
router.get("/customer/:customerId", ctrl.listByCustomer);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     tags: [订单管理]
 *     summary: 获取订单详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 订单详情
 */
router.get("/:id", ctrl.getById);

/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [订单管理]
 *     summary: 创建订单
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, amount, currency]
 *             properties:
 *               customerId: { type: integer }
 *               amount: { type: number }
 *               currency: { type: string, default: CNY }
 *               orderDate: { type: string, format: date }
 *               status: { type: string, default: pending }
 *               remark: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post("/", ctrl.create);

/**
 * @swagger
 * /api/orders/{id}:
 *   put:
 *     tags: [订单管理]
 *     summary: 更新订单
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put("/:id", ctrl.update);

/**
 * @swagger
 * /api/orders/{id}:
 *   delete:
 *     tags: [订单管理]
 *     summary: 删除订单
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete("/:id", ctrl.remove);

export default router;
