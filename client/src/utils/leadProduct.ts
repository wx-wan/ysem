import type { Lead } from '../api/lead';

/** 线索产品信息的统一形状（产品库存档 与 未建档快照 的公共可读字段） */
export interface LeadProductInfo {
  id?: string | null;
  productNo?: string | null;
  name?: string | null;
  craftIds?: string[];
  audienceId?: string | null;
  categoryId?: string | null;
  sizeL?: number | null;
  sizeW?: number | null;
  sizeH?: number | null;
  weight?: number | null;
}

/**
 * 线索产品信息的**统一取值入口**（与 `resolveLeadCustomer` 同构）。
 *
 * 规则（V1.2）：产品**未建档**时，线索里的产品需求只存在明细快照 `items[0].productSnapshot` 里
 * （不创建产品库记录）；建档后才关联产品库产品 `items[0].product`。
 * 组件里不要再直接写 `items[0].product?.name`，否则未建档线索一律显示为空。
 */
export function resolveLeadProduct(lead?: Pick<Lead, 'items'> | null): LeadProductInfo | null {
  const item = lead?.items?.[0];
  if (!item) return null;
  return (item.product ?? item.productSnapshot ?? null) as LeadProductInfo | null;
}

/** 产品是否已建档（已关联产品库产品） */
export function isProductFiled(lead?: Pick<Lead, 'items'> | null): boolean {
  return !!lead?.items?.[0]?.productId;
}
