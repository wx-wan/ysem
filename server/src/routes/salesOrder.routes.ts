import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listSalesOrders,
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
  removeSalesOrder,
} from '../controllers/salesOrder.controller';

const router = Router();

// 所有销售订单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内施加
router.use(authenticate);

router.get('/', listSalesOrders);
router.get('/:id', getSalesOrder);
router.post('/', createSalesOrder);
router.put('/:id', updateSalesOrder);
router.delete('/:id', removeSalesOrder);

export default router;
