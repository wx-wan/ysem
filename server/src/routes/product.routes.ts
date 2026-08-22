import { Router } from 'express';
import {
  getProductOptions, getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  previewProductSku, batchCreateProducts, getMixedProducts,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/options', getProductOptions);
router.get('/sku-preview', previewProductSku);
router.get('/mixed', getMixedProducts);
router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', createProduct);
router.post('/batch', batchCreateProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;
