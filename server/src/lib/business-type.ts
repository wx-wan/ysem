/**
 * OperationLog.businessType 取值表（V1.0）
 *
 * 依据：
 *  - V1.0 `OperationLog.businessType` 在 schema 中为**非闭集字符串**（01-system.prisma），
 *    配套索引 `@@index([businessType, businessId])`。因此这里用 const 对象 + 字面量联合类型，
 *    不新增 Prisma enum（避免产生第二套枚举）。
 *  - 取值命名与 V1.0 `AttachmentOwnerType` / `ApprovalBizType` 保持同一套业务对象名称。
 *  - 旧版裸字符串 `target` / `targetId` 已废弃，由 `businessType` / `businessId` / `businessNo` 取代。
 *
 * 兼容说明：`COMBO` 为组合产品在操作日志中的类型标签（对应 `AttachmentOwnerType.COMBO_PRODUCT`）。
 */
export const BUSINESS_TYPE = {
  PRODUCT: 'PRODUCT',
  COMBO: 'COMBO',
  CUSTOMER: 'CUSTOMER',
  LEAD: 'LEAD',
  OPPORTUNITY: 'OPPORTUNITY',
  QUOTATION: 'QUOTATION',
  SAMPLE_ORDER: 'SAMPLE_ORDER',
  SALES_ORDER: 'SALES_ORDER',
  PRODUCTION_ORDER: 'PRODUCTION_ORDER',
  QUALITY_INSPECTION: 'QUALITY_INSPECTION',
  SHIPMENT: 'SHIPMENT',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  PAYMENT: 'PAYMENT',
  PROFIT: 'PROFIT',
  SUPPLIER: 'SUPPLIER',
  CERTIFICATE: 'CERTIFICATE',
  USER: 'USER',
} as const;

export type BusinessType = (typeof BUSINESS_TYPE)[keyof typeof BUSINESS_TYPE];

/** 业务对象类型中文名（OperationLog 列表筛选用） */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  PRODUCT: '产品',
  COMBO: '组合产品',
  CUSTOMER: '客户',
  LEAD: '线索',
  OPPORTUNITY: '商机',
  QUOTATION: '报价单',
  SAMPLE_ORDER: '打样单',
  SALES_ORDER: '销售订单',
  PRODUCTION_ORDER: '生产订单',
  QUALITY_INSPECTION: '质检单',
  SHIPMENT: '出运单',
  PURCHASE_ORDER: '采购单',
  PAYMENT: '收款',
  PROFIT: '利润',
  SUPPLIER: '供应商',
  CERTIFICATE: '资质',
  USER: '用户',
};
