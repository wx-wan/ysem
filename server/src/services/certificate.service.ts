import { MasterStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainNotFoundError } from '../lib/errors';
import { certificateRepository } from '../repositories';

/**
 * Certificate Business Layer —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 认证资质属**产品 / 供应侧主数据**（被 Product 关联、被 Excel 导入按名称解析）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 *
 * 【行为等价性（含既有实现的取舍，逐字沿用）】
 *   · `logo` 字段存在于 schema 且被 update 直通写入，但 **create 不写 logo**
 *     —— 迁移前即如此，本轮不改（避免顺手改业务）；
 *   · create 返回整行，update / delete 返回 null。
 */

export const certificateSchema = z.object({
  name: z.string().min(1, '证书名称不能为空'),
  code: z.string().trim().max(50).optional(),
  issuer: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  validUntil: z.string().optional(), // ISO 字符串，可选
  status: z.nativeEnum(MasterStatus).optional(),
  remark: z.string().trim().max(500).optional(),
  logo: z.string().trim().max(500).optional(),
});

export type CertificateInput = z.infer<typeof certificateSchema>;

/** 列表（不分页） */
export function list() {
  return certificateRepository.findAll();
}

/** 详情（不存在 → 404「证书不存在」） */
export async function getOne(id: string) {
  const item = await certificateRepository.findById(id);
  if (!item) throw new DomainNotFoundError('证书不存在');
  return item;
}

/** 新建 */
export function create(data: CertificateInput) {
  return certificateRepository.create({
    name: data.name,
    code: data.code ?? null,
    issuer: data.issuer ?? null,
    category: data.category ?? null,
    validUntil: data.validUntil ? new Date(data.validUntil) : null,
    status: data.status ?? MasterStatus.ACTIVE,
    remark: data.remark ?? null,
  });
}

/** 更新（局部；validUntil 需显式做日期转换，其余字段直通） */
export async function update(id: string, body: Partial<CertificateInput>) {
  const { validUntil, ...rest } = body;
  // 类型化 payload：Record<string, unknown> 会擦除 status 的 MasterStatus 校验
  const payload: Prisma.CertificateUncheckedUpdateInput = { ...rest };
  if (validUntil !== undefined) {
    payload.validUntil = validUntil ? new Date(validUntil) : null;
  }
  await certificateRepository.update(id, payload);
}

/** 删除 */
export async function remove(id: string) {
  await certificateRepository.delete(id);
}
