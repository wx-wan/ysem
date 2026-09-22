import { PRODUCT_CURRENCIES, type ProductCurrency, type ProductVisibility } from '../../types/product';

/**
 * Product UI 常量（Round F-S1 · Product MVP UI）
 *
 * 原则：**值**来自后端真实契约（枚举 / 常量逐字对齐），前端只补中文 label 与分页边界，
 * 不自造可选值、不改变后端语义。
 */

/** 分页（后端 getProducts 上限 pageSize ≤ 100；前端不发送越界值） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 可见性（prisma enum ProductVisibility） */
export const VISIBILITY_LABEL: Record<ProductVisibility, string> = {
  PUBLIC: '公开',
  PRIVATE: '不公开',
};

export const VISIBILITY_COLOR: Record<ProductVisibility, string> = {
  PUBLIC: 'green',
  PRIVATE: 'orange',
};

export const VISIBILITY_OPTIONS: { label: string; value: ProductVisibility }[] = [
  { label: VISIBILITY_LABEL.PUBLIC, value: 'PUBLIC' },
  { label: VISIBILITY_LABEL.PRIVATE, value: 'PRIVATE' },
];

/** 列表筛选：可见性（含「全部」= 不发送该参数） */
export const VISIBILITY_FILTER_OPTIONS: { label: string; value: ProductVisibility | 'ALL' }[] = [
  { label: '全部可见性', value: 'ALL' },
  ...VISIBILITY_OPTIONS,
];

/** 币种中文名（仅 UI 展示；值 = 后端 CURRENCIES 白名单） */
export const CURRENCY_LABEL: Record<string, string> = {
  CNY: '人民币',
  USD: '美元',
  EUR: '欧元',
  GBP: '英镑',
  JPY: '日元',
  HKD: '港币',
  AUD: '澳元',
  CAD: '加元',
  KRW: '韩元',
  RUB: '卢布',
  SEK: '瑞典克朗',
  NOK: '挪威克朗',
  DKK: '丹麦克朗',
};

export const CURRENCY_OPTIONS: { label: string; value: ProductCurrency }[] = PRODUCT_CURRENCIES.map((code) => ({
  label: `${code} · ${CURRENCY_LABEL[code] ?? code}`,
  value: code,
}));

/**
 * SKU 说明（与后端 lib/skuCode.ts 契约一致）：
 *   · 留空 = 由后端按「工艺-受众-序号」自动生成；
 *   · 若同时选择了工艺与受众，但其编码缺失 → 后端返回 400（不会静默落库）。
 */
export const SKU_AUTO_HINT = '留空则由系统按「工艺-受众-序号」自动生成（同一组合内自动递增）。';

/** 表单文案：可见性语义（与后端可见性谓词一致） */
export const VISIBILITY_HINT =
  '公开：所有登录用户可见、可被商机/报价选择；不公开：仅创建人与被指定人员可见。';
