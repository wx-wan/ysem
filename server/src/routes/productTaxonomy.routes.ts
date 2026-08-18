import { Router } from 'express';
import { authenticate, requirePerm } from '../middleware/auth';
import {
  getCrafts, createCraft, updateCraft, deleteCraft,
  getAudiences, createAudience, updateAudience, deleteAudience,
  getCategories, createCategory, updateCategory, deleteCategory,
} from '../controllers/productTaxonomy.controller';

const router = Router();

// 工艺
router.get('/crafts', authenticate, getCrafts);
router.post('/crafts', authenticate, requirePerm('product:taxonomy:create'), createCraft);
router.put('/crafts/:id', authenticate, requirePerm('product:taxonomy:update'), updateCraft);
router.delete('/crafts/:id', authenticate, requirePerm('product:taxonomy:delete'), deleteCraft);

// 受众
router.get('/audiences', authenticate, getAudiences);
router.post('/audiences', authenticate, requirePerm('product:taxonomy:create'), createAudience);
router.put('/audiences/:id', authenticate, requirePerm('product:taxonomy:update'), updateAudience);
router.delete('/audiences/:id', authenticate, requirePerm('product:taxonomy:delete'), deleteAudience);

// 品类
router.get('/categories', authenticate, getCategories);
router.post('/categories', authenticate, requirePerm('product:taxonomy:create'), createCategory);
router.put('/categories/:id', authenticate, requirePerm('product:taxonomy:update'), updateCategory);
router.delete('/categories/:id', authenticate, requirePerm('product:taxonomy:delete'), deleteCategory);

export default router;
