import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  removePurchaseOrder,
} from '../controllers/purchaseOrder.controller';

const router = Router();

// 所有采购单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按 ownerId 施加
router.use(authenticate);

router.get('/', listPurchaseOrders);
router.get('/:id', getPurchaseOrder);
router.post('/', createPurchaseOrder);
router.put('/:id', updatePurchaseOrder);
router.delete('/:id', removePurchaseOrder);

export default router;
