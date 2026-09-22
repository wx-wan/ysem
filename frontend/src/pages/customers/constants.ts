import type { CustomerLevel, CustomerListType } from '../../types/customer';

/**
 * Customer List UI 常量（Round F-6）
 *
 * 说明：`CustomerListType` 的取值**复用 F-5 类型**，此处只补 UI label，不重新复制字符串定义。
 */

export type CustomerViewMode = 'my' | 'public' | 'all';

export interface ViewOption {
  value: CustomerViewMode;
  label: string;
}

/**
 * 视图可见性（**UI 视图选择，不是安全授权**）：
 *   · 后端 Customer 路由无统一 requirePerm（F-0），因此不能用 hasPerm('customers') 判断可访问性；
 *   · 当前阶段规则：admin → my / public / all；非 admin → my / public；
 *   · /all 是管理员口径（含 ownerStats 等全局统计），非 admin 请求即便返回 200 也不符合产品语义，
 *     故在 UI 层不提供入口；后端始终是最终权威。
 */
export const VIEW_OPTIONS: ViewOption[] = [
  { value: 'my', label: '我的客户' },
  { value: 'public', label: '公海' },
  { value: 'all', label: '全部客户' },
];

export const ADMIN_VIEWS: CustomerViewMode[] = ['my', 'public', 'all'];
export const NON_ADMIN_VIEWS: CustomerViewMode[] = ['my', 'public'];

export const DEFAULT_VIEW: CustomerViewMode = 'my';

/** 分页（后端无统一 pageSize 上限 ⇒ 前端自行限制，禁止发送 1000/10000） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 哪个视图支持哪些筛选（与 F-5 Query 类型一一对应，不多发参数） */
export const VIEW_FILTER_CAPABILITY: Record<CustomerViewMode, { type: boolean; ownerId: boolean }> = {
  my: { type: true, ownerId: false },
  public: { type: false, ownerId: false },
  all: { type: true, ownerId: false }, // ownerId 后端支持，但 F-01 冻结 ⇒ 本轮 UI 不实现
};

/**
 * `type` 筛选项（值必须与后端分支一致）。
 * 注意：后端还接受 `type=public`（公海），该语义已由「公海」视图承载，故不在下拉中重复提供。
 */
export const TYPE_FILTER_OPTIONS: { value: CustomerListType; label: string }[] = [
  { value: 'key', label: '重点客户' },
  { value: 'noOrder', label: '无订单' },
  { value: 'noOrder-none', label: '无订单 · 待开发' },
  { value: 'noOrder-A', label: '无订单 · A（准成交）' },
  { value: 'noOrder-B', label: '无订单 · B（高意向）' },
  { value: 'noOrder-C', label: '无订单 · C（中意向）' },
  { value: 'noOrder-D', label: '无订单 · D（低意向）' },
  { value: 'done', label: '已成交' },
  { value: 'done-new', label: '已成交 · 新客户' },
  { value: 'done-old', label: '已成交 · 老客户' },
];

export const VALID_TYPES: CustomerListType[] = TYPE_FILTER_OPTIONS.map((o) => o.value);

/** 意向等级展示（后端 IntentLevel 枚举） */
export const INTENT_LABEL: Record<string, string> = {
  READY: '准成交',
  HIGH: '高意向',
  MEDIUM: '中意向',
  LOW: '低意向',
};

export const INTENT_COLOR: Record<string, string> = {
  READY: 'red',
  HIGH: 'volcano',
  MEDIUM: 'gold',
  LOW: 'default',
};

export const isViewMode = (value: string | null): value is CustomerViewMode =>
  value === 'my' || value === 'public' || value === 'all';

export const getViewLabel = (view: CustomerViewMode): string =>
  VIEW_OPTIONS.find((o) => o.value === view)?.label ?? '我的客户';

/* ============ 详情页展示标签（Round F-7）——键均为后端真实枚举值 ============ */

/** SalesOrderStatus（prisma 00-enums） */
export const SALES_ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  DEPOSIT_PENDING: '待定金',
  DEPOSIT_PAID: '定金已付',
  IN_PRODUCTION: '生产中',
  QC: '质检中',
  READY_TO_SHIP: '待出运',
  SHIPPED: '已出运',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const SALES_ORDER_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default',
  CONFIRMED: 'blue',
  DEPOSIT_PENDING: 'gold',
  DEPOSIT_PAID: 'cyan',
  IN_PRODUCTION: 'processing',
  QC: 'geekblue',
  READY_TO_SHIP: 'orange',
  SHIPPED: 'purple',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

