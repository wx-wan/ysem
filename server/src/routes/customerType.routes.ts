import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getActiveCustomerTypes,
  getAllCustomerTypes,
  getCustomerType,
  createCustomerType,
  updateCustomerType,
  deleteCustomerType,
  updateCustomerTypeSort,
} from '../controllers/customerType.controller';

const router = Router();

router.get('/active', authenticate, getActiveCustomerTypes);
router.get('/', authenticate, requirePerm('system:customer-type'), getAllCustomerTypes);
router.get('/:id', authenticate, requirePerm('system:customer-type'), getCustomerType);
router.post('/', authenticate, requirePerm('system:customer-type:edit'), createCustomerType);
router.put('/sort', authenticate, requirePerm('system:customer-type:edit'), updateCustomerTypeSort);
router.put('/:id', authenticate, requirePerm('system:customer-type:edit'), updateCustomerType);
router.delete('/:id', authenticate, requirePerm('system:customer-type:edit'), deleteCustomerType);

export default router;
