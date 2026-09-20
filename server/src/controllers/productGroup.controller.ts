import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { buildSkuCode, withSkuRetry, SkuConcurrencyError } from '../lib/skuCode';
import { projectProductRows } from '../utils/scope';

/**
 * ComboProduct 成员产品的公开字段（DQ-3=C 投影白名单）。
 * `visibility` / `createdBy` / `visibleUsers` 为**内部授权字段**，仅用于可见性判定，不得进入响应。
 */
const GROUP_ITEM_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

/** 成员产品关联 select：含内部授权字段，响应前必须经 projectProductRows 投影 */
const GROUP_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  visibility: true,
  createdBy: true,
  visibleUsers: { select: { userId: true } },
} as const;

/** 读取侧（DQ-3=C）：对含 `items[].product` 的 ComboProduct 记录做可见性投影 */
const withProductVisibility = <T>(req: AuthRequest, group: T): T => {
  const rec = group as Record<string, unknown>;
  const items = rec.items as Record<string, unknown>[] | undefined;
  if (!items) return group;
  return { ...rec, items: projectProductRows(req, items, GROUP_ITEM_PRODUCT_FIELDS) } as T;
};

/** 业务规则违例（事务内抛出以回滚），由 handler 统一转为 400 */
class ProductGroupRuleError extends Error {}

