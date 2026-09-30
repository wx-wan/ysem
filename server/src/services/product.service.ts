import { z } from 'zod';
import type { $Enums, Prisma } from '@prisma/client';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainForbiddenError, DomainNotFoundError } from '../lib/errors';
import { computeDiff, type DiffItem, type FieldFormatter } from '../lib/operation-diff';
import { SkuConcurrencyError, SkuContextError } from '../lib/skuCode';
import { createProductOperation, updateProductOperation } from '../operations/product.operations';
import { certificateRepository } from '../repositories/certificate.repository';
import { operationLogRepository } from '../repositories/operationLog.repository';
import { productGroupRepository } from '../repositories/productGroup.repository';
import { productRepository } from '../repositories/product.repository';
import { productTaxonomyRepository } from '../repositories/productTaxonomy.repository';
import { userRepository } from '../repositories/user.repository';

/**
 * Product Business Layer（Round R-4 · Product Layering）
 *
 * 职责：Product 的业务规则、业务不变量、跨实体读取组合、事务编排入口、审计留痕。
 * 约束：不读 req / res，不返回 HTTP Response，不处理状态码，不出现 `$transaction`，不直接 import Prisma 单例。
 *
 * 【与既有 API 的关系】
 *   本文件是对 `controllers/product.controller.ts` 的**逐条行为搬迁**：
 *   请求字段、响应结构、错误码、错误文案、筛选/排序/分页/可见性口径全部未改。
 *   旧字段 → V1.0 列的映射（images→coverImage / price→defaultPrice / …）原样保留，
 *   仅迁出 Controller（属业务映射，不属 HTTP 职责）。
 *
 * 【可见性投影为何由 Controller 注入】
 *   `scope.projectProductRows` 需要 `AuthRequest`。为使 Business 层不接触 HTTP 对象，
 *   沿用 R-2 Lead 的 `LeadScopeProvider` 先例：由 HTTP 边界把「可见性条件」与「读取侧投影」
 *   两个函数注入 `ProductActorContext`，Business 只调用、不实现权限政策。
 */

// ============================================================
// 调用者上下文（由 Controller 在 HTTP 边界组装）
// ============================================================

export interface ProductActorContext {
  userId?: string;
  username?: string;
  realName?: string;
  roleCode?: string;
  /** 管理员判据：`roleCode === 'admin' || 'ADMIN'`（沿用既有各处判据） */
  isAdmin: boolean;
  /** `productVisibilityWhere(req)` 的结果；Business 不自行构造权限条件 */
  visibilityWhere: Record<string, unknown>;
  /** `projectProductRows(req, ...)` 的绑定版本；Business 不接触 req */
  projectRows: <T>(
    rows: readonly T[],
    fields: readonly string[],
    options?: { nameField?: string },
  ) => T[];
}

// ============================================================
// 读取侧投影白名单
// ============================================================

/**
 * 组合成员产品的公开字段（DQ-3=C 投影白名单）。
 * `visibility` / `createdBy` / `visibleUsers` 为**内部授权字段**，仅用于可见性判定，不得进入响应。
 *
 * 原本 `product.controller`（MIXED_GROUP_PRODUCT_FIELDS）与 `productGroup.controller`
 * （GROUP_ITEM_PRODUCT_FIELDS）各有一份内容完全相同的副本，今收敛为单一事实来源。
 */
export const COMBO_ITEM_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

// ============================================================
// DTO（schema 契约住在 Business 层，Controller 复用；沿用 R-3 Customer 先例）
// ============================================================

