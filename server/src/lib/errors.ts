/**
 * 领域错误契约 —— Round R-1 Foundation
 *
 * 归属 **共享基础设施（lib/）** 而非 Business 层，原因：
 *   ① 该契约同时被 **HTTP 边界**（`middleware/errorHandler.ts`）与
 *      **领域层**（services / operations）使用；
 *      若放在 `services/`，则 middleware（共享层）会反向依赖业务层。
 *   ② `lib/` 已是既有基础设施目录（prisma / activity-logger / business-type /
 *      operation-diff / numberSequence / skuCode），符合「先复用现有基础设施」。
 *
 * 目的：让 Business / Operation 层能够表达「业务失败」而**不必接触 HTTP**。
 *
 *   Business 层：   throw new DomainNotFoundError('商机不存在');
 *   Controller 层： try { ... } catch (e) { next(e) }   ← 由 errorHandler 统一映射为状态码
 *
 * 因此本文件不含 Express 依赖，也不产生任何响应 —— HTTP 状态码的最终决定权
 * 仍然只在 HTTP 边界（Controller / errorHandler）手里。
 *
 * 【与既有机制的关系】
 * 现有代码普遍使用 `fail(res, 400, '...')` 在 Controller 内直接返回错误。
 * 本轮**不改动**这些既有写法（行为不变），只提供分层重构后 Business 层所需的
 * 错误载体；`middleware/errorHandler.ts` 已增加对应映射分支（纯新增，不影响既有错误路径）。
 */

export interface DomainErrorOptions {
  /** HTTP 状态码，默认 400 */
  httpStatus?: number;
  /** 响应体 `code`，默认与 httpStatus 相同 */
  code?: number;
  /** 附加信息（如字段级校验明细），供 HTTP 边界投递 */
  details?: unknown;
}

/** 领域错误基类：携带「建议的 HTTP 状态码」，但不构造响应 */
export class DomainError extends Error {
  readonly httpStatus: number;
  readonly code: number;
  readonly details?: unknown;

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.httpStatus = options.httpStatus ?? 400;
    this.code = options.code ?? this.httpStatus;
    this.details = options.details;
  }
}

/** 参数 / 业务前置条件不满足 → 400 */
export class DomainValidationError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, { ...options, httpStatus: options.httpStatus ?? 400 });
  }
}

/** 目标资源不存在 → 404（业务层**不应**为「越权」复用本类，越权走 DomainForbiddenError） */
export class DomainNotFoundError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, { ...options, httpStatus: options.httpStatus ?? 404 });
  }
}

/** 无权限 → 403 */
export class DomainForbiddenError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, { ...options, httpStatus: options.httpStatus ?? 403 });
  }
}

/** 状态冲突 / 唯一性冲突 → 409 */
export class DomainConflictError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, { ...options, httpStatus: options.httpStatus ?? 409 });
  }
}
