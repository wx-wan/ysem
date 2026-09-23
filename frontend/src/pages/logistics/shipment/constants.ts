import type { ShipmentStatus } from '../../../types/shipment';

/**
 * 出运单 UI 常量（Round F-S5）
 * 状态键 = prisma `enum ShipmentStatus`（6 值），逐字一致；本阶段状态**只读展示**。
 */
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  DRAFT: '草稿',
  BOOKED: '已订舱',
  SHIPPED: '已发运',
  ARRIVED: '已到港',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const SHIPMENT_STATUS_COLOR: Record<ShipmentStatus, string> = {
  DRAFT: 'default',
  BOOKED: 'processing',
  SHIPPED: 'blue',
  ARRIVED: 'cyan',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

export const SHIPMENT_STATUS_OPTIONS: { label: string; value: ShipmentStatus }[] = (
  Object.keys(SHIPMENT_STATUS_LABEL) as ShipmentStatus[]
).map((status) => ({ label: SHIPMENT_STATUS_LABEL[status], value: status }));

export const SHIPMENT_STATUS_FILTER_OPTIONS: { label: string; value: ShipmentStatus | 'ALL' }[] = [
  { label: '全部状态', value: 'ALL' },
  ...SHIPMENT_STATUS_OPTIONS,
];

/** 分页（后端 pageSize 上限 100） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 创建即 DRAFT（后端默认；本阶段不提供出运状态流转 UI） */
export const SHIPMENT_STATUS_HINT = '出运单创建后状态为「草稿」；本阶段仅展示状态，不提供状态流转入口。';

/** 数量安全（后端：本次数量 ≤ 订单数量 − 已出运数量；超出返回 409） */
export const QUANTITY_SAFETY_HINT = '本次数量必须大于 0，且不得超过订单行的可出运数量（后端会校验并重算已出运数量）。';

/** 无产品列：ShipmentItem 无 productId，产品经订单行传递 */
export const SHIPMENT_ITEM_LINEAGE_HINT = '出运明细不直接关联产品，产品血缘经订单行传递。';

/** 订单状态门限（后端 SHIPPABLE_STATUSES；草稿/已完成/已取消不允许出货） */
export const SHIPPABLE_STATUS_HINT = '订单处于草稿、已完成或已取消状态时不允许创建出运单。';