// 尺寸 / 克重：V1.0 Product 为 Float?，旧版以 String 存储，统一归一为 number | null
const toFloat = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const productSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().nullish(),
  // 分类 id 为 cuid（ProductCraft/ProductAudience/ProductCategory @default(cuid())），历史数据可能为 uuid，
  // 仅校验非空字符串，避免误杀合法 id（z.string().uuid() 会把 cuid 报成 Invalid uuid → 400）
  craftIds: z.array(z.string().min(1)).nullish(),
  audienceId: z.string().min(1).nullish(),
  categoryId: z.string().min(1).nullish(),
  // 产品属性（V1.0 Product 尺寸/克重为 Float，兼容前端传字符串或数字）
  images: z.string().nullish(),
  sizeL: z.preprocess(toFloat, z.number().nullable().optional()),
  sizeW: z.preprocess(toFloat, z.number().nullable().optional()),
  sizeH: z.preprocess(toFloat, z.number().nullable().optional()),
  weight: z.preprocess(toFloat, z.number().nullable().optional()),
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

export type ProductWriteInput = z.infer<typeof productSchema>;

/** 列表筛选（与既有 query 参数一一对应，未新增字段） */
export interface ProductListFilters {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
  craftIds?: string;
  audienceId?: string;
  categoryId?: string;
  visibility?: string;
}

/** 产品 / 组合混排筛选 */
export interface ProductMixedFilters {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
  type?: string;
  craftIds?: string;
  audienceId?: string;
  visibility?: string;
}

// ============================================================
// 内部工具（旧字段 → V1.0 列）
// ============================================================

// 逗号分隔 id 串 → id 数组（旧 certificationIds / craftIds 兼容）
const parseIdList = (v?: string | null): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const SUPPLY_MODES = ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'] as const;
const CURRENCIES = [
  'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD',
  'AUD', 'CAD', 'KRW', 'RUB', 'SEK', 'NOK', 'DKK',
] as const;

/** 旧 supplyModes 逗号串 → V1.0 SupplyMode[]；非法值一律忽略（回落默认模式） */
const toSupplyModes = (v?: string | null): $Enums.SupplyMode[] | undefined => {
  const modes = parseIdList(v).filter((m): m is $Enums.SupplyMode =>
    (SUPPLY_MODES as readonly string[]).includes(m),
  );
  return modes.length ? modes : undefined;
};

/** 旧 currency 字符串 → V1.0 Currency 枚举；非法值回落 Prisma 默认（USD） */
const toCurrency = (v?: string | null): $Enums.Currency | undefined =>
  v && (CURRENCIES as readonly string[]).includes(v) ? (v as $Enums.Currency) : undefined;

// 供货方式由角色决定（前端不手动选择）：admin/purchaser 默认可多选，单品创建取默认首项；其他角色默认深度定制
const defaultSupplyModeByRole = (roleCode?: string): $Enums.SupplyMode => {
  if (roleCode === 'admin' || roleCode === 'purchaser') return 'DEEP_CUSTOM';
  return 'DEEP_CUSTOM';
};

/**
 * 读取侧：把 coverImage 冗余列透出为前端约定的 `images`（JSON 数组字符串）。
 * 产品图片范式是 coverImage + Attachment(ownerType=PRODUCT)，建档仅在 coverImage 落库图片（不生成 Attachment 记录），
 * 因此响应统一以 coverImage 回填 images，使前端 ProductDetailModal / ProductEditModal / ProductCard 能正确渲染。
 */
function withImages<T extends Record<string, any>>(p: T): T & { images: string | null } {
  return { ...p, images: (p.coverImage as string | null) ?? null };
}

/**
 * 旧 SingleProduct 写入体 → V1.0 Product 写入体。
 * 客户专属价格/定制不在此承载（见 CustomerProduct / ProductPrice —— 二者当前无写入口，如实保留现状）。
 * productNo 不在此生成：由 Operation 层在事务内通过 getNextNumber(tx, 'PRD') 分配后合并。
 * sku 亦不在此生成：必须由 Operation 层在**同一事务内**通过 buildSkuCode(tx, ...) 生成
 *（详见 lib/skuCode.ts 的并发说明）。
 */
