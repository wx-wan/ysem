import request from './request';

/** OperationLog 条目（后端 OperationLog 表的投影，与全局日志页同结构） */
export interface OperationLogItem {
  id: string;
  userId: string | null;
  username: string;
  realName: string | null;
  action: string;
  module: string;
  businessType: string | null;
  businessId: string | null;
  businessNo: string | null;
  summary: string | null;
  diff: string | null; // 结构化变更 JSON：[{field,label,beforeText,afterText}]
  customerId: string | null;
  createdAt: string;
}

/** 各业务模块从 OperationLog 捞取自己的操作记录（单一日志库，不重复建记录） */
export const getSalesLogs = (id: string) =>
  request.get<{ data: { list: OperationLogItem[] } }>(`/sales/${id}/logs`).then((r) => r.data.data.list);

export const getCustomerLogs = (id: string) =>
  request.get<{ data: { list: OperationLogItem[] } }>(`/customers/${id}/logs`).then((r) => r.data.data.list);

export const getProductLogs = (id: string) =>
  request.get<{ data: { list: OperationLogItem[] } }>(`/products/${id}/logs`).then((r) => r.data.data.list);

/** 动作中文名（覆盖跨模块常见动作；未列出的回退为原始 action） */
export const LOG_ACTION_LABELS: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '修改',
  DELETE: '删除',
  STATUS: '状态变更',
  STAGE: '阶段变更',
  STAGE_CHANGE: '阶段变更',
  CLAIM: '认领',
  RELEASE: '释放',
  TRANSFER: '转移',
  TRANSFERRED: '转移',
  KEY_TOGGLE: '重点客户切换',
  INTENT_CHANGE: '意向变更',
  OPPORTUNITY_CREATED: '创建商机',
  OPPORTUNITY_UPDATED: '修改商机',
  OPPORTUNITY_DELETED: '删除商机',
  PIPELINE_CREATED: '创建商机',
  PIPELINE_UPDATED: '修改商机',
  PIPELINE_DELETED: '删除商机',
  LOGIN: '登录',
  AUTH: '授权',
  EXPORT: '导出',
  IMPORT: '导入',
  CREATED: '创建',
  UPDATED: '修改',
};

/** 动作 → 时间线节点颜色 */
export const LOG_ACTION_COLORS: Record<string, string> = {
  CREATE: 'green',
  CREATED: 'green',
  PIPELINE_CREATED: 'green',
  OPPORTUNITY_CREATED: 'green',
  UPDATE: 'blue',
  UPDATED: 'blue',
  PIPELINE_UPDATED: 'blue',
  OPPORTUNITY_UPDATED: 'blue',
  DELETE: 'red',
  OPPORTUNITY_DELETED: 'red',
  PIPELINE_DELETED: 'red',
  STATUS: 'orange',
  STAGE: 'purple',
  STAGE_CHANGE: 'purple',
  CLAIM: 'cyan',
  RELEASE: 'orange',
  TRANSFER: 'purple',
  TRANSFERRED: 'purple',
  KEY_TOGGLE: 'gold',
  INTENT_CHANGE: 'gold',
};
