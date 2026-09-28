import { z } from 'zod';
import { MasterStatus } from '@prisma/client';
import { productTaxonomyRepository } from '../repositories/productTaxonomy.repository';

/**
 * Product 分类主数据 Business Layer（Round R-4 · Product Layering）
 *
 * 归属：Product master data 的**分类字典**（工艺 / 受众 / 品类）。
 * 职责：DTO 契约（供 Controller 复用）、分类字典的业务读取/写入编排。
 *
 * 现状说明（如实记录，未自行"补业务"）：
 *   本模块当前为**字典维护型 CRUD**，除「名称非空」「受众编码 ≤10 位」「品类须归属受众」
 *   等 DTO 级约束外，既有代码中**不存在**额外的业务规则（无状态机、无跨实体流程）。
 *   因此本层目前很薄 —— 这是对既有行为的忠实搬迁，不是"为了分层而制造空层"：
 *   Controller 不得直接访问 Prisma，故必须存在这一层。
 *
 * 不负责：HTTP request/response、状态码、响应格式化。
 */

// ============================================================
// DTO（schema 契约住在 Business 层，Controller 复用；沿用 R-3 Customer 先例）
// ============================================================

export const craftSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  code: z.string().trim().max(10, '编码最多 10 位').optional(),
  sort: z.number().int().optional(),
  status: z.nativeEnum(MasterStatus).optional(),
});

export const audienceSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  code: z.string().trim().max(10, '编码最多 10 位').optional(),
  sort: z.number().int().optional(),
  status: z.nativeEnum(MasterStatus).optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  audienceId: z.string().min(1, '请选择所属受众'),
  sort: z.number().int().optional(),
  status: z.nativeEnum(MasterStatus).optional(),
});

export type CraftInput = z.infer<typeof craftSchema>;
export type AudienceInput = z.infer<typeof audienceSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;

// ============================================================
// 读取
// ============================================================

export function listCrafts() {
  return productTaxonomyRepository.findCrafts();
}

export function listAudiences() {
  return productTaxonomyRepository.findAudiencesWithCategories();
}

export function listCategories() {
  return productTaxonomyRepository.findCategoriesWithAudience();
}

// ============================================================
// 写入（字典维护）
// ============================================================

export function createCraft(input: CraftInput) {
  return productTaxonomyRepository.createCraft(input);
}

export function updateCraft(id: string, input: Partial<CraftInput>) {
  return productTaxonomyRepository.updateCraft(id, input);
}

export function deleteCraft(id: string) {
  return productTaxonomyRepository.deleteCraft(id);
}

export function createAudience(input: AudienceInput) {
  return productTaxonomyRepository.createAudience(input);
}

export function updateAudience(id: string, input: Partial<AudienceInput>) {
  return productTaxonomyRepository.updateAudience(id, input);
}

export function deleteAudience(id: string) {
  return productTaxonomyRepository.deleteAudience(id);
}

export function createCategory(input: CategoryInput) {
  return productTaxonomyRepository.createCategory(input);
}

export function updateCategory(id: string, input: Partial<CategoryInput>) {
  return productTaxonomyRepository.updateCategory(id, input);
}

export function deleteCategory(id: string) {
  return productTaxonomyRepository.deleteCategory(id);
}
