import { Router } from 'express';
import {
  getProductOptions, getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  previewProductSku, getMixedProducts, getProductLogs,
  checkProductNameOwnership,
} from '../controllers/product.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/options', getProductOptions);
router.get('/sku-preview', previewProductSku);
router.get('/mixed', getMixedProducts);
// 产品名占用检查（轻量只读）：必须早于 `/:id`，否则被 getProductById 遮蔽
router.get('/ownership', checkProductNameOwnership);
router.get('/', getProducts);
router.get('/:id/logs', getProductLogs);

router.get('/:id', getProductById);
// 产品写操作按**按钮级权限**判定（系统设置 → 权限管理 → 产品管理 → 产品新增/编辑/删除）；
// admin 全量放行（requirePerm 内置）。权限码见 prisma/seed.ts。
router.post('/', requirePerm('product:create'), createProduct);
router.put('/:id', requirePerm('product:update'), updateProduct);
router.delete('/:id', requirePerm('product:delete'), deleteProduct);

// 【规则冻结】产品**不支持独立创建、不支持 Excel 导入**：
//   · 页面无「新建产品」入口，创建只发生在**线索建档**路径（产品随线索产生）；
//   · `POST /api/products/import` 与 `GET /api/products/template` 已下线（含下载模板）。
// `POST /api/products` 保留：线索建档仍需要它（守卫为 `product:create` 权限）。

export default router;
