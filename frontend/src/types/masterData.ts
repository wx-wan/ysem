/**
 * Shared Master Data 类型（Round F-4）
 *
 * 原则：字段**只**来自后端真实存在者（prisma schema + controller 实际 select / 返回），
 * 不臆造字段、不声明后端不返回的属性。日期经 JSON 序列化为 ISO 字符串。
 *
 * 依据：
 *   · prisma/schema/03-customer.prisma  CustomerType(L166) / Channel(L144)
 *   · prisma/schema/04-product.prisma   Certificate(L243) / ProductCraft(L84) /
 *                                       ProductAudience(L113) / ProductCategory(L126)
 *   · controllers/product.controller.ts getProductOptions → select { id, name, sku }
 *   · controllers/customer.controller.ts getCountries    → string[]
 *   · controllers/user.controller.ts   getUsersForSelect → select { id, username, realName }
 */

/** 主数据启停状态（prisma enum MasterStatus） */
export type MasterStatus = 'ACTIVE' | 'INACTIVE';

/** 客户类型（GET /api/customer-types/active：后端已过滤 isActive === true） */
export interface CustomerType {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 渠道 / 平台（GET /api/channels/tree：后端返回**未过滤**的完整树，
 * 含 status === 'INACTIVE' 节点 —— 消费方必须经 filterActiveChannels() 收敛）。
 */
export interface Channel {
  id: string;
  name: string;
  /** ONLINE | OFFLINE */
  category: string;
  parentId: string | null;
  contact: string | null;
  status: MasterStatus;
  sort: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  /** 由 tree 接口组装 */
  children: Channel[];
}

/** 证书字典（GET /api/certificates：后端无启停过滤，前端**不得**自行过滤） */
export interface Certificate {
  id: string;
  name: string;
  code: string | null;
  issuer: string | null;
  category: string | null;
  validUntil: string | null;
  status: MasterStatus;
  logo: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 基础工艺（GET /api/product/taxonomy/crafts） */
export interface ProductCraft {
  id: string;
  name: string;
  code: string | null;
  sort: number;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

/** 目标人群（GET /api/product/taxonomy/audiences） */
export interface ProductAudience {
  id: string;
  name: string;
  code: string | null;
  sort: number;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

/** 三级产品品类（GET /api/product/taxonomy/categories） */
export interface ProductCategory {
  id: string;
  name: string;
  audienceId: string;
  sort: number;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

/** 产品选项（GET /api/products/options：后端已做产品可见性过滤，前端不得放宽） */
export interface ProductOption {
  id: string;
  name: string;
  sku: string;
}

/** 国家/地区字典项（GET /api/customers/countries 返回 string[]，元素即国家名） */
export type Country = string;

/**
 * 通用「选人」选项（GET /api/users/select: { id, username, realName }）
 *
 * ⚠️ **This endpoint is NOT a valid owner-assignment candidate source.**
 * F-01（F-4A）已冻结：该接口不应用 dataScope、返回集含非 ACTIVE（LOCKED）用户、
 * 且不返回 status 字段 ⇒ 其返回集不是后端允许指派集合的子集，前端无法收敛。
 * 仅可用于**通用展示型选人**（如产品可见人员等），**禁止**用于 Customer / Lead / Sales
 * 的 owner 指派；owner 候选源等待后端 owner-candidate API。
 */
export interface UserSelectOption {
  id: string;
  username: string;
  realName: string;
}

/** 分页响应 data 形状（后端 success(res, { list, total, page, pageSize })） */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}
