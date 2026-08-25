import { Router } from 'express';
import { getTodayRates } from '../controllers/exchange.controller';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: 汇率
 *   description: 多币种汇率查询
 */

/**
 * @swagger
 * /api/ext/exchange:
 *   get:
 *     tags: [汇率]
 *     summary: 获取汇率数据
 *     security: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, default: CNY }
 *         description: 基准货币代码
 *     responses:
 *       200:
 *         description: 汇率数据
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     base: { type: string }
 *                     date: { type: string }
 *                     rates: { type: object }
 */
router.get('/', getTodayRates);

export default router;
