import { Router } from 'express';
import multer from 'multer';
import {
  getProductOptions, getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  previewProductSku, getMixedProducts, importExcel, downloadTemplate, getProductLogs,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

router.get('/options', getProductOptions);
router.get('/sku-preview', previewProductSku);
router.get('/mixed', getMixedProducts);
// 模板下载必须排在 `/:id` 之前，否则会被 `/:id` 捕获（id='template' → 404「产品不存在」）
router.get('/template', downloadTemplate);
router.get('/', getProducts);
router.get('/:id/logs', getProductLogs);

router.get('/:id', getProductById);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

// Excel 导入
router.post('/import', upload.single('file'), importExcel);

export default router;
