import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { listProfits, getProfit, createProfit, updateProfit } from '../controllers/profit.controller';

const router = Router();

// 所有利润单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按 salesOrder.ownerId 继承
router.use(authenticate);

router.get('/', listProfits);
router.get('/:id', getProfit);
router.post('/', createProfit);
router.put('/:id', updateProfit);

// 不提供 DELETE：Profit 为 SalesOrder 1:1 的利润核算 / 审计快照实体，纠错走 DRAFT / 重算 / 更新

export default router;
