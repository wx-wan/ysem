import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listQualityInspections,
  getQualityInspection,
  createQualityInspection,
  updateQualityInspection,
  removeQualityInspection,
} from '../controllers/qualityInspection.controller';

const router = Router();

// 所有质检单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按宿主继承
router.use(authenticate);

router.get('/', listQualityInspections);
router.get('/:id', getQualityInspection);
router.post('/', createQualityInspection);
router.put('/:id', updateQualityInspection);
router.delete('/:id', removeQualityInspection);

export default router;
