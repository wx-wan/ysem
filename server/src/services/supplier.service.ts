import { DomainValidationError } from '../lib/errors';
import { createSupplierAggregate } from '../operations/procurement.operations';
import { supplierRepository } from '../repositories';

/**
 * Supplier Business Layer —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * Supplier 是**被采购单长期复用的共享主数据**（DQ-4=A）：
 *   · 仅做存在性校验，**不施加** owner 数据范围（不在公海语义内）；
 *   · 编号走 NumberSequence `SUP`，与业务写入同事务（不产生编号空洞）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

/** 供应商下拉/搜索（供采购表单选择） */
export function list(keyword?: string) {
  return supplierRepository.findManyByKeyword(String(keyword ?? '').trim());
}

/** 新增供应商 */
export function create(
  body: { name?: unknown; contact?: unknown; phone?: unknown; address?: unknown; remark?: unknown },
  createdBy: string | null,
) {
  const raw = body?.name;
  if (!raw || !String(raw).trim()) throw new DomainValidationError('供应商名称不能为空');

  return createSupplierAggregate({
    name: String(raw).trim(),
    contact: body.contact ? String(body.contact) : null,
    phone: body.phone ? String(body.phone) : null,
    address: body.address ? String(body.address) : null,
    remark: body.remark ? String(body.remark) : null,
    createdBy,
  });
}
