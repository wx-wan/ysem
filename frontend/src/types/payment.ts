import type { Currency } from './customer';

/**
 * Payment（收付款）类型（Round F-S6）
 *
 * 依据 server/src/controllers/payment.controller.ts：PAYMENT_INCLUDE L41-45 · createSchema L51-67
 * · prisma/schema/13-finance.prisma（model Payment）· 00-enums.prisma（PaymentDirection / PaymentStatus / PaymentType）
 *
 * ★ 关键合同（F-S6 硬规则）：`Payment.status` 模型默认 **PENDING**，而
 *   `SalesOrder.paidAmountCny = SUM(Payment.amountCny WHERE direction=IN AND status=CONFIRMED)`
 *   ⇒ 收款必须**显式提交 `status: 'CONFIRMED'`**，否则已收累计恒为 0。
 */

export type { Currency };

/** 收付款方向（IN=收款 · OUT=付款） */
export type PaymentDirection = 'IN' | 'OUT';

/** 收付款状态（模型默认 PENDING；仅 CONFIRMED 计入已收累计） */
export type PaymentStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'FAILED';

/** 款项类型（默认 OTHER） */
export type PaymentType = 'DEPOSIT' | 'BALANCE' | 'FULL' | 'OTHER';

/** 宿主/客户精简投影（PAYMENT_INCLUDE） */
export interface PaymentSalesOrderLite {
  id: string;
  orderNo: string;
  status: string;
  ownerId: string | null;
}

export interface PaymentPurchaseOrderLite {
  id: string;
  purchaseNo: string;
  status: string;
  ownerId: string | null;
}

export interface PaymentCustomerLite {
  id: string;
  customerNo: string;
  companyName: string;
}

/** 收付款单（标量行 + include 投影） */
export interface PaymentListItem {
  id: string;
  /** PY-yyyyMMdd-0001 */
  paymentNo: string;
  direction: PaymentDirection;
  type: PaymentType;
  salesOrderId: string | null;
  purchaseOrderId: string | null;
  customerId: string | null;
  currency: Currency;
  /** Decimal → string */
  exchangeRate: string | null;
  /** Decimal → string */
  amount: string;
  /** Decimal → string */
  amountCny: string | null;
  /** Decimal → string（收付款比例，百分数语义） */
  ratio: string | null;
  payDate: string | null;
  method: string | null;
  bankAccount: string | null;
  voucherRemark: string | null;
  status: PaymentStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  remark: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  salesOrder: PaymentSalesOrderLite | null;
  purchaseOrder: PaymentPurchaseOrderLite | null;
  customer: PaymentCustomerLite | null;
}

/**
 * 收款创建载荷（F-S6 仅用收款：direction=IN + salesOrderId + status=CONFIRMED）
 * 不提交：customerId（后端按订单客户推导并校验一致性）· exchangeRate（后端解析）· purchaseOrderId（收款不得关联采购单）
 */
export interface PaymentCreatePayload {
  direction: PaymentDirection;
  salesOrderId: string;
  amount: number;
  /** ★ 必须显式 CONFIRMED，否则不计入 paidAmountCny */
  status: PaymentStatus;
  type?: PaymentType;
  currency?: Currency;
  payDate?: string | null;
  method?: string | null;
  bankAccount?: string | null;
  voucherRemark?: string | null;
  remark?: string | null;
}
