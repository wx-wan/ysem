import { z } from 'zod';
import { DomainNotFoundError } from '../lib/errors';
import { updateDictionarySortOperation } from '../operations/dictionary.operations';
import { dictionaryRepository, type DictionaryTable } from '../repositories/dictionary.repository';

/**
 * Dictionary Business Layer —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 承载「基础字典」这一个**业务域的规则**：可维护的选项集（币种 / 单位 / 客户类型 / 沟通工具）。
 *
 * 【为什么按域组织，而不是四个模块各建一层】
 *   四个字典的既有 Controller 实现逐行同构：`list / active-list / detail / create(排序自增)
 *   / update / delete / batch-sort`。差异**仅在**：表名、字段 schema、错误名词、搜索字段、创建默认值。
 *   Master Execution Plan「Domain First, Layer Second」要求按业务域整合，
 *   因此此处以**描述符表**表达差异，共享同一套业务规则实现；
 *   而不是为四张结构相同的表复制四份等价 service（那才是「为了形式制造层」）。
 *
 * 约束：不读 req / res、不返回 HTTP、不处理状态码、不出现 `$transaction`、不直接 import Prisma 单例。
 *
 * 【行为等价性】每个描述符逐项对齐迁移前的 Controller：
 *   校验文案、默认值（`isActive ?? true`、`sort ?? max+1`、`symbol ?? ''`）、
 *   搜索字段组合、404 名词、响应体（create 返回整行、update 返回 null）均逐字沿用。
 */

export type DictionaryKind = 'currency' | 'unit' | 'customerType' | 'commTool';

interface DictionaryDescriptor {
  /** 域内实体名（用于 404 文案：`${noun}不存在`） */
  noun: string;
  /** Prisma 模型 delegate 名 */
  table: DictionaryTable;
  /** 列表 keyword 搜索字段（OR 组合，顺序与既有实现一致） */
  searchFields: string[];
  /** 创建 / 更新入参 schema（与既有 Controller 内的 schema 逐字一致） */
  schema: z.AnyZodObject;
  /** 由已校验入参构造 create data（含默认值规则） */
  buildCreateData(data: Record<string, unknown>, maxSort: number | null): Record<string, unknown>;
}

/** 排序入参（批量排序） */
export const dictionarySortSchema = z.array(
  z.object({
    id: z.string(),
    sort: z.number().int(),
  }),
);

export type DictionarySortItem = z.infer<typeof dictionarySortSchema>[number];

const nextSort = (maxSort: number | null, provided: unknown): number =>
  typeof provided === 'number' ? provided : (maxSort ?? 0) + 1;