export async function buildProductCreateData(
  input: ProductWriteInput,
  actor: { userId?: string; roleCode?: string },
): Promise<Omit<Prisma.ProductUncheckedCreateInput, 'productNo' | 'sku'>> {
  const {
    craftIds,
    sku: _ignored,
    visibleUserIds,
    images,
    price,
    currency,
    taxRate,
    certificationIds,
    supplyModes,
    progress: _progress,
    ...rest
  } = input;
  const certIds = parseIdList(certificationIds);

  const data: Omit<Prisma.ProductUncheckedCreateInput, 'productNo' | 'sku'> = {
    ...rest,
    coverImage: images ?? null,
    defaultPrice: price ?? null,
    defaultCurrency: toCurrency(currency),
    defaultTaxRate: taxRate ?? null,
    supplyModes: toSupplyModes(supplyModes) ?? [defaultSupplyModeByRole(actor.roleCode)],
    createdBy: actor.userId || null,
    source: rest.source ?? 'MANUAL',
    ...(craftIds?.length
      ? { crafts: { create: craftIds.map((id) => ({ productCraft: { connect: { id } } })) } }
      : {}),
    ...(certIds.length
      ? { certifications: { create: certIds.map((id) => ({ certificate: { connect: { id } } })) } }
      : {}),
    ...(visibleUserIds?.length
      ? { visibleUsers: { create: visibleUserIds.map((userId) => ({ userId })) } }
      : {}),
  };
  return data;
}

/** 更新体映射（旧字段按 V1.0 Product 重新映射；`progress` 无对应列，忽略） */
function buildProductUpdateData(input: Partial<ProductWriteInput>): Record<string, unknown> {
  const {
    craftIds,
    sku: _ignored,
    visibleUserIds,
    images,
    price,
    currency,
    taxRate,
    certificationIds,
    supplyModes,
    progress: _progress,
    ...rest
  } = input;
  const data: Record<string, unknown> = { ...rest };
  if (images !== undefined) data.coverImage = images;
  if (price !== undefined) data.defaultPrice = price;
  if (currency !== undefined) data.defaultCurrency = toCurrency(currency);
  if (taxRate !== undefined) data.defaultTaxRate = taxRate;
  if (supplyModes !== undefined) data.supplyModes = toSupplyModes(supplyModes);
  if (Array.isArray(craftIds)) {
    data.crafts = {
      deleteMany: {},
      create: craftIds.map((id) => ({ productCraft: { connect: { id } } })),
    };
  }
  if (certificationIds !== undefined) {
    data.certifications = {
      deleteMany: {},
      create: parseIdList(certificationIds).map((id) => ({ certificate: { connect: { id } } })),
    };
  }
  if (Array.isArray(visibleUserIds)) {
    data.visibleUsers = {
      deleteMany: {},
      create: visibleUserIds.map((userId) => ({ userId })),
    };
  }
  return data;
}

// ============================================================
// 产品操作差异计算
// ============================================================

