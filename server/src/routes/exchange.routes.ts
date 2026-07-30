import { Router } from 'express';

const router = Router();

// GET /api/ext/exchange?from=CNY
router.get('/', async (_req, res) => {
  try {
    const from = (_req.query.from as string) || 'CNY';
    const response = await fetch(`https://api.frankfurter.app/latest?from=${from}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
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
