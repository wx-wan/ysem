import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  removeQuotation,
} from '../controllers/quotation.controller';

const router = Router();

// 所有报价接口都需要登录；写权限由前端按角色控制
router.use(authenticate);

router.get('/', listQuotations);
router.get('/:id', getQuotation);
router.post('/', createQuotation);
router.put('/:id', updateQuotation);
router.delete('/:id', removeQuotation);

export default router;
