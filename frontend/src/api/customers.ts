import type { ApiResponse } from './request';
import request from './request';
import { unwrapArray, unwrapPageWithExtras, unwrapResponse } from '../utils/response';
import type {
  CustomerAllQuery,
  CustomerAllResponse,
  CustomerBase,
  CustomerCreateRequest,
  CustomerDetail,
  CustomerMyQuery,
  CustomerMyResponse,
  CustomerOption,
  CustomerPublicQuery,
  CustomerPublicResponse,
  CustomerReport,
  CustomerUpdateRequest,
} from '../types/customer';

/**
 * Customer API（Round F-5）
 *
 * 只封装后端**当前真实存在**的 GET 端点（本轮不做 create / update / remove / claim /
 * release / transfer / tags / import）：
 *   GET /api/customers/my      → 我的私海（含公海）+ 统计
 *   GET /api/customers/public  → 公海
 *   GET /api/customers/all     → 管理员全集 + ownerStats
 *   GET /api/customers/:id     → 详情（owner / salesOrders / opportunities / activities）
 *   GET /api/customers/report  → 管道与转化统计
 *
 * 已由 F-4 提供、此处**不重复实现**：getCountries()、getCustomerTypes()（见 api/masterData.ts）。
 *
 * owner 边界（F-01）：本文件不涉及 owner 候选集，也不调用通用选人接口（masterData 层）。
 * 归属写入属 F-7/F-8，且在后端 owner-candidate API 落地前保持 BLOCKED。
 */

/** 去掉 undefined / null / 空字符串（后端以 `if (keyword)` 判空 ⇒ 空串与缺省等价），避免 ?keyword=undefined */
const toParams = <Q extends object>(query?: Q): Record<string, string | number> => {
  const params: Record<string, string | number> = {};
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }
  return params;
};

/**
 * 原始请求（保留在 customerApi 中，便于需要信封的场景）
 *
 * 读侧 5 个 GET 与 F-5 完全一致（**未改变任何 contract**）；写侧为 F-8 新增：
 *   POST /api/customers        → 创建（后端 create）
 *   PUT  /api/customers/:id    → 更新（后端 update）
 * 方法/路径严格取自 server/src/routes/customer.routes.ts（post "/"、put "/:id"）。
 */
export const customerApi = {
  my: (params?: CustomerMyQuery) => request.get<ApiResponse<CustomerMyResponse>>('/customers/my', { params: toParams(params) }),
  public: (params?: CustomerPublicQuery) => request.get<ApiResponse<CustomerPublicResponse>>('/customers/public', { params: toParams(params) }),
  all: (params?: CustomerAllQuery) => request.get<ApiResponse<CustomerAllResponse>>('/customers/all', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<CustomerDetail>>(`/customers/${encodeURIComponent(id)}`),
  report: () => request.get<ApiResponse<CustomerReport>>('/customers/report'),
  create: (payload: CustomerCreateRequest) => request.post<ApiResponse<CustomerBase>>('/customers', payload),
  update: (id: string, payload: CustomerUpdateRequest) =>
    request.put<ApiResponse<CustomerBase>>(`/customers/${encodeURIComponent(id)}`, payload),
  /**
   * F-S2 additive：客户选项（GET /api/customers/options）—— 后端**既有**端点，仅补前端绑定。
   * 不改变任何 Customer 契约/业务规则；返回数组（后端无分页），已按 roleScope 过滤。
   */
  options: () => request.get<ApiResponse<CustomerOption[]>>('/customers/options'),
};

/** 我的客户（/my）：分页 + stats + 子筛选计数 + 金额聚合，**保留全部统计字段** */
export const getMyCustomers = async (params?: CustomerMyQuery): Promise<CustomerMyResponse> =>
  unwrapPageWithExtras(await customerApi.my(params), 'GET /customers/my');

/** 公海客户（/public）：仅分页（后端不返回统计字段，前端不臆造） */
export const getPublicCustomers = async (params?: CustomerPublicQuery): Promise<CustomerPublicResponse> =>
  unwrapPageWithExtras(await customerApi.public(params), 'GET /customers/public');

/** 全部客户（/all）：分页 + ownerStats + publicCount + 两套 stats + 金额聚合 */
export const getAllCustomers = async (params?: CustomerAllQuery): Promise<CustomerAllResponse> =>
  unwrapPageWithExtras(await customerApi.all(params), 'GET /customers/all');

/** 客户详情（/:id）：不可见 / 不存在时后端返回 404「客户不存在」，错误正常向上抛（不吞成 null） */
export const getCustomer = async (id: string): Promise<CustomerDetail> =>
  unwrapResponse(await customerApi.detail(id), 'GET /customers/:id').data;

/** 客户报表（/report）：与 list stats 形状不同，独立结构 */
export const getCustomerReport = async (): Promise<CustomerReport> =>
  unwrapResponse(await customerApi.report(), 'GET /customers/report').data;

/**
 * 创建客户（POST /api/customers）
 *
 * F-8 冻结：payload **仅**接受 CustomerCreateRequest 的字段（类型层面即禁止提交
 * customerLevel / firstOrderAt / englishName / position / wechat / region）。
 * ownerId 仅允许 undefined（归当前用户）或 null（公海）—— 指定其他用户属 F-01 BLOCKED。
 */
export const createCustomer = async (payload: CustomerCreateRequest): Promise<CustomerBase> =>
  unwrapResponse(await customerApi.create(payload), 'POST /customers').data;

/**
 * 更新客户（PUT /api/customers/:id）
 *
 * ownerId：不传 = 保持当前归属；null = 移入公海（不得指定其他用户，F-01）。
 * 未传字段后端保持原值。
 * D-INTENT v2（F-8C）：Customer.intentLevel **不是可写字段** —— 由关联 Opportunity.intentLevel
 * 在后端**读取时派生**（无商机 / 全部商机无意向 ⇒ null）⇒ 请求体中不再出现 intentLevel。
 */
export const updateCustomer = async (id: string, payload: CustomerUpdateRequest): Promise<CustomerBase> =>
  unwrapResponse(await customerApi.update(id, payload), 'PUT /customers/:id').data;

/**
 * 客户选项列表（GET /api/customers/options）—— **F-S2 additive**
 *
 * 用途：商机创建/编辑时的「客户」选择数据源（F-S2）。
 * 语义：后端按 `roleScope(req)` 过滤，**无分页**、无 keyword 参数；返回 { id, companyName, contactName, … }。
 * 边界：不改变任何 Customer 契约/业务规则；前端不得据此放宽可见性（后端始终是权威）。
 * （F-4A 已判定 customerOptions 为 page-level 数据集 ⇒ 不进入 master data store，由页面按需加载。）
 */
export const getCustomerOptions = async (): Promise<CustomerOption[]> =>
  unwrapArray(await customerApi.options(), 'GET /customers/options');
