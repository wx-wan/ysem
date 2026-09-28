import { Request, Response } from 'express';
import * as operationLogService from '../services/operationLog.service';
import { fail, success } from '../utils/response';

/**
 * OperationLog Controller（审计查询）—— Round R-5 · Phase 4 · D4-b
 *
 * 职责（仅此）：HTTP request/response、查询参数透传、响应包装。
 * **禁止** Prisma 访问 / 过滤语义 —— 已在 `services/operationLog.service.ts`（Business）
 * / `repositories/operationLog.repository.ts`（Data）。
 *
 * 【无 Operation 层】只读单查询（零事务、零跨域），按 Master Plan §13 不制造空壳。
 */

/**
 * GET /api/operation-logs
 *
 * 查询全局审计日志（V1.0 `OperationLog`）。
 *
 * 字段语义（V1.0）：
 *  - `businessType` / `businessId` / `businessNo` 业务对象定位
 *  - `summary` 人类可读摘要
 * 旧字段 `target` / `targetId` / `detail` 已废弃，不得再出现在查询与响应中。
 *
 * 支持：关键字（username / realName / summary / businessNo）、模块、动作、操作人、
 * 业务类型、业务对象 id、单据号、时间区间、分页与排序。
 */
export const getOperationLogs = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    success(res, await operationLogService.list(q));
  } catch (e) {
    // 既有契约：本端点的任何失败统一为「查询操作日志失败」（500）
    fail(res, 500, '查询操作日志失败');
  }
};
