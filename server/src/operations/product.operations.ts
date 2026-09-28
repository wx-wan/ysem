import type { Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { SkuContextError, withSkuRetry } from '../lib/skuCode';
import { productRepository } from '../repositories/product.repository';
import { runInTransaction } from '../repositories';

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
export function createProductOperation(input: {
  data: Omit<Prisma.ProductUncheckedCreateInput, 'productNo' | 'sku'>;
  craftIds: string[];
  audienceId: string | null;
  hasFullContext: boolean;
}) {
  return withSkuRetry(() =>
    runInTransaction(async (tx) => {
      const productNo = await getNextNumber(tx, 'PRD');
      const sku = await productRepository.nextSku(input.craftIds, input.audienceId, undefined, tx);
      if (input.hasFullContext && sku === null) {
        throw new SkuContextError('工艺或受众缺少编码，请先在分类管理中补充代码');
      }
      return productRepository.create({ ...input.data, sku, productNo }, tx);
    }),
  );
}

/**
 * 更新产品：工艺/受众变化时按新组合重新生成 SKU，与 Product 更新同事务。
 *
 * `skuNeedsRegen` / `finalCraftIds` / `finalAudienceId` 由 Business 依据「变更前后比对」判定。
 * `excludeId` 为自身 id（不得把自身 SKU 当作冲突候选）。
 */
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