const DESCRIPTORS: Record<DictionaryKind, DictionaryDescriptor> = {
  // ---- 币种（CurrencyRate）----
  currency: {
    noun: '币种',
    table: 'currencyRate',
    searchFields: ['code', 'name'],
    schema: z.object({
      code: z.string().trim().min(1, '币种代码不能为空').max(10, '币种代码最多 10 字符'),
      name: z.string().trim().min(1, '币种名称不能为空').max(50, '币种名称最多 50 字符'),
      symbol: z.string().trim().max(10, '符号最多 10 字符').optional(),
      isActive: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    buildCreateData: (d, maxSort) => ({
      code: d.code,
      name: d.name,
      // 既有行为：symbol 未传落空串（非 null）
      symbol: d.symbol ?? '',
      isActive: d.isActive ?? true,
      sort: nextSort(maxSort, d.sort),
    }),
  },

  // ---- 单位（Unit）----
  unit: {
    noun: '单位',
    table: 'unit',
    searchFields: ['name'],
    schema: z.object({
      name: z.string().trim().min(1, '单位名称不能为空').max(20, '单位名称最多 20 字符'),
      isActive: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    buildCreateData: (d, maxSort) => ({
      name: d.name,
      isActive: d.isActive ?? true,
      sort: nextSort(maxSort, d.sort),
    }),
  },

  // ---- 客户类型（CustomerType）----
  customerType: {
    noun: '客户类型',
    table: 'customerType',
    searchFields: ['name', 'description'],
    schema: z.object({
      name: z.string().min(1, '名称不能为空').max(50, '名称最多 50 字符'),
      description: z.string().max(200, '说明最多 200 字符').optional(),
      isActive: z.boolean().optional(),
      sort: z.number().int().optional(),
    }),
    buildCreateData: (d, maxSort) => ({
      name: d.name,
      description: d.description ?? null,
      isActive: d.isActive ?? true,
      sort: nextSort(maxSort, d.sort),
    }),
  },

  // ---- 沟通工具（CommunicationTool）----
  commTool: {
    noun: '沟通工具',
    table: 'communicationTool',
    searchFields: ['name', 'description'],
    schema: z.object({
      name: z.string().min(1, '名称不能为空').max(50, '名称最多 50 字符'),
      // 允许 null：编辑回填时 description 可能为 null，z.string().optional() 不接受 null
      description: z.string().max(200, '说明最多 200 字符').optional().nullable(),
      icon: z.string().max(50, '图标名称最多 50 字符').optional().nullable(),
      isActive: z.boolean().optional(),
      // 数字输入框可能提交字符串；空串/置空视为未填（交由默认值逻辑处理）
      sort: z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
        z.number().int('排序必须为整数').optional(),
      ),
    }),
    buildCreateData: (d, maxSort) => ({
      name: d.name,
      description: d.description ?? null,
      icon: d.icon ?? null,
      isActive: d.isActive ?? true,
      sort: nextSort(maxSort, d.sort),
    }),
  },
};

/** 取入参 schema（Controller 在 HTTP 边界使用；DTO 定义属 Business 层资产） */
export function schemaOf(kind: DictionaryKind): z.AnyZodObject {
  return DESCRIPTORS[kind].schema;
}

/** 构造 keyword 搜索条件（无 keyword 时返回 undefined，与既有实现一致） */
function buildKeywordWhere(kind: DictionaryKind, keyword?: string): Record<string, unknown> | undefined {
  if (!keyword) return undefined;
  return {
    OR: DESCRIPTORS[kind].searchFields.map((f) => ({ [f]: { contains: keyword } })),
  };
}

/** 启用项列表（下拉数据源） */
export function listActive(kind: DictionaryKind) {
  return dictionaryRepository.findMany(DESCRIPTORS[kind].table, { isActive: true });
}

/** 全部列表（设置页管理，支持 keyword） */
export function listAll(kind: DictionaryKind, keyword?: string) {
  return dictionaryRepository.findMany(DESCRIPTORS[kind].table, buildKeywordWhere(kind, keyword));
}

/** 详情（不存在 → 404 `${noun}不存在`） */
export async function getOne(kind: DictionaryKind, id: string) {
  const item = await dictionaryRepository.findById(DESCRIPTORS[kind].table, id);
  if (!item) throw new DomainNotFoundError(`${DESCRIPTORS[kind].noun}不存在`);
  return item;
}

/** 新增（sort 缺省时取当前最大 + 1；返回整行） */
export async function create(kind: DictionaryKind, data: Record<string, unknown>) {
  const descriptor = DESCRIPTORS[kind];
  const maxSort = await dictionaryRepository.maxSort(descriptor.table);
  return dictionaryRepository.create(descriptor.table, descriptor.buildCreateData(data, maxSort));
}

/** 更新（局部；未传字段由 Prisma 忽略 undefined 保持原值；返回 null） */
export async function update(kind: DictionaryKind, id: string, data: Record<string, unknown>) {
  await dictionaryRepository.update(DESCRIPTORS[kind].table, id, data);
}

/** 删除 */
export async function remove(kind: DictionaryKind, id: string) {
  await dictionaryRepository.delete(DESCRIPTORS[kind].table, id);
}

/** 批量更新排序（事务归 Operation 层） */
export function updateSort(kind: DictionaryKind, items: DictionarySortItem[]) {
  return updateDictionarySortOperation(DESCRIPTORS[kind].table, items);
}
