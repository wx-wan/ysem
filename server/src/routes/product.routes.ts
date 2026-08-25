import { Router } from 'express';
import multer from 'multer';
import {
  getProductOptions, getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  previewProductSku, getMixedProducts, importExcel, downloadTemplate,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

router.get('/options', getProductOptions);
router.get('/sku-preview', previewProductSku);
router.get('/mixed', getMixedProducts);
router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

// Excel 导入 / 模板下载
router.post('/import', upload.single('file'), importExcel);
router.get('/template', downloadTemplate);

export default router;
