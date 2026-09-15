import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 利润单（Profit）==========
// 后端：/api/profits（V1.0 controller），编号 PRF → PF-yyyyMMdd-0001（NumberSequence 生成）。
//
// 关键语义：
//  - Profit 与 SalesOrder 为 **1:1**（SalesOrder 侧 `salesOrderId @unique`）；
//  - Profit **自身无 customer 字段**，客户只能经 `salesOrder.customer` 取得；
//  - Profit **无 DELETE 端点**（1:1 审计快照实体，纠错走 DRAFT / 重算 / 更新）；
//  - 运费为**服务端权威**：freightCostCny = Σ Shipment.freightAmountCny，客户端传入会被忽略；
//  - 成本项全部为本位币（CNY）Decimal，经 JSON 序列化为「字符串」。
//
// 计算口径（服务端）：
//   totalCostCny = material + outsource + packaging + labor + freight + other
//   profitCny    = revenueCny − totalCostCny
//   margin       = revenueCny > 0 ? profitCny / revenueCny × 100 : 0

export type ProfitStatus = 'DRAFT' | 'CONFIRMED';

export const PROFIT_STATUS_TEXT: Record<ProfitStatus, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
};

export const PROFIT_STATUS_COLOR: Record<ProfitStatus, string> = {
  DRAFT: 'default',
  CONFIRMED: 'success',
};

/** 利润单（SalesOrder 1:1） */
export interface Profit {
  id: string;
  profitNo: string;

  /** 1:1 宿主（不可变更） */
  salesOrderId: string;

  /** 收入（原币） */
  revenue: string;
  /** 收入（本位币） */
  revenueCny: string;
  currency: string;
  exchangeRate: string | null;

  // ---- 成本（本位币 CNY）----
  materialCostCny: string;
  outsourceCostCny: string;
  packagingCostCny: string;
  laborCostCny: string;
  /** 运费 ← Σ Shipment.freightAmountCny（服务端聚合，只读） */
  freightCostCny: string;
  otherCostCny: string;
  totalCostCny: string;

  // ---- 结果 ----
  profitCny: string;
  /** 利润率 %（百分数语义） */
  margin: string;

  /** 成本来源快照（审计依据） */
  costSnapshot?: Record<string, unknown> | null;
  calculatedAt?: string | null;

  status: ProfitStatus;
  remark: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- include ----
  salesOrder?: {
    id: string;
    orderNo: string;
    status: string;
    ownerId: string | null;
    customerId: string;
    currency: string;
    totalAmount: string;
    totalAmountCny: string | null;
    exchangeRate: string | null;
    customer?: { id: string; customerNo: string; companyName: string } | null;
  } | null;
}

export interface ProfitListRes {
  list: Profit[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProfitListParams {
  salesOrderId?: string;
  status?: ProfitStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 创建 / 更新入参。freightCostCny 不在入参内（服务端从 Shipment 聚合） */
export interface ProfitPayload {
  salesOrderId: string;
  revenue?: number | string;
  revenueCny?: number | string;
  currency?: string;
  exchangeRate?: number | string | null;
  materialCostCny?: number | string;
  outsourceCostCny?: number | string;
  packagingCostCny?: number | string;
  laborCostCny?: number | string;
  otherCostCny?: number | string;
  status?: ProfitStatus;
  remark?: string | null;
}

export const profitApi = {
  list: (params?: ProfitListParams) =>
    request.get<ApiResponse<ProfitListRes>>('/profits', { params }),

  get: (id: string) => request.get<ApiResponse<Profit>>(`/profits/${id}`),

  create: (data: ProfitPayload) =>
    request.post<ApiResponse<Profit>>('/profits', data),

  update: (id: string, data: Partial<ProfitPayload>) =>
    request.put<ApiResponse<Profit>>(`/profits/${id}`, data),

  // 不提供 remove()：V1.0 Profit API 无 DELETE（1:1 审计快照，纠错走 DRAFT / 重算 / 更新）
};
