import type { SalesOrderStatus } from '../../../types/salesOrder';

/**
 * 销售订单 UI 常量（Round F-S4）
 *
 * 状态标签**复用** F-7 已收口的 `SALES_ORDER_STATUS_LABEL` / `SALES_ORDER_STATUS_COLOR`
 * （键 = prisma `enum SalesOrderStatus` 全部 10 值）—— D-FS4-031：零新增状态字典。
 */
export {
  SALES_ORDER_STATUS_COLOR as ORDER_STATUS_COLOR,
  SALES_ORDER_STATUS_LABEL as ORDER_STATUS_LABEL,
} from '../../customers/constants';

import { SALES_ORDER_STATUS_LABEL } from '../../customers/constants';

/** 状态下拉选项（仅用于**列表筛选**；F-S4 不提供状态变更 UI — D-FS4-014） */
export const ORDER_STATUS_OPTIONS: { label: string; value: SalesOrderStatus }[] = (
  Object.keys(SALES_ORDER_STATUS_LABEL) as SalesOrderStatus[]
).map((status) => ({ label: SALES_ORDER_STATUS_LABEL[status], value: status }));

export const ORDER_STATUS_FILTER_OPTIONS: { label: string; value: SalesOrderStatus | 'ALL' }[] = [
  { label: '全部状态', value: 'ALL' },
  ...ORDER_STATUS_OPTIONS,
];

/** 复用 F-S1 收口的币种选项（值 = 后端 Currency 白名单） */
export { CURRENCY_OPTIONS as ORDER_CURRENCY_OPTIONS } from '../../products/constants';

/** 分页（后端 pageSize 上限 100） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 明细单位默认值（后端 SalesOrderItem.unit 默认 'PCS'） */
export const ORDER_DEFAULT_UNIT = 'PCS';

/**
 * D-FS4-013/015：创建即 CONFIRMED 的业务原因（UI 明示，避免误解为状态机）
 */
export const CREATE_STATUS_HINT =
  '订单创建后直接进入「已确认」：后端出运单要求订单状态不属于草稿，这是链路衔接所需（非状态流转功能）。';

/** 状态只读（D-FS4-014） */
export const STATUS_READONLY_HINT = '订单状态在本阶段仅展示，不提供状态流转入口。';

/** 明细重建语义（D-FS4-021） */
export const ITEMS_REBUILD_HINT = '保存时将按下方明细整体覆盖订单明细；仅当明细确实变化时才会提交。';

/** 明细被下游引用时后端返回 409 的说明 */
export const ITEMS_LOCKED_HINT = '若明细已被出运单等下游单据引用，后端将拒绝重建明细（返回 409）。';

/** 历史明细产品不可用（D-FS4-012） */
export const UNAVAILABLE_ITEM_PRODUCT_HINT =
  '该明细关联的产品当前不可用。保存前请替换或移除该产品（后端对不可见产品会拒绝重建明细）。';

export const ITEM_PRODUCT_UNAVAILABLE_LABEL = '历史产品';

/** 单价/数量为前端收紧校验（D-FS4-010；后端实际允许 unitPrice = 0，不修改契约） */
export const ITEM_VALIDATION_HINT = '本阶段要求每行填写产品、数量（≥1）与单价（>0）。';

/** 无负责人展示（D-FS4-018） */
export const OWNER_HINT = '后端未提供订单负责人投影，本阶段不展示负责人。';

/** 列表筛选范围（D-FS4-016） */
export const LIST_FILTER_NOTE = '列表支持关键词（订单号 / 客户名称）与状态筛选。';

/** 不展示快照字段（D-FS4-025） */
export const SNAPSHOT_OMIT_NOTE = '下单快照字段后端尚未写入，本阶段不展示。';

/* ============ F-S6：收付款展示（键 = prisma PaymentStatus / PaymentType） ============ */

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: '待确认',
  RECEIVED: '已收款',
  CONFIRMED: '已确认',
  FAILED: '失败',
};

export const PAYMENT_STATUS_COLOR: Record<string, string> = {
  PENDING: 'gold',
  RECEIVED: 'blue',
  CONFIRMED: 'green',
  FAILED: 'red',
};

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  DEPOSIT: '定金',
  BALANCE: '尾款',
  FULL: '全款',
  OTHER: '其他',
};

/** 已收累计口径（Payment direction=IN + status=CONFIRMED 汇总回写） */
export const PAID_AMOUNT_HINT = '「已收（CNY）」由后端按已确认收款自动汇总（收款创建即确认）。';
