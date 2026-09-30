/**
 * Notification 能力 —— Round R-5 · T2（D-P6-B）
 *
 * 由 `notification.ts` 归位而来：统一承载权限变更 / 审批 / 系统公告通知。
 *  - 在线用户：经 SSE 长连接实时推送（连接表在本能力内）
 *  - 离线用户：落库 Notification（Data 部分在 `repositories/notification.repository.ts`）
 */
export * from './notification.service';
