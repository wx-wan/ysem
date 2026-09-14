import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listPayments,
  getPayment,
  createPayment,
  updatePayment,
  removePayment,
} from '../controllers/payment.controller';

const router = Router();

// 所有收付款接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按宿主继承
router.use(authenticate);

router.get('/', listPayments);
router.get('/:id', getPayment);
router.post('/', createPayment);
router.put('/:id', updatePayment);
router.delete('/:id', removePayment);

export default router;
