import { Router } from 'express';
import { getDailyRates, ensureToday } from '../controllers/exchange.controller';

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
router.get('/', async (_req, res) => {
  try {
    const from = (_req.query.from as string) || 'CNY';
    const response = await fetch(`https://api.frankfurter.app/latest?from=${from}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json() as { base?: string; date?: string; rates?: Record<string, number> };
    res.json({
      code: 0,
      data: {
        base: data.base,
        date: data.date,
        rates: data.rates,
      },
    });
  } catch {
    // 降级返回参考汇率
    res.json({
      code: 0,
      data: {
        base: (_req.query.from as string) || 'CNY',
        date: new Date().toISOString().slice(0, 10),
        rates: {
          USD: 0.14,
          EUR: 0.13,
          GBP: 0.11,
          JPY: 20.5,
          KRW: 185,
        },
      },
    });
  }
});

export default router;
