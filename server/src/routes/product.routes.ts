import { Router } from 'express';
import multer from 'multer';
import {
  getProducts, getProduct, createProduct, updateProduct,
  deleteProduct, batchDeleteProducts, importProducts, importProductsByRpa,
  syncPlatformProducts, getProductOptions,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 产品管理
 *   description: 自产品（成品/半成品）与外购品的增删改查、导入与同步
 */

router.get('/options', getProductOptions);
router.get('/sync', syncPlatformProducts);
router.post('/import', upload.single('file'), importProducts);
router.post('/import/rpa', upload.single('file'), importProductsByRpa);

router.get('/', getProducts);
router.get('/:id', getProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/batch', batchDeleteProducts);
router.delete('/:id', deleteProduct);

export default router;
