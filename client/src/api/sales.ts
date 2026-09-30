import axios from './request';

/**
 * 商机阶段：**不落库**，由后端按关联单据派生（server/src/utils/pipelineStage.ts），只读展示。
 */
export type OpportunityStage =
  | 'OPPORTUNITY'
  | 'QUOTED'
  | 'SAMPLE'
  | 'PRODUCTION'
  | 'SHIPPED'
  | 'ORDER';

/** 客户意向等级（Opportunity.intentLevel） */
export type IntentLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'READY';

/** 商机明细行（OpportunityItem：产品快照 + 意向数量） */
export interface OpportunityItemLine {
  id: string;
  productId?: string | null;
  /** 建档时落库的产品名快照 */
  productName?: string | null;
  quantity?: number | null;
  /** 可见性投影后的产品（PRIVATE 且不可见时为 null） */
  product?: { id: string; name: string; sku?: string | null } | null;
}

/**
 * 商机（Opportunity）—— `GET /api/sales`、`GET /api/sales/:id` 的真实返回形状。
 *
 * 后端直接透传 Prisma payload（含 owner / customer / lead / channel / shop / items 六个关联）
 * 并注入派生字段 `stage`。**没有**顶层 `companyName` / `contactName` / `email` / `phone` /
 * `country` / `source`：公司信息一律取 `customer.*`，负责人一律取 `owner.*`。
 *
 * 金额类字段（estimatedAmount / exchangeRate / probability）为 Prisma Decimal，
 * JSON 序列化后是**字符串**（如 "1234.0000"），参与计算前必须 `Number()`。
 */
export interface SalesItem {
  id: string;
  /** 商机编号 OPP-yyyyMMdd-0001 */
  opportunityNo?: string | null;
  title: string;
  /** 派生阶段：列表 / 详情 / by-product 返回时存在；by-customer 与写接口返回时不存在 */
  stage?: OpportunityStage | string | null;
  customerId: string;
  customer?: { id: string; companyName: string; contactName?: string | null } | null;
  leadId?: string | null;
  lead?: { id: string; leadNo?: string | null; leadName?: string | null } | null;
  estimatedAmount?: number | string | null;
  currency?: string | null;
  exchangeRate?: number | string | null;
  estimatedCloseDate?: string | null;
  intentLevel?: IntentLevel | null;
  /** 成交概率 0~100（Decimal → 字符串） */
  probability?: number | string | null;
  notes?: string | null;
  ownerId?: string | null;
  owner?: { id: string; username: string; realName?: string | null } | null;
  /** 来源渠道 / 平台：线索转商机时服务端从 Lead 派生，创建后不可修改 */
  channelId?: string | null;
  channel?: { id: string; name: string } | null;
  shopId?: string | null;
  shop?: { id: string; name: string } | null;
  items?: OpportunityItemLine[];
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

/**
 * 商机可写字段形状（作为更新入参的基类）。
 * 注：商机**已无独立创建入口** —— 创建只发生在「线索确认」（`leadApi.confirm`）。
 */
export interface OpportunityCreatePayload {
  customerId: string;
  leadId: string;
  title: string;
  estimatedAmount?: number | null;
  estimatedCloseDate?: string | null;
  intentLevel?: IntentLevel | null;
  notes?: string | null;
  ownerId?: string | null;
  /** 关联产品明细；服务端按可见性校验并落 productName 快照 */
  products?: { productId: string; quantity?: number }[] | null;
  /** 兼容旧契约的字段，服务端**不采信**（渠道一律由 Lead 派生） */
  channelId?: string | null;
  shopId?: string | null;
}

/** 更新入参：`leadId` / `channelId` / `shopId` 不可修改（提交即 400） */
export type OpportunityUpdatePayload = Partial<
  Omit<OpportunityCreatePayload, 'leadId' | 'channelId' | 'shopId'>
>;

/**
 * `GET /api/sales/by-product/:productId` 的**扁平投影**（与列表 / 详情形状不同：
 * 无 customer / owner 嵌套、无 createdAt，公司名与负责人被提平成顶层字段）。
 */
export interface ProductOpportunityItem {
  id: string;
  opportunityNo?: string | null;
  title: string;
  companyName?: string | null;
  contactName?: string | null;
  /** 派生阶段（后端同时回填到 status，语义与 stage 相同） */
  stage?: OpportunityStage | string | null;
  status?: OpportunityStage | string | null;
  estimatedAmount?: number | string | null;
  amountCNY?: number | string | null;
  /** 该产品在此商机下的意向数量合计 */
  quantity?: number | null;
  /** 更新时间（该接口不返回 createdAt） */
  updateTime?: string | null;
  assignee?: { id: string; username: string; realName?: string | null } | null;
}

// 阶段配色统一由 components/sales/stages.ts 提供（STAGE_META / getStageMeta）
// 阶段为后端派生值，仅用于展示，不支持手动修改。

export const salesApi = {
  // 列表
  list: (params: Record<string, string>, signal?: AbortSignal) =>
    axios.get<{ data: { list: SalesItem[]; total: number; page: number; pageSize: number } }>('/sales', {
      params,
      signal,
    }),

  // 详情
  get: (id: string) => axios.get<{ data: SalesItem }>(`/sales/${id}`),

  // 商机**不支持创建**：`POST /api/sales` 已下线，唯一创建入口是「线索确认」
  // （`leadApi.confirm` ← `POST /api/leads/:id/confirm`，见 utils/convertLead.ts）。

  // 更新
  update: (id: string, data: OpportunityUpdatePayload) => axios.put<{ data: SalesItem }>(`/sales/${id}`, data),

  // 删除
  delete: (id: string) => axios.delete(`/sales/${id}`),

  // 批量删除
  batchDelete: (ids: string[]) => axios.delete('/sales/batch', { data: { ids } }),

  // 商机不支持 Excel 导入（`POST /api/sales/import` 已下线，唯一来源为「线索转商机」）

  // 获取可分配用户
  getAssignUsers: () => axios.get<{ data: { id: string; realName: string; username: string }[] }>('/sales/assign-users'),

  // 按客户查询商机（后端返回未 include 的原始商机，无 stage）
  listByCustomer: (customerId: string) => axios.get<{ data: SalesItem[] }>(`/sales/by-customer/${customerId}`),

  // 按产品查询商机记录（返回扁平投影，见 ProductOpportunityItem）
  listByProduct: (productId: string) =>
    axios.get<{ data: { list: ProductOpportunityItem[]; total: number } }>(`/sales/by-product/${productId}`),
};
