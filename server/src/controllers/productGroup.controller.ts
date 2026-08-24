import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { buildSkuCode } from './product.controller';

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
            include: { product: { select: { id: true, name: true, sku: true, spec: true } } },
          },
        },
      }),
      prisma.comboProduct.count({ where }),
    ]);

    // 组装成员产品 + 数量
    const groups = list.map((g) => {
      const products = g.items
        .filter((it) => it.product)
        .map((it) => ({
          id: it.product!.id,
          name: it.product!.name,
          sku: it.product!.sku,
          spec: it.spec ?? it.product!.spec,
          quantity: it.quantity,
          price: it.price,
        }));
      const productCount = g.items.length;
      const { items, ...rest } = g;
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
          include: { product: { select: { id: true, name: true, sku: true, spec: true, weight: true } } },
        },
      },
    });
    if (!group) {
      fail(res, 404, '产品组不存在');
      return;
    }
    const products = group.items
      .filter((it) => it.product)
      .map((it) => ({
        id: it.product!.id,
        name: it.product!.name,
        sku: it.product!.sku,
        spec: it.spec ?? it.product!.spec,
        quantity: it.quantity,
        price: it.price,
      }));
    const { items, ...rest } = group;
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

    for (const it of items) {
      let pid = it.productId;
      if (!pid) {
        // 快速新建单品：分类沿用组合选定信息（工艺/受众/品类/可见性），仅补充尺寸/克重/认证/描述
        if (!it.name) {
          fail(res, 400, '组合明细中快速新建单品时名称不能为空');
          return;
        }
        // SKU 与批量新建一致：按「工艺-受众-序号」自动生成（缺码则不生成，但不阻塞创建）
        const sku = await buildSkuCode(groupCraftIds, groupAudienceId);
        const p = await prisma.singleProduct.create({
          data: {
            name: it.name,
            price: it.price ?? null,
            images: it.images ?? null,
            sizeL: it.sizeL ?? null,
            sizeW: it.sizeW ?? null,
            sizeH: it.sizeH ?? null,
            weight: it.weight ?? null,
            certificationIds: it.certificationIds ?? null,
            remark: it.remark ?? null,
            supplyModes: 'DEEP_CUSTOM',
            source: 'MANUAL',
            visibility: groupVisibility,
            audienceId: groupAudienceId,
            categoryId: groupCategoryId,
            sku,
            createdBy: req.userId,
            ...(groupCraftIds.length ? { crafts: { connect: groupCraftIds.map((id) => ({ id })) } } : {}),
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

    const group = await prisma.comboProduct.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        ownerId: req.userId || '',
        items: itemData.length
          ? { create: itemData.map((d, i) => ({ ...d, sort: i })) }
          : undefined,
      },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true, spec: true } } } } },
    });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'combo',
      comboId: group.id,
      targetId: group.id,
      target: group.name,
      detail: `创建了组合「${group.name}」${itemData.length ? `（含 ${itemData.length} 个单品）` : ''}`,
    });
    created(res, group);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
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
      comboId: group.id,
      targetId: group.id,
      target: group.name,
      detail: `更新了组合「${group.name}」`,
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
      module: 'product-group',
      targetId: existing.id,
      target: existing.name,
      detail: `删除了产品组「${existing.name}」`,
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
              spec: z.string().nullish(),
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
    await prisma.comboItem.deleteMany({ where: { groupId: group.id } });
    const created = await prisma.comboProduct.update({
      where: { id: group.id },
      data: {
        items: {
          create: body.items.map((it, i) => ({
            productId: it.productId ?? undefined,
            spec: it.spec ?? null,
            quantity: it.quantity ?? 1,
            price: it.price ?? null,
            sort: i,
          })),
        },
      },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true, spec: true } } } } },
    });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'combo',
      comboId: group.id,
      targetId: group.id,
      target: group.name,
      detail: `更新了组合「${group.name}」的单品明细`,
    });
    success(res, created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
