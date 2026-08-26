import { Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { computeDiff, DiffItem, FieldFormatter } from '../lib/operation-diff';

const productSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().nullish(),
  craftIds: z.array(z.string().uuid()).nullish(),
  audienceId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  // 产品属性（尺寸/克重后端以 String 存储，兼容前端传字符串或数字）
  images: z.string().nullish(),
  sizeL: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : String(v)), z.string().nullable().optional()),
  sizeW: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : String(v)), z.string().nullable().optional()),
  sizeH: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : String(v)), z.string().nullable().optional()),
  weight: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : String(v)), z.string().nullable().optional()),
  // 供货模式（单选，逗号分隔，最多一个值）
  supplyModes: z.string().nullish(),
  // 认证资质：关联证书 id 列表（逗号分隔）
  certificationIds: z.string().nullish(),
  // 原有
  description: z.string().nullish(),
  price: z.number().nonnegative().nullish(),
  currency: z.string().nullish(),
  taxRate: z.number().min(0).max(100).nullish(),
  stock: z.number().int().min(0).nullish(),
  lowStockAlert: z.number().int().min(0).nullish(),
  source: z.string().nullish(),
  // 可见性：PUBLIC 所有人可见；PRIVATE 仅指定用户可见
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  visibleUserIds: z.array(z.string()).nullish(),
  // 产品进度（打样/报价阶段多子任务并行），前端维护的 JSON 字符串
  progress: z.string().nullish(),
});

