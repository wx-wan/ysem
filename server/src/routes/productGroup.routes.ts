import { Router } from 'express';
import {
  getProductGroups, getProductGroupById, createProductGroup, updateProductGroup,
  deleteProductGroup, updateGroupProducts,
} from '../controllers/productGroup.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getProductGroups);
router.get('/:id', getProductGroupById);
router.post('/', createProductGroup);
router.put('/:id', updateProductGroup);
router.delete('/:id', deleteProductGroup);
router.post('/:id/products', updateGroupProducts); // ?mode=add|remove

export default router;