/** 比对「数据库原记录」与「提交体」，输出结构化变更列表（供前端以 Tag 展示）。 */
async function buildProductDiff(existing: any, parsed: Record<string, any>): Promise<DiffItem[]> {
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

  // 差异比对仍沿用旧入参名，读取原记录时需映射到 V1.0 列名
  const SOURCE_FIELD: Record<string, string> = {
    images: 'coverImage',
    price: 'defaultPrice',
    currency: 'defaultCurrency',
    taxRate: 'defaultTaxRate',
  };

  // id → 名称 解析（关联字段）
  const formatters: Record<string, FieldFormatter> = {
    // 字符串数组 id（逗号分隔）转名称
    categoryId: async (v) =>
      v
        ? (await productTaxonomyRepository.findCategoryNameById(v as string))?.name ?? String(v)
        : '空',
    audienceId: async (v) =>
      v
        ? (await productTaxonomyRepository.findAudienceNameById(v as string))?.name ?? String(v)
        : '空',
    craftIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : (typeof v === 'string' ? (v as string).split(',').filter(Boolean) : []);
      if (!ids.length) return '空';
      const names = await productTaxonomyRepository.findCraftNamesByIds(ids);
      return names.map((n) => n.name).join('、') || '空';
    },
    certificationIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : (typeof v === 'string' ? (v as string).split(',').filter(Boolean) : []);
      if (!ids.length) return '空';
      const certs = await certificateRepository.findNamesByIds(ids);
      return certs.map((c) => c.name).join('、') || '空';
    },
    visibleUserIds: async (v) => {
      const ids: string[] = Array.isArray(v) ? v : [];
      if (!ids.length) return '空';
      const users = await userRepository.findNamesByIds(ids);
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
      // V1.0 crafts 为 ProductCraftLink 中间表，工艺实体在 productCraft 上
      before[f] = existing?.crafts?.map((c: any) => c.productCraft?.id) ?? [];
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
            arr = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }
        if (Array.isArray(arr)) {
          const list = arr.filter((i: any) => i && i.url).map((i: any) => ({ url: i.url, name: i.name ?? '' }));
          return list.length ? list : null; // 空数组规范为 null，避免「空 → 空」误记变更
        }
        return null;
      };
      before[f] = parseImg(existing?.[SOURCE_FIELD[f]]);
      after[f] = parsed?.[f] === undefined ? before[f] : parseImg(parsed?.[f]);
      // 已在分支内设置 after，跳过末尾统一赋值
      continue;
    } else {
      before[f] = existing?.[SOURCE_FIELD[f] ?? f];
    }
    after[f] = parsed?.[f] === undefined ? before[f] : parsed[f];
  }

  return computeDiff(before, after, { labels, formatters, fields, ignore: ['sku'] });
}

// ============================================================
// 1. 下拉 / 列表 / 详情 / 操作记录
// ============================================================

/**
 * 可选产品下拉。
 * 可见性过滤：管理员可选全部；其余用户仅可选公开产品 + 私密下创建人或被指定的产品。
 */
export function listProductOptions(actor: ProductActorContext) {
  return productRepository.findOptions(actor.visibilityWhere);
}

/** 产品分页列表（关键词 / 工艺 / 受众 / 品类 / 可见性 + 统一可见性过滤） */
export async function listProducts(filters: ProductListFilters, actor: ProductActorContext) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 10));
  const keyword = (filters.keyword ?? '').trim() || '';
  const craftIds = filters.craftIds?.split(',').filter(Boolean);
  const audienceId = filters.audienceId;
  const categoryId = filters.categoryId;
  const visibility = filters.visibility;

  const where: Record<string, unknown> = {};
  if (keyword) where.OR = [
    { name: { contains: keyword } },
    { sku: { contains: keyword } },
  ];
  // V1.0 crafts 为 ProductCraftLink 中间表，工艺筛选走 productCraftId
  if (craftIds?.length) where.crafts = { some: { productCraftId: { in: craftIds } } };
  if (audienceId) where.audienceId = audienceId;
  if (categoryId) where.categoryId = categoryId;
  if (visibility) where.visibility = visibility;

  // 可见性过滤：管理员可查看全部产品；其余用户仅见公开产品或自己可见的私密产品（复用统一 helper）
  Object.assign(where, actor.visibilityWhere);

  const scoped = where as Prisma.ProductWhereInput;
  const [list, total] = await Promise.all([
    productRepository.findPage(scoped, (page - 1) * pageSize, pageSize),
    productRepository.countByWhere(scoped),
  ]);

  // crafts 摊平为工艺实体数组，保持旧响应形状
  const rows = list.map(({ crafts, ...rest }) => withImages({ ...rest, crafts: crafts.map((l) => l.productCraft) }));
  return { list: rows, total, page, pageSize };
}

/**
 * 产品详情。
 * 可见性：管理员可查看任意产品；其余用户仅创建人 + 指定可见人可查看私密产品（**403**，不泄露为 404 —— 沿用既有口径）。
 */
