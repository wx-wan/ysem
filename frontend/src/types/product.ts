/**
 * Product 类型（Round F-S1 · Product MVP UI）
 *
 * 字段**只**来自后端真实返回（只读核对，未臆造、未猜测）：
 *   · server/prisma/schema/04-product.prisma  `model Product`
 *   · server/src/controllers/product.controller.ts
 *       - getProducts    L256-308 → Product 全字段行 + crafts[{id,name}]
 *                                   + audience{id,name} + category{id,name} + visibleUsers[{userId}]
 *       - getProductById L310-338 → Product 全字段行 + crafts[ProductCraft 完整]
 *                                   + audience{...,categories} + category + visibleUsers[{userId}]
 *       - createProduct  L394-441 → `created(res, product)`（Prisma 行本体，**不含** relations 投影）
 *       - updateProduct  L443-…   → 同上
 *       - productSchema  L69-98   → **可写字段白名单**：仅该白名单内的键被后端接受
 *                                   （Zod 默认剥离未知键 ⇒ 发送白名单外字段等于静默丢弃）
 *
 * 类型规则（沿用 F-5）：
 *   · Decimal → JSON string（'1200.000000'），**不在 API 层做 Number() 转换**；
 *     展示用 utils/format.formatDecimalString；仅「可编辑数字输入框」在表单层做一次数值解析。
 *   · DateTime → ISO string。
 */

/** 产品可见性（prisma enum ProductVisibility，仅两值） */
export type ProductVisibility = 'PUBLIC' | 'PRIVATE';

/**
 * 币种（prisma enum Currency 的可用集合）
 *
 * 取值**逐字复制**自 server/src/controllers/product.controller.ts L52-55 的 CURRENCIES 常量：
 * 后端对该字段做白名单校验，非法值会被静默回落为 Prisma 默认（USD），因此前端不得自造币种。
 */
export const PRODUCT_CURRENCIES = [
  'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD',
  'AUD', 'CAD', 'KRW', 'RUB', 'SEK', 'NOK', 'DKK',
] as const;

export type ProductCurrency = (typeof PRODUCT_CURRENCIES)[number];

/** 关系投影：list 端点的 audience / category（select { id, name }） */
export interface ProductRef {
  id: string;
  name: string;
}

/** 关系投影：crafts（list 端点 crafts 摊平为工艺实体 { id, name }） */
export interface ProductCraftRef {
  id: string;
  name: string;
}

/**
 * 产品列表行（GET /api/products 的 data.list 元素）
 *
 * 说明：该端点对 Product 未做字段裁剪（Prisma 全字段）+ 4 组关系投影；
 * 此处只声明**本阶段实际消费**的字段，未声明的字段后端仍会返回（不影响读取）。
 */
export interface ProductListItem {
  id: string;
  /** PRD-yyyyMMdd-0001（后端 NumberSequence 生成，前端不可写） */
  productNo: string;
  name: string;
  sku: string | null;
  coverImage: string | null;
  /** Decimal(18,6) → string；null = 未设置标准价 */
  defaultPrice: string | null;
  defaultCurrency: ProductCurrency;
  /** Decimal(9,4) 百分数 → string */
  defaultTaxRate: string | null;
  stock: number | null;
  lowStockAlert: number | null;
  visibility: ProductVisibility;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  audience: ProductRef | null;
  category: ProductRef | null;
  crafts: ProductCraftRef[];
}

/**
 * 产品详情（GET /api/products/:id 的 data）
 *
 * 与列表行的差异（后端真实差异，非前端加工）：
 *   · crafts 为**完整 ProductCraft 实体**（含 code / sort / status …）；
 *     结构上是 ProductCraftRef 的超集 ⇒ 表单只消费 id；
 *   · 额外返回 visibleUsers（可见人名单）。
 */
export interface ProductDetail extends ProductListItem {
  visibleUsers: { userId: string }[];
}

/** create / update 的返回体：Prisma 行本体（不含 relations 投影） */
export type ProductMutated = Omit<ProductListItem, 'audience' | 'category' | 'crafts'>;

/**
 * 写入载荷（**严格等于**后端 productSchema 白名单中本阶段使用的键）
 *
 * 注意：`model` / `material` / `colors` / `packaging` / `features` / `moq` / `leadTime` /
 * `hsCode` / `ownerId` 虽存在于 DB 模型，但**不在** productSchema 白名单中
 * ⇒ 后端会静默丢弃 ⇒ 本阶段不声明、不发送（避免"看似可写"的假能力）。
 *
 * 字段映射（后端 buildProductCreateData L353-392 / updateProduct L446-465）：
 *   price → defaultPrice · currency → defaultCurrency · taxRate → defaultTaxRate
 *   images → coverImage · craftIds → ProductCraftLink · visibleUserIds → ProductVisibleUser
 */
export interface ProductWritePayload {
  name?: string;
  /** 留空则后端按「工艺-受众-序号」自动生成（见 lib/skuCode.ts） */
  sku?: string | null;
  craftIds?: string[] | null;
  audienceId?: string | null;
  categoryId?: string | null;
  images?: string | null;
  price?: number | null;
  currency?: ProductCurrency | null;
  taxRate?: number | null;
  stock?: number | null;
  lowStockAlert?: number | null;
  description?: string | null;
  visibility?: ProductVisibility;
}

/** 创建载荷（name 必填，与后端一致） */
export interface ProductCreatePayload extends ProductWritePayload {
  name: string;
}

/** 更新载荷（后端 productSchema.partial()：未传字段保持原值） */
export type ProductUpdatePayload = ProductWritePayload;

/**
 * 列表查询参数（GET /api/products）
 *
 * 后端支持：page · pageSize · keyword · craftIds · audienceId · categoryId · visibility
 * 本阶段只使用 page / pageSize / keyword / visibility（其余不在 MVP 范围）。
 */
export interface ProductListQuery {
  page?: number;
  pageSize?: number;
  /** 匹配 name / sku（后端 contains，非分词） */
  keyword?: string;
  visibility?: ProductVisibility;
}
