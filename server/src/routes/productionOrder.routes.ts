import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listProductionOrders,
  getProductionOrder,
  createProductionOrder,
  updateProductionOrder,
  removeProductionOrder,
} from '../controllers/productionOrder.controller';

const router = Router();

// 所有生产工单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内施加
router.use(authenticate);

router.get('/', listProductionOrders);
router.get('/:id', getProductionOrder);
router.post('/', createProductionOrder);
router.put('/:id', updateProductionOrder);
router.delete('/:id', removeProductionOrder);

export default router;