export async function getProductDetail(id: string, actor: ProductActorContext) {
  const product = await productRepository.findDetail(id);
  if (!product) throw new DomainNotFoundError('产品不存在');

  if (product.visibility === 'PRIVATE' && !actor.isAdmin) {
    const uid = actor.userId;
    const isCreator = product.createdBy === uid;
    const isVisibleUser = product.visibleUsers.some((v) => v.userId === uid);
    if (!isCreator && !isVisibleUser) {
      throw new DomainForbiddenError('无权查看该不公开产品');
    }
  }

  // crafts 摊平为工艺实体数组，保持旧响应形状
  const { crafts, ...rest } = product;
  return withImages({ ...rest, crafts: crafts.map((l) => l.productCraft) });
}

/**
 * 产品操作记录（详情「操作记录」Tab 数据源）。
 *
 * 只读 OperationLog 中 `businessType = PRODUCT` 且 `businessId = 产品 id` 的记录，按时间倒序返回。
 * 产品/组合操作只落 OperationLog（ProductActivity 副表已在 V1.0 删除），故此端点补齐产品时间线。
 * 数据范围：沿用既有语义 —— 仅要求登录，不做产品可见性过滤。
 */
export async function getProductLogs(id: string) {
  const product = await productRepository.findIdById(id);
  if (!product) throw new DomainNotFoundError('产品不存在');
  return operationLogRepository.findByBusiness(
    { businessType: BUSINESS_TYPE.PRODUCT, businessId: product.id },
    100,
  );
}

/** SKU 预览：按当前工艺/受众返回下一个 SKU（不落库），供表单实时展示 */
export async function previewProductSku(input: {
  craftIds?: string;
  audienceId?: string;
  excludeId?: string;
}) {
  const craftIds = input.craftIds?.split(',').filter(Boolean) ?? [];
  const audienceId = input.audienceId ?? null;
  const excludeId = input.excludeId ?? undefined;
  return productRepository.nextSku(craftIds, audienceId, excludeId);
}

// ============================================================
// 2. 创建 / 更新 / 删除
// ============================================================

export async function createProduct(input: ProductWriteInput, actor: ProductActorContext) {
  // 旧 SingleProduct 写入体 → V1.0 Product 写入体（productNo 在事务内分配）
  const data = await buildProductCreateData(input, { userId: actor.userId, roleCode: actor.roleCode });

  // SKU 无需人工录入：按「工艺-受众-序号」自动生成（必须在事务内生成）
  const hasFullContext = Boolean(input.craftIds?.length && input.audienceId);

  const product = await createProductOperation({
    data,
    craftIds: input.craftIds ?? [],
    audienceId: input.audienceId ?? null,
    hasFullContext,
  });

  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'CREATE',
    module: 'product',
    businessType: BUSINESS_TYPE.PRODUCT,
    businessId: product.id,
    businessNo: product.productNo,
    summary: `创建了产品「${product.name}」`,
  });
  return product;
}

