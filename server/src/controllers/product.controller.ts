import { Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

// ============ 校验 ============

const PRODUCT_TYPES = ['SELF', 'EXTERNAL'] as const;
const SELF_KINDS = ['FINISHED', 'SEMI'] as const;
const PRODUCT_SOURCES = ['MANUAL', 'SYNC', 'RPA'] as const;
const PRODUCT_STATUS = ['ACTIVE', 'INACTIVE'] as const;

const createProductSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().optional().nullable(),
  type: z.enum(PRODUCT_TYPES).default('SELF'),
  selfKind: z.enum(SELF_KINDS).optional().nullable(),
  category: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  price: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  taxRate: z.number().optional().nullable(),
  stock: z.number().int().optional().nullable(),
  lowStockAlert: z.number().int().optional().nullable(),
  source: z.enum(PRODUCT_SOURCES).default('MANUAL'),
  status: z.enum(PRODUCT_STATUS).default('ACTIVE'),
  remark: z.string().optional().nullable(),
});

const updateProductSchema = createProductSchema.partial();

// ============ 列表 ============

export const getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = '1', pageSize = '20', keyword = '', type = '', source = '', status = '',
    } = req.query as Record<string, string>;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: Record<string, unknown> = {};
    const AND: unknown[] = [];

    if (keyword) {
      AND.push({
        OR: [
          { name: { contains: keyword } },
          { sku: { contains: keyword } },
          { category: { contains: keyword } },
          { spec: { contains: keyword } },
        ],
      });
    }
    if (type) where.type = type;
    if (source) where.source = source;
    if (status) where.status = status;

    if (AND.length > 0) where.AND = AND;

    const [list, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    success(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (e) {
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============

export const getProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    success(res, product);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 创建 ============

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createProductSchema.parse(req.body);
    if (data.type === 'EXTERNAL') data.selfKind = null;
    const product = await prisma.product.create({ data });
    created(res, product, '创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map((e) => e.message).join(', '));
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新 ============

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateProductSchema.parse(req.body);
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '产品不存在'); return; }
    if (data.type === 'EXTERNAL') data.selfKind = null;
    const product = await prisma.product.update({ where: { id: req.params.id }, data });
    success(res, product, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map((e) => e.message).join(', '));
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '产品不存在'); return; }
    await prisma.product.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch (e: any) {
    if (e?.code === 'P2003') {
      fail(res, 400, '该产品已被线索关联，无法删除');
      return;
    }
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 批量删除 ============

export const batchDeleteProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    success(res, null, '批量删除成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败');
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ Excel / CSV 导入（文件导入 或 RPA 导入） ============

const PRODUCT_IMPORT_FIELDS: Record<string, string> = {
  '产品名称': 'name',
  '名称': 'name',
  'SKU': 'sku',
  '编码': 'sku',
  '类型': 'type',
  '产品类别': 'type',
  '明细类别': 'selfKind',
  '分类': 'category',
  '类别': 'category',
  '单位': 'unit',
  '规格': 'spec',
  '价格': 'price',
  '币种': 'currency',
  '备注': 'remark',
};

const TYPE_LABEL_MAP: Record<string, string> = {
  '自产品': 'SELF', '自制': 'SELF', 'SELF': 'SELF',
  '外购品': 'EXTERNAL', '外购': 'EXTERNAL', 'EXTERNAL': 'EXTERNAL',
};

const SELF_KIND_MAP: Record<string, string> = {
  '成品': 'FINISHED', 'FINISHED': 'FINISHED',
  '半成品': 'SEMI', 'SEM': 'SEMI', 'SEMI': 'SEMI',
};

const parseProductsFromBuffer = (buffer: Buffer, source: 'MANUAL' | 'RPA'): any[] => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return rows.map((row) => {
    const data: Record<string, any> = { source };
    for (const [cn, field] of Object.entries(PRODUCT_IMPORT_FIELDS)) {
      const value = (row[cn] ?? '').toString().trim();
      if (!value) continue;
      if (field === 'type') data.type = TYPE_LABEL_MAP[value] || 'SELF';
      else if (field === 'selfKind') data.selfKind = SELF_KIND_MAP[value] || null;
      else if (field === 'price') data.price = value ? Number(value) : undefined;
      else data[field] = value;
    }
    if (!data.name) return null;
    if (data.type === 'EXTERNAL') data.selfKind = null;
    return data;
  }).filter(Boolean) as any[];
};

const doImport = async (req: AuthRequest, res: Response, source: 'MANUAL' | 'RPA') => {
  try {
    const file = (req as any).file;
    if (!file) { fail(res, 400, '请上传文件'); return; }
    const parsed = parseProductsFromBuffer(file.buffer, source);
    if (parsed.length === 0) { fail(res, 400, '未解析到有效产品数据'); return; }

    let successCount = 0;
    const errors: string[] = [];
    for (const item of parsed) {
      try {
        await prisma.product.create({ data: item });
        successCount += 1;
      } catch (e: any) {
        errors.push(`${item.name || '未知'}: ${e?.message || '导入失败'}`);
      }
    }
    success(res, { total: parsed.length, success: successCount, errors }, '导入完成');
  } catch (e) {
    console.error(e);
    fail(res, 500, '导入失败');
  }
};

export const importProducts = (req: AuthRequest, res: Response) => doImport(req, res, 'MANUAL');
export const importProductsByRpa = (req: AuthRequest, res: Response) => doImport(req, res, 'RPA');

// ============ 平台同步（占位） ============
// 预留接口：后续对接外部平台（如小满、独立站、电商平台）拉取产品数据。
// 当前返回"未配置同步源"，待产品引入后实现具体同步逻辑。

export const syncPlatformProducts = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // TODO: 对接具体平台 API，将返回的产品映射为 Product 后批量写入（source='SYNC'）
    success(
      res,
      { synced: 0, message: '平台同步通道尚未配置，敬请期待产品接入后开放' },
      '同步通道待接入',
    );
  } catch {
    fail(res, 500, '同步失败');
  }
};

// ============ 下拉选项（线索/订单选择产品用） ============

export const getProductOptions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, sku: true, type: true, selfKind: true, unit: true, price: true },
      orderBy: { name: 'asc' },
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};
