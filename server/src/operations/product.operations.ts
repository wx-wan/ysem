import type { Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { SkuContextError, withSkuRetry } from '../lib/skuCode';
import { productRepository } from '../repositories/product.repository';
import { userRepository } from '../repositories/user.repository';
import { runInTransaction, type DbClient } from '../repositories';

/**
 * Product Operation Layer（Round R-4 · Product Layering）
 *
 * 职责：**事务编排**（编号分配 / SKU 生成 / 落库必须原子）与跨仓储组合。
 * 不负责业务政策 —— 「什么条件下允许创建 / 更新」「字段如何从请求体映射到 V1.0 列」
 * 由 Business Layer（services/product.service.ts）决定。
 *
 * 事务边界：Product 的 `$transaction` 全部收在本层（Controller / Business 不出现 `$transaction`）。
 *
 * 【为什么 create / update 需要事务】（沿用既有注释，未改语义）
 *   · 业务失败 → 编号计数一并回滚，不产生编号空洞
 *   · SKU 用 tx 扫描 → 事务内可见本事务已创建的 Product（消除确定性重复 SKU）
 *   · 跨请求 SKU 唯一冲突 → 有限重试（重试包住整个事务，SKU 重新计算）
 */

/**
 * 创建产品：分配编号 → 生成 SKU → 落库（同一事务，SKU 冲突有限重试）。
 *
 * `hasFullContext`（工艺 + 受众齐备）由 Business 判定：齐备时 SKU 必须生成成功，
 * 否则属「分类未配置 code」的业务前置条件不满足 → `SkuContextError`（HTTP 边界映射 400）。
 */
export function createProductOperation(
  input: {
    data: Omit<Prisma.ProductUncheckedCreateInput, 'productNo' | 'sku'>;
    craftIds: string[];
    audienceId: string | null;
    hasFullContext: boolean;
  },
  db?: DbClient,
) {
  const run = async (tx: DbClient) => {
    const productNo = await getNextNumber(tx, 'PRD');
    const sku = await productRepository.nextSku(input.craftIds, input.audienceId, undefined, tx);
    if (input.hasFullContext && sku === null) {
      throw new SkuContextError('工艺或受众缺少编码，请先在分类管理中补充代码');
    }
    return productRepository.create({ ...input.data, sku, productNo }, tx);
  };

  // V1.1（lead-fk-only）：由上层聚合传入外部事务（线索建档）时**不启用 SKU 重试** ——
  // withSkuRetry 的前提是「重试包住整个事务」，在外层事务内重试会残留上一次的写入。
  // 此时 SKU 唯一冲突交由整个外层事务回滚处理。
  if (db) return run(db);
  return withSkuRetry(() => runInTransaction(run));
}

/**
 * 更新产品：工艺/受众变化时按新组合重新生成 SKU，与 Product 更新同事务。
 *
 * `skuNeedsRegen` / `finalCraftIds` / `finalAudienceId` 由 Business 依据「变更前后比对」判定。
 * `excludeId` 为自身 id（不得把自身 SKU 当作冲突候选）。
 */
/**
 * **按 id 更新产品字段**（线索侧专用：线索已关联产品后再改产品名 / 尺寸克重）。
 *
 * 语义：修改**同一条**产品记录（不建档、不新建、不改编号）。
 * 只写**不影响 SKU 派生**的字段（名称与尺寸克重）——工艺 / 受众 / 品类属产品主数据，
 * 由产品库维护（改动会影响 SKU 派生，须走产品模块的更新流程）。
 */
export async function updateProductFromLeadOperation(
  productId: string,
  patch: {
    name?: string | null;
    sizeL?: number | null;
    sizeW?: number | null;
    sizeH?: number | null;
    weight?: number | null;
  },
  db?: DbClient,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.sizeL !== undefined) data.sizeL = patch.sizeL;
  if (patch.sizeW !== undefined) data.sizeW = patch.sizeW;
  if (patch.sizeH !== undefined) data.sizeH = patch.sizeH;
  if (patch.weight !== undefined) data.weight = patch.weight;
  if (Object.keys(data).length) {
    await productRepository.update(productId, data as Prisma.ProductUpdateInput, db);
  }
}

export function updateProductOperation(input: {
  id: string;
  data: Record<string, unknown>;
  skuNeedsRegen: boolean;
  finalCraftIds: string[];
  finalAudienceId: string | null;
}) {
  return withSkuRetry(() =>
    runInTransaction(async (tx) => {
      const data: Record<string, unknown> = { ...input.data };
      if (input.skuNeedsRegen) {
        const sku = await productRepository.nextSku(
          input.finalCraftIds,
          input.finalAudienceId,
          input.id,
          tx,
        );
        if (sku === null && input.finalCraftIds.length && input.finalAudienceId) {
          throw new SkuContextError('工艺或受众缺少编码，请先在分类管理中补充代码');
        }
        data.sku = sku;
      }
      return productRepository.update(input.id, data as unknown as Prisma.ProductUpdateInput, tx);
    }),
  );
}

// ============================================================
// 产品名占用检查（轻量只读：GET /api/products/ownership）
// ============================================================

/**
 * 产品名占用检查结果。
 *
 * 产品**没有归属概念**（`Product.ownerId` 列未被任何业务读写），故「占用」只有两个维度：
 * 同名产品是否存在、以及它是否在当前调用者的可见范围内。
 */
export interface ProductNameOwnershipResult {
  /** NOT_FOUND=无同名（名称可用）；OWNED_BY_ME=同名且在可见范围内；OWNED_BY_OTHER=同名但不可见 */
  code: 'NOT_FOUND' | 'OWNED_BY_ME' | 'OWNED_BY_OTHER';
  productId?: string;
  productNo?: string;
  /** 仅 `OWNED_BY_OTHER` 返回：创建人显示名（与客户名归属提示口径一致，不泄露其它细节） */
  ownerName?: string;
}

/**
 * 产品名占用检查（`GET /api/products/ownership?name=` 的唯一数据来源）。
 *
 * 口径：
 *   · 名称匹配 = `trim` + **大小写不敏感**（产品名本身不唯一，这里只判「是否存在同名」）；
 *   · 软删产品（`deletedAt` 非空）**不计占用**；
 *   · `excludeId` 供**编辑态排除自身**（否则改其它字段也会把自己判成「已有同名」）；
 *   · 同名且在调用者可见范围内 → `OWNED_BY_ME`（可直接复用）；
 *     同名但不可见 → `OWNED_BY_OTHER`（提示避免重复建档，并回创建人显示名）。
 */
export async function checkProductNameOwnershipOperation(
  name: string,
  excludeId: string | null,
  visibilityWhere: Record<string, unknown>,
  db?: DbClient,
): Promise<ProductNameOwnershipResult> {
  const keyword = name.trim();
  if (!keyword) return { code: 'NOT_FOUND' };

  const hit = await productRepository.findFirst(
    {
      where: {
        name: { equals: keyword, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, productNo: true, createdBy: true },
    },
    db,
  );
  if (!hit) return { code: 'NOT_FOUND' };

  const visible = await productRepository.findVisibleById(hit.id, visibilityWhere, db);
  if (visible) return { code: 'OWNED_BY_ME', productId: hit.id, productNo: hit.productNo };

  let ownerName: string | undefined;
  if (hit.createdBy) {
    const creators = await userRepository.findNamesByIds([hit.createdBy], db);
    ownerName = creators[0]?.realName || creators[0]?.username || undefined;
  }
  return { code: 'OWNED_BY_OTHER', productId: hit.id, productNo: hit.productNo, ownerName };
}