export async function updateProduct(
  id: string,
  input: Partial<ProductWriteInput>,
  actor: ProductActorContext,
) {
  const data = buildProductUpdateData(input);

  // DQ-3=C：保留 PUBLIC / PRIVATE visibility 模型，授权门与列表 / 详情及 delete 的可见性谓词
  // 均经 productVisibilityWhere 保持逐字一致。
  // DQ-6=404：scope 外与不存在统一 404，不泄露 PRIVATE 产品存在性。
  const existing = await productRepository.findScopedForWrite(id, actor.visibilityWhere);
  if (!existing) throw new DomainNotFoundError('产品不存在');

  // 可见即可编辑：授权门已上移至上方 scoped 读取，与列表/详情可见性口径一致。
  // 工艺/受众变化判定为纯计算（事务外）；SKU 生成与 Product update 必须同事务。
  let skuNeedsRegen = false;
  let finalCraftIds: string[] = [];
  let finalAudienceId: string | null = null;
  {
    const oldCraftIds = existing.crafts.map((c) => c.productCraft.id).sort().join(',');
    const newCraftIds = !Array.isArray(input.craftIds) ? null : [...input.craftIds].sort().join(',');
    const oldAudienceId = existing.audienceId ?? '';
    const newAudienceId = input.audienceId === undefined ? oldAudienceId : (input.audienceId ?? '');
    const craftsChanged = newCraftIds !== null && newCraftIds !== oldCraftIds;
    const audienceChanged = newAudienceId !== oldAudienceId;
    if (craftsChanged || audienceChanged) {
      finalCraftIds = Array.isArray(input.craftIds) ? input.craftIds : existing.crafts.map((c) => c.productCraft.id);
      finalAudienceId = input.audienceId === undefined ? existing.audienceId : input.audienceId;
      skuNeedsRegen = true;
    }
  }

  const product = await updateProductOperation({
    id,
    data,
    skuNeedsRegen,
    finalCraftIds,
    finalAudienceId,
  });

  // ---- 自动计算前后差异 ----
  const diff = await buildProductDiff(existing, input as Record<string, any>);
  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'UPDATE',
    module: 'product',
    businessType: BUSINESS_TYPE.PRODUCT,
    businessId: product.id,
    businessNo: product.productNo,
    summary: `修改了产品「${product.name}」${diff.length ? `（${diff.length} 处变更）` : ''}`,
    diff,
  });
  return product;
}

export async function deleteProduct(id: string, actor: ProductActorContext) {
  if (!actor.isAdmin) {
    throw new DomainForbiddenError('仅管理员可删除产品');
  }
  const product = await productRepository.findById(id);
  if (!product) throw new DomainNotFoundError('产品不存在');
  await productRepository.deleteById(id);
  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    action: 'DELETE',
    module: 'product',
    businessType: BUSINESS_TYPE.PRODUCT,
    businessId: product.id,
    businessNo: product.productNo,
    summary: `删除了产品「${product.name}」（编号 ${product.productNo}，SKU ${product.sku || '—'}）`,
  });
}

// ============================================================
// 3. 产品 / 组合 混合列表
// ============================================================

/**
 * 产品 / 组合 混合列表：同一列表内按类型（ALL/PRODUCT/GROUP）混排。
 * 产品筛选项（工艺/受众/可见性）仅作用于产品；组合仅受关键词 + 类型影响。
 * 返回条目形如 `{ type: 'PRODUCT'|'GROUP', data: <原始记录> }`，前端据此分派卡片。
 */
export async function listMixedProducts(filters: ProductMixedFilters, actor: ProductActorContext) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 8));
  const keyword = (filters.keyword ?? '').trim();
  const type = (filters.type ?? 'ALL').toUpperCase();
  const craftIds = (filters.craftIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const audienceId = filters.audienceId;
  const visibility = filters.visibility;

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
    if (craftIds.length) and.push({ crafts: { some: { productCraftId: { in: craftIds } } } });
    if (audienceId) and.push({ audienceId });
    if (visibility) and.push({ visibility });

    // 可见性过滤（复用统一 helper）：非管理员仅见公开产品或自己可见的私密产品，与列表/详情口径一致
    const vis = actor.visibilityWhere;
    if (vis.OR) and.push(vis);

    const where: Record<string, unknown> = and.length ? { AND: and } : {};
    const products = await productRepository.findManyForMixed(where as Prisma.ProductWhereInput);
    products.forEach((p) => {
      const { crafts, ...rest } = p;
      entries.push({
        type: 'PRODUCT',
        data: withImages({ ...rest, crafts: crafts.map((l) => l.productCraft) }) as unknown as Record<string, unknown>,
      });
    });
  }

  // 组合部分
  if (type !== 'PRODUCT') {
    const where: Record<string, unknown> = {};
    if (keyword) where.name = { contains: keyword };

    const groupsRaw = await productGroupRepository.findManyWithItems(where as Prisma.ComboProductWhereInput);
    const groups = groupsRaw.map((g) => {
      // 读取侧（DQ-3=C）：组合成员产品按可见性投影（不可见 ⇒ product=null，不得进入 products）
      const items = actor.projectRows(g.items, COMBO_ITEM_PRODUCT_FIELDS);
      return {
        ...g,
        items,
        productCount: g.items.length,
        products: items.map((it) => it.product).filter(Boolean),
      };
    });
    groups.forEach((g) => entries.push({ type: 'GROUP', data: g as unknown as Record<string, unknown> }));
  }

  // 合并排序 + 分页（按创建时间倒序混合）
  entries.sort((a, b) => new Date(b.data.createdAt as string).getTime() - new Date(a.data.createdAt as string).getTime());
  const total = entries.length;
  const list = entries.slice((page - 1) * pageSize, page * pageSize);
  return { list, total, page, pageSize };
}

