import { NextFunction, Request, Response } from 'express';
import { DomainError } from '../lib/errors';
import * as exchangeService from '../services/exchange.service';
import { error, success } from '../utils/response';

/**
 * Exchange Controller —— Round R-5 · Phase 2 · Master Data Domain（汇率）
 *
 * 职责（仅此）：HTTP request/response、参数解析、错误映射。
 * **禁止** Prisma 访问 / 外部源调用 / 缓存策略 —— 已在 `services/exchange.service.ts`
 * / `repositories/exchange.repository.ts`。API Contract 保持不变。
 *
 * 注：`exchange.routes.ts` 当前仅挂载 `getTodayRates`；其余两个导出保留以维持 API 表面不变。
 */

/** DomainError → 既有 `error(res, message, code)` 形状；其余交给 errorHandler（既有语义） */
function respond(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof DomainError) {
    error(res, err.message, err.code);
    return;
  }
  next(err);
}

/**
 * GET /api/ext/exchange（前端顶栏实时汇率）
 * 带 24 小时缓存：当天 DB 已有记录直接返回，不重复请求外部 API；
 * 未命中才请求 Frankfurter 并落库；外部失败时回退最近历史缓存 / 内置参考值。
 */
export const getTodayRates = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await exchangeService.getTodayRates());
  } catch (err) {
    respond(res, next, err);
  }
};

/** GET /api/exchange/daily?date=YYYY-MM-DD —— 指定日期汇率 */
export const getDailyRates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = (req.query.date as string) || undefined;
    return success(res, await exchangeService.getDailyRates(date));
  } catch (err) {
    respond(res, next, err);
  }
};

/** POST /api/exchange/daily —— 强制刷新当日汇率 */
export const ensureToday = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return success(res, await exchangeService.ensureToday());
  } catch (err) {
    respond(res, next, err);
  }
};
