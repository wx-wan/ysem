import request from './request';

// ============ 产品分类 Taxonomy ============

export interface ProductCraft {
  id: string;
  name: string;
  sort: number;
  status: number;
}

export interface ProductCategory {
  id: string;
  name: string;
  audienceId: string;
  audience?: { id: string; name: string };
  sort: number;
  status: number;
}

export interface ProductAudience {
  id: string;
  name: string;
  sort: number;
  status: number;
  categories?: ProductCategory[];
}

export const taxonomyApi = {
  // 工艺
  getCrafts: () => request.get<ProductCraft[]>('/product/taxonomy/crafts'),
  createCraft: (data: Partial<ProductCraft>) => request.post('/product/taxonomy/crafts', data),
  updateCraft: (id: string, data: Partial<ProductCraft>) => request.put(`/product/taxonomy/crafts/${id}`, data),
  deleteCraft: (id: string) => request.delete(`/product/taxonomy/crafts/${id}`),

  // 受众
  getAudiences: () => request.get<ProductAudience[]>('/product/taxonomy/audiences'),
  createAudience: (data: Partial<ProductAudience>) => request.post('/product/taxonomy/audiences', data),
  updateAudience: (id: string, data: Partial<ProductAudience>) => request.put(`/product/taxonomy/audiences/${id}`, data),
  deleteAudience: (id: string) => request.delete(`/product/taxonomy/audiences/${id}`),

  // 品类
  getCategories: () => request.get<ProductCategory[]>('/product/taxonomy/categories'),
  createCategory: (data: Partial<ProductCategory>) => request.post('/product/taxonomy/categories', data),
  updateCategory: (id: string, data: Partial<ProductCategory>) => request.put(`/product/taxonomy/categories/${id}`, data),
  deleteCategory: (id: string) => request.delete(`/product/taxonomy/categories/${id}`),
};

// ============ 产品 Product ============

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  craftIds?: string[];
  crafts?: { id: string; name: string }[];
  audienceId?: string | null;
  audience?: { id: string; name: string; categories?: ProductCategory[] } | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;

  // 产品属性
  images?: string | null;       // 多图逗号分隔 URL
  sizeL?: string | null;        // 长 cm
  sizeW?: string | null;        // 宽 cm
  sizeH?: string | null;        // 高 cm
  weight?: string | null;       // 克重 g
  unit?: string | null;         // 单位

  // 产品要求
  sampleNo?: string | null;     // 打样单号
  logo?: boolean;               // 功能勾选
  sound?: boolean;              // 发声
  glow?: boolean;               // 发光
  colorChange?: boolean;        // 变色
  sprayWater?: boolean;         // 喷水
  colors?: string | null;       // 潘通色
  colorImage?: string | null;   // 颜色标注图
  packaging?: string | null;    // 包装（卡/盒/袋/桶）

  // 供货模式
  supplyModes?: string | null;  // DEEP_CUSTOM/LIGHT_CUSTOM/STOCK

  // 原有字段
  spec?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  taxRate?: number | null;
  stock?: number | null;
  lowStockAlert?: number | null;
  source?: string;
  status?: string;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  craftIds?: string;
  audienceId?: string;
  categoryId?: string;
  status?: string;
}

// 下拉选项类型（供销售单等引用）
export interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
}

const productApi = {
  getList: (params?: ProductListParams) =>
    request.get<{ list: Product[]; total: number; page: number; pageSize: number }>('/products', { params }),
  getById: (id: string) => request.get<Product>(`/products/${id}`),
  // 兼容旧接口：获取产品下拉选项（仅 id/name/sku）
  options: () => request.get<ProductOption[]>('/products/options'),
  create: (data: Partial<Product>) => request.post('/products', data),
  update: (id: string, data: Partial<Product>) => request.put(`/products/${id}`, data),
  delete: (id: string) => request.delete(`/products/${id}`),
};

export { productApi };
export default productApi;
