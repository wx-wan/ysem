import type { Currency } from './customer';

/**
 * SalesOrder（销售订单）类型（Round F-S4 · Decision Freeze D-FS4-001~034）
 *
 * 字段**只**来自后端真实返回（只读核对 server/src/controllers/salesOrder.controller.ts）：
 *   · SALES_ORDER_INCLUDE L39-45 → customer{id,customerNo,companyName} · opportunity{id,opportunityNo,title}
 *                                  · quotation{id,quotationNo,title} · sampleOrder{id,sampleNo,productName}
 *                                  · items[orderBy lineNo asc]（**无 owner 投影** → D-FS4-018）
 *   · SALES_ORDER_DETAIL_INCLUDE L48-56 → 上述 + productionOrders/shipments/payments/profit（只读）
 *   · createSchema L110-133 / updateSchema L135-137 / listQuerySchema L139-150
 *   · 08-sales-order.prisma（model SalesOrder / SalesOrderItem）
 *
 * 类型规则（沿用 F-5）：Decimal 一律 **string**（quantity、unitPrice、amount、totalAmount、totalAmountCny、
 * exchangeRate、depositRatio、depositAmount、balanceAmount、paidAmountCny、costPrice、costAmount、shippedQty）；
 * DateTime → ISO string。
 */

export type { Currency };

/** 销售订单状态（prisma enum SalesOrderStatus，10 值；F-S4 中除创建时的 CONFIRMED 外**只读**） */
export type SalesOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'DEPOSIT_PENDING'
  | 'DEPOSIT_PAID'
  | 'IN_PRODUCTION'
  | 'QC'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED';

/** 明细关联产品的公开投影（本项目既有 DQ-3=C 白名单：id / name / sku） */
export interface SalesOrderItemProduct {
  id: string;
  name: string;
  sku: string | null;
}

/**
 * 订单明细（SalesOrderItem）
 *
 * `productId` / `product` 均可为 null（产品删除 → SetNull；产品不可见 → 读取侧投影为 null）；
 * `productName` 为**快照**（NOT NULL），产品不可见时读取侧会遮蔽（详见 D-FS4-012 的 UI 处理）。
 */
