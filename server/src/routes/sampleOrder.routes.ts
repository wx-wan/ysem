import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listSampleOrders,
  getSampleOrder,
  createSampleOrder,
  updateSampleOrder,
  removeSampleOrder,
  listSampleRounds,
  createSampleRound,
  updateSampleRound,
  removeSampleRound,
} from '../controllers/sampleOrder.controller';

const router = Router();

// 所有打样单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内施加
router.use(authenticate);

// 打样轮次（SampleOrder 1:N SampleRound）
router.get('/:id/rounds', listSampleRounds);
router.post('/:id/rounds', createSampleRound);
router.put('/:id/rounds/:roundId', updateSampleRound);
router.delete('/:id/rounds/:roundId', removeSampleRound);

router.get('/', listSampleOrders);
router.get('/:id', getSampleOrder);
router.post('/', createSampleOrder);
router.put('/:id', updateSampleOrder);
router.delete('/:id', removeSampleOrder);

export default router;
