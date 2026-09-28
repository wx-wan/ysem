import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createProductGroupOperation,
  replaceProductGroupItemsOperation,
  type ProductGroupItemPlan,
} from '../operations/productGroup.operations';
import { productGroupRepository } from '../repositories/productGroup.repository';
import { COMBO_ITEM_PRODUCT_FIELDS } from './product.service';

/**
 * ComboProduct（产品组合）Business Layer（Round R-4 · Product Layering）
 *
 * 职责：组合的业务规则（行内快速新建单品的必填校验）、跨实体写入编排、审计留痕。
 * 约束：不读 req / res，不返回 HTTP Response，不处理状态码，不出现 `$transaction`，不直接 import Prisma 单例。
 *
 * 【与既有 API 的关系】
 *   本文件是对 `controllers/productGroup.controller.ts` 的**逐条行为搬迁**：
 *   请求字段、响应结构、错误码、错误文案、可见性投影口径全部未改。
 *
 * 【一处「仅在实现层面等价」的搬迁，必须明示】
 *   原实现把「行内快速新建单品时名称不能为空」放在**事务内**抛出（靠回滚撤销同事务内已创建的 Product）。
 *   本层改为在**开启事务之前**校验：错误码（400）、文案、以及「不残留孤儿 Product / 不消耗 CMB、PRD 编号」
 *   的最终结果完全一致，但不再依赖回滚。对外契约不变。
 */

// ============================================================
// 调用者上下文（由 Controller 在 HTTP 边界组装）
// ============================================================

export interface ProductGroupActorContext {
  userId?: string;
  username?: string;
  realName?: string;
  /** `projectProductRows(req, ...)` 的绑定版本；Business 不接触 req */
  projectRows: <T>(
    rows: readonly T[],
    fields: readonly string[],
    options?: { nameField?: string },
  ) => T[];
}

// ============================================================
// DTO
// ============================================================

export const groupSchema = z.object({
  name: z.string().min(1, '产品组名称不能为空'),
  description: z.string().nullish(),
  // 组合的「分类信息」：工艺/受众/品类/可见性 由组合统一选定，
  // 作为所有组合子单品（行内快速新建）的分类，无需逐行填写
  // 同 product.controller：分类 id 为 cuid，仅校验非空字符串
  craftIds: z.array(z.string().min(1)).nullish(),
  audienceId: z.string().min(1).nullish(),
  categoryId: z.string().min(1).nullish(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  visibleUserIds: z.array(z.string()).nullish(),
  // 组合明细：productId 关联已有单品；无 productId 时行内快速新建单品（name 必填）
  // 行内快速新建的单品仅填写 尺寸/克重/认证/描述，分类沿用组合选定的信息
  items: z
    .array(
      z.object({
        productId: z.string().nullish(),
        name: z.string().nullish(),
        quantity: z.number().int().min(1).default(1),
        price: z.number().nullish(),
        images: z.string().nullish(),
        sizeL: z.string().nullish(),
        sizeW: z.string().nullish(),
        sizeH: z.string().nullish(),
        weight: z.string().nullish(),
        certificationIds: z.string().nullish(),
        remark: z.string().nullish(),
      }),
    )
    .nullish(),
});

export const groupItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().nullish(),
        name: z.string().nullish(),
        quantity: z.number().int().min(1).default(1),
        price: z.number().nullish(),
      }),
    )
    .min(1, '请至少提供一个单品'),
});

export type GroupInput = z.infer<typeof groupSchema>;
export type GroupItemsInput = z.infer<typeof groupItemsSchema>;

export interface ProductGroupListFilters {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
}

/** V1.0 Product 尺寸/克重为 Float?，旧前端传字符串，统一归一为 number | null */
const toNumberOrNull = (v?: string | null): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseIdList = (v?: string | null): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 读取侧（DQ-3=C）：对含 `items[].product` 的 ComboProduct 记录做可见性投影 */
function withProductVisibility<T>(actor: ProductGroupActorContext, group: T): T {
  const rec = group as Record<string, unknown>;
  const items = rec.items as Record<string, unknown>[] | undefined;
  if (!items) return group;
  return { ...rec, items: actor.projectRows(items, COMBO_ITEM_PRODUCT_FIELDS) } as T;
}

