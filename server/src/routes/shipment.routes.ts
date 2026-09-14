import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listShipments,
  getShipment,
  createShipment,
  updateShipment,
  removeShipment,
} from '../controllers/shipment.controller';

const router = Router();

// 所有出运单接口都需要登录；数据范围（ALL / DEPT / SELF）由 scope 工具在控制器内按 salesOrder.ownerId 施加
router.use(authenticate);

router.get('/', listShipments);
router.get('/:id', getShipment);
router.post('/', createShipment);
router.put('/:id', updateShipment);
router.delete('/:id', removeShipment);

export default router;
