import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getActiveCurrencies,
  getAllCurrencies,
  getCurrency,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  updateCurrencySort,
} from '../controllers/currency.controller';

const router = Router();

router.get('/active', authenticate, getActiveCurrencies);
router.get('/', authenticate, requirePerm('system:data'), getAllCurrencies);
router.get('/:id', authenticate, requirePerm('system:data'), getCurrency);
router.post('/', authenticate, requirePerm('system:data:edit'), createCurrency);
router.put('/sort', authenticate, requirePerm('system:data:edit'), updateCurrencySort);
router.put('/:id', authenticate, requirePerm('system:data:edit'), updateCurrency);
router.delete('/:id', authenticate, requirePerm('system:data:edit'), deleteCurrency);

export default router;
