import axios from './request';
import type { ProductImageItem } from '../utils/productImages';

export type LeadSource = 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
/**
 * 线索状态（4 态，与后端 LeadStatus 一致）。
 * 状态由单据事件自动推进，前端**不得**主动写入：
 * NEW 新线索 / CONFIRMED 已确认（已绑定商机）/ SAMPLED 已打样 / WON 已成交。
 */
export type LeadStatus = 'NEW' | 'CONFIRMED' | 'SAMPLED' | 'WON';

export interface LeadCustomer {
  id: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface Lead {
  id: string;
  leadNo?: string | null; // 线索编号 XS-yyyyMM-####（V1.0 canonical 字段名）
  leadName: string;
  customerId?: string | null;
  customer?: LeadCustomer | null;
  sourceChannel?: string | null;
  source: LeadSource;
  status: LeadStatus;
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: { tool: string; account: string }[] | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  productInterest?: string | null;
  productName?: string | null;
  productId?: string | null;
  product?: { id: string; name: string } | null;
  quantity?: number;
  remark?: string | null;
  // 详情扩展字段
  targetMarket?: string | null;
  productType?: string | null;
  productDesc?: string | null; // 兼容旧取值（Lead 标量，已废弃；真实值见 items[0].productDesc）
  images?: string[] | string | null; // 兼容旧取值（已废弃；真实值见 attachments）
  // F-8L-B：来源渠道 / 来源平台（channelId/shopId → Channel 自关联树）
  channelId?: string | null;
  channel?: { id: string; name: string } | null;
  shopId?: string | null;
  shop?: { id: string; name: string } | null;
  // F-8L-B：采购产品明细（V1.0 产品关联落在 LeadItem）
  items?: Array<{
    id: string;
    productId?: string | null;
    product?: { id: string; name: string } | null;
    productName?: string | null;
    quantity?: number;
    productDesc?: string | null;
  }>;
  // D1：参考图片附件（Attachment ownerType=LEAD）
  attachments?: Array<{ id: string; url: string; name?: string | null; category?: string; sort?: number }>;
  targetPrice?: string | null;
  /** 目标价位汇率快照：1 单位该币种 = X CNY（与金额一同落库，后续换算固定用它） */
  targetPriceRate?: number | null;
  expectedDelivery?: string | null;
  customerType?: string | null;
  currency?: string | null; // 币种（CurrencyRate.code），目标价位前缀
  unit?: string | null; // 单位（Unit.name），数量需求后缀，默认 个
  /** 负责人 ID（V1.0 canonical 归属/请求字段） */
  ownerId?: string | null;
  /** 负责人（后端 owner relation；显示优先使用） */
  owner?: { id: string; username: string; realName: string | null } | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  pipelineId?: string | null; // 关联商机 ID（确认转商机后回填，便于溯源）
}

export interface LeadPayload {
  leadName?: string;
  customerId?: string | null;
  channelId?: string | null;
  shopId?: string | null;
  /** 来源渠道/平台组合值（JSON {channelId, shopId}），由后端入库前拆分为独立列 */
  sourceKey?: string | null;
  productId?: string | null;
  quantity?: number;
  source?: LeadSource;
  status?: LeadStatus;
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: { tool: string; account: string }[] | null;
  email?: string;
  phone?: string;
  country?: string;
  productInterest?: string;
  productName?: string | null;
  remark?: string;
  // 详情扩展字段
  targetMarket?: string | null;
  productType?: string | null;
  productDesc?: string | null;
  images?: { url: string; name?: string }[] | null;
  targetPrice?: string | null;
  /** 目标价位汇率快照：1 单位该币种 = X CNY（金额必带，CNY 恒为 1） */
  targetPriceRate?: number | null;
  expectedDelivery?: string | null;
  customerType?: string | null;
  currency?: string | null; // 币种（CurrencyRate.code），目标价位前缀
  unit?: string | null; // 单位（Unit.name），数量需求后缀，默认 个
  /** 负责人 ID（V1.0 canonical 请求字段） */
  ownerId?: string | null;
}

/** 线索操作日志条目（OperationLog 投影） */
export interface LeadOperationLog {
  id: string;
  userId?: string | null;
  username: string;
  realName?: string | null;
  /** CREATE / UPDATE / DELETE / CLAIM / RELEASE / TRANSFERRED ... */
  action: string;
  module?: string | null;
  businessType?: string | null;
  businessId?: string | null;
  businessNo?: string | null;
  summary?: string | null;
  /** 字段级变更明细 JSON：[{field,label,beforeText,afterText}] */
  diff?: string | null;
  createdAt: string;
}

export interface LeadListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: string;
  platform?: string;
  status?: LeadStatus;
  source?: LeadSource;
  /** 按负责人筛选（V1.0 canonical；服务端只读 ownerId） */
  ownerId?: string;
  scope?: 'mine' | 'pool';
  /** 排序（白名单，格式 字段:方向，如 createdAt:desc） */
  sort?: string;
}

export const leadApi = {
  list: (params: LeadListParams = {}) =>
    axios
      .get<{ code: number; data: { list: Lead[]; total: number; page: number; pageSize: number } }>('/leads', {
        params,
      })
      .then((r) => r.data),
  get: (id: string) => axios.get<{ code: number; data: Lead }>(`/leads/${id}`).then((r) => r.data),
  /** 线索操作记录（操作日志，按时间倒序） */
  getLogs: (id: string) =>
    axios.get<{ code: number; data: LeadOperationLog[] }>(`/leads/${id}/logs`).then((r) => r.data),
  create: (payload: LeadPayload) =>
    axios.post<{ code: number; data: Lead }>('/leads', payload).then((r) => r.data),
  update: (id: string, payload: Partial<LeadPayload>) =>
    axios.put<{ code: number; data: null }>(`/leads/${id}`, payload).then((r) => r.data),
  delete: (id: string) => axios.delete<{ code: number; data: null }>(`/leads/${id}`).then((r) => r.data),
  // 注：状态变更接口已下线（状态只由单据事件推进），故不再提供 changeStatus
  transfer: (id: string, newOwnerId: string) =>
    axios.post<{ code: number; data: null }>(`/leads/${id}/transfer`, { newOwnerId }).then((r) => r.data),
  release: (id: string) =>
    axios.post<{ code: number; data: null }>(`/leads/${id}/release`).then((r) => r.data),
  claim: (id: string) =>
    axios.post<{ code: number; data: null }>(`/leads/${id}/claim`).then((r) => r.data),
};
