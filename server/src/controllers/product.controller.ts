import { Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { SkuConcurrencyError, SkuContextError } from '../lib/skuCode';
import { AuthRequest } from '../middleware/auth';
import * as productService from '../services/product.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, projectProductRows } from '../scope';

/**
 * Product Controller（Round R-4 · Product Layering）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO/schema 校验、
 *              authentication / permission context 接入、HTTP 状态码、response formatting。
 *
 * **禁止**：Prisma 访问、数据库查询、事务编排、复杂业务判断、状态机、跨实体业务流程
 * —— 这些均已在 R-4 迁往 services（Business）/ operations（Operation）/ repositories（Data）。
 *
 * API Contract 保持不变：请求字段、响应结构、错误码与文案、筛选/排序/分页口径逐项未改。
 * 导出名与既有路由引用一致（`routes/product.routes.ts` 无需改动）。
 *
 * 说明：Excel 文件解码（XLSX.read）与模板生成属 **HTTP/文件边界** 职责，留在 Controller；
 *       表头 → 字段名的映射与逐行建档属业务，已迁至 Business 层。
 */

// ============================================================
// HTTP 边界：调用者上下文组装
// ============================================================

/**
 * 组装业务上下文：actor 身份 + 可见性条件 + 读取侧投影。
 * `req` 只在本函数内被读取，Business / Operation / Data 层不接触 HTTP 对象。
 */
function buildActorContext(req: AuthRequest): productService.ProductActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    roleCode: req.roleCode,
    isAdmin: req.roleCode === 'admin' || req.roleCode === 'ADMIN',
    visibilityWhere: productVisibilityWhere(req),
    projectRows: (rows, fields, options) => projectProductRows(req, rows, fields, options),
  };
}

/**
 * 错误映射（HTTP 边界职责）：
 *  - DomainError（Business 层表达的业务失败）→ 既有响应形状 {code, message}
 *  - ZodError（DTO 校验失败）→ 400 + 逐条 message 拼接
 *  - 其它 → `fallback`（各 handler 的既有文案，逐字保留）
 */
function respondError(res: Response, err: unknown, fallback: string, zodAware = false): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (zodAware && err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, fallback);
}

// ============================================================
// 查询
// ============================================================

// 预览接口：按当前工艺/受众返回下一个 SKU（不落库），供表单实时展示
export const previewProductSku = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sku = await productService.previewProductSku({
      craftIds: req.query.craftIds as string | undefined,
      audienceId: req.query.audienceId as string | undefined,
      excludeId: req.query.excludeId as string | undefined,
    });
    success(res, { sku });
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProductOptions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await productService.listProductOptions(buildActorContext(req));
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await productService.listProducts(
      {
        page: req.query.page as string,
        pageSize: req.query.pageSize as string,
        keyword: req.query.keyword as string,
        craftIds: req.query.craftIds as string | undefined,
        audienceId: req.query.audienceId as string | undefined,
        categoryId: req.query.categoryId as string | undefined,
        visibility: req.query.visibility as string | undefined,
      },
      buildActorContext(req),
    );
    success(res, result);
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProductById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detail = await productService.getProductDetail(req.params.id, buildActorContext(req));
    success(res, detail);
  } catch (err) {
    respondError(res, err, '服务器错误');
  }
};

/**
 * GET /api/products/:id/logs —— 产品操作记录（详情「操作记录」Tab 数据源）。
 */
export const getProductLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await productService.getProductLogs(req.params.id);
    success(res, { list });
  } catch (err) {
    respondError(res, err, '查询产品操作记录失败');
  }
};

/**
 * 产品 / 组合 混合列表：同一列表内按类型（ALL/PRODUCT/GROUP）混排。
 * 返回条目形如 { type: 'PRODUCT'|'GROUP', data: <原始记录> }，前端据此分派卡片。
 */
export const getMixedProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await productService.listMixedProducts(
      {
        page: req.query.page as string,
        pageSize: req.query.pageSize as string,
        keyword: req.query.keyword as string,
        type: req.query.type as string,
        craftIds: req.query.craftIds as string,
        audienceId: req.query.audienceId as string | undefined,
        visibility: req.query.visibility as string | undefined,
      },
      buildActorContext(req),
    );
    success(res, result);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============================================================
// 写入
// ============================================================

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productService.productSchema.parse(req.body);
    const product = await productService.createProduct(parsed, buildActorContext(req));
    created(res, product);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    if (err instanceof SkuContextError) { fail(res, 400, err.message); return; }
    if (err instanceof SkuConcurrencyError) {
      console.error('[createProduct] sku conflict', err.cause);
      fail(res, 409, err.message);
      return;
    }
    console.error('[createProduct]', err);
    fail(res, 500, err instanceof Error ? err.message : '服务器错误');
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productService.productSchema.partial().parse(req.body);
    const product = await productService.updateProduct(req.params.id, parsed, buildActorContext(req));
    success(res, product, '更新成功');
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    if (err instanceof SkuContextError) { fail(res, 400, err.message); return; }
    if (err instanceof SkuConcurrencyError) {
      console.error('[updateProduct] sku conflict', err.cause);
      fail(res, 409, err.message);
      return;
    }
    console.error('[updateProduct] error:', err);
    fail(res, 500, err instanceof Error ? err.message : '服务器错误');
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await productService.deleteProduct(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, '服务器错误');
  }
};

// ============================================================
// Excel 导入 / 模板下载
// ============================================================

export const importExcel = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) return fail(res, 400, '请上传文件');

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

    // 逐行解析与建档（含表头映射、名称→ID 解析、逐行独立事务）在 Business 层
    const result = await productService.importProducts(rows, buildActorContext(req));
    success(res, result);
  } catch (err) {
    next(err);
  }
};

export const downloadTemplate = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const header = [
      '产品名称', '工艺', '受众', '品类', '尺寸长', '尺寸宽', '尺寸高', '克重',
      '供货模式', '认证资质', '描述', '价格', '币种', '税率', '库存', '低库存预警',
      '来源', '可见性', '可见人员', '备注',
    ];
    const ws = XLSX.utils.aoa_to_sheet([header]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '产品导入模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    next(err);
  }
};