/** OpportunityOutcome（prisma 00-enums） */
export const OPPORTUNITY_OUTCOME_LABEL: Record<string, string> = {
  OPEN: '进行中',
  WON: '赢单',
  LOST: '输单',
};

export const OPPORTUNITY_OUTCOME_COLOR: Record<string, string> = {
  OPEN: 'processing',
  WON: 'green',
  LOST: 'red',
};

/** CustomerLevel（prisma 00-enums） */
export const CUSTOMER_LEVEL_LABEL: Record<string, string> = {
  DIAMOND: '钻石客户',
  STRATEGIC: '战略客户',
  PREMIUM: '优质客户',
  NORMAL: '普通客户',
  POTENTIAL: '潜在客户',
};

/** LeadSource（prisma 00-enums） */
export const LEAD_SOURCE_LABEL: Record<string, string> = {
  MANUAL: '手工录入',
  EXCEL: 'Excel 导入',
  RPA: 'RPA 抓取',
  SYNC: '第三方同步',
};

/** CustomerActivity.action（controller 写入的真实取值） */
export const ACTIVITY_ACTION_LABEL: Record<string, string> = {
  CREATED: '创建',
  UPDATED: '更新',
  CLAIM: '认领',
  RELEASE: '释放',
  TRANSFERRED: '转交',
  KEY_TOGGLE: '重点客户变更',
  INTENT_CHANGE: '意向变更',
};

/** 后端详情对 activities 的取值上限（controller: take 50） */
export const ACTIVITY_TAKE_LIMIT = 50;

/* ============ F-8：Create/Edit 选项与读侧文案（键 = 后端真实枚举值） ============ */

/** 客户等级选项（**Edit 可用；Create 不开放** —— D-CUSTOMER-LEVEL：create 固定 NORMAL） */
export const CUSTOMER_LEVEL_OPTIONS: { value: CustomerLevel; label: string }[] = [
  { value: 'DIAMOND', label: '钻石客户' },
  { value: 'STRATEGIC', label: '战略客户' },
  { value: 'PREMIUM', label: '优质客户' },
  { value: 'NORMAL', label: '普通客户' },
  { value: 'POTENTIAL', label: '潜在客户' },
];

/**
 * 无意向文案（D-INTENT v2 / F-8C 单一来源）
 *
 * Customer.intentLevel 为后端**只读派生值**（= 该客户全部 Opportunity.intentLevel 的最高等级）；
 * 无商机 / 全部商机无意向 ⇒ null，前端统一显示本文案。
 * 供 CustomerTable / CustomerDetailPage / CustomerStats 复用。
 */
export const NO_INTENT_LABEL = '无意向';

/** 字段实体消歧（IC-FE-3）：Customer.intentLevel 与 Opportunity.intentLevel 是两个实体 */
export const CUSTOMER_INTENT_LABEL = '客户意向';
export const OPPORTUNITY_INTENT_LABEL = '商机意向';

/** IC-FE-4：pipelineAmount = 全部商机 estimatedAmount 汇总（含 OPEN/WON/LOST，不过滤 outcome） */
export const PIPELINE_AMOUNT_COLUMN_TITLE = '商机金额合计（含赢单/输单）';

/** IC-FE-6：stats 与 filter 当前非同一口径（后端未统一，属 DEFERRED/B-2） */
export const STATS_SCOPE_NOTE = '统计卡片为独立统计口径，与当前筛选条件的结果不一定一致。';
export const TYPE_FILTER_SCOPE_NOTE = '类型筛选依据客户订单记录与商机意向判定，与统计卡片口径不同。';

/** IC-FE-2：status 字段当前无流转规则（后端无写入方/无过滤），不得暗示状态机 */
export const STATUS_NO_WORKFLOW_NOTE = '（无流转功能）';

/* IC-FE-1：lastOrderAt / totalOrderAmountCny 为后端死列（src/ 全仓零引用），
   前端禁止读取/展示 —— 已在 types/customer.ts 标注并在 CustomerDetailPage 移除消费。 */
