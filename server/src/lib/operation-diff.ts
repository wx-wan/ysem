/**
 * 通用操作差异计算工具
 * --------------------------------------------------
 * 设计目标：任何模块的「编辑」操作都可以通过 compare(before, after) 自动产出
 * 结构化变更列表，统一写入 OperationLog / 各实体时间线，并由前端以 Tag 形式展示。
 *
 * 各模块只需提供：
 *  - FIELD_LABELS：字段中文名映射
 *  - FORMATTERS：字段值格式化器（枚举、布尔、数组、关联 id→名称 等）
 */

export interface DiffItem {
  /** 字段 key */
  field: string;
  /** 字段中文名（用于展示） */
  label: string;
  /** 变更前原始值（调试用） */
  before: unknown;
  /** 变更后原始值 */
  after: unknown;
  /** 变更前展示文本 */
  beforeText: string;
  /** 变更后展示文本 */
  afterText: string;
}

export type FieldFormatter = (value: unknown) => string | Promise<string>;

export interface DiffOptions {
  /** 字段中文名映射： module -> field -> label */
  labels?: Record<string, string>;
  /** 字段值格式化器： module -> field -> formatter */
  formatters?: Record<string, FieldFormatter>;
  /** 需要比对的字段白名单（不传则比对 before/after 的所有顶层 key） */
  fields?: string[];
  /** 需要忽略的字段 */
  ignore?: string[];
}

/** 通用值格式化：处理 null / 布尔 / 数组 / 数字 / 字符串 */
export function defaultFormat(value: unknown): string {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (value.length === 0) return '空';
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('、');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 计算两个对象的差异（支持异步格式化器，如 id→名称 查询）。
 * @param before 变更前记录（通常是数据库查出的实体）
 * @param after  变更后记录（通常是请求体解析出的目标值）
 * @param opts   模块级 labels / formatters / fields / ignore
 */
export async function computeDiff(
  before: Record<string, any>,
  after: Record<string, any>,
  opts: DiffOptions = {},
): Promise<DiffItem[]> {
  const { labels = {}, formatters = {}, fields, ignore = [] } = opts;
  const keys = fields ?? [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const items: DiffItem[] = [];

  for (const field of keys) {
    if (ignore.includes(field)) continue;
    const b = before?.[field];
    const a = after?.[field];
    if (isEqual(b, a)) continue;

    const fmt = formatters[field] ?? defaultFormat;
    const beforeText = await fmt(b);
    const afterText = await fmt(a);
    items.push({
      field,
      label: labels[field] ?? field,
      before: b,
      after: a,
      beforeText,
      afterText,
    });
  }
  return items;
}

/** 浅比较（数组按 JSON 比较，对象按引用跳过深层） */
function isEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (a === b) return true;
  // null/undefined/空串/空数组 视为相等（避免「空 → 空」反复记录）
  const isEmpty = (v: unknown): boolean =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isEmpty(a) && isEmpty(b)) return true;
  return false;
}

/**
 * 将 DiffItem[] 序列化为数据库存储字符串。
 */
export function serializeDiff(items?: DiffItem[] | null): string | null {
  if (!items || items.length === 0) return null;
  return JSON.stringify(items);
}

export function parseDiff(raw: string | null | undefined): DiffItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
