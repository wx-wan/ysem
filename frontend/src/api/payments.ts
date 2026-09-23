import type { ApiResponse } from './request';
import request from './request';
import { unwrapResponse } from '../utils/response';
import type { PaymentCreatePayload, PaymentListItem } from '../types/payment';

/**
 * Payment（收付款）API（Round F-S6）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/payment.routes.ts）：
 *   POST /api/payments → 创建（收款：direction=IN + salesOrderId 必填 + amount 必填；
 *                         成功后后端在**同一事务**内重算 SalesOrder.paidAmountCny）
 *
 * F-S6 最小闭环只需创建能力（收款登记）；列表/详情/删除不在本阶段范围。
 * 权限：仅 `authenticate`（无 requirePerm）。
 */
export const createPayment = async (payload: PaymentCreatePayload): Promise<PaymentListItem> =>
  unwrapResponse(
    await request.post<ApiResponse<PaymentListItem>>('/payments', payload),
    'POST /payments',
  ).data;