const groupSchema = z.object({
  name: z.string().min(1, '产品组名称不能为空'),
  description: z.string().nullish(),
  // 组合的「分类信息」：工艺/受众/品类/可见性 由组合统一选定，
  // 作为所有组合子单品（行内快速新建）的分类，无需逐行填写
  craftIds: z.array(z.string().uuid()).nullish(),
  audienceId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
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

/** V1.0 Product 尺寸/克重为 Float?，旧前端传字符串，统一归一为 number | null */
const toNumberOrNull = (v?: string | null): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 列表（含成员产品简要信息）
export const getProductGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = (req.query.keyword as string)?.trim() || '';

    const where: Record<string, unknown> = {};
    if (keyword) where.name = { contains: keyword };

    const [list, total] = await Promise.all([
      prisma.comboProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: {
            orderBy: { sort: 'asc' },
            include: { product: { select: GROUP_ITEM_PRODUCT_SELECT } },
          },
        },
      }),
      prisma.comboProduct.count({ where }),
    ]);

    // 组装成员产品 + 数量（读取侧 DQ-3=C：不可见 PRIVATE 产品不得进入响应）
    const groups = list.map((g) => {
      const items = projectProductRows(req, g.items, GROUP_ITEM_PRODUCT_FIELDS);
      const products = items
        .filter((it) => it.product)
        .map((it) => ({
          id: it.product!.id,
          name: it.product!.name,
          sku: it.product!.sku,
          quantity: it.quantity,
          price: it.price,
        }));
      const productCount = g.items.length;
      const { items: _items, ...rest } = g;
      return { ...rest, productCount, products };
    });

    success(res, { list: groups, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getProductGroupById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const group = await prisma.comboProduct.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          orderBy: { sort: 'asc' },
          include: {
            product: { select: { ...GROUP_ITEM_PRODUCT_SELECT, weight: true } },
          },
        },
      },
    });
    if (!group) {
      fail(res, 404, '产品组不存在');
      return;
    }
    // 读取侧（DQ-3=C）：不可见 PRIVATE 产品不得进入响应
    const detailItems = projectProductRows(req, group.items, GROUP_ITEM_PRODUCT_FIELDS);
    const products = detailItems
      .filter((it) => it.product)
      .map((it) => ({
        id: it.product!.id,
        name: it.product!.name,
        sku: it.product!.sku,
        quantity: it.quantity,
        price: it.price,
      }));
    const { items: _items, ...rest } = group;
    success(res, { ...rest, productCount: group.items.length, products });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = groupSchema.parse(req.body);
    // 组合选定的「分类信息」作为所有行内快速新建单品的分类（与单品/批量新建一致）
    const groupCraftIds = parsed.craftIds ?? [];
    const groupAudienceId = parsed.audienceId ?? null;
    const groupCategoryId = parsed.categoryId ?? null;
    const groupVisibility = parsed.visibility ?? 'PUBLIC';
    const groupVisibleUserIds = parsed.visibleUserIds ?? [];
    // 组合明细：productId 关联已有单品；缺 productId 则行内快速新建单品
    const items = parsed.items ?? [];
    const itemData: { productId: string; quantity: number; price: number | null }[] = [];

    // 编号分配 + 内部 Product 创建 + ComboProduct / ComboItem 创建必须同事务：
    // 任一步失败 → 全部回滚，既不残留孤儿 Product，也不消耗 CMB / PRD 编号
    // 跨请求 SKU 唯一冲突 → 有限重试（重试包住整个事务：CMB / PRD 编号随回滚一并释放）
    const group = await withSkuRetry(() => prisma.$transaction(async (tx) => {
      const comboNo = await getNextNumber(tx, 'CMB');

      for (const it of items) {
        let pid = it.productId;
        if (!pid) {
          // 快速新建单品：分类沿用组合选定信息（工艺/受众/品类/可见性），仅补充尺寸/克重/认证/描述
          if (!it.name) {
            throw new ProductGroupRuleError('组合明细中快速新建单品时名称不能为空');
          }
          // SKU 与批量新建一致：按「工艺-受众-序号」自动生成（缺码则不生成，但不阻塞创建）
          // ⚠️ 必须传 `tx`：事务内可见本事务**已创建但未提交**的 Product，
          //    否则同一组合内相同 craft-audience 的多个明细会生成同一个 SKU（确定性 P2002）
          const sku = await buildSkuCode(tx, groupCraftIds, groupAudienceId);
          const certIds = String(it.certificationIds ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const productNo = await getNextNumber(tx, 'PRD');
          // V1.0：行内快速新建写入 Product（images→coverImage, price→defaultPrice,
          // 尺寸/克重 Float, crafts 走 ProductCraftLink 嵌套创建, 认证走 ProductCertification）
          const p = await tx.product.create({
            data: {
              productNo,
              name: it.name,
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
              sku,
              createdBy: req.userId,
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
          });
          pid = p.id;
        }
        itemData.push({
          productId: pid,
          quantity: it.quantity ?? 1,
          price: it.price ?? null,
        });
      }

      return tx.comboProduct.create({
        data: {
          comboNo,
          name: parsed.name,
          description: parsed.description ?? null,
          ownerId: req.userId || '',
          items: itemData.length
            ? { create: itemData.map((d, i) => ({ ...d, sort: i })) }
            : undefined,
        },
        include: { items: { include: { product: { select: GROUP_ITEM_PRODUCT_SELECT } } } },
      });
    }));
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'combo',
      businessType: BUSINESS_TYPE.COMBO,
      businessId: group.id,
      businessNo: group.comboNo,
      summary: `创建了组合「${group.name}」${itemData.length ? `（含 ${itemData.length} 个单品）` : ''}`,
    });
    // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
    created(res, withProductVisibility(req, group));
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    if (err instanceof ProductGroupRuleError) {
      fail(res, 400, err.message);
      return;
    }
    if (err instanceof SkuConcurrencyError) {
      console.error('[createProductGroup] sku conflict', err.cause);
      fail(res, 409, err.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = groupSchema.partial().parse(req.body);
    const existing = await prisma.comboProduct.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '产品组不存在');
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.description !== undefined) data.description = parsed.description ?? null;

    const group = await prisma.comboProduct.update({ where: { id: req.params.id }, data });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'combo',
      businessType: BUSINESS_TYPE.COMBO,
      businessId: group.id,
      businessNo: group.comboNo,
      summary: `更新了组合「${group.name}」`,
    });
    success(res, group);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.comboProduct.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '产品组不存在');
      return;
    }
    await prisma.comboProduct.delete({ where: { id: req.params.id } });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'DELETE',
      module: 'combo',
      businessType: BUSINESS_TYPE.COMBO,
      businessId: existing.id,
      businessNo: existing.comboNo,
      summary: `删除了产品组「${existing.name}」`,
    });
    success(res, { success: true });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 向组合添加 / 移除单品（通过 items 关联维护，组合无 productIds 冗余字段）
export const updateGroupProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z
      .object({
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
      })
      .parse(req.body);
    const group = await prisma.comboProduct.findUnique({ where: { id: req.params.id } });
    if (!group) {
      fail(res, 404, '组合不存在');
      return;
    }
    // 重新写入组合明细
    // V1.0 ComboItem 的 Prisma 字段名为 comboId（物理列名仍为 groupId）
    await prisma.comboItem.deleteMany({ where: { comboId: group.id } });
    const created = await prisma.comboProduct.update({
      where: { id: group.id },
      data: {
        items: {
          create: body.items.map((it, i) => ({
            productId: it.productId ?? undefined,
            quantity: it.quantity ?? 1,
            price: it.price ?? null,
            sort: i,
          })),
        },
      },
      include: { items: { include: { product: { select: GROUP_ITEM_PRODUCT_SELECT } } } },
    });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'combo',
      businessType: BUSINESS_TYPE.COMBO,
      businessId: group.id,
      businessNo: group.comboNo,
      summary: `更新了组合「${group.name}」的单品明细`,
    });
    // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
    success(res, withProductVisibility(req, created));
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