/** 从（已投影的）成员明细派生 products + productCount（沿用既有响应形状） */
function deriveProducts(items: readonly Record<string, unknown>[]) {
  return items
    .filter((it) => it.product)
    .map((it) => {
      const p = it.product as { id: string; name: string; sku: string | null };
      return { id: p.id, name: p.name, sku: p.sku, quantity: it.quantity, price: it.price };
    });
}

// ============================================================
// 读取
// ============================================================

/** 组合分页列表（含成员产品简要信息；读取侧投影剔除不可见产品） */
export async function listProductGroups(
  filters: ProductGroupListFilters,
  actor: ProductGroupActorContext,
) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const keyword = (filters.keyword ?? '').trim() || '';

  const where: Record<string, unknown> = {};
  if (keyword) where.name = { contains: keyword };

  const [list, total] = await Promise.all([
    productGroupRepository.findPageWithItems(where, (page - 1) * pageSize, pageSize),
    productGroupRepository.countByWhere(where),
  ]);

  const groups = list.map((g) => {
    const items = actor.projectRows(g.items, COMBO_ITEM_PRODUCT_FIELDS);
    const productCount = g.items.length;
    const { items: _items, ...rest } = g;
    return { ...rest, productCount, products: deriveProducts(items) };
  });

  return { list: groups, total, page, pageSize };
}

/** 组合详情 */
export async function getProductGroupDetail(id: string, actor: ProductGroupActorContext) {
  const group = await productGroupRepository.findDetailById(id);
  if (!group) throw new DomainNotFoundError('产品组不存在');

  const detailItems = actor.projectRows(group.items, COMBO_ITEM_PRODUCT_FIELDS);
  const { items: _items, ...rest } = group;
  return { ...rest, productCount: group.items.length, products: deriveProducts(detailItems) };
}

// ============================================================
// 写入
// ============================================================

/**
 * 创建组合（含行内快速新建单品）。
 *
 * 事务边界在 Operation 层：编号分配 + 内部 Product 创建 + ComboProduct / ComboItem 创建必须原子。
 */
export async function createProductGroup(input: GroupInput, actor: ProductGroupActorContext) {
  // 组合选定的「分类信息」作为所有行内快速新建单品的分类（与单品/批量新建一致）
  const groupCraftIds = input.craftIds ?? [];
  const groupAudienceId = input.audienceId ?? null;
  const groupCategoryId = input.categoryId ?? null;
  const groupVisibility = input.visibility ?? 'PUBLIC';
  const groupVisibleUserIds = input.visibleUserIds ?? [];
  const items = input.items ?? [];

  // 业务前置条件（在事务之前判定，结果与「事务内抛出 → 回滚」一致）：行内快速新建单品必须有名称
  for (const it of items) {
    if (!it.productId && !it.name) {
      throw new DomainValidationError('组合明细中快速新建单品时名称不能为空');
    }
  }

  // 组合明细：productId 关联已有单品；缺 productId 则行内快速新建单品
  const plans: ProductGroupItemPlan[] = items.map((it) => {
    if (it.productId) {
      return {
        kind: 'existing',
        productId: it.productId,
        quantity: it.quantity ?? 1,
        price: it.price ?? null,
      };
    }
    const certIds = parseIdList(it.certificationIds);
    // V1.0：行内快速新建写入 Product（images→coverImage, price→defaultPrice,
    // 尺寸/克重 Float, crafts 走 ProductCraftLink 嵌套创建, 认证走 ProductCertification）
    // ⚠️ 不含 productNo / sku：二者必须由 Operation 在同一事务内生成
    return {
      kind: 'new',
      productData: {
        name: it.name as string,
        defaultPrice: it.price ?? null,
        coverImage: it.images ?? null,
        sizeL: toNumberOrNull(it.sizeL),
        sizeW: toNumberOrNull(it.sizeW),
        sizeH: toNumberOrNull(it.sizeH),
        weight: toNumberOrNull(it.weight),
        remark: it.remark ?? null,
        supplyModes: ['DEEP_CUSTOM'],
        source: 'MANUAL',
        visibility: groupVisibility,
        audienceId: groupAudienceId,
        categoryId: groupCategoryId,
        createdBy: actor.userId,
        ...(groupCraftIds.length
          ? { crafts: { create: groupCraftIds.map((id) => ({ productCraft: { connect: { id } } })) } }
          : {}),
        ...(certIds.length
          ? { certifications: { create: certIds.map((id) => ({ certificate: { connect: { id } } })) } }
          : {}),
        ...(groupVisibleUserIds.length
          ? { visibleUsers: { create: groupVisibleUserIds.map((userId) => ({ userId })) } }
          : {}),
      },
      quantity: it.quantity ?? 1,
      price: it.price ?? null,
    };
  });

  const group = await createProductGroupOperation({
    name: input.name,
    description: input.description ?? null,
    ownerId: actor.userId || '',
    items: plans,
    skuCraftIds: groupCraftIds,
    skuAudienceId: groupAudienceId,
  });

  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'CREATE',
    module: 'combo',
    businessType: BUSINESS_TYPE.COMBO,
    businessId: group.id,
    businessNo: group.comboNo,
    summary: `创建了组合「${group.name}」${plans.length ? `（含 ${plans.length} 个单品）` : ''}`,
  });

  // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
  return withProductVisibility(actor, group);
}