export interface SalesOrderItem {
  id: string;
  orderId: string;
  lineNo: number;
  productId: string | null;
  product: SalesOrderItemProduct | null;
  customerProductId: string | null;
  productName: string;
  productSku: string | null;
  spec: string | null;
  craft: string | null;
  size: string | null;
  material: string | null;
  packaging: string | null;
  colors: string[];
  /** Decimal → string */
  quantity: string;
  unit: string;
  /** Decimal → string */
  unitPrice: string;
  /** Decimal → string */
  amount: string;
  currency: Currency;
  costPrice: string | null;
  costAmount: string | null;
  deliveryDate: string | null;
  /** Decimal → string（由 ShipmentItem 汇总回写，一律重算） */
  shippedQty: string;
  remark: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderCustomerLite {
  id: string;
  customerNo: string;
  companyName: string;
}

export interface SalesOrderOpportunityLite {
  id: string;
  opportunityNo: string;
  title: string;
}

export interface SalesOrderQuotationLite {
  id: string;
  quotationNo: string;
  title: string;
}

export interface SalesOrderSampleOrderLite {
  id: string;
  sampleNo: string;
  productName: string;
}

/** 订单标量行（Prisma SalesOrder 全字段） */
export interface SalesOrderBase {
  id: string;
  /** SO-yyyyMMdd-0001（后端 NumberSequence 生成） */
  orderNo: string;
  opportunityId: string;
  /** 商业来源报价单（可空；本链路恒为报价进入，故非空） */
  quotationId: string | null;
  customerId: string;
  sampleOrderId: string | null;
  status: SalesOrderStatus;
  confirmedAt: string | null;
  depositPaidAt: string | null;
  productionStartAt: string | null;
  qcAt: string | null;
  readyToShipAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  currency: Currency;
  exchangeRate: string | null;
  /** Decimal → string（NOT NULL） */
  totalAmount: string;
  /** Decimal → string（无可用汇率时为 null） */
  totalAmountCny: string | null;
  depositRatio: string | null;
  depositAmount: string | null;
  balanceAmount: string | null;
  /** Decimal → string（Payment direction=IN + status=CONFIRMED 汇总回写；F-S6 关注） */
  paidAmountCny: string;
  orderDate: string | null;
  deliveryDate: string | null;
  actualDeliveryDate: string | null;
  tradeTerms: string | null;
  paymentTerms: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  /** ADR-04 快照（后端 Deferred，始终 null；**不展示** — D-FS4-025） */
  customerSnapshot: Record<string, unknown> | null;
  termsSnapshot: Record<string, unknown> | null;
  /** ⚠ 无 owner 投影（仅标量 ownerId）⇒ UI 不展示负责人（D-FS4-018） */
  ownerId: string | null;
  remark: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** 列表行（= 标量行 + INCLUDE 投影） */
export interface SalesOrderListItem extends SalesOrderBase {
  customer: SalesOrderCustomerLite;
  opportunity: SalesOrderOpportunityLite;
  quotation: SalesOrderQuotationLite | null;
  sampleOrder: SalesOrderSampleOrderLite | null;
  items: SalesOrderItem[];
}

/** 下游只读投影（详情 include；F-S4 仅承载类型，不消费其业务逻辑） */
export interface SalesOrderDownstreamRefs {
  productionOrders: { id: string; productionNo: string; status: string }[];
  shipments: { id: string; shipmentNo: string; status: string }[];
  payments: {
    id: string;
    paymentNo: string;
    direction: string;
    type: string;
    amount: string;
    currency: Currency;
    status: string;
  }[];
  profit: { id: string; profitNo: string; profitCny: string | null; status: string } | null;
}

/** 详情（= 列表行 + 下游只读投影） */
export interface SalesOrderDetail extends SalesOrderListItem, SalesOrderDownstreamRefs {}

/**
 * 列表查询参数（GET /api/sales-orders）
 *
 * 后端真实支持：customerId · opportunityId · quotationId · sampleOrderId · status · productId · keyword
 * （orderNo / customer.companyName contains）· page · pageSize（上限 100）。
 * F-S4 前端仅实现 keyword + status + 分页（+ 入口协议带入的 quotationId）—— D-FS4-016。
 */
export interface SalesOrderListQuery {
  keyword?: string;
  status?: SalesOrderStatus;
  customerId?: string;
  opportunityId?: string;
  quotationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 明细入参（SalesOrder itemSchema 白名单中本阶段提交的键）
 *
 * ★ 不提交（D-FS4-004）：`material` / `colors`（QuotationItem 无该列，由后端自 Product 填充）、
 *   `amount`（后端 = quantity × unitPrice）、`currency`（随订单币种）、`leadTime`（不在 SalesOrder itemSchema）。
 */
export interface SalesOrderItemInput {
  productId: string;
  productName?: string;
  productSku?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
  quantity: number;
  unit?: string;
  unitPrice: number;
  remark?: string | null;
}

/**
 * 创建载荷（D-FS4-003~013）
 *
 * 提交：opportunityId（来自报价）· quotationId（来自报价）· currency · **status='CONFIRMED'** ·
 *       orderDate? · deliveryDate? · remark? · items[]
 * 不提交：customerId（后端由商机推导）· totalAmount（后端汇总）· exchangeRate（后端解析）· ownerId（F-01）
 */
export interface SalesOrderCreatePayload {
  opportunityId: string;
  quotationId: string;
  currency: Currency;
  /** D-FS4-013：显式 CONFIRMED —— Shipment 的状态门限排除 DRAFT */
  status: SalesOrderStatus;
  orderDate?: string | null;
  deliveryDate?: string | null;
  remark?: string | null;
  items: SalesOrderItemInput[];
}

/**
 * 更新载荷（D-FS4-020/021）
 *
 * 允许：remark · orderDate · deliveryDate · actualDeliveryDate · tradeTerms · paymentTerms ·
 *       portOfLoading · portOfDischarge · cancelReason · currency（仅改动时）· items（**仅在明细变化时**）
 * 禁止：status · ownerId · customerId · opportunityId · quotationId · sampleOrderId · totalAmount · exchangeRate
 */
export interface SalesOrderUpdatePayload {
  remark?: string | null;
  orderDate?: string | null;
  deliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  tradeTerms?: string | null;
  paymentTerms?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  cancelReason?: string | null;
  currency?: Currency;
  items?: SalesOrderItemInput[];
}