// 按「工艺代码 - 受众代码 - 序号」自动生成 SKU：
// 多工艺时主工艺在括号外，其余用 + 连接，如 TJ(ZS)-ET-001；序号按同组合递增 3 位补零。
// 缺少工艺或受众（含缺 code）时返回 null，由调用方决定提示。
export async function buildSkuCode(
  craftIds: string[],
  audienceId: string | null,
  excludeId?: string,
): Promise<string | null> {
  if (!craftIds.length || !audienceId) return null;
  const crafts = await prisma.productCraft.findMany({ where: { id: { in: craftIds } } });
  const craftCodes = craftIds
    .map((id) => crafts.find((c) => c.id === id)?.code)
    .filter((c): c is string => Boolean(c));
  if (craftCodes.length !== craftIds.length) return null; // 有工艺未配置 code
  const audience = await prisma.productAudience.findUnique({ where: { id: audienceId } });
  if (!audience?.code) return null;

  const craftPart = craftCodes.length > 1
    ? `${craftCodes[0]}(${craftCodes.slice(1).join('+')})`
    : craftCodes[0];
  const prefix = `${craftPart}-${audience.code}-`;

  const existing = await prisma.singleProduct.findMany({
    where: { sku: { startsWith: prefix }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { sku: true },
  });
  let max = 0;
  for (const p of existing) {
    if (!p.sku) continue;
    const n = Number(p.sku.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// ============ 产品操作差异计算 ============
// 比对「数据库原记录」与「提交体」，输出结构化变更列表（供前端以 Tag 展示）。
async function buildProductDiff(
  existing: any,
  parsed: Record<string, any>,
): Promise<DiffItem[]> {
  // 字段中文名
  const labels: Record<string, string> = {
    name: '产品名称',
    categoryId: '产品分类',
    audienceId: '目标受众',
    craftIds: '工艺',
    certificationIds: '认证资质',
    visibleUserIds: '可见成员',
    images: '产品图片',
    sizeL: '长(cm)',
    sizeW: '宽(cm)',
    sizeH: '高(cm)',
    weight: '重量(g)',
    supplyModes: '供货模式',
    description: '描述',
    price: '单价',
    currency: '币种',
    taxRate: '税率(%)',
    stock: '库存',
    lowStockAlert: '低库存预警',
    source: '产品来源',
    visibility: '可见范围',
  };

  // id → 名称 解析（关联字段）
  const formatters: Record<string, FieldFormatter> = {
    // 字符串数组 id（逗号分隔）转名称
    categoryId: async (v) => (v ? (await prisma.productCategory.findUnique({ where: { id: v as string } }))?.name ?? String(v) : '空'),
    audienceId: async (v) => (v ? (await prisma.productAudience.findUnique({ where: { id: v as string } }))?.name ?? String(v) : '空'),
    craftIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : (typeof v === 'string' ? (v as string).split(',').filter(Boolean) : []);
      if (!ids.length) return '空';
      const names = await prisma.productCraft.findMany({ where: { id: { in: ids } }, select: { name: true } });
      return names.map((n) => n.name).join('、') || '空';
    },
    certificationIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : (typeof v === 'string' ? (v as string).split(',').filter(Boolean) : []);
      if (!ids.length) return '空';
      const certs = await prisma.certificate.findMany({ where: { id: { in: ids } }, select: { name: true } });
      return certs.map((c) => c.name).join('、') || '空';
    },
    visibleUserIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : [];
      if (!ids.length) return '空';
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { realName: true, username: true } });
      return users.map((u) => u.realName || u.username).join('、') || '空';
    },
    supplyModes: (v) => {
      const map: Record<string, string> = { TRADE: '贸易', CUSTOM: '定制', STOCK: '现货' };
      const arr: string[] = typeof v === 'string' ? v.split(',').filter(Boolean) : [];
      return arr.map((m) => map[m] ?? m).join('、') || '空';
    },
    images: (v) => {
      const arr: { url: string; name?: string }[] = Array.isArray(v) ? v : [];
      return arr.length ? arr.map((i) => i.url).join('、') : '空';
    },
    visibility: (v) => (v === 'PUBLIC' ? '公开' : v === 'PRIVATE' ? '私密' : String(v ?? '空')),
    currency: (v) => String(v ?? '空'),
  };

  // 构造 before / after 扁平对象（仅比对可编辑字段）
  const fields = Object.keys(labels);
  const before: Record<string, any> = {};
  const after: Record<string, any> = {};
  for (const f of fields) {
    if (f === 'craftIds') {
      before[f] = existing?.crafts?.map((c: any) => c.id) ?? [];
    } else if (f === 'visibleUserIds') {
      // 可见成员存于关联表 visibleUsers，需从关联取 userId 数组，避免 undefined 与空数组误判为变更
      before[f] = existing?.visibleUsers?.map((v: any) => v.userId) ?? [];
    } else if (f === 'images') {
      // 图片存为 JSON 数组 [{url,name}]，解析为结构化数组以便前端以缩略图对比，并正确识别真正变化
      const parseImg = (raw: any): { url: string; name: string }[] | null => {
        if (!raw) return null;
        let arr: any = raw;
        if (typeof raw === 'string') {
          try {
            arr = JSON.parse(raw);
          } catch {
            arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
        if (Array.isArray(arr)) {
          const list = arr.filter((i: any) => i && i.url).map((i: any) => ({ url: i.url, name: i.name ?? '' }));
          return list.length ? list : null; // 空数组规范为 null，避免「空 → 空」误记变更
        }
        return null;
      };
      before[f] = parseImg(existing?.images);
      after[f] = parsed?.[f] === undefined ? before[f] : parseImg(parsed?.[f]);
      // 已在分支内设置 after，跳过末尾统一赋值
      continue;
    } else {
      before[f] = existing?.[f];
    }
    after[f] = parsed?.[f] === undefined ? before[f] : parsed[f];
  }

  return computeDiff(before, after, { labels, formatters, fields, ignore: ['sku'] });
}

// 预览接口：按当前工艺/受众返回下一个 SKU（不落库），供表单实时展示
export const previewProductSku = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const craftIds = (req.query.craftIds as string | undefined)?.split(',').filter(Boolean) ?? [];
    const audienceId = (req.query.audienceId as string | undefined) ?? null;
    const excludeId = (req.query.excludeId as string | undefined) ?? undefined;
    const sku = await buildSkuCode(craftIds, audienceId, excludeId);
    success(res, { sku });
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProductOptions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 可见性过滤：管理员可选全部；其余用户仅可选公开产品 + 私密下创建人或被指定的产品
    const uid = req.userId;
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    const where: Record<string, unknown> = {};
    if (uid && !isAdmin) {
      where.OR = [
        { visibility: 'PUBLIC' },
        { AND: [{ visibility: 'PRIVATE' }, { createdBy: uid }] },
        { AND: [{ visibility: 'PRIVATE' }, { visibleUsers: { some: { userId: uid } } }] },
      ];
    }
    const list = await prisma.singleProduct.findMany({
      where,
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    });
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
    const keyword = (req.query.keyword as string)?.trim() || '';
    const craftIds = (req.query.craftIds as string | undefined)?.split(',').filter(Boolean);
    const audienceId = req.query.audienceId as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;
    const visibility = req.query.visibility as string | undefined;

    const where: Record<string, unknown> = {};
    if (keyword) where.OR = [
      { name: { contains: keyword } },
      { sku: { contains: keyword } },
    ];
    if (craftIds?.length) where.crafts = { some: { id: { in: craftIds } } };
    if (audienceId) where.audienceId = audienceId;
    if (categoryId) where.categoryId = categoryId;
    if (visibility) where.visibility = visibility;

    // 可见性过滤：管理员可查看全部产品；其余用户仅见公开产品或自己可见的私密产品
    const uid = req.userId;
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (uid && !isAdmin) {
      where.OR = [
        { visibility: 'PUBLIC' },
        { AND: [{ visibility: 'PRIVATE' }, { createdBy: uid }] },
        { AND: [{ visibility: 'PRIVATE' }, { visibleUsers: { some: { userId: uid } } }] },
      ];
    }

    const [list, total] = await Promise.all([
      prisma.singleProduct.findMany({
        where,
        include: {
          crafts: { select: { id: true, name: true } },
          audience: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          visibleUsers: { select: { userId: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.singleProduct.count({ where }),
    ]);

    success(res, { list, total, page, pageSize });
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProductById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.singleProduct.findUnique({
      where: { id: req.params.id },
      include: {
        crafts: true,
        audience: { include: { categories: true } },
        category: true,
        visibleUsers: { select: { userId: true } },
        activities: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    // 管理员可查看任意产品；其余用户仅创建人 + 指定可见人可查看私密产品
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (product.visibility === 'PRIVATE' && !isAdmin) {
      const uid = req.userId;
      const isCreator = product.createdBy === uid;
      const isVisibleUser = product.visibleUsers.some((v) => v.userId === uid);
      if (!isCreator && !isVisibleUser) {
        fail(res, 403, '无权查看该不公开产品');
        return;
      }
    }
    success(res, product);
  } catch { fail(res, 500, '服务器错误'); }
};

// 供货方式由角色决定（前端不手动选择）：admin/purchaser 默认可多选，单品创建取默认首项；其他角色默认深度定制
const defaultSupplyModeByRole = (roleCode?: string): string => {
  if (roleCode === 'admin' || roleCode === 'purchaser') return 'DEEP_CUSTOM';
  return 'DEEP_CUSTOM';
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productSchema.parse(req.body);
    const { craftIds, sku: _ignored, visibleUserIds, ...rest } = parsed;

    // 使用 SingleProductCreateInput 支持多对多/一对多关联的嵌套写入
    const data: Prisma.SingleProductCreateInput = {
      ...rest,
      source: rest.source ?? 'MANUAL',
      supplyModes: rest.supplyModes || defaultSupplyModeByRole(req.roleCode),
      ...(craftIds?.length ? { crafts: { connect: craftIds.map((id) => ({ id })) } } : {}),
      ...(visibleUserIds?.length ? { visibleUsers: { create: visibleUserIds.map((userId) => ({ userId })) } } : {}),
    };

    // SKU 无需人工录入：按「工艺-受众-序号」自动生成
    const hasFullContext = Boolean(craftIds?.length && parsed.audienceId);
    const sku = await buildSkuCode(craftIds ?? [], parsed.audienceId ?? null);
    if (hasFullContext && sku === null) {
      fail(res, 400, '工艺或受众缺少编码，请先在分类管理中补充代码');
      return;
    }
    data.sku = sku;

    const product = await prisma.singleProduct.create({ data });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: `创建了产品「${product.name}」`,
      productId: product.id,
    });
    created(res, product);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    console.error('[createProduct]', err);
    fail(res, 500, err instanceof Error ? err.message : '服务器错误');
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productSchema.partial().parse(req.body);
    const { craftIds, sku: _ignored, visibleUserIds, ...rest } = parsed;
    const data = { ...rest } as Prisma.SingleProductUpdateInput;
    if (Array.isArray(craftIds)) {
      data.crafts = craftIds.length ? { set: craftIds.map((id) => ({ id })) } : { set: [] };
    }
    if (Array.isArray(visibleUserIds)) {
      data.visibleUsers = {
        deleteMany: {},
        create: visibleUserIds.map((userId) => ({ userId })),
      };
    }
    // 工艺或受众变化时，SKU 按新组合自动重新生成；未变化则保留原 SKU
    const existing = await prisma.singleProduct.findUnique({
      where: { id: req.params.id },
      include: { crafts: { select: { id: true, name: true } }, visibleUsers: { select: { userId: true } } },
    });
    if (!existing) { fail(res, 404, '产品不存在'); return; }
    // 可见即可编辑：能查看到该产品即允许修改（列表/详情已按可见性过滤），不再单独校验修改权限
    {
      const oldCraftIds = existing.crafts.map((c) => c.id).sort().join(',');
      const newCraftIds = !Array.isArray(craftIds) ? null : [...craftIds].sort().join(',');
      const oldAudienceId = existing.audienceId ?? '';
      const newAudienceId = parsed.audienceId === undefined ? oldAudienceId : (parsed.audienceId ?? '');
      const craftsChanged = newCraftIds !== null && newCraftIds !== oldCraftIds;
      const audienceChanged = newAudienceId !== oldAudienceId;
      if (craftsChanged || audienceChanged) {
        const finalCraftIds = Array.isArray(craftIds) ? craftIds : existing.crafts.map((c) => c.id);
        const finalAudienceId = parsed.audienceId === undefined ? existing.audienceId : parsed.audienceId;
        const sku = await buildSkuCode(finalCraftIds, finalAudienceId, existing.id);
        if (sku === null && (finalCraftIds.length && finalAudienceId)) {
          fail(res, 400, '工艺或受众缺少编码，请先在分类管理中补充代码');
          return;
        }
        data.sku = sku;
      }
    }
    const product = await prisma.singleProduct.update({
      where: { id: req.params.id },
      data,
    });

    // ---- 自动计算前后差异 ----
    const diff = await buildProductDiff(existing, parsed);
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: `修改了产品「${product.name}」${diff.length ? `（${diff.length} 处变更）` : ''}`,
      diff,
      productId: product.id,
    });
    success(res, product, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    console.error('[updateProduct] error:', err);
    fail(res, 500, err instanceof Error ? err.message : '服务器错误');
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (!isAdmin) {
      fail(res, 403, '仅管理员可删除产品');
      return;
    }
    const product = await prisma.singleProduct.findUnique({ where: { id: req.params.id } });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    await prisma.singleProduct.delete({ where: { id: req.params.id } });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      action: 'DELETE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: JSON.stringify({ name: product.name, sku: product.sku }),
      productId: product.id,
    });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};

/**
 * 产品 / 组合 混合列表：同一列表内按类型（ALL/PRODUCT/GROUP）混排。
 * 产品筛选项（工艺/受众/可见性/单位）仅作用于产品；组合仅受关键词 + 类型影响。
 * 返回条目形如 { type: 'PRODUCT'|'GROUP', data: <原始记录> }，前端据此分派卡片。
 */
export const getMixedProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 8));
    const keyword = ((req.query.keyword as string) || '').trim();
    const type = ((req.query.type as string) || 'ALL').toUpperCase();
    const craftIds = ((req.query.craftIds as string) || '').split(',').map((s) => s.trim()).filter(Boolean);
    const audienceId = req.query.audienceId as string | undefined;
    const visibility = req.query.visibility as string | undefined;

    const entries: Array<{ type: 'PRODUCT' | 'GROUP'; data: Record<string, unknown> }> = [];

    // 产品部分
    if (type !== 'GROUP') {
      const and: Record<string, unknown>[] = [];
      if (keyword) {
        and.push({
          OR: [
            { name: { contains: keyword } },
            { sku: { contains: keyword } },
          ],
        });
      }
      if (craftIds.length) and.push({ crafts: { some: { id: { in: craftIds } } } });
      if (audienceId) and.push({ audienceId });
      if (visibility) and.push({ visibility });

      const uid = req.userId;
      const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
      if (uid && !isAdmin) {
        and.push({
          OR: [
            { visibility: 'PUBLIC' },
            { AND: [{ visibility: 'PRIVATE' }, { createdBy: uid }] },
            { AND: [{ visibility: 'PRIVATE' }, { visibleUsers: { some: { userId: uid } } }] },
          ],
        });
      }

      const where: Record<string, unknown> = and.length ? { AND: and } : {};
      const products = await prisma.singleProduct.findMany({
        where,
        include: {
          crafts: { select: { id: true, name: true } },
          audience: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          visibleUsers: { select: { userId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      products.forEach((p) => entries.push({ type: 'PRODUCT', data: p as unknown as Record<string, unknown> }));
    }

    // 组合部分
    if (type !== 'PRODUCT') {
      const where: Record<string, unknown> = {};
      if (keyword) where.name = { contains: keyword };

      const groupsRaw = await prisma.comboProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
      });
      const groups = groupsRaw.map((g) => ({
        ...g,
        productCount: g.items.length,
        products: g.items.map((it) => it.product).filter(Boolean),
      }));
      groups.forEach((g) => entries.push({ type: 'GROUP', data: g as unknown as Record<string, unknown> }));
    }

    // 合并排序 + 分页（按创建时间倒序混合）
    entries.sort((a, b) => new Date(b.data.createdAt as string).getTime() - new Date(a.data.createdAt as string).getTime());
    const total = entries.length;
    const list = entries.slice((page - 1) * pageSize, page * pageSize);
    success(res, { list, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ========== Excel 导入产品 ==========
const PRODUCT_FIELD_MAP: Record<string, string> = {
  产品名称: 'name',
  name: 'name',
  产品简称: 'shortName',
  工艺: 'craftNames',
  受众: 'audienceName',
  品类: 'categoryName',
  尺寸长: 'sizeL',
  尺寸宽: 'sizeW',
  尺寸高: 'sizeH',
  克重: 'weight',
  供货模式: 'supplyModes',
  认证资质: 'certificationNames',
  描述: 'description',
  价格: 'price',
  币种: 'currency',
  税率: 'taxRate',
  库存: 'stock',
  低库存预警: 'lowStockAlert',
  来源: 'source',
  可见性: 'visibility',
  可见人员: 'visibleUsernames',
};

export const importExcel = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) return fail(res, 400, '请上传文件');

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    // 预加载名称→ID 映射
    const [crafts, audiences, categories, certs, users] = await Promise.all([
      prisma.productCraft.findMany({ select: { id: true, name: true } }),
      prisma.productAudience.findMany({ select: { id: true, name: true } }),
      prisma.productCategory.findMany({ select: { id: true, name: true } }),
      prisma.certificate.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ select: { id: true, realName: true, username: true } }),
    ]);
    const craftMap = new Map(crafts.map((c) => [c.name, c.id]));
    const audienceMap = new Map(audiences.map((a) => [a.name, a.id]));
    const categoryMap = new Map(categories.map((c) => [c.name, c.id]));
    const certMap = new Map(certs.map((c) => [c.name, c.id]));
    const userMap = new Map<string, string>();
    users.forEach((u) => { if (u.realName) userMap.set(u.realName, u.id); if (u.username) userMap.set(u.username, u.id); });

    const created: any[] = [];
    const failed: { index: number; name?: string; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const data: Record<string, any> = {};
      for (const [key, value] of Object.entries(raw)) {
        const mapped = PRODUCT_FIELD_MAP[key] || PRODUCT_FIELD_MAP[key.toLowerCase()] || null;
        if (mapped && value !== undefined && value !== null && value !== '') data[mapped] = value;
      }
      if (!data.name) {
        failed.push({ index: i, reason: '缺少产品名称' });
        continue;
      }
      try {
        // 名称 → ID 解析
        const craftIds: string[] = [];
        if (data.craftNames) {
          String(data.craftNames).split(/[、,，]/).forEach((n) => {
            const id = craftMap.get(n.trim());
            if (id) craftIds.push(id);
          });
        }
        const audienceId = data.audienceName ? audienceMap.get(String(data.audienceName).trim()) : undefined;
        const categoryId = data.categoryName ? categoryMap.get(String(data.categoryName).trim()) : undefined;
        const certificationIds: string[] = [];
        if (data.certificationNames) {
          String(data.certificationNames).split(/[、,，]/).forEach((n) => {
            const id = certMap.get(n.trim());
            if (id) certificationIds.push(id);
          });
        }
        const visibleUserIds: string[] = [];
        if (data.visibleUsernames) {
          String(data.visibleUsernames).split(/[、,，]/).forEach((n) => {
            const id = userMap.get(n.trim());
            if (id) visibleUserIds.push(id);
          });
        }

        const payload: Record<string, any> = {
          name: data.name,
          sku: undefined,
          craftIds,
          audienceId,
          categoryId,
          sizeL: data.sizeL,
          sizeW: data.sizeW,
          sizeH: data.sizeH,
          weight: data.weight,
          supplyModes: data.supplyModes ? String(data.supplyModes).split(/[、,，]/)[0] : undefined,
          certificationIds: certificationIds.join(','),
          description: data.description,
          price: data.price === undefined ? undefined : Number(data.price),
          currency: data.currency,
          taxRate: data.taxRate === undefined ? undefined : Number(data.taxRate),
          stock: data.stock === undefined ? undefined : Number(data.stock),
          lowStockAlert: data.lowStockAlert === undefined ? undefined : Number(data.lowStockAlert),
          source: data.source,
          visibility: data.visibility === '私有' || data.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
          visibleUserIds,
        };

        const parsed = productSchema.parse(payload);
        const { craftIds: cIds, sku: _ig, visibleUserIds: vIds, ...rest } = parsed;
        const pdata: Prisma.SingleProductCreateInput = {
          ...rest,
          source: rest.source ?? 'MANUAL',
          supplyModes: rest.supplyModes || defaultSupplyModeByRole(req.roleCode),
          ...(cIds?.length ? { crafts: { connect: cIds.map((id) => ({ id })) } } : {}),
          ...(vIds?.length ? { visibleUsers: { create: vIds.map((userId) => ({ userId })) } } : {}),
        };
        const hasFullContext = Boolean(cIds?.length && parsed.audienceId);
        const sku = await buildSkuCode(cIds ?? [], parsed.audienceId ?? null);
        if (hasFullContext && sku === null) {
          failed.push({ index: i, name: parsed.name, reason: '工艺或受众缺少编码，请先在分类管理中补充代码' });
          continue;
        }
        pdata.sku = sku;
        const product = await prisma.singleProduct.create({ data: pdata });
        void activityLogger.log({
          userId: req.userId || '',
          username: req.username || '',
          realName: req.realName,
          action: 'CREATE',
          module: 'product',
          targetId: product.id,
          target: product.name,
          detail: `通过 Excel 导入创建了产品「${product.name}」`,
          productId: product.id,
        });
        created.push(product);
      } catch (err) {
        const reason = err instanceof z.ZodError ? err.errors.map((e) => e.message).join(', ') : '服务器错误';
        failed.push({ index: i, name: data.name, reason });
      }
    }

    success(res, {
      total: rows.length,
      successCount: created.length,
      failCount: failed.length,
      created,
      failed,
    });
  } catch (err) {
    next(err);
  }
};

// ========== 下载导入模板 ==========
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
