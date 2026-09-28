import type { Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { withSkuRetry } from '../lib/skuCode';
import { productRepository } from '../repositories/product.repository';
import { productGroupRepository, type ComboItemInput } from '../repositories/productGroup.repository';
import { runInTransaction } from '../repositories';

/**
 * ComboProduct（产品组合）Operation Layer（Round R-4 · Product Layering）
 *
 * 职责：**事务编排**与跨仓储组合。
 * 不负责业务政策 —— 「组合明细缺失 productId 时是否允许（行内快速新建需名称）」
 * 由 Business Layer（services/productGroup.service.ts）在事务**之前**判定。
 */

/**
 * 组合明细的写入计划（由 Business 组装）。
 * - `existing`：关联已有单品
 * - `new`：行内快速新建单品（`productData` 已由 Business 完成「请求体 → V1.0 Product 列」映射，
 *          仅缺 `productNo` / `sku` 两项，二者必须在本层事务内生成）
 */
export type ProductGroupItemPlan =
  | { kind: 'existing'; productId: string; quantity: number; price: number | null }
  | {
      kind: 'new';
      productData: Omit<Prisma.ProductUncheckedCreateInput, 'productNo' | 'sku'>;
      quantity: number;
      price: number | null;
    };

/**
 * 创建组合：编号分配 + 内部 Product 创建 + ComboProduct / ComboItem 创建必须同事务。
 *
 * 任一步失败 → 全部回滚，既不残留孤儿 Product，也不消耗 CMB / PRD 编号；
 * 跨请求 SKU 唯一冲突 → 有限重试（重试包住整个事务：CMB / PRD 编号随回滚一并释放）。
 *
 * ⚠️ SKU 必须用 `tx` 生成：事务内需可见本事务**已创建但未提交**的 Product，
 *    否则同一组合内相同 craft-audience 的多个明细会生成同一个 SKU（确定性 P2002）。
 */
export function createProductGroupOperation(input: {
  name: string;
  description: string | null;
  ownerId: string;
  items: ProductGroupItemPlan[];
  /** 行内快速新建单品的 SKU 上下文（沿用组合选定的工艺 / 受众） */
  skuCraftIds: string[];
  skuAudienceId: string | null;
}) {
  return withSkuRetry(() =>
    runInTransaction(async (tx) => {
      const comboNo = await getNextNumber(tx, 'CMB');

      const itemData: ComboItemInput[] = [];
      let sort = 0;
      for (const plan of input.items) {
        let productId: string;
        if (plan.kind === 'existing') {
          productId = plan.productId;
        } else {
          const sku = await productRepository.nextSku(
            input.skuCraftIds,
            input.skuAudienceId,
            undefined,
            tx,
          );
          const productNo = await getNextNumber(tx, 'PRD');
          const created = await productRepository.create({ ...plan.productData, sku, productNo }, tx);
          productId = created.id;
        }
        itemData.push({ productId, quantity: plan.quantity, price: plan.price, sort });
        sort += 1;
      }

      return productGroupRepository.createWithItems(
        {
          comboNo,
          name: input.name,
          description: input.description,
          ownerId: input.ownerId,
          items: itemData,
        },
        tx,
      );
    }),
  );
}

/**
 * 组合明细整组替换（`POST /product-groups/:id/products`）。
 *
 * ⚠️ 沿用既有语义：**两步各自独立、不包事务**（先删后建）。本层不改变该行为，
 *    只把它从 Controller 收敛到 Operation（后续如需改为原子操作属业务决策，不在本轮）。
 */
export async function replaceProductGroupItemsOperation(input: {
  comboId: string;
  items: { productId?: string | null; quantity: number; price: number | null }[];
}) {
  await productGroupRepository.deleteItemsByComboId(input.comboId);
  return productGroupRepository.addItems(
    input.comboId,
    input.items.map((it, i) => ({
      productId: it.productId ?? null,
      quantity: it.quantity,
      price: it.price,
      sort: i,
    })),
  );
}
