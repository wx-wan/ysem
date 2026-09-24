import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getActiveUnits,
  getAllUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  updateUnitSort,
} from '../controllers/unit.controller';

const router = Router();

router.get('/active', authenticate, getActiveUnits);
router.get('/', authenticate, requirePerm('system:data'), getAllUnits);
router.get('/:id', authenticate, requirePerm('system:data'), getUnit);
router.post('/', authenticate, requirePerm('system:data:edit'), createUnit);
router.put('/sort', authenticate, requirePerm('system:data:edit'), updateUnitSort);
router.put('/:id', authenticate, requirePerm('system:data:edit'), updateUnit);
router.delete('/:id', authenticate, requirePerm('system:data:edit'), deleteUnit);

export default router;
