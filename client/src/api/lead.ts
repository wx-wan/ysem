import axios from './request';
import type { ProductImageItem } from '../utils/productImages';

export type LeadSource = 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
/**
 * 线索状态（4 态，与后端 LeadStatus 一致）。
 * 状态由单据事件自动推进，前端**不得**主动写入：
 * NEW 新线索 / CONFIRMED 已确认（已绑定商机）/ SAMPLED 已打样 / WON 已成交。
 */
export type LeadStatus = 'NEW' | 'CONFIRMED' | 'SAMPLED' | 'WON';

/**
 * 线索关联的客户（后端 `LEAD_CUSTOMER_SELECT` 投影）。
 * 注意：只有这 6 个字段；`contactMethods` / `customerType` 等需经 `customerApi.getById` 取完整档案。
 */
export interface LeadCustomer {
  id: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  customerType?: string | null;
  contactMethods?: { tool: string; account: string }[] | null;
  // 来源不变量：一个客户只有一种来源 —— 线索来源以其客户来源为唯一权威
  channelId?: string | null;
  shopId?: string | null;
}

/**
 * 线索（V1.1 · lead-fk-only 后的**只读**形状）。
 *
 * 客户信息一律取 `customer.*`（线索不再持有 companyName / contactName / contactMethods /
 * email / phone / country / customerType）；产品信息一律取 `items[].product.*`
 * （线索明细不再持有 productName / craftIds / audienceId / categoryId / 长宽高 / 克重）；
 * 数量取 `items[].quantity`（Lead 标量 quantity 已下线）。
 */
export interface Lead {
  id: string;
  leadNo?: string | null; // 线索编号 XS-yyyyMM-####（V1.0 canonical 字段名）
  leadName: string;
  customerId?: string | null;
  customer?: LeadCustomer | null;
  source: LeadSource;
  status: LeadStatus;
  productInterest?: string | null;
  remark?: string | null;
  // 详情扩展字段（线索级需求）
  targetMarket?: string | null;
  productDesc?: string | null; // 兼容旧取值（Lead 标量，已废弃；真实值见 items[0].productDesc）
  images?: string[] | string | null; // 兼容旧取值（已废弃；真实值见 attachments）
  // F-8L-B：来源渠道 / 来源平台（channelId/shopId → Channel 自关联树）
  channelId?: string | null;
  channel?: { id: string; name: string } | null;
  shopId?: string | null;
  shop?: { id: string; name: string } | null;
  /** 采购产品明细（V1.1：只含产品外键 + 意向数量 + 线索级「客户具体要求」） */
  items?: Array<{
    id: string;
    productId?: string | null;
    product?: { id: string; name: string } | null;
    quantity?: number;
    productDesc?: string | null;
  }>;
  // D1：参考图片附件（Attachment ownerType=LEAD）
  attachments?: Array<{ id: string; url: string; name?: string | null; category?: string; sort?: number }>;
  targetPrice?: string | null;
  /** 建档美元汇率快照：1 USD = X CNY（建档时由后端抓取当日汇率落库，与线索币种无关，只读） */
  usdRate?: number | null;
  expectedDelivery?: string | null;
  /** 当前进行到的向导阶段（0 客户信息 / 1 需求详情 / 2 确认商机）：暂存时记录，详情据此决定展示「编辑」或「确认」 */
  stage?: number | null;
  currency?: string | null; // 币种（CurrencyRate.code），目标价位前缀
  unit?: string | null; // 单位（Unit.name），数量需求后缀，默认 个
  /** 负责人 ID（V1.0 canonical 归属/请求字段） */
  ownerId?: string | null;
  /** 负责人（后端 owner relation；显示优先使用） */
  owner?: { id: string; username: string; realName: string | null } | null;
  /** 草稿标记：暂存场景为 true，已建档 / 正式提交为 false（用于区分「草稿态关联了客户」与「已正式建档锁定」） */
  draft?: boolean | null;
  /** 客户信息阶段是否已锁定（建档后锁定）：详情打开时直接复现，避免关掉后锁定状态丢失 */
  customerLocked?: boolean | null;
  /** 需求详情阶段是否已锁定（建档后锁定）：详情打开时直接复现 */
  productLocked?: boolean | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 关联商机 ID（页面跳转 / 溯源用）。
   * 注意：后端线索接口当前**不返回**该字段（V1.0 起真实外键在 `Opportunity.leadId` 一侧），
   * 保留声明以兼容既有调用点；如需真实溯源应由后端补投影。
   */
  pipelineId?: string | null;
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
  /** 客户公司名：**建档入参**（后端归一匹配既有客户，命中复用否则建档，并回填 customerId） */
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
  productDesc?: string | null;
  images?: { url: string; name?: string }[] | null;
  targetPrice?: string | null;
  expectedDelivery?: string | null;
  customerType?: string | null;
  /** 产品分类与规格：**建档入参**（后端写入 Product，不再落线索表） */
  craftIds?: string[];
  audienceId?: string | null;
  categoryId?: string | null;
  sizeL?: number | null;
  sizeW?: number | null;
  sizeH?: number | null;
  weight?: number | null;
  /** 当前进行到的向导阶段（0 客户信息 / 1 需求详情 / 2 确认商机）：暂存时记录，详情据此决定展示「编辑」或「确认」 */
  stage?: number | null;
  currency?: string | null; // 币种（CurrencyRate.code），目标价位前缀
  unit?: string | null; // 单位（Unit.name），数量需求后缀，默认 个
  /** 负责人 ID（V1.0 canonical 请求字段） */
  ownerId?: string | null;
  /** 草稿标记：暂存场景为 true，后端放宽联系方式等必填约束，允许空必填创建草稿线索（不落库） */
  draft?: boolean;
  /** 客户信息阶段是否已锁定（建档后锁定） */
  customerLocked?: boolean;
  /** 需求详情阶段是否已锁定（建档后锁定） */
  productLocked?: boolean;
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
  /** 按关联产品过滤（命中 LeadItem.productId） */
  productId?: string;
  /** 按负责人筛选（V1.0 canonical；服务端只读 ownerId） */
  ownerId?: string;
  /**
   * 列表范围：`mine`=我的；`pool`=公海（无负责人）；`all`=全部已归属线索（**管理员专用**，
   * 非管理员传 `all` 服务端按角色数据范围处理，不会返回全量）。
   */
  scope?: 'mine' | 'all' | 'pool';
  /** 排序（白名单，格式 字段:方向，如 createdAt:desc） */
  sort?: string;
}

/**
 * 「确认线索」入参（`POST /api/leads/:id/confirm`）。
 * 客户与来源线索由服务端从线索派生，**客户端不传也不可指定**。
 */
export interface LeadConfirmPayload {
  title: string;
  estimatedAmount?: number | null;
  estimatedCloseDate?: string | null;
  intentLevel?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  products?: { productId: string; quantity?: number }[] | null;
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
  /**
   * 确认线索 → 创建商机（**商机唯一创建入口**）。
   * 规则：商机不支持创建，只可由线索创建 —— 客户与来源线索由服务端从线索派生，
   * 故入参不含 `customerId` / `leadId`；成功后后端自动把线索推进为「已确认」。
   */
  confirm: (id: string, payload: LeadConfirmPayload) =>
    axios.post<{ code: number; data: unknown }>(`/leads/${id}/confirm`, payload).then((r) => r.data),
};
