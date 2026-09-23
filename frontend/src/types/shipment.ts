import type { Currency } from './customer';

/**
 * Shipment（出运单）类型（Round F-S5）
 *
 * 字段**只**来自后端真实返回（只读核对 server/src/controllers/shipment.controller.ts）：
 *   · SHIPMENT_INCLUDE L44-51 → salesOrder{id,orderNo,status,ownerId} · customer{id,customerNo,companyName}
 *                              · items[+ salesOrderItem{id,lineNo,productName}]（orderBy createdAt asc）
 *   · SHIPMENT_DETAIL_INCLUDE L54-57 → 上述 + inspections（只读）
 *   · createSchema L88-115 / listQuerySchema L121-128
 *   · prisma/schema/11-shipment.prisma（model Shipment / ShipmentItem）
 *
 * 类型规则：Decimal → string（quantity/freightAmount/freightAmountCny）；DateTime → ISO string；
 * packageCount 为 Int（number）；grossWeight/netWeight/volume 为 Float（number）。
 * ★ ShipmentItem **没有 productId** —— 产品血缘经 `salesOrderItemId` 传递。
 */

export type { Currency };

/** 出运状态（prisma enum ShipmentStatus；F-S5 仅展示，不提供状态流转 UI） */
export type ShipmentStatus = 'DRAFT' | 'BOOKED' | 'SHIPPED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED';

/** 明细关联的订单行精简投影（SHIPMENT_INCLUDE.items.salesOrderItem） */
export interface ShipmentOrderItemLite {
  id: string;
  lineNo: number;
  productName: string;
}

/** 出运明细（ShipmentItem；**无 productId**） */
export interface ShipmentItem {
  id: string;
  shipmentId: string;
  salesOrderItemId: string;
  salesOrderItem: ShipmentOrderItemLite | null;
  productName: string;
  spec: string | null;
  /** Decimal → string */
  quantity: string;
  packageCount: number | null;
  grossWeight: number | null;
  volume: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentSalesOrderLite {
  id: string;
  orderNo: string;
  status: string;
  ownerId: string | null;
}

export interface ShipmentCustomerLite {
  id: string;
  customerNo: string;
  companyName: string;
}

/** 出运单标量行（Prisma Shipment 全字段） */
export interface ShipmentBase {
  id: string;
  /** SH-yyyyMMdd-0001（后端 NumberSequence 生成） */
  shipmentNo: string;
  salesOrderId: string;
  customerId: string;
  status: ShipmentStatus;
  shipmentDate: string | null;
  etd: string | null;
  eta: string | null;
  atd: string | null;
  ata: string | null;
  incoterm: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  carrier: string | null;
  vessel: string | null;
  billOfLadingNo: string | null;
  trackingNo: string | null;
  shippingMethod: string | null;
  packageCount: number | null;
  grossWeight: number | null;
  netWeight: number | null;
  volume: number | null;
  freightAmount: string | null;
  freightCurrency: Currency | null;
  freightAmountCny: string | null;
  customsDeclarationNo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** 列表行 */
export interface ShipmentListItem extends ShipmentBase {
  salesOrder: ShipmentSalesOrderLite;
  customer: ShipmentCustomerLite;
  items: ShipmentItem[];
}

/** 质检只读投影（详情额外 include；F-S5 仅展示） */
export interface ShipmentInspectionRef {
  id: string;
  inspectionNo: string;
  type: string;
  result: string | null;
}

/** 详情 */
export interface ShipmentDetail extends ShipmentListItem {
  inspections: ShipmentInspectionRef[];
}

/**
 * 列表查询参数（GET /api/shipments）
 * 后端支持：salesOrderId · customerId · status · keyword（shipmentNo / trackingNo / 订单号）· page · pageSize
 */
export interface ShipmentListQuery {
  salesOrderId?: string;
  customerId?: string;
  status?: ShipmentStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 出运明细入参（ShipmentItem itemSchema 白名单）
 * ★ 不提交 productId（ShipmentItem 无该列）；salesOrderItemId 必填且必须属于该销售订单。
 */
export interface ShipmentItemInput {
  salesOrderItemId: string;
  productName?: string;
  spec?: string | null;
  quantity: number;
  packageCount?: number | null;
  grossWeight?: number | null;
  volume?: number | null;
}

/**
 * 创建载荷（F-S5）
 * 提交：salesOrderId · items[] · 日期/物流/装载等可选字段
 * 不提交：customerId（后端由订单推导）· status（后端默认 DRAFT）· freightAmountCny（需显式，本阶段不填）
 */
export interface ShipmentCreatePayload {
  salesOrderId: string;
  shipmentDate?: string | null;
  etd?: string | null;
  eta?: string | null;
  carrier?: string | null;
  vessel?: string | null;
  billOfLadingNo?: string | null;
  trackingNo?: string | null;
  shippingMethod?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  incoterm?: string | null;
  packageCount?: number | null;
  grossWeight?: number | null;
  netWeight?: number | null;
  volume?: number | null;
  freightAmount?: number | null;
  freightCurrency?: Currency | null;
  notes?: string | null;
  items: ShipmentItemInput[];
}