/** 更新组合（仅名称 / 备注） */
export async function updateProductGroup(
  id: string,
  input: Partial<GroupInput>,
  actor: ProductGroupActorContext,
) {
  const existing = await productGroupRepository.findRawById(id);
  if (!existing) throw new DomainNotFoundError('产品组不存在');

  const data: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description ?? null;

  const group = await productGroupRepository.updateBasics(id, data);
  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'UPDATE',
    module: 'combo',
    businessType: BUSINESS_TYPE.COMBO,
    businessId: group.id,
    businessNo: group.comboNo,
    summary: `更新了组合「${group.name}」`,
  });
  return group;
}

/** 删除组合 */
export async function deleteProductGroup(id: string, actor: ProductGroupActorContext) {
  const existing = await productGroupRepository.findRawById(id);
  if (!existing) throw new DomainNotFoundError('产品组不存在');

  await productGroupRepository.deleteById(id);
  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'DELETE',
    module: 'combo',
    businessType: BUSINESS_TYPE.COMBO,
    businessId: existing.id,
    businessNo: existing.comboNo,
    summary: `删除了产品组「${existing.name}」`,
  });
  return { success: true };
}

/**
 * 向组合添加 / 移除单品（通过 items 关联维护，组合无 productIds 冗余字段）。
 *
 * ⚠️ 沿用既有语义：重新写入组合明细 = 先删后建，两步**各自独立、不包事务**。
 *    既有行为中 body.items[].name 被 schema 接收但**未使用**（Observed existing issue，本轮不顺手修）。
 */
export async function updateGroupProducts(
  id: string,
  input: GroupItemsInput,
  actor: ProductGroupActorContext,
) {
  const group = await productGroupRepository.findRawById(id);
  if (!group) throw new DomainNotFoundError('组合不存在');

  const updated = await replaceProductGroupItemsOperation({
    comboId: group.id,
    items: input.items.map((it) => ({
      productId: it.productId ?? null,
      quantity: it.quantity ?? 1,
      price: it.price ?? null,
    })),
  });

  void activityLogger.log({
    userId: actor.userId || '',
    username: actor.username || '',
    realName: actor.realName,
    action: 'UPDATE',
    module: 'combo',
    businessType: BUSINESS_TYPE.COMBO,
    businessId: group.id,
    businessNo: group.comboNo,
    summary: `更新了组合「${group.name}」的单品明细`,
  });

  // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
  return withProductVisibility(actor, updated);
}
