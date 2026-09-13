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

/**
 * 旧 `Order.type` → V1.0 业务对象类型的**日志标签**映射（仅用于 OperationLog.businessType）。
 *
 * ⚠️ 本映射不改变任何数据模型，也不代表 Order 五拆已经完成。
 * `order.controller.ts` 五拆（Quotation / SampleOrder / SalesOrder / ProductionOrder / Shipment）
 * 在 Round 3B-2 完成后，本映射与其调用点一并删除。
 */
export const LEGACY_ORDER_TYPE_TO_BUSINESS_TYPE: Record<string, BusinessType> = {
  QUOTE: BUSINESS_TYPE.QUOTATION,
  SAMPLE: BUSINESS_TYPE.SAMPLE_ORDER,
  ORDER: BUSINESS_TYPE.SALES_ORDER,
  PRODUCTION: BUSINESS_TYPE.PRODUCTION_ORDER,
  SHIPPED: BUSINESS_TYPE.SHIPMENT,
};

/** 旧 `Order.type` → 业务对象类型标签；未知取值返回 undefined（不做兜底猜测）。 */
export const legacyOrderBusinessType = (
  orderType?: string | null,
): BusinessType | undefined =>
  orderType ? LEGACY_ORDER_TYPE_TO_BUSINESS_TYPE[orderType] : undefined;