// ============================================================
// 4. Excel 导入
// ============================================================

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

/** 单行失败原因（与既有实现逐字一致） */
function importFailureReason(err: unknown): string {
  if (err instanceof z.ZodError) return err.errors.map((e) => e.message).join(', ');
  if (err instanceof SkuContextError) return err.message;
  if (err instanceof SkuConcurrencyError) return err.message;
  return '服务器错误';
}

/**
 * Excel 导入产品（逐行独立事务，保留既有「部分成功」语义）。
 *
 * 入参 `rows` 为 Controller 解析出的原始行对象（表头 → 值），
 * **表头 → 字段名的映射规则属导入契约，留在 Business 层**。
 */
export async function importProducts(
  rows: Record<string, unknown>[],
  actor: ProductActorContext,
) {
  // 预加载名称→ID 映射
  const [crafts, audiences, categories, certs, users] = await Promise.all([
    productTaxonomyRepository.findCraftNameIdPairs(),
    productTaxonomyRepository.findAudienceNameIdPairs(),
    productTaxonomyRepository.findCategoryNameIdPairs(),
    certificateRepository.findNameIdPairs(),
    userRepository.findIdentityPairs(),
  ]);
  const craftMap = new Map(crafts.map((c) => [c.name, c.id]));
  const audienceMap = new Map(audiences.map((a) => [a.name, a.id]));
  const categoryMap = new Map(categories.map((c) => [c.name, c.id]));
  const certMap = new Map(certs.map((c) => [c.name, c.id]));
  const userMap = new Map<string, string>();
  users.forEach((u) => {
    if (u.realName) userMap.set(u.realName, u.id);
    if (u.username) userMap.set(u.username, u.id);
  });

  const created: Record<string, unknown>[] = [];
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
      const pdata = await buildProductCreateData(parsed, {
        userId: actor.userId,
        roleCode: actor.roleCode,
      });
      const hasFullContext = Boolean(parsed.craftIds?.length && parsed.audienceId);
      // 编号分配、SKU 生成与业务写入同事务：逐行独立事务，保留导入的部分成功语义
      const product = await createProductOperation({
        data: pdata,
        craftIds: parsed.craftIds ?? [],
        audienceId: parsed.audienceId ?? null,
        hasFullContext,
      });
      void activityLogger.log({
        userId: actor.userId || '',
        username: actor.username || '',
        realName: actor.realName,
        action: 'CREATE',
        module: 'product',
        businessType: BUSINESS_TYPE.PRODUCT,
        businessId: product.id,
        businessNo: product.productNo,
        summary: `通过 Excel 导入创建了产品「${product.name}」`,
      });
      created.push(product as unknown as Record<string, unknown>);
    } catch (err) {
      failed.push({ index: i, name: data.name, reason: importFailureReason(err) });
    }
  }

  return {
    total: rows.length,
    successCount: created.length,
    failCount: failed.length,
    created,
    failed,
  };
}
