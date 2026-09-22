import type { ApiResponse } from './request';
import request from './request';
import { unwrapArray } from '../utils/response';
import type {
  Certificate,
  Channel,
  Country,
  CustomerType,
  ProductAudience,
  ProductCategory,
  ProductCraft,
  ProductOption,
  UserSelectOption,
} from '../types/masterData';

/**
 * Shared Master Data API（Round F-4 §8-§16）
 *
 * 只封装**后端当前真实存在**的 GET 端点（F-4A 审计结论），共 9 个：
 *   GET /api/customer-types/active        → CustomerType[]      （后端已过滤 isActive）
 *   GET /api/channels/tree                → Channel[]（树）      （后端**未**过滤 status）
 *   GET /api/customers/countries          → string[]            （无 dataScope，字典用途）
 *   GET /api/certificates                 → Certificate[]       （后端无启停过滤）
 *   GET /api/product/taxonomy/crafts      → ProductCraft[]
 *   GET /api/product/taxonomy/audiences   → ProductAudience[]
 *   GET /api/product/taxonomy/categories  → ProductCategory[]
 *   GET /api/products/options             → ProductOption[]     （后端已做产品可见性过滤）
 *   GET /api/users/select                 → UserSelectOption[]  （⚠️ 非 owner 候选源，见下）
 *
 * 权限：以上端点均只要求 authenticate；除 /api/users 外均无 requirePerm。
 * 说明：本层**不改动任何后端语义**（不过滤、不放宽可见性、不转换业务含义）。
 */

/** 原始请求（保留在 masterDataApi 中便于需要信封的业务使用） */
export const masterDataApi = {
  customerTypes: () => request.get<ApiResponse<CustomerType[]>>('/customer-types/active'),
  channelsTree: () => request.get<ApiResponse<Channel[]>>('/channels/tree'),
  countries: () => request.get<ApiResponse<Country[]>>('/customers/countries'),
  certificates: () => request.get<ApiResponse<Certificate[]>>('/certificates'),
  productCrafts: () => request.get<ApiResponse<ProductCraft[]>>('/product/taxonomy/crafts'),
  productAudiences: () => request.get<ApiResponse<ProductAudience[]>>('/product/taxonomy/audiences'),
  productCategories: () => request.get<ApiResponse<ProductCategory[]>>('/product/taxonomy/categories'),
  productOptions: () => request.get<ApiResponse<ProductOption[]>>('/products/options'),
  userSelectOptions: () => request.get<ApiResponse<UserSelectOption[]>>('/users/select'),
};

/** 客户类型（语义 = 后端已过滤 isActive === true，前端不得再改变） */
export const getCustomerTypes = async (): Promise<CustomerType[]> =>
  unwrapArray(await masterDataApi.customerTypes(), 'GET /customer-types/active');

/**
 * 渠道树（**原始未过滤**）
 * 消费方若需要「可选中的有效渠道」，必须调用 filterActiveChannels()（utils/masterData.ts）。
 */
export const getChannelsTree = async (): Promise<Channel[]> =>
  unwrapArray(await masterDataApi.channelsTree(), 'GET /channels/tree');

/** 国家字典（string[]；UI 的 {label,value} 映射由组件层负责） */
export const getCountries = async (): Promise<Country[]> =>
  unwrapArray(await masterDataApi.countries(), 'GET /customers/countries');

/** 证书字典（不做 isActive 过滤 —— 后端无该语义） */
export const getCertificates = async (): Promise<Certificate[]> =>
  unwrapArray(await masterDataApi.certificates(), 'GET /certificates');

/** 基础工艺 */
export const getProductCrafts = async (): Promise<ProductCraft[]> =>
  unwrapArray(await masterDataApi.productCrafts(), 'GET /product/taxonomy/crafts');

/** 目标人群 */
export const getProductAudiences = async (): Promise<ProductAudience[]> =>
  unwrapArray(await masterDataApi.productAudiences(), 'GET /product/taxonomy/audiences');

/** 三级品类 */
export const getProductCategories = async (): Promise<ProductCategory[]> =>
  unwrapArray(await masterDataApi.productCategories(), 'GET /product/taxonomy/categories');

/** 产品选项（后端已按可见性过滤：admin / PUBLIC / 自建 PRIVATE / 被指定 —— 前端不得放宽） */
export const getProductOptions = async (): Promise<ProductOption[]> =>
  unwrapArray(await masterDataApi.productOptions(), 'GET /products/options');

/**
 * 通用「选人」列表（GET /api/users/select）—— **generic user select only**
 *
 * ⚠️ **This endpoint is NOT a valid owner-assignment candidate source.**
 * F-01（F-4A）冻结原因：无 dataScope、返回集含非 ACTIVE（LOCKED）用户、且不返回 status，
 * 因此其返回集不是后端「允许指派集合」的子集，前端**无法**收敛为合法 owner 列表。
 * 禁止用于 Customer / Lead / Sales 的 owner 指派（亦禁止以「owner 候选集」语义重新包装本接口）；
 * owner 候选源等待后端 owner-candidate API（F-01 Option C）。
 */
export const getUserSelectOptions = async (): Promise<UserSelectOption[]> =>
  unwrapArray(await masterDataApi.userSelectOptions(), 'GET /users/select');
