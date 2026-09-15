import request, { type ApiResponse } from './request';

// ========== V1.0 审批配置（ApprovalConfig）==========
// 后端：/api/approval-configs（V1.0 controller，commit 956586ca）
//
// 语义要点：
//  - 业务类型字段为 **bizType**（ApprovalBizType，schema @unique）；legacy `type` 已废弃；
//  - 冻结 8 个业务类型（enum 中不存在 QUALITY_INSPECTION）；
//  - `approverIds` / `approverNames` 在 DB 与响应中均为 **JSON 字符串**（不是数组）；
//  - V1.0 **无 upsert**：POST 已存在 → 409；PUT 不存在 → 404；
//  - `approverIds` 写入要求 array、min(1)、不可重复（重复 → 400）；
//  - `flow`（多级审批）仅作合法 JSON 保存，**不参与 runtime**（多级审批 Deferred）。

/** 冻结的 8 个审批业务类型（与后端 ALL_BIZ_TYPES / ApprovalBizType enum 完全一致） */
export type ApprovalBizType =
  | 'QUOTATION'
  | 'SAMPLE_ORDER'
  | 'SALES_ORDER'
  | 'PRODUCTION_ORDER'
  | 'SHIPMENT'
  | 'PURCHASE_ORDER'
  | 'PAYMENT'
  | 'PROFIT';

/** 稳定的展示顺序与文案（顺序 = 后端 enum 顺序） */
export const APPROVAL_BIZ_TYPES: ApprovalBizType[] = [
  'QUOTATION',
  'SAMPLE_ORDER',
  'SALES_ORDER',
  'PRODUCTION_ORDER',
  'SHIPMENT',
  'PURCHASE_ORDER',
  'PAYMENT',
  'PROFIT',
];

export const APPROVAL_BIZ_TYPE_LABEL: Record<ApprovalBizType, string> = {
  QUOTATION: '报价单审批',
  SAMPLE_ORDER: '打样单审批',
  SALES_ORDER: '销售订单审批',
  PRODUCTION_ORDER: '生产工单审批',
  SHIPMENT: '出运单审批',
  PURCHASE_ORDER: '采购单审批',
  PAYMENT: '收付款审批',
  PROFIT: '利润单审批',
};

/** 审批配置（一个 bizType 至多一条） */
export interface ApprovalConfig {
  id: string;
  bizType: ApprovalBizType;
  /** JSON 字符串，如 '["userId1","userId2"]' */
  approverIds: string;
  /** JSON 字符串或 null */
  approverNames: string | null;
  /** 多级审批预留（当前 runtime 为单级，不参与计算） */
  flow?: unknown;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 创建入参（POST）：bizType 必填，approverIds 要求 ≥1 且不可重复 */
export interface ApprovalConfigPayload {
  bizType: ApprovalBizType;
  approverIds: string[];
  approverNames?: string[];
  flow?: unknown;
  enabled?: boolean;
}

/** 更新入参（PUT）：bizType 位于路径，body 不含 bizType */
export type ApprovalConfigUpdatePayload = Omit<ApprovalConfigPayload, 'bizType'>;

export const approvalConfigApi = {
  /** 列表：仅返回已存在的配置（**不补齐**缺失 bizType） */
  list: () => request.get<ApiResponse<ApprovalConfig[]>>('/approval-configs'),

  get: (bizType: ApprovalBizType) =>
    request.get<ApiResponse<ApprovalConfig>>(`/approval-configs/${bizType}`),

  /** 新建：该 bizType 已存在 → 409 */
  create: (payload: ApprovalConfigPayload) =>
    request.post<ApiResponse<ApprovalConfig>>('/approval-configs', payload),

  /** 更新：该 bizType 不存在 → 404 */
  update: (bizType: ApprovalBizType, payload: ApprovalConfigUpdatePayload) =>
    request.put<ApiResponse<ApprovalConfig>>(`/approval-configs/${bizType}`, payload),

  /** 删除配置（当前页面不提供删除 UI；停用走 enabled=false） */
  remove: (bizType: ApprovalBizType) =>
    request.delete<ApiResponse<null>>(`/approval-configs/${bizType}`),
};
