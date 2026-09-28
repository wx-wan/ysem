# YSEM Global Data Architecture Audit

> Round：Data Architecture Audit · **Read Only** · No Implementation
> 本报告未修改任何代码 / Schema / Migration / API / 前端，未 commit，未 push。

---

## 0. 阅读指引（本报告的核心结论，先看这 8 条）

1. **YSEM 的主数据只有 6 类实体 + 9 类字典**，其余 40+ 张表全部是业务过程 / 关系 / 业务事实 / 支撑设施。
2. **Lead 不是主数据，也不是独立业务对象**——它是「Customer 尚未建档时的销售过程前段容器」，同时承担了「客户资料暂存所」的职责，这是当前架构最大的边界错误。
3. **业务过程已经天然是一条链**（Lead → Opportunity → Quotation/SampleOrder → SalesOrder → Production/Shipment），且系统**已经**用派生方式（`pipelineStage.deriveStage`）而不是落库 stage 来表达阶段——这个方向是**正确且先进的**，应当制度化。
4. **真正的「客户资料重复」只有一处**：`Lead.customerId` 已建的情况下，`Lead.companyName/contactName/email/phone/country/customerType/contactMethods` 与 `Customer.*` 并存。**Opportunity / Quotation / SalesOrder 并没有存 customerName，全部走 include 联查**（`customer: { select: { companyName } }`）——这一点比预期健康得多。
5. **真正的关系冗余有 4 处**：`Quotation/SampleOrder/SalesOrder/Shipment/Payment.customerId` 全部可由上游派生，靠应用层 `resolveRefs` 校验一致性（`salesOrder.controller.ts:296-349`），而不是数据库约束。
6. **系统存在大量「已建模未接线」的死列/死模型**：`Opportunity.outcome/outcomeAt/wonAt/lostReason`（0 引用）、`ProductPrice`（0 读写）、`Quotation.customerSnapshot` / `SampleOrder.customerSnapshot` / `SalesOrder.customerSnapshot` / `termsSnapshot`（0 写入 0 消费）、`Customer.totalOrderAmountCny` / `lastOrderAt`（声明「由履约层回写」但 0 写入）、`Quotation.parentId/revisions` 版本链（写入 Deferred）。这些不是「重复字段」，而是**架构承诺与实现脱节**，比重复字段更值得先处理。
7. **Draft 只有 Lead 有，且实现方向正确**（同表布尔 + 前端锁定标志），但**语义与其它 6 个模块不一致**（其它模块的 DRAFT 是状态枚举首态）。且其存在理由是「前端校验放宽」，不是「数据所有权」。
8. **唯一真正在建的冗余是正在途中的改动**：工作区未提交的 `Opportunity.channelId/shopId` 新增，把渠道/平台从 2 处变成 3 处。这一改动在动工前应当先做架构决策（见 §24）。

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| HEAD | `66ebebec42e1937482f6753ff92703310cb49d2f` |
| origin/master | `66ebebec42e1937482f6753ff92703310cb49d2f`（与 HEAD 一致） |
| Working Tree | **dirty（有未提交改动，含在途 Schema 变更）** |

未提交改动：

```
 M client/src/api/sales.ts
 M client/src/i18n/locales/en.json
 M client/src/i18n/locales/zh.json
 M client/src/utils/convertLead.ts
 M server/prisma/schema/05-opportunity.prisma
 M server/src/controllers/sales.controller.ts
?? client/src/components/sales/OpportunityCardList.tsx
?? client/src/components/sales/OpportunityDetailPanel.tsx
?? client/src/components/sales/useOpportunityList.ts
?? server/prisma/migrations/20260928120000_add_channel_to_opportunity/
```

其中 `05-opportunity.prisma` 的在途变更内容为：

```38:46:server/prisma/schema/05-opportunity.prisma
  // ---------- 来源渠道 / 平台（与 Lead.channelId / Lead.shopId 同义；线索转商机时原样带入）----------
  channelId String? // 来源渠道
  channel   Channel? @relation("OpportunityChannel", fields: [channelId], references: [id], onDelete: SetNull)
  shopId    String? // 来源平台
  shop      Channel? @relation("OpportunityShop", fields: [shopId], references: [id], onDelete: SetNull)
```

配套迁移 `20260928120000_add_channel_to_opportunity/migration.sql` 已写好但未提交。**这是本次审计期间正在发生的架构动作，其方向与「联查优先」冲突**（见 §13 与 §24-D1）。

技术栈：`server` = Node/Express/TypeScript/Prisma 5.22（多文件 schema）/PostgreSQL；`client` = React + TypeScript + Vite + Ant Design；Schema 拆分为 16 个 `.prisma` 文件，共 **52 个 model**。

---

## 2. Current Architecture

### 2.1 物理分层（按 schema 文件）

| 文件 | 层 | 模型 |
|---|---|---|
| `00-enums.prisma` | 枚举 | 29 个枚举（Currency / MasterStatus / LeadStatus / OpportunityOutcome / QuotationStatus / SalesOrderStatus / PaymentStatus / PurchaseStatus / ProfitStatus …） |
| `01-system.prisma` | 平台 | User / Role / Permission / RolePermission / Department / LoginLog / Notification / OperationLog |
| `02-support.prisma` | 平台支撑 | ApprovalConfig / ApprovalRecord / NumberSequence / Attachment / DailyExchangeRate |
| `03-customer.prisma` | 主数据 + 过程 | Customer / Supplier / Lead / LeadItem / Channel / CustomerType / CommunicationTool |
| `04-product.prisma` | 主数据 | Product / CustomerProduct / ProductPrice / ProductCraft / ProductCraftLink / ProductAudience / ProductCategory / ProductVisibleUser / Certificate / ProductCertification / ProductTask / ComboProduct / ComboItem |
| `05-master.prisma` | 字典主数据 | CurrencyRate / Unit |
| `05-opportunity.prisma` | 销售过程 | Opportunity / OpportunityItem |
| `06-quotation.prisma` | 销售过程 | Quotation / QuotationItem |
| `07-sample.prisma` | 销售过程 | SampleOrder / SampleRound |
| `08-sales-order.prisma` | 交易 | SalesOrder / SalesOrderItem |
| `09-production.prisma` | 履约 | ProductionOrder / ProductionOrderItem |
| `10-purchase.prisma` | 履约（供方） | PurchaseOrder / PurchaseOrderItem |
| `11-shipment.prisma` | 履约 | Shipment / ShipmentItem |
| `12-quality.prisma` | 履约 | QualityInspection |
| `13-finance.prisma` | 财务 | Payment / Profit |

### 2.2 真实主链（从 FK 实证，非文档假设）

```
Lead ──(leadId, 1:N)──> Opportunity ──(opportunityId, 1:N)──> Quotation ──(quotationId, 可空)──┐
  │                          │                                                                │
  │                          │                                                                ▼
  │                          ├──(opportunityId, 可空)──> SampleOrder ──(sampleOrderId,可空)──> SalesOrder
  │                          │                                                                │
  │                          └────────────────────(opportunityId, 必填, Restrict)──────────────┘
  │                                                                                           │
  ▼ Customer(intake)                                                                          ▼
Customer <──(customerId, Restrict)────────────────────────────────────────────────────────  SalesOrder
                                                                                              │
                     ┌────────────────────────────────────────────┬───────────────────────────┤
                     ▼                        ▼                    ▼                       ▼
              ProductionOrder            Shipment             Payment(IN)              Profit (1:1)
                     │                        │
                     ▼                        ▼
             ProductionOrderItem        ShipmentItem
                     │
                     ▼
              PurchaseOrderItem ── PurchaseOrder ── Supplier
```

关键基数（均已在 schema 注释中明确）：
- `Lead 1:N Opportunity`（`Opportunity.leadId` **非 unique**）
- `Opportunity 1:N Quotation`（`@@unique([opportunityId, version])`，version 链已建模）
- `Opportunity 1:N SampleOrder`、`1:N SalesOrder`
- `Quotation 1:N SalesOrder`（`SalesOrder.quotationId` 可空）
- `SampleOrder 1:N SalesOrder`（`SalesOrder.sampleOrderId` 可空）
- `SalesOrder 1:N ProductionOrder / Shipment / Payment`，`1:1 Profit`
- `ProductionOrder 1:N PurchaseOrder`（`@@index([productionOrderId])`，**非 unique**）

### 2.3 唯一约束（`@unique`）形成的「天然幂等键」清单

`customerNo / supplierNo / leadNo / productNo / sku / comboNo / opportunityNo / quotationNo / sampleNo / orderNo / productionNo / purchaseNo / shipmentNo / inspectionNo / paymentNo / profitNo / username / email / Certificate.code`，以及业务键 `@@unique([opportunityId, version])`、`@@unique([orderId, lineNo])`、`@@unique([sampleOrderId, roundNo])`、`@@unique([customerId, productId, version])`、`@@unique([productId, customerId, minQty, currency])`、`@@unique([date, currencyCode])`。

编号通过 `NumberSequence`（`02-support.prisma:43`）+ `getNextNumber(tx, code)` 生成，且在事务内分配（如 `sales.controller.ts:403-404`）。

### 2.4 控制器 ↔ 模块映射（33 controllers / 32 routes）

| 路由前缀 | Controller | 实际业务对象 |
|---|---|---|
| `/api/sales` | `sales.controller.ts` | **Opportunity（商机）** ← 命名错位 |
| `/api/sales-orders` | `salesOrder.controller.ts` | SalesOrder |
| `/api/quotations` | `quotation.controller.ts` | Quotation |
| `/api/sample-orders` | `sampleOrder.controller.ts` | SampleOrder |
| `/api/leads` | `lead.controller.ts` | Lead |
| `/api/customers` | `customer.controller.ts` (67KB，最大) | Customer + 客户时间线聚合 |
| `/api/products` | `product.controller.ts` | Product |
| `/api/product-groups` | `productGroup.controller.ts` | ComboProduct |
| `/api/production-orders` / `/api/purchases` / `/api/purchase-orders` / `/api/shipments` / `/api/inspections` / `/api/payments` / `/api/profits` | 各自 controller | 履约 / 财务 |

### 2.5 已完成的收敛（正面证据）

- **活动/日志域已完成单一化**：`SalesActivity`、`OpportunityActivity`、`CustomerActivity`、`ProductActivity` 四个副表已全部删除（`02-support.prisma:80-85` 有明确删除记录），统一收敛到 `OperationLog`（`01-system.prisma:145`，带 `businessType/businessId/businessNo/customerId` 索引）。`日志功能审计.md` 记录了这次整合。**这是「消灭重复表」的成功先例，可作为后续迁移的方法论模板。**
- **商机阶段已改为派生不落库**：`Opportunity` **没有** `stage` 列，`OpportunityOutcome` 枚举注释明确「禁止出现落库的 `Opportunity.stage`」。

---

## 3. Business Process Map（真实流程，按代码实证）

阶段定义、进入/退出条件与数据归属：

| # | 阶段 | 进入条件 | 退出条件 | 核心数据 | 主数据引用 | 业务状态 | 产生的业务事实 | 需快照 | 需独立持久化 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | **线索录入 / 暂存** | 手工 / Excel / RPA / 第三方同步 | 客户建档 | `Lead` + `LeadItem`（含 `productDesc` 需求详情） | `Channel`(来源)、`Product`(可空)、`Customer`(可空) | `Lead.draft=true`、`stage=0/1` | 需求描述（非交易事实） | 否 | **是（但应重新定义所有权）** |
| 1 | **线索资格判断 / 建档** | 用户点确认 | 客户 + 产品下落 | `Customer`（客户端编排创建） | `Customer`、`Product` | `Lead.draft=false`、`customerLocked/productLocked` | 无 | 否 | 否（属阶段 0 的行内状态） |
| 2 | **跟进 / 转商机** | `convertLeadToOpportunity` | Opportunity 创建 | `Opportunity` + `OpportunityItem` | `Customer`(必填 Restrict)、`Lead`、`Product` | `Lead.status=CONFIRMED`、`Opportunity.outcome`（死列） | 商机意向金额 `estimatedAmount` | 否 | **是** |
| 3 | **报价** | 手工创建 `Quotation` | 客户接受 / 拒绝 / 过期 | `Quotation` + `QuotationItem` | `Opportunity`、`Customer`、`Product` | `QuotationStatus`（DRAFT→…→ACCEPTED/REJECTED/EXPIRED） | **单价、金额、条款、有效期、成本价** | **是** | **是** |
| 4 | **打样** | 由商机发起或独立发起 | `APPROVED` / `REJECTED` | `SampleOrder` + `SampleRound`（多轮） | `Opportunity`(可空)、`Customer`、`Product` | `SampleStatus` + 轮次 `SampleRoundResult` | 打样费、轮次时间线、改进记录 | **是** | **是** |
| 5 | **成交 / 下单** | 报价接受或老客复购 | 订单确认 | `SalesOrder` + `SalesOrderItem` | `Opportunity`(必填)、`Quotation`(可空)、`SampleOrder`(可空)、`Customer` | `SalesOrderStatus`（10 态） | **成交价、数量、金额、定金/尾款、汇率** | **是** | **是** |
| 6 | **生产** | 订单进入生产 | 生产完成 | `ProductionOrder` + `ProductionOrderItem` | `SalesOrder`、`Supplier`(外发)、`SalesOrderItem` | `ProductionStatus` + `ProductionItemStatus` | 完成数、不良数、进度 | 部分 | **是** |
| 7 | **采购 / 外发** | 生产需要 | 到货 | `PurchaseOrder` + `PurchaseOrderItem` | `Supplier`、`ProductionOrderItem`、`SalesOrder` | `PurchaseStatus` + `PurchaseItemStatus` | 采购单价、金额 | 部分 | **是** |
| 8 | **质检** | 生产完成 / 出货前 | 判定通过 | `QualityInspection` | `ProductionOrder` 或 `Shipment`（exact-one） | `InspectionResult` | 抽样数、不良数、不良率 | 是（检验人姓名） | **是** |
| 9 | **交付 / 出货** | 备货完成 | 到港 / 完成 | `Shipment` + `ShipmentItem` | `SalesOrder`、`Customer`、`SalesOrderItem` | `ShipmentStatus` | 运费、件数、毛净重、体积 | 部分 | **是** |
| 10 | **回款** | 收款发生 | 对账确认 | `Payment` | `SalesOrder`(IN) 或 `PurchaseOrder`(OUT)，`Customer` 辅助 | `PaymentStatus`（PENDING→RECEIVED→CONFIRMED） | **收款金额、汇率、比例、凭证** | **是** | **是** |
| 11 | **利润核算** | 收入与成本齐备 | 确认 | `Profit` | `SalesOrder`（1:1） | `ProfitStatus` | 收入/各项成本/利润率 | **是**（`costSnapshot` 已实现） | **是** |
| 12 | **售后 / 复购** | — | — | **无模型**：复购走「新 SalesOrder（`quotationId` 可空）」；售后无落点 | — | — | — | — | 缺口 |

**阶段派生（重要正面设计）**：阶段不落库，由 `deriveStage` 按关联单据推导：

```52:64:server/src/utils/pipelineStage.ts
export function deriveStage(
  opportunity: { id: string; leadId?: string | null },
  signals?: OpportunityStageSignals,
): PipelineStage {
  if (signals) {
    if (signals.hasShipment) return 'SHIPPED';
    if (signals.hasProductionOrder) return 'PRODUCTION';
    if (signals.hasSalesOrder) return 'ORDER';
    if ((signals.sampleOrderCount ?? 0) > 0) return 'SAMPLE';
    if ((signals.quotationCount ?? 0) > 0) return 'QUOTED';
  }
  return 'OPPORTUNITY';
}
```

`deriveStages` 批量版仅用 3 个 groupBy/findMany 完成全量推导（`pipelineStage.ts:72-135`），调用点 6 处（`sales.controller.ts:188/215/244/287/347`、`customer.controller.ts:1593`）。

**结论**：YSEM 的业务过程**已经是一条链**，且刻意避免了「阶段落库」这一最典型的重复字段来源。当前问题不是「阶段重复」，而是**链上每一环都各自复制了 `customerId` 与渠道信息，且没有一个统一的「过程实例」概念**。

---

## 4. Master Data Inventory

判定标准（四项全满足才计入主数据）：① 独立生命周期；② 被 ≥2 个业务过程引用；③ 应有唯一权威来源；④ 其它模块只应引用 ID。

### 4.1 真正的主数据（6 类实体）

| 主数据 | 模型 | 生命周期 | 被引用的过程 | 权威维护方 | 当前引用方式 | 判定 |
|---|---|---|---|---|---|---|
| **客户** | `Customer` | 建档 → 停用（软删白名单 Q9） | Lead / Opportunity / Quotation / SampleOrder / SalesOrder / Shipment / Payment / CustomerProduct / ProductPrice | 业务员（`ownerId`，null=公海） | **真 FK** ✔ | ✅ 合规 |
| **产品** | `Product` | 建档 → 停用（软删白名单） | LeadItem / OpportunityItem / QuotationItem / SampleOrder / SalesOrderItem / ProductionOrderItem / PurchaseOrderItem / ComboItem | 产品负责人（`ownerId` + `visibility`） | **真 FK（全部可空 SetNull）** ✔ | ✅ 合规 |
| **供应商** | `Supplier` | 建档 → 停用（软删白名单） | PurchaseOrder / ProductionOrderItem(外发) | 采购 | **真 FK** ✔ | ✅ 合规 |
| **渠道 / 平台** | `Channel` | 自关联树，ONLINE/OFFLINE | Lead / Customer / (Opportunity 在途) | 系统设置 | 真 FK，但从一处复制成多处（见 §10） | ⚠️ 引用方式待定 |
| **组织 / 人员** | `User` / `Department` / `Role` / `Permission` | 覆盖（User 软删白名单） | 全部 | 管理员 | `ownerId` 真 FK；`createdBy/updatedBy` **裸字符串** | ⚠️ 半合规 |
| **组合产品** | `ComboProduct` | 停用即删除（Q9 不设 deletedAt） | ComboItem；**未被任何业务过程引用** | 产品 | — | ⚠️ 事实上是产品的一个变体，未接入主链（`order/` 目录为空、无 route 引用） |

### 4.2 字典型主数据（9 类，均为「系统设置」页维护）

| 字典 | 模型 | 被谁引用 | 引用方式 | 判定 |
|---|---|---|---|---|
| 客户类型 | `CustomerType` | `Customer.customerType` / `Lead.customerType` | **裸字符串存 name，无 FK** | ❌ 违反 SSOT（`03-customer.prisma:37` 注释「有意不建」） |
| 沟通工具 | `CommunicationTool` | `Customer/Lead.contactMethods` Json 数组 | 存 name 字符串 | ⚠️ 同上（`03-customer.prisma:190`） |
| 单位 | `Unit` | `Lead.unit`、`ProductPrice.unit`、各行 `unit` | 存 name/code 字符串 | ⚠️ 同上 |
| 币种（展示） | `CurrencyRate` | 顶部汇率切换、下拉 | `code` 与 `Currency` 枚举对齐 | ✅ 分工明确 |
| 证书 | `Certificate` | `ProductCertification` | **真 FK** ✔ | ✅ 合规 |
| 产品工艺 | `ProductCraft` | `ProductCraftLink` / `Supplier.crafts`(name 数组) / `LeadItem.craftIds`(id 数组) | **三种引用方式并存** | ❌ 需统一 |
| 产品受众 | `ProductAudience` | `Product.category`、`LeadItem.audienceId`（裸 String） | FK + 裸 String | ⚠️ |
| 产品品类 | `ProductCategory` | `Product.categoryId`、`LeadItem.categoryId`（裸 String）、`Supplier.categories`(name 数组) | FK + 裸 String + 数组 | ❌ 需统一 |
| 每日汇率 | `DailyExchangeRate` | `utils/currency.ts` 换算 | 唯一汇率数据源 | ✅（严格说属「时间序列参考数据」，非主数据） |

### 4.3 被误认为主数据、实则应归位或缺失的对象

| 对象 | 现状 | 判定 |
|---|---|---|
| **国家 / 地区** | **无主数据表**。`Customer.country/region`、`Lead.country`、`Supplier.country` 均为 `String?`，取值来自前端常量 `client/src/data/countries.ts`（ISO alpha-2 数组） | ⚠️ 前端常量即 SSOT，DB 无法约束、无法统计、无法多语言。可接受（国家列表稳定），但需**明确冻结为「前端枚举契约」**，禁止后端再存中文名 |
| **联系人 Contact** | **无模型**。三种存法并存：① `Customer.contactName/position/email/phone/wechat` 标量；② `Customer/Lead.contactMethods Json [{tool,account}]`；③ `Supplier.contact/phone/email`、`Department.phone/email` | ❌ **这是真正的架构缺口**：同一客户多联系人无法表达；同一事实在同一张表内有两种表示（标量 + JSON），是**表内重复** |
| **Organization / 租户** | **不存在**。全仓库无 `organization/tenant` 模型，系统为单租户 | ✅ 现状一致，但需冻结「是否永远单租户」 |
| **Lead** | 常被当作主数据（有 `leadNo`、独立页面、公海/认领/转移） | ❌ **不是主数据**：它不描述「什么东西是什么」，而是描述「一次尚未成立的销售机会走到哪一步」。见 §14 / §15 |
| **ProductTask** | 挂在 `Product` 上（主数据），含 `type/status/refType/refId/dueDate/ownerId` | ⚠️ **过程数据挂在主数据上**。`Product` 是主数据却被业务流程回写状态，属职责混淆 |
| **ProductVisibleUser** | 产品 × 用户（可见性） | ✅ 合规的关系表 |

---

## 5. Business Process Inventory

按「独立业务对象 vs 同一过程的不同阶段」判定（依据：生命周期 + 状态机 + 是否产生独立业务事实 + 是否被独立引用）：

| 对象 | 独立生命周期？ | 有独立状态机？ | 产生独立业务事实？ | 被独立引用？ | 判定 |
|---|---|---|---|---|---|
| `Lead` | 半独立（转商机后即终止） | `LeadStatus` 4 态，**只能由下游单据自动推进** | 否（只有需求描述） | `OperationLog` 溯源 | **属于 Sales Process 的阶段容器**，不应视为与 Customer 平级的主数据 |
| `LeadItem` | 随 Lead | — | 否 | — | 需求明细（**弱快照**：productDesc/尺寸/工艺/受众/品类） |
| `Opportunity` | **是** | `OpportunityOutcome`（死列）+ 派生 stage | 意向金额（非交易） | `Quotation/SampleOrder/SalesOrder` 必填 FK | **是销售过程的核心载体**，独立持久化成立 |
| `OpportunityItem` | 随 Opportunity | — | 意向数量/目标价 | — | 关系 + 轻量快照 |
| `Quotation` | **是**（version 链） | `QuotationStatus` 6 态 | **是**（报价价、条款、有效期、成本价） | `SalesOrder.quotationId` | **必须独立**：历史事实 + 客户签署依据 |
| `SampleOrder` / `SampleRound` | **是**（多轮次） | `SampleStatus` 8 态 + 轮次结果 | **是**（打样费） | `SalesOrder.sampleOrderId` | **必须独立** |
| `SalesOrder` | **是** | `SalesOrderStatus` 10 态 | **是**（成交价/数量/金额） | Production/Shipment/Payment/Profit/Purchase | **必须独立** |
| `ProductionOrder` | **是** | `ProductionStatus` + `ProductionItemStatus` | 是（完成数/不良数） | PurchaseOrder | **必须独立** |
| `PurchaseOrder` | **是** | `PurchaseStatus` + `PurchaseItemStatus` | 是（采购价） | Payment(OUT) | **必须独立** |
| `Shipment` | **是**（可分批） | `ShipmentStatus` | 是（运费/装载量） | QualityInspection | **必须独立** |
| `QualityInspection` | **是** | `InspectionResult` | 是（不良率） | — | **必须独立** |
| `Payment` | **是** | `PaymentStatus`（两步：已到账 / 已对账） | **是**（金额/汇率/凭证） | — | **必须独立** |
| `Profit` | **是**（1:1 订单） | `ProfitStatus` | **是**（成本/利润） | — | **必须独立** |
| **Follow-up / Activity / Task** | **不存在独立表** | — | — | — | ✅ **已正确收敛进 `OperationLog`**（4 个副表已删）。**不要再新增 Activity 表。** |

**核心结论**：

> **Lead 与 Opportunity 不是两个平级业务对象，而是同一条 Sales Process 的两个阶段。**
> 但 `Quotation` / `SampleOrder` 虽然处于同一条链上，**因为有独立生命周期 + 独立历史事实 + 独立状态机，必须独立建模**。
> `SalesOrder` 之后进入**履约域**，与销售过程是不同业务域（不同 owner、不同关注点、不同状态机）。

---

## 6. Relationship Data Inventory

| 关系表 | 两端 | 是否持有「事实」 | 是否被正确使用 | 判定 |
|---|---|---|---|---|
| `ProductCraftLink` | Product × ProductCraft | 否 | ✅（物理表 `_ProductCraftToSingleProduct`，`@map` 精确对齐） | ✅ 合规 |
| `ProductVisibleUser` | Product × User | 否（权限） | ✅ | ✅ 合规 |
| `ProductCertification` | Product × Certificate | **是**（本产品证书编号/有效期，可与字典不同） | ✅ | ✅ 关系 + 事实（合理） |
| `ComboItem` | ComboProduct × Product | 是（quantity/price） | ⚠️ 未接入业务链 | ⚠️ |
| `LeadItem` | Lead × Product | 是（需求数量/尺寸/工艺） | ✅ | ⚠️ 关系 + 需求快照混合（可接受） |
| `OpportunityItem` | Opportunity × Product | 是（quantity/targetPrice） | ✅ | ⚠️ 同上 |
| `QuotationItem` / `SalesOrderItem` | 单据 × Product | **是**（交易事实）+ 快照 | ✅ | ✅ 三重职责但**是正确落点** |
| `SampleOrder`（表头即单个产品） | SampleOrder × Product | 是 | ✅ | ✅ 打样单天然单产品（`rounds` 承担多轮） |
| `ProductionOrderItem` / `ShipmentItem` / `PurchaseOrderItem` | 单据 × 产品/订单行 | 是 | ✅ | ✅ |
| `CustomerProduct` | Customer × Product | **是**（定制版本 `version` + `agreedPrice`） | ❌ **无任何 CRUD**（无 controller / route / 前端 API）；仅 `SalesOrderItem.customerProductId` 可被客户端传任意 id | ❌ **死关系** |
| `ProductPrice` | Customer × Product × minQty × Currency | 是（客户专属价） | ❌ **0 写入 0 读取**，仅 `product.controller.ts:362` 注释提及 | ❌ **死模型** |
| `ShopChannel` | — | — | **不存在**（`Channel` 自关联树替代） | ✅ 合规 |
| `CustomerContact` | — | — | **不存在**（联系人内嵌） | ❌ 缺口 |

**关系层的核心问题**：关系表本身设计基本正确，但存在 **两个死关系（`CustomerProduct` / `ProductPrice`）与一个缺口（`CustomerContact`）**。死关系的危害大于重复字段：它们让「客户专属价格」这一类事实**在架构上声明存在、在系统中无处可写**，导致价格只能落进 `QuotationItem.unitPrice` / `SalesOrderItem.unitPrice`，从而**丧失「客户级价格约定」这一主数据能力**。

---

## 7. Business Fact Inventory

「业务事实」判定：某次真实业务发生了什么，**不得因主数据更新而改变**。

| 事实 | 落点 | 是否可被主数据变更影响 | 判定 |
|---|---|---|---|
| 报价单价 / 金额 | `QuotationItem.unitPrice/amount`、`Quotation.totalAmount` | 否（快照 + 独立列） | ✅ |
| 报价成本价 | `QuotationItem.costPrice` | 否 | ✅ |
| 报价条款 | `Quotation.tradeTerms/paymentTerms/leadTime/validUntil/portOfLoading` | 否 | ✅ **（实质上已承担了空壳 `customerSnapshot` 的职责）** |
| 打样费 | `SampleOrder.feeAmount`、`SampleRound.feeAmount` | 否 | ✅ |
| **成交价 / 成交数量** | `SalesOrderItem.unitPrice/quantity/amount/currency/costPrice/costAmount` | 否 | ✅ |
| **订单金额构成** | `SalesOrder.totalAmount/depositRatio/depositAmount/balanceAmount` | 否 | ✅ |
| 采购价 | `PurchaseOrderItem.unitPrice/amount` | 否 | ✅ |
| 运费 | `Shipment.freightAmount/freightAmountCny`（ADR-20：Profit 运费的唯一数据源） | 否 | ✅ |
| **收付款** | `Payment.amount/amountCny/ratio/payDate/method/bankAccount` | 否 | ✅ |
| 汇率（发生时刻） | `Quotation/SalesOrder/Payment/PurchaseOrder/Profit.exchangeRate`、`Lead.usdRate` | 否（建档时抓取一次，不再变更） | ✅ **正确的「时点事实」** |
| 利润 | `Profit.revenue/revenueCny/*CostCny/totalCostCny/profitCny/margin` + `costSnapshot` | 否 | ✅ |
| 质检结果 | `QualityInspection.sampleQty/defectQty/defectRate/disposition` | 否 | ✅ |
| 出货装载量 | `Shipment.packageCount/grossWeight/netWeight/volume`、`ShipmentItem.quantity` | 否 | ✅ |
| **已收累计** | `SalesOrder.paidAmountCny` | **是（派生汇总，会变）** | ⚠️ 属**派生数据**，非事实（详见 §13） |
| **已发数量** | `SalesOrderItem.shippedQty` | **是（派生汇总）** | ⚠️ 同上 |

**结论**：业务事实层的落点设计**质量很高**——金额三件套（`currency` + `exchangeRate` + `amountCny`）在全系统一致，汇率快照语义统一。真正的缺陷只有两处：① 派生汇总字段与业务事实混在同一张表（`paidAmountCny` / `shippedQty` / `progress`）；② 客户级价格约定（`ProductPrice`）事实无处落。

---

## 8. Draft Audit

### 8.1 现状（证据）

**只有 `Lead` 有 Draft 概念**，且是**同表行内标识**，不是独立表：

```247:254:server/prisma/schema/03-customer.prisma
  /// 三步向导当前阶段（0 客户信息 / 1 需求详情 / 2 确认商机）：
  stage Int?
  /// 草稿标记：暂存=1（仅落线索表，未建档）；建档/锁定/正式提交=0。
  draft Boolean @default(false)
  /// 阶段锁定标志：客户信息（建档后锁定）/ 需求详情（建档后锁定）是否锁定。
  customerLocked Boolean @default(false)
  productLocked  Boolean @default(false)
```

| 问题 | 证据 | 判定 |
|---|---|---|
| Q：Draft 存在哪里？ | 同表布尔列 + `stage Int?` + 两个锁定布尔列 | ✅ 方向正确（未建重复表） |
| Q：Draft 与正式数据的关系？ | 同一行、同一 ID；`draft` 只影响**录入校验** | ⚠️ 见下 |
| Q：Draft 是否独立 ID？ | 否，与正式 Lead 同一 `id`/`leadNo` | ✅ 正确 |
| Q：Draft 是否允许引用主数据？ | 允许（`customerId`/`productId`/`channelId` 在草稿期即可为空或已填） | ✅ 正确 |
| Q：Draft 转正式时发生什么？ | `draft: false`；**由前端编排**：`ConvertCreateSummaryModal` / `LeadFormModal.createCustomerFromForm` 创建 Customer/Product，再 `leadApi.update({customerId})` | ❌ **非事务、非幂等** |
| Q：Draft 是否产生重复数据？ | 否（同表）。**但**「客户按名称模糊匹配」会：`convertLead.ts:60-65` `findCustomerByName` 拉 `pageSize: 200` 在前端 `toLowerCase()` 比对 → **重复客户风险** | ❌ |
| Q：Draft 删除/取消后数据如何处理？ | 无特殊处理，走 Lead 删除 | ⚠️ 未定义 |

### 8.2 Draft 的实际作用（只有一处功能）

```559:564:server/src/controllers/lead.controller.ts
  // 唯一实质作用：draft 放宽「至少一条联系方式」校验
```

`draft=true` 的**唯一硬性效果**是放宽联系方式必填校验；其余全部是前端 UI 派生（`LeadFormModal.tsx:1028/1031/1066-1068/1170-1171`）。

### 8.3 Draft 的三个实质问题

**D1 · 语义与其它 6 个模块不一致**

| 模块 | Draft 表达方式 | 语义 |
|---|---|---|
| Lead | `draft Boolean`（旁挂） | 「尚未建档」 |
| Quotation | `QuotationStatus.DRAFT`（状态机首态） | 「尚未提交」 |
| SampleOrder | `SampleStatus.DRAFT` | 同上 |
| SalesOrder | `SalesOrderStatus.DRAFT` | 同上 |
| ProductionOrder | `ProductionStatus.DRAFT` | 同上 |
| PurchaseOrder | `PurchaseStatus.DRAFT` | 同上 |
| Profit | `ProfitStatus.DRAFT` | 同上 |

→ **同一个词表达两种完全不同的东西**：① 状态机首态；② 「主数据尚未建档」的数据完整度标志。**Lead.draft 本质上不是 Draft，而是「客户/产品尚未建档」的完整性标志**，命名为 draft 是误导。

**D2 · 锁定标志与派生规则双轨并存**

```892:897:client/src/components/lead/LeadFormModal.tsx
  // customerLocked ?? (!!customerId && !draft)
```

落库值（`customerLocked/productLocked`）与派生规则（`!!customerId && !draft`）同时存在，两者可能不一致——**这是「同一事实两种来源」的表内重复**。

**D3 · 历史数据靠启发式回填**

```sql
-- server/prisma/migrations/20260926010000_lead_draft/migration.sql
UPDATE "Lead" SET "draft" = TRUE WHERE "customerId" IS NULL AND "stage" IS NOT NULL;
```

用 `customerId IS NULL AND stage IS NOT NULL` 推断历史草稿——**无权威依据的猜测**，说明 `draft` 从来不是一个被明确定义的状态。

---

## 9. Snapshot Audit

### 9.1 四类快照，成熟度差异极大

| 类别 | 字段 | 写入 | 读取/消费 | 判定 |
|---|---|---|---|---|
| **① 声明但从未实现（死字段）** | `Quotation.customerSnapshot` | ❌ 0 写入 | ❌ 0 消费 | ❌ 删除或明确定义 |
| | `SampleOrder.customerSnapshot` | ❌ | ❌ | ❌ 同上 |
| | `SalesOrder.customerSnapshot` / `termsSnapshot` | ❌ | ❌ | ❌ 同上 |
| | `Quotation.parentId` / `revisions`（版本链） | ❌ 写入 Deferred | 仅 `orderBy version desc` | ⚠️ 半成品 |
| | `Opportunity.outcome/outcomeAt/wonAt/lostReason` | ❌ **0 引用（server+client 全无）** | ❌ | ❌ 删除或接线 |
| **② 唯一真实完整实现** | `Profit.costSnapshot` | ✅ `profit.controller.ts:252-288` `buildCostSnapshot`（Decimal→String 防精度丢失） | 仅类型声明（`client/src/api/profits.ts:62`），**无页面渲染** | ✅ 写入正确，展示缺失 |
| **③ 明细行快照（实际在跑）** | `OpportunityItem.productName`；`QuotationItem.productName/productSku/spec/craft/size/packaging`；`SampleOrder.productName/spec/craft/size/packaging`；`SalesOrderItem.productName/productSku/spec/craft/size/material/packaging/colors`；`ShipmentItem.productName/spec`；`ProductionOrderItem.productName/spec`；`PurchaseOrderItem.itemName/spec` | ✅ 均在创建时写入 | ✅ 列表/详情直接回显 | ✅ 冻结语义正确，⚠️ 但被当展示名用 |
| **④ 汇率快照** | 各表 `exchangeRate`；`Lead.usdRate` | ✅ | ✅ | ✅ 正确 |

### 9.2 明细快照的写入策略（关键证据）

**「入参优先 + Product 兜底」**，且**产品主数据更新后不回写**（冻结语义正确）：

```171:172:server/src/controllers/quotation.controller.ts
  // 三处注释背书：「Product 后续改名不会回溯修改已落库明细」
  // → quotation.controller.ts:171 / salesOrder.controller.ts:188 / sampleOrder.controller.ts:153
```

写入实现（`quotation.controller.ts:174-230`、`salesOrder.controller.ts:191-258`）：

```
productName = item.productName ?? product.name
productSku  = item.productSku  ?? product.sku
packaging   = item.packaging   ?? product.packaging
spec / craft / size → 仅取入参（Product 无对应列）
```

`product.controller.ts:457-547` `updateProduct` **仅** `tx.product.update`，无任何明细回写。✔

### 9.3 快照的核心问题

**问题 1 · `Snapshot ≠ Duplicate` 的边界被执行层破坏**

快照字段同时被当作**展示字段**：
- `QuotePage.tsx:443-444` 直接渲染 `productName/spec`
- `SalesOrders.tsx:642-643`、`SamplePage.tsx:263/393`
- `salesOrder.controller.ts:44`：`sampleOrder: { select: { productName: true } }` → 列表用打样单快照当展示名

→ 导致「展示需要」成为修改快照的理由（例如有人会想「产品改名了，列表要跟着变」）。

**问题 2 · 可见性投影会篡改历史快照（严重）**

```44:56:server/src/controllers/quotation.controller.ts
const withProductVisibility = <T>(req: AuthRequest, record: T): T => {
  const rec = record as Record<string, unknown>;
  return {
    ...rec,
    items: projectProductRows(
      req,
      (rec.items ?? []) as Record<string, unknown>[],
      QUOTATION_ITEM_PRODUCT_FIELDS,
      { nameField: 'productName' },   // ← 不可见 ⇒ 快照 productName 被置 null
    ),
  } as T;
};
```

即：**权限投影会把「历史快照」改写为 null**（`quotation.controller.ts:44` 注释自己写明「不可见 ⇒ product=null 且快照 productName=null」）。同样的模式存在于 `sales.controller.ts:78-86`（`OpportunityItem.productName`）。

→ 违反快照不可变原则。快照一旦落库，就不应因**当下**的产品可见性被抹除。这与「快照 = 当时发生的事实」直接冲突。

**问题 3 · 5 套独立实现，无统一构造器**

| 实体 | 构造函数 |
|---|---|
| QuotationItem | `parseItems`（`quotation.controller.ts:174`） |
| SalesOrderItem | `parseItems`（`salesOrder.controller.ts:191`） |
| SampleOrder | `resolveProductSnapshot`（`sampleOrder.controller.ts:156-166`） |
| OpportunityItem | `buildItems`（`sales.controller.ts:107-126`） |
| PurchaseOrderItem | 纯入参（`purchaseOrder.controller.ts:179-283`，注释「不复制数据」） |

**问题 4 · 前端无「选产品自动带出快照」**

`QuotePage.tsx:542` / `SalesOrders.tsx:806` / `SamplePage.tsx:495` 的 `productName` 是**手填 Input（"名称（手填）"）**；`productId` Select 只改 id。快照兜底完全靠 server。→ **展示值与事实值可能不一致**（用户手填的名称会覆盖产品真名，且这是被设计允许的）。

**问题 5 · 打样单是「表头即单产品」**

`SampleOrder` 无明细表，`productName/spec/craft/size/packaging` 直接挂表头。多产品打样无法表达。

---

## 10. Duplicate Field Audit

区分六类，逐项判「删除 / 保留 / 改关系 / 改快照」。

### 10.1 A 类：真正重复的**主数据事实**（应改联查）— 只有一组

| 字段 | 出现位置 | 事实归属 | 权威来源 | 当前机制 | 判定 |
|---|---|---|---|---|---|
| `companyName` | `Lead.companyName` / `Customer.companyName` | Customer | Customer | Lead 建档后仍保留原值，且 `Lead.customerId` 已存在 → 两份并存 | **保留但降级**：`Lead.companyName` 是「建档前录入值」，转档后应只作历史留痕（改名「intakeCompanyName」语义），**不得**作为展示源 |
| `contactName` / `email` / `phone` | `Lead.*` / `Customer.*` / `Supplier.*` / `Department.*` / `User.*` | Contact（缺失） | 无 | 5 张表各存一份 | ❌ **根因是缺 Contact 主数据**。短期：Lead 值降级为 intake 留痕；长期：引入 `Contact` |
| `country` | `Lead.country` / `Customer.country` / `Supplier.country` | 各自实体 | 各自 | 三处独立 | ⚠️ 保留（各主体可不同），但需**冻结国家值域为 ISO alpha-2 常量** |
| `customerType` | `Lead.customerType` / `Customer.customerType` | Customer | `CustomerType` | 两处存 `name` 字符串，**无 FK** | ❌ 两处都违反 SSOT（含无 FK） |
| `contactMethods` | `Lead.contactMethods` / `Customer.contactMethods` | Contact | Customer | 两处 Json | ❌ 同 Contact 缺口 |
| **`channelId` / `shopId`** | `Lead` / `Customer` / **`Opportunity`（在途）** | **来源事实** | 应只有一处 | 三处复制，靠 `convertLead.ts:166-167` 手工带入 | ❌ **最有争议**，见 §13-D1 / §24-D1 |
| **`customerId`** | `Quotation` / `SampleOrder` / `SalesOrder` / `Shipment` / `Payment` | 由 `Opportunity.customerId` / `SalesOrder.customerId` 派生 | 上游 | 应用层一致性校验（`salesOrder.controller.ts:329-346`），非 DB 约束 | ⚠️ **冗余 FK**：可派生，但保留有查询性能与安全（Restrict）价值。建议：**Quotation 保留**（报价单需独立成立），**Shipment/Payment 建议评估** |

### 10.2 B 类：**跨表展示字段**——经证实基本不存在

| 字段 | 预期会重复 | 实测 | 判定 |
|---|---|---|---|
| `customerName` | 曾在 `Lead/Opportunity/Order` | **`server/src` 全局 0 命中**；`Opportunity` **无** `customerName` 列；一律 `customer: { select: { companyName } }` 联查（`sales.controller.ts:86-95`、`quotation.controller.ts:62-69`、`salesOrder.controller.ts:40-46`） | ✅ **优秀，无冗余展示字段** |
| `productName`（商机/报价/订单） | 预期重复 | 仅有**快照**语义（见 §9），非展示冗余 | ✅ |

> **重要修正**：本次审计证实，YSEM **并没有**「每张业务表都复制 customerName/productName」的问题。真正的客户资料冗余只存在于 `Lead`（且 Lead 本身是过程容器）。这一点与任务预设不同，需在决策时纠正。

### 10.3 C 类：**过程属性**（归属清晰，非重复）

| 字段 | 归属 | 判定 |
|---|---|---|
| `status`（各单据枚举） | 各过程自身 | ✅ 保留（但见 §22 风险：状态可由客户端任意设置） |
| `ownerId` | 各过程自身（销售员/跟单员/采购员/生产负责人） | ✅ 保留 |
| `expectedCloseDate` / `estimatedAmount` / `intentLevel` / `probability` | Opportunity | ✅ 保留 |
| `outcome/outcomeAt/wonAt/lostReason` | Opportunity | ❌ **0 引用死列**，删除或接线 |
| `Lead.status` / `stage` / `draft` / `customerLocked` / `productLocked` | Lead | ⚠️ 5 列表达同一件事（「走到哪一步」），可压缩 |
| `Opportunity.stage` | **已正确改为派生不落库** | ✅ 典范 |

### 10.4 D 类：**业务事实**（必须保留，非重复）

见 §7 全表。判定：**全部保留**。

### 10.5 E 类：**快照**（保留，但需规范）

见 §9。判定：明细行快照**全部保留**（语义正确）；`customerSnapshot/termsSnapshot` **删除或定义**。

### 10.6 F 类：**派生/聚合字段**（应明确标记为派生，非独立事实）

| 字段 | 声明 | 实测写入 | 判定 |
|---|---|---|---|
| `Customer.totalOrderAmountCny` | 「由履约层回写，只读」 | **0 写入** | ❌ 空列。要么接线，要么删 |
| `Customer.lastOrderAt` | 同上 | **0 写入** | ❌ 同上 |
| `Customer.firstOrderAt` | 同上 | 仅由**人工**在客户建/改时写入（`customer.controller.ts:1167`），**非履约层回写** | ❌ 语义与实现不符 |
| `SalesOrder.paidAmountCny` | 「由 Payment(status=CONFIRMED) 汇总回写」 | ✅ `payment.controller.ts:225-242` `recalcPaidAmountCny`（事务内 + 行锁 `lockSalesOrders`） | ✅ 实现正确，但属派生 → 应明确标注 |
| `SalesOrderItem.shippedQty` | 「由 ShipmentItem 汇总回写」 | ✅ `shipment.controller.ts:303-329` `recalcShippedQty`（行锁） | ✅ 同上 |
| `ProductionOrder.progress` | 「由明细汇总回写」 | ⚠️ `productionOrder.controller.ts:218-227` 是**纯计算**，值来自 `body.progress ?? parsed.progress ?? 0`（**入参**，非汇总） | ❌ 语义与实现不符 |
| `ProductionOrderItem.completedQty/defectQty` | 明细汇总 | 行输入（`productionOrder.controller.ts:186-203`），非汇总 | ⚠️ 实为事实，命名误导 |
| `PurchaseOrderItem.arrivedQty` | 到货汇总 | **入参**保留（`purchaseOrder.controller.ts:268-288`），非到货单汇总；`PurchaseItemStatus` 自动同步**仅见注释**（`purchaseOrder.controller.ts:45`），未实现 | ❌ 语义与实现不符 |
| `Product.stock` / `lowStockAlert` | 库存 | 仅人工建/改/导入（`product.controller.ts:101-102,544`），**无发货扣减 / 采购入库联动** | ❌ 库存事实未闭环 |

### 10.7 G 类：**表内重复**（同一张表内两种表示同一事实）

| 表 | 重复 | 判定 |
|---|---|---|
| `Customer` | `contactName/email/phone/wechat` 标量 **vs** `contactMethods Json [{tool,account}]` | ❌ **同一事实两种表示**。`03-customer.prisma:32-33` 注释明确「替代单字段 phone/email/wechat 的扁平录入」，但**旧标量未删除** → 双写风险 |
| `Lead` | `email/phone` 标量 **vs** `contactMethods Json` | ❌ 同上（`03-customer.prisma:222-224`） |
| `Lead` | `draft` **vs** `customerLocked/productLocked`（可由 `!!customerId && !draft` 派生） | ⚠️ 双轨 |
| `Opportunity` | `outcome`（0 引用）**vs** 派生 stage | ❌ 两套阶段真相 |

---

## 11. Data Ownership Matrix

| 数据 | 当前存储位置 | 真正归属 | 权威来源 | 其他模块 | 是否允许复制 | 是否需要快照 | 建议 |
|---|---|---|---|---|---|---|---|
| 客户名称 | `Customer.companyName`；`Lead.companyName`（intake） | Customer | Customer | Lead/Opportunity/Quotation/SalesOrder/Shipment | ❌ | 仅历史场景（暂不需要） | Lead 侧降级为「建档前录入值」；其余**联查** |
| 客户编号 | `Customer.customerNo` | Customer | Customer | 全部 | ❌ | 否 | 联查 |
| 客户类型 | `Customer.customerType`(String)、`Lead.customerType`(String) | Customer | `CustomerType` | Lead | ❌ | 否 | **加 FK 或冻结为字典 code**；Lead 侧删除 |
| 客户等级 | `Customer.customerLevel`(enum) | Customer | Customer | — | ❌ | 否 | 保持 |
| 客户所属渠道/平台 | `Customer.channelId/shopId` | **来源事实** | 待决策 | Lead / Opportunity | 待决策 | 否 | **见 §24-D1** |
| 客户联系人 | `Customer.contactName/email/phone/wechat/contactMethods` | Contact（缺失） | Customer | Lead/Supplier | ❌ | 否 | 引入 `Contact`，先删标量或 JSON 之一 |
| 客户国家 | `Customer.country` | Customer | 前端常量 | — | 各主体可独立 | 否 | 冻结 ISO alpha-2 |
| 客户归属 | `Customer.ownerId`（null=公海） | Customer | Customer | 全部 | ❌ | 否 | 保持（公海=null 语义已稳定） |
| 客户首单/末单/累计 | `Customer.firstOrderAt/lastOrderAt/totalOrderAmountCny` | **派生（SalesOrder 聚合）** | SalesOrder | — | 允许派生缓存 | 否 | **接线或删除** |
| 产品名称 | `Product.name` | Product | Product | 全部单据 | ❌（**但单据行允许快照**） | **订单/报价/打样是** | 主数据联查；单据行快照冻结 |
| 产品 SKU / 型号 | `Product.sku` / `model` | Product | Product | 单据 | ❌ | 报价/订单可快照 | 同上 |
| 产品分类（品类/受众/工艺） | `Product.categoryId/audienceId`(FK)、`crafts`(Link)；`LeadItem.craftIds/audienceId/categoryId`(裸 String) | Product | 三个字典表 | LeadItem | ❌ | 否 | LeadItem 侧改 FK |
| 产品标准价 | `Product.defaultPrice/defaultCurrency/defaultTaxRate` | Product | Product | 报价/订单 | ❌（参考值） | 计价时快照 | 保持 |
| **客户专属价格** | `ProductPrice`（**0 读写**） | **关系事实（Customer×Product）** | ProductPrice | 报价/订单 | ❌ | 计价时快照 | **接线或删除**（见 §21） |
| 客户定制规格 | `CustomerProduct`（**无 CRUD**） | 关系事实 | CustomerProduct | SalesOrderItem | ❌ | 订单快照 | **接线或删除** |
| 商机标题 / 意向金额 / 意向等级 / 概率 / 预计成交日 | `Opportunity.title/estimatedAmount/intentLevel/probability/estimatedCloseDate` | Opportunity（过程） | Opportunity | — | ❌ | 否 | 保持 |
| 商机阶段 | **派生不落库**（`pipelineStage.ts`） | 派生 | 关联单据 | 列表/看板 | 允许计算 | 否 | ✅ 保持，制度化 |
| 商机终态 | `Opportunity.outcome/outcomeAt/wonAt/lostReason` | Opportunity | Opportunity | — | ❌ | 否 | **删除或接线** |
| 线索来源 | `Lead.source`(enum) + `Lead.channelId/shopId` | Lead | Lead | Customer | 转入时一次 | 否 | 只保留一处 |
| 线索需求（产品/数量/尺寸/工艺/交期/目标价/币种） | `Lead.productInterest/quantity/targetPrice/currency/unit/expectedDelivery` + `LeadItem.*` | Lead（过程） | Lead | Opportunity 转入 | 转入一次 | 是（转入时的需求快照） | **保留**，但需与 `LeadItem` 去重（表头 vs 明细双份） |
| 线索状态 | `Lead.status`（自动推进） | 派生（下游单据） | 单据事件 | — | ❌ | 否 | ✅ 保持 |
| 线索草稿/锁定 | `Lead.draft/stage/customerLocked/productLocked` | 派生 | `customerId/productId` | — | ❌ | 否 | **压缩为派生**（见 §20） |
| 报价单价/数量/金额/成本价 | `QuotationItem.*` | **业务事实** | Quotation | — | — | **是** | 保留 |
| 报价条款/有效期 | `Quotation.tradeTerms/paymentTerms/leadTime/validUntil/portOfLoading` | **业务事实** | Quotation | 订单参考 | 参考复制 | 是 | 保留 |
| 报价产品快照 | `QuotationItem.productName/productSku/spec/craft/size/packaging` | **快照** | 报价时点 | — | — | **是** | 保留，但**禁止被可见性投影改写** |
| 报价状态 | `Quotation.status` + 4 时间戳 | 过程 | Quotation | — | ❌ | 否 | 保留（需加流转校验） |
| 客户快照 | `Quotation/SampleOrder/SalesOrder.customerSnapshot/termsSnapshot` | 未定义 | — | — | — | — | **删除或定义** |
| 打样单产品信息 | `SampleOrder.productName/spec/craft/size/packaging` | 快照 | 打样时点 | — | — | 是 | 保留；建议加明细表 |
| 打样轮次 | `SampleRound.*` | 过程 + 事实 | SampleOrder | — | — | 是 | 保留 |
| 成交价 / 数量 / 金额 / 定金 | `SalesOrderItem.*`、`SalesOrder.totalAmount/deposit*` | **业务事实** | SalesOrder | — | — | **是** | 保留 |
| 订单已收累计 | `SalesOrder.paidAmountCny` | **派生（Payment 聚合）** | Payment | — | 允许派生缓存 | 否 | 保留（已正确回写），标注派生 |
| 订单已发数量 | `SalesOrderItem.shippedQty` | **派生（Shipment 聚合）** | Shipment | — | 允许派生缓存 | 否 | 保留（已正确回写） |
| 生产进度 | `ProductionOrder.progress` | **派生（明细聚合）** | ProductionOrderItem | — | — | 否 | **修正：改为真汇总** |
| 采购到货量 | `PurchaseOrderItem.arrivedQty/status` | 事实 + 派生 | PurchaseOrderItem | — | — | 否 | 修正语义或接线 |
| 汇率（发生时刻） | 各表 `exchangeRate`、`Lead.usdRate` | **时点事实** | 各单据自身 | — | — | **是** | 保留 |
| 每日汇率 | `DailyExchangeRate.rateToCny` | 参考数据 | 外部 API | 全部换算 | — | — | 保留 |
| 币种展示名/符号 | `CurrencyRate.name/symbol` | 字典 | CurrencyRate | 全部 | — | 否 | 保留 |
| 币种值域 | `Currency` 枚举 | 契约 | Schema | 全部 | — | 否 | 保留 |
| 收付款金额/汇率/凭证 | `Payment.amount/amountCny/ratio/payDate/method` | **业务事实** | Payment | — | — | 是 | 保留 |
| 收付款宿主客户 | `Payment.customerId` | **派生**（SalesOrder.customerId） | SalesOrder | — | ❌ | 否 | **评估删除** |
| 利润各项成本 | `Profit.*CostCny` + `costSnapshot` | **业务事实 + 快照** | Profit | — | — | **是** | 保留 |
| 质检人数/不良率 | `QualityInspection.sampleQty/defectQty/defectRate` | **业务事实** | QualityInspection | — | — | 是 | 保留 |
| 质检人姓名 | `QualityInspection.inspectorName` | 快照 | 检验时点 | — | — | 是 | 保留（前端未展示） |
| 运费 | `Shipment.freightAmount/freightAmountCny` | **业务事实** | Shipment | Profit（ADR-20） | — | 是 | 保留 |
| 出货客户 | `Shipment.customerId` | **派生** | SalesOrder | — | ❌ | 否 | **评估删除** |
| 附件 | `Attachment`（多态 ownerType+ownerId） | 支撑 | 各宿主 | 全部 | — | 否 | 保留（设计良好） |
| 审批流水 | `ApprovalRecord`（多态 bizType+businessId） | 支撑 | 各宿主 | 全部 | — | **是**（审批留痕） | 保留 |
| 操作日志 | `OperationLog`（含 `customerId` 冗余） | 审计事实 | 全局 | 全部 | 允许（审计要求快照化） | **是** | 保留 |
| 单据编号 | `NumberSequence` + 各表 `xxxNo` | 契约 | NumberSequence | 全部 | ❌ | 否 | 保留 |

---

## 12. Cross-table Dependency Map

### 12.1 引用强度分级

**Restrict（强引用：上游是下游的历史证据，不可删）**
- `Opportunity.customerId` → Customer
- `Quotation.opportunityId` → Opportunity，`Quotation.customerId` → Customer
- `SampleOrder.customerId` → Customer
- `SalesOrder.opportunityId` → Opportunity，`SalesOrder.customerId` → Customer
- `ProductionOrder.salesOrderId` → SalesOrder
- `Shipment.salesOrderId` → SalesOrder，`Shipment.customerId` → Customer
- `ShipmentItem.salesOrderItemId` → SalesOrderItem
- `Payment.salesOrderId` / `purchaseOrderId` / `customerId`（exact-one + 辅助）
- `Profit.salesOrderId`（**@unique**，1:1）
- `QualityInspection.productionOrderId` / `shipmentId`（exact-one，手写 DB CHECK）
- `ProductCertification.certificateId` → Certificate
- `CustomerProduct.customerId/productId` → Customer/Product
- `ProductPrice.customerId/productId` → Customer/Product
- `ComboItem.productId` → Product

**SetNull（弱引用：人员离职/产品停用不销毁业务数据）**
- 全部 `ownerId`（Customer/Lead/Opportunity/SalesOrder/ProductionOrder/Product/ComboProduct/Supplier）
- 全部明细 `productId`（LeadItem/OpportunityItem/QuotationItem/SalesOrderItem/PurchaseOrderItem）
- `Lead.customerId`、`Opportunity.leadId`、`SalesOrder.quotationId/sampleOrderId`、`ProductionOrderItem.salesOrderItemId`、`PurchaseOrderItem.productionOrderItemId`
- `Product.categoryId/audienceId`、`Supplier.`、`Attachment`（无 FK）

**Cascade（组成关系：宿主删除则明细消失）**
- 全部 `xxxItem` → 单据表头
- `SampleRound` → SampleOrder
- `ProductCraftLink` / `ProductVisibleUser` / `ProductCertification` / `ProductTask` → Product
- `ComboItem` → ComboProduct
- `RolePermission`、`Notification`、`LoginLog`

**无 FK 的软引用（风险区）**
- `LeadItem.craftIds[] / audienceId / categoryId`（裸 String）
- `Supplier.crafts[] / categories[]`（存 name）
- `Customer.customerType` / `Lead.customerType`（存 name）
- `Lead.unit / currency / country`
- `Product.material / packaging / colors[] / source`
- `ProductTask.refType/refId`（有意软关联，注释明确）
- `CustomerProduct.sourceType/sourceId`、`ProductPrice.sourceType/sourceId`
- 全表 `createdBy / updatedBy`、`ApprovalRecord.submittedBy/approverId`、`Attachment.uploadedBy`、`QualityInspection.inspectorId`、`Payment.confirmedBy`、`Department.leaderId`
- `OperationLog.userId/username`（**有意无 FK**：审计须在用户删除后存活 —— 正确设计）

### 12.2 潜在循环 / 双写风险

| 风险 | 证据 | 判定 |
|---|---|---|
| `Lead ↔ Opportunity` 曾被设计为双向 FK | `03-customer.prisma:258-260` 注释明确「此处不得再声明 `opportunityId` 冗余列（双向真实 FK 会产生循环外键与双写不一致）」 | ✅ **已识别并规避** |
| `SalesOrder.customerId` 与 `Opportunity.customerId` 可能不一致 | `Quotation/SampleOrder/SalesOrder` 三处 `customerId` 靠 `salesOrder.controller.ts:329-346` 应用层校验 | ⚠️ DB 无约束 |
| `ProductionOrderItem.salesOrderItemId` 可空 + SetNull | `09-production.prisma:47-48` | ⚠️ 生产行可脱离订单行（追溯断裂） |
| 覆盖删除风险 | 无 SQL 查询发现「一处修改多处同步」（见 §13），**风险低** | ✅ |

---

## 13. Reverse Synchronization Audit

### 13.1 「一处修改，多处同步」——**基本不存在**（重要正面结论）

| 假设 | 搜索证据 | 结论 |
|---|---|---|
| 改 Customer 名称 → 同步 Lead/Opportunity/SalesOrder | `server/src` 全局 `customerName` **0 命中**；`updateCustomer` 仅写 `prisma.customer.update` | ❌ **不存在** ✔ |
| 改 Product 名称 → 同步各明细 | `product.controller.ts:544` 仅 `tx.product.update`；三处注释明确「Product 后续改名不会回溯修改已落库明细」 | ❌ **不存在** ✔ |
| `updateMany` 批量同步业务表 | 仅 `lead.controller.ts:1063/1133`（释放产品 visibility/owner），与字段同步无关 | ❌ **不存在** ✔ |

> **结论**：YSEM **没有**「反向同步」这一反模式。这是本次审计最重要的正面发现之一——它意味着后续若要改造，**不需要先拆除同步逻辑**，改造成本远低于预期。

### 13.2 存在的真实「派生回写」（正向，非反向）

| 派生字段 | 实现 | 事务 | 失败处理 | 判定 |
|---|---|---|---|---|
| `SalesOrder.paidAmountCny` | `payment.controller.ts:225-242` `recalcPaidAmountCny`（aggregate→update），批量 `:245-252`；行锁 `lockSalesOrders:188-217` | ✅ 事务内 | 抛出 | ✅ 正确 |
| `SalesOrderItem.shippedQty` | `shipment.controller.ts:303-329` `recalcShippedQty`（groupBy→update）；行锁 `lockSalesOrderItems:215-297` | ✅ | 抛出 | ✅ 正确 |
| `Lead.status` | `leadStatus.ts:30-40` `advanceLeadStatus`（四态单调前进，`LEAD_STATUS_RANK:19-24` 保证不降级） | ❌ **在主事务之外** | **仅 `console.error`，不阻断** | ❌ **风险：订单已建但线索状态未推进** |
| `Opportunity.stage` | 读时派生，无写入 | — | — | ✅ 最佳 |
| `Customer.totalOrderAmountCny/lastOrderAt` | **无实现** | — | — | ❌ 空列 |
| `Customer.firstOrderAt` | 人工写入（`customer.controller.ts:1167`），非履约层回写 | — | — | ❌ 语义不符 |
| `ProductionOrder.progress` | 入参（`productionOrder.controller.ts:492/617`），非汇总 | — | — | ❌ 语义不符 |
| `Product.stock` | 无联动 | — | — | ❌ 未闭环 |

`Lead.status` 触发点（3 处，均在主事务外）：

| 事件 | 位置 |
|---|---|
| 创建商机 → `CONFIRMED` | `sales.controller.ts:442` |
| 创建打样单 → `SAMPLED` | `sampleOrder.controller.ts:390` |
| 创建销售订单 → `WON` | `salesOrder.controller.ts:527`（经 `leadIdOfOpportunity:43` 由 opportunityId 间接追溯） |

**判定**：这是全系统唯一的「弱一致性」链路。风险等级**中**（状态滞后不影响金额，但影响看板与客户时间线）。

### 13.3 状态机未受服务端保护（新发现）

```113:113:server/src/controllers/quotation.controller.ts
  status: z.nativeEnum(QuotationStatus).optional(),   // 客户端可任意指定状态
```

```122:122:server/src/controllers/salesOrder.controller.ts
  status: z.nativeEnum(SalesOrderStatus).optional(),
```

- `Quotation.status`：仅 `status: body.status ?? DRAFT`（`quotation.controller.ts:350`）+ 一张「状态 → 时间戳字段」映射表（`:73-78`），**无流转合法性校验**
- `SalesOrder.status`：同上，`STATUS_TIME_FIELD`（`salesOrder.controller.ts:73-79`）

→ **过程数据（状态）的唯一权威来源实际上是客户端**。这属于 §6 分类中的 **Process Data 所有权未定义**。

### 13.4 两套胜负真相并存

| 真相 | 落点 | 状态 |
|---|---|---|
| 线索赢单 | `Lead.status = WON` | ✅ 由 `SalesOrder` 创建自动推进 |
| 商机赢单 | `Opportunity.outcome = WON` / `wonAt` | ❌ **从不写入**（server+client 全局 0 引用） |

→ 同一事实（是否赢单）在架构上有两个声明，只有一个在跑。

---

## 14. Current Module Boundary

**判定标准（现状实际使用的）**：`一个业务对象 = 一个 controller = 一个前端页面 = 一张表`。

证据：
- 33 controllers ↔ 32 routes ↔ 31 pages ↔ 52 models，几乎一一对应
- `client/src/components/` 按对象分目录（customer / lead / sales / product / order / purchase / setting）
- 目录名与业务对象同名（`sales` = 商机、`salesOrders` = 订单）

### 14.1 当前边界的三类问题

| 问题 | 证据 | 影响 |
|---|---|---|
| **命名错位** | `sales.controller.ts` 实际是商机（`/api/sales`，导出 `getOpportunities/createOpportunity`），而订单在 `salesOrder.controller.ts`（`/api/sales-orders`） | 「sales」一词同时指「商机」与「销售全流程」，模块语义混乱 |
| **过程被拆成 4 个平级模块** | `Lead` / `Opportunity` / `Quotation` / `SampleOrder` 各自独立 controller / page，但业务上是一条链 | 每个模块各自实现「引用 + 快照 + 状态」，重复实现（`buildItems`/`parseItems`/`resolveProductSnapshot`） |
| **主数据与过程耦合** | `product.controller.ts` 挂 `ProductTask`（过程任务在 `04-product.prisma:282`）；`customer.controller.ts:706-767` 客户详情页内嵌 `salesOrders/opportunities/leads` 全量查询（67KB 巨型 controller） | 主数据模块承担了过程聚合职责，边界模糊 |

### 14.2 「空壳」模块

| 模块 | 证据 | 判定 |
|---|---|---|
| `client/src/components/order/` | **目录为空** | 死目录 |
| ComboProduct（`/api/product-groups`） | 前端 `ProductGroupManageModal`，但**无任何单据可引用组合** | 未接入主链 |
| CustomerProduct / ProductPrice | 无 controller、无 route、无前端 API | 死模型 |

---

## 15. Proposed Module Boundary

判定标准（应使用的）：**业务职责 + 生命周期 + 数据所有权 + 状态机**。

```
① 主数据域 (Master Data Domain)
   生命周期：人工维护，长期存在；无业务状态机（只有 ACTIVE/INACTIVE）
   ├── Customer           客户（含公海归属、等级、类型）
   ├── Contact            【建议新增】客户联系人（替代 contactName/email/phone/contactMethods 内嵌）
   ├── Product            标准品（含分类/工艺/证书/可见性）
   ├── ComboProduct       组合产品（需接入或下线）
   ├── Supplier           供应商
   ├── Channel            渠道/平台（来源 SSOT）
   └── 字典：CustomerType / CommunicationTool / Unit / CurrencyRate / Certificate / ProductCraft / ProductAudience / ProductCategory
   规则：只被引用，不被业务过程回写；不承载过程状态

② 销售过程域 (Sales Process Domain)
   生命周期：从线索到成交终止；有过程状态机；不产生交易事实
   ├── Lead            线索（过程前段；客户建档前的 intake）
   ├── Opportunity     商机（过程中段；阶段派生不落库）
   └── 阶段派生服务     pipelineStage（读时计算）
   规则：只存「过程属性」（owner/来源/意向/预计成交）；不复制客户资料；不存成交价

③ 报价域 (Quotation Domain)
   生命周期：独立（版本链 + 有效期）；有独立状态机；产生历史事实
   └── Quotation + QuotationItem
   理由：报价是「对客户的正式承诺」，有法律/商务留痕价值，即使成交也可能不成交

④ 打样域 (Sample Domain)
   生命周期：独立（多轮次）；状态机 SampleStatus + SampleRoundResult
   └── SampleOrder + SampleRound +【建议】SampleItem

⑤ 订单域 (Sales Order Domain)
   生命周期：独立；状态机 SalesOrderStatus（10 态）；产生交易事实
   └── SalesOrder + SalesOrderItem

⑥ 履约域 (Fulfillment Domain)
   生命周期：订单确认后启动，与订单生命周期不同（不同 owner）
   ├── ProductionOrder + ProductionOrderItem
   ├── Shipment + ShipmentItem
   └── QualityInspection
   理由：履约关注「能不能按时按质交付」，销售关注「卖多少钱」，职责与干系人不同

⑦ 采购域 (Procurement Domain)
   └── PurchaseOrder + PurchaseOrderItem

⑧ 财务域 (Finance Domain)
   ├── Payment（IN/OUT 双向，exact-one 宿主）
   ├── Profit（1:1 订单，含 costSnapshot）
   └── DailyExchangeRate（时点参考数据）

⑨ 平台域 (Platform Domain)
   ├── User / Role / Permission / Department
   ├── Attachment（多态旁挂）
   ├── ApprovalConfig / ApprovalRecord（多态旁挂）
   ├── NumberSequence
   ├── OperationLog（含全部 Activity/Timeline，**不再新增 Activity 表**）
   └── Notification / LoginLog
```

### 15.1 对任务假设的回答

| 假设 | 审计结论 |
|---|---|
| 「Lead / Opportunity 实际上属于 Sales Process」 | ✅ **成立**。二者应归入同一「销售过程域」，是同一过程实例的两个阶段。但**不必然合并成一张表**（见下） |
| 「Quote 属于 Sales Process 的一个阶段，但由于有独立生命周期和历史事实，需要独立模型」 | ✅ **完全成立**，且 `SampleOrder` 同理 |
| 「Order 之后是履约」 | ✅ 成立，且已有独立域（Production/Shipment/QC） |
| 「Payment 属业务过程还是事实？」 | **是业务事实**（不是过程），宿主为 SalesOrder/PurchaseOrder |

### 15.2 关于「Lead 与 Opportunity 是否应合并成一张表」

**建议：不合并表，但合并「域」并统一「过程实例」语义。** 理由：

**反对合并的证据**
- 基数不同：`Lead 1:N Opportunity`（一个线索可产多个商机），合并会退化为自关联
- 生命周期长度不同：Lead 在转商机后即终止（`LeadStatus` 只到 WON 就停），Opportunity 才进入报价/打样/订单
- 字段集几乎不重叠：Lead 有 `draft/stage/customerLocked/productLocked/usdRate/contactMethods`；Opportunity 有 `estimatedAmount/intentLevel/probability/estimatedCloseDate/outcome`
- 已有清晰 FK：`Opportunity.leadId`（全系统唯一一条 Lead↔Opportunity 外键，且已正确避免双向）

**支持归入同一域的证据**
- `Lead.status` 的 4 态全部由 Opportunity 下游事件推进（`NEW→CONFIRMED→SAMPLED→WON`）→ **Lead 的状态机是被 Opportunity 驱动的**
- `Lead` 的 `channelId/shopId` 被复制进 Opportunity（在途改动）→ 说明二者共享同一「过程上下文」
- 前端 `convertLeadToOpportunity` 把二者串成一个动作

→ **结论：域的边界应合并（Sales Process），表的边界应保留（Lead / Opportunity 各自独立，因基数为 1:N）。这是「不为减少表数量而强行合并」的正例。**

---

## 16. Current vs Target Architecture

### Current Architecture

```
【主数据】 Customer ── Supplier ── Product(+Combo) ── Channel ── User/Dept
             │                        │
             │  (intake 期字段复制)   │ (无 customerName 复制 ✔)
             ▼                        ▼
【销售过程】 Lead ──1:N──> Opportunity ──1:N──> Quotation ──1:N──> SalesOrder
             │             │  (stage 派生 ✔)       │  (version 链半成品)
             │             │  (outcome 死列 ✗)     └── SampleOrder(+Round)
             │             └── customerId 复制
             │                 channelId 复制（在途）
             ▼
【关系/冗余】 Quotation.customerId ── SampleOrder.customerId ── SalesOrder.customerId
             Shipment.customerId ── Payment.customerId        （5 处可派生，靠 app 层校验）
             死关系：CustomerProduct(无 CRUD) ── ProductPrice(0 读写)

【业务事实】 SalesOrderItem(*, 快照正确) ── Payment(*, 快照正确) ── Profit(+costSnapshot ✔)
             派生混入：paidAmountCny ✔ / shippedQty ✔ / progress ✗(入参) / arrivedQty ✗(入参)
             空列：Customer.totalOrderAmountCny / lastOrderAt / Opportunity.outcome

【快照】     明细行快照 ✔（5 套独立实现，被当展示名用，被可见性投影篡改 ✗）
             customerSnapshot / termsSnapshot ✗（0 写入 0 消费）

【Draft】    仅 Lead.draft（旁挂布尔，与其它 6 模块的 status=DRAFT 语义不一致）

【Activity】 ✅ 已收敛进 OperationLog（4 个副表已删）
```

### Target Architecture

```
【主数据】    Customer ──【Contact 新增】── Product ── Supplier ── Channel ── Organization(User/Dept)
                    ↑ 唯一权威，只被引用，不被过程回写
                    │
【业务过程】  ┌─ Sales Process Domain ────────────────────────────────┐
              │  Lead ──1:N──> Opportunity                           │
              │  （状态机由下游驱动；阶段读时派生；不复制主数据；     │
              │    不存成交价；渠道归属只保留一处）                  │
              └──────────────────────────────────────────────────────┘
                                    │
              ┌── 报价/打样（独立生命周期 + 独立历史事实）───────────┐
              │  Quotation(+Version)  │  SampleOrder(+Round+Item)   │
              └──────────────────────────────────────────────────────┘
                                    │
【交易事实】  ┌─ Order Domain ──────────────────────────────────────┐
              │  SalesOrder + SalesOrderItem                        │
              │  ↳ 成交价/数量/金额/定金：冻结，快照不可变           │
              │  ↳ customerId 由 opportunityId 派生（评估保留必要性）│
              └──────────────────────────────────────────────────────┘
                                    │
【履约】      ProductionOrder ──> Shipment ──> QualityInspection
              PurchaseOrder(Supplier 侧)
                                    │
【财务】      Payment（exact-one 宿主，双向）──> Profit（1:1 + costSnapshot）
                                    │
【关系】      引用为主（FK）＋ 允许的派生缓存（明确标注 + 事务内回写）
【历史快照】  Snapshot 只在「价格/条款/规格/汇率/成本/审批」六类时点冻结
             快照一旦落库：不因主数据更新而变，不因权限投影而抹除
【Draft】     统一为「状态机首态 + 数据完整度标志」两件事，命名分离
【派生】       一切可 JOIN/聚合得到的展示数据不落库；确需落库的缓存必须标注+回写
【平台】      Attachment / Approval / OperationLog（唯一时间线）/ NumberSequence
```

### 逐项差异说明

| # | 项 | Current | Target | 差异本质 |
|---|---|---|---|---|
| 1 | 渠道归属 | Lead + Customer + Opportunity 三份 | 一处权威 + 其余引用 | 消除复制 |
| 2 | customerId | 5 处冗余 FK | 至多 Quotation 独立持有，其余派生 | 消除冗余 FK |
| 3 | Opportunity 终态 | `outcome` 死列 | 删除或接线为唯一终态 | 消除双真相 |
| 4 | 客户专属价格 | `ProductPrice` 死模型 | 接线或删除 | 补齐主数据能力 |
| 5 | 客户定制规格 | `CustomerProduct` 无 CRUD | 接线或删除 | 同上 |
| 6 | 联系人 | 内嵌标量 + JSON 双表示 | `Contact` 主数据 | 补齐主数据 |
| 7 | Draft | 仅 Lead 有、布尔旁挂 | 统一语义（状态 / 完整度分离） | 语义统一 |
| 8 | 快照 | 死壳 + 被投影篡改 + 被当展示名 | 六类时点冻结、不可变、不被投影改写 | 快照纪律 |
| 9 | 派生 | 混入事实表、部分语义不符 | 明确标注 + 事务内回写 | 职责分离 |
| 10 | 模块边界 | 一对象一模块 | 按域划分（主数据/销售过程/报价/打样/订单/履约/采购/财务/平台） | 职责归位 |
| 11 | 状态机权威 | 客户端可任意设 status | 服务端校验流转 | 所有权归位 |
| 12 | Activity | ✅ 已收敛 | 保持（**禁止新增**） | 无差异 |

---

## 17. Single Source of Truth Rules

> **规则 SSOT-1**：每一个主数据事实只有一个权威表与一个权威字段。其它模块**只能**通过 FK + JOIN 读取。
> 适用：客户名称/编号/等级/类型/国家、产品名称/SKU/规格/分类/标准价、供应商名称、渠道名称、组织与人员名称。

> **规则 SSOT-2**：关系通过 FK 表达，不得把两端资料复制进关系表。
> 适用：`CustomerProduct`、`OrderItem`、`OpportunityProduct`、`ProductCertification` 等。

> **规则 SSOT-3**：过程属性（status/stage/owner/nextAction/probability/expectedCloseDate）归属**过程实体**，不归属主数据。主数据**不得**持有过程状态。
> 反例：`ProductTask`（过程任务挂在 `Product` 主数据上）；`Product.stock`（库存状态挂在产品上但无入库/出库事件源）。

> **规则 SSOT-4**：能通过 JOIN / relation / aggregation 得到的展示数据**不得**落库为基础字段。
> 正例：`Opportunity` 无 `customerName`、无 `stage`（已达标）。
> 待修正：`Lead.companyName/contactName/email/phone/country/customerType`（建档后应降级为 intake 留痕，不再作为展示源）。

> **规则 SSOT-5**：字典值域只有两种合法表达：① 枚举（Schema 级契约，如 `Currency`）；② 真 FK 到字典表。**禁止**用 `String` 存字典 `name`。
> 待修正：`Customer.customerType`、`Lead.customerType`、`Lead.unit`、`Supplier.crafts/categories`、`LeadItem.audienceId/categoryId`、各行 `unit`。

> **规则 SSOT-6**：派生的落库缓存（如 `paidAmountCny`）必须满足三条件：① 注释标注「派生」，② 在同一事务内回写，③ 回写函数唯一。
> 待修正：`ProductionOrder.progress`、`PurchaseOrderItem.arrivedQty`（当前为入参）、`Customer.totalOrderAmountCny`（无回写）。

> **规则 SSOT-7**：状态机流转的判定权在**服务端**。客户端只能提交事件，不能提交目标状态。
> 待修正：`Quotation.status`、`SalesOrder.status` 当前由客户端直接指定。

> **规则 SSOT-8**：时间线/活动**只有** `OperationLog`。**禁止**新增 `XxxActivity` 表（`CustomerActivity`/`OpportunityActivity`/`ProductActivity`/`SalesActivity` 已删除，不得复活）。

---

## 18. Allowed Duplication Rules

> **规则 DUP-1（允许）**：**交易价格、成交数量、订单金额、折扣、税率、汇率**——表达「当时发生的业务事实」，**必须**独立保存，不得引用主数据现值。
> 落点：`QuotationItem` / `SalesOrderItem` / `PurchaseOrderItem` / `Payment` / `Profit` / `Shipment.freightAmount`。

> **规则 DUP-2（允许）**：**时点汇率快照**（`exchangeRate`、`Lead.usdRate`）——汇率随时间变，换算必须用当时汇率。

> **规则 DUP-3（允许）**：**单据行产品快照**（`productName/productSku/spec/material/colors`）——主数据可改名/停用，历史单据必须保留当时认知。
> ⚠️ 但快照**一旦写入即不可变**：不接受主数据更新回写，也不接受权限投影抹除。

> **规则 DUP-4（允许）**：**客户/条款快照**，但仅在**有明确消费方与明确字段清单**时才落库。
> 当前 `customerSnapshot/termsSnapshot` 不满足此条件 → 应删除或先定义。

> **规则 DUP-5（允许）**：**审计日志的字段快照**（`OperationLog.diff` / `username` / `realName` / `businessNo`）——审计要求与业务表解耦。
> `OperationLog.userId` 有意不建 FK，正确。

> **规则 DUP-6（允许）**：**派生缓存**，但必须满足 SSOT-6 三条件。
> 已达标：`paidAmountCny`、`shippedQty`。

> **规则 DUP-7（禁止）**：**客户基础资料**（名称/国家/联系人/类型/等级）复制进过程表用于展示。
> 正例：`Opportunity` 已合规。待修正：`Lead` 在建档后仍保留全套客户字段。

> **规则 DUP-8（禁止）**：**产品基础资料**（分类/工艺/受众/证书/标准价）复制进业务表。
> 待修正：`LeadItem.craftIds/audienceId/categoryId` 用裸 String 存 id。

> **规则 DUP-9（禁止）**：**同一实体在表内有两种表示**（标量 vs JSON）。当前 `Customer.contactName/email/phone/wechat` vs `contactMethods` 违规。

> **规则 DUP-10（禁止）**：**状态与阶段落库后与派生并存**（如 `Opportunity.outcome` vs 派生 stage；`Lead.draft` vs `customerLocked` 派生规则）。

---

## 19. Snapshot Rules

> **规则 SN-1**：快照的**唯一存在理由**是「保存某个时间点的历史事实」。因查询方便而复制的数据不是快照，是冗余。
> **Snapshot ≠ Duplicate。**

> **规则 SN-2**：以下六类**必须**快照：
> ① 单据行产品快照（`productName/sku/spec/material/colors/craft/packaging`）
> ② 交易价格与金额（`unitPrice/amount/quantity/currency`）
> ③ 商务条款（`tradeTerms/paymentTerms/leadTime/validUntil/portOfLoading`）
> ④ 汇率（`exchangeRate`）
> ⑤ 成本构成（`Profit.costSnapshot`）
> ⑥ 审批与操作留痕（`ApprovalRecord` / `OperationLog`）

> **规则 SN-3**：以下**不应**快照：
> 客户基础资料（名称/国家/联系人）——可用 FK 追溯历史（`Customer` 有软删，不需要快照）
> 产品分类/工艺/证书——同上
> 组织与人员名称——可用 userId 追溯

> **规则 SN-4（不可变）**：快照一旦落库，**不得**因主数据更新而回写，**不得**因当前权限投影而置 null。
> ❌ 当前违规：`withProductVisibility` 将不可见产品的 `productName` 置 null（`quotation.controller.ts:44-56`、`sales.controller.ts:78-86`）。
> 修正方向：权限投影应作用于**关联对象**（`item.product`），**不得**作用于快照字段本身。

> **规则 SN-5**：快照字段可以被**展示**，但展示方必须知道它可能落后于主数据现值。若页面需要「当前名称」，应同时 include 主数据并优先展示现值——**不要**通过修改快照来满足展示需求。

> **规则 SN-6**：快照构造必须有**唯一工具函数**，禁止每个 controller 各自实现（当前 `buildItems` / `parseItems` / `resolveProductSnapshot` 三套）。

> **规则 SN-7**：未定义形状与消费方的 Snapshot 字段**不得**存在于 Schema（当前 4 个空壳字段违规）。

---

## 20. Draft Rules

> **规则 DR-1**：Draft **不是**一种数据类型。它只有两种合法语义，且必须**命名区分**：
> ① **状态机首态**（`DRAFT` 作为状态枚举值）——适用 Quotation / SampleOrder / SalesOrder / ProductionOrder / PurchaseOrder / Profit
> ② **数据完整度标志**（「关联主数据尚未建档」）——`Lead` 的情况，**不应叫 draft**
> **禁止**用同一个词表达两种语义。

> **规则 DR-2**：Draft **不创建**独立数据表，也**不需要**独立 ID。Draft 与正式数据共享同一行、同一主键。
> ✅ 当前 `Lead.draft` 已合规。

> **规则 DR-3**：Draft 期**允许**引用主数据（`customerId`/`productId` 可为空或已填），**不要求**主数据在建。
> ✅ 当前已合规。

> **规则 DR-4**：Draft **不得**产生重复主数据。转正式时若需建档，必须是**服务端事务 + 幂等键**（如客户唯一键），**禁止**客户端模糊匹配。
> ❌ 当前违规：`convertLead.ts:60-65` 客户端 `findCustomerByName`（`pageSize:200` + `toLowerCase` 比对），无事务、无唯一性保证。

> **规则 DR-5**：Draft 的状态应**可派生**则不落库；确需落库的必须与派生规则一致（单一真相）。
> ❌ 当前违规：`Lead.draft` 与 `customerLocked/productLocked` 双轨（`LeadFormModal.tsx:892-897` 同时用落库值与 `!!customerId && !draft` 派生值）。

> **规则 DR-6**：Draft 取消/删除时，已建的主数据（Customer/Product）**保留**（不得连带删除），仅解除引用。

> **规则 DR-7**：历史数据回填必须基于**权威依据**，禁止启发式猜测。
> ❌ 当前违规：`20260926010000_lead_draft/migration.sql` 用 `customerId IS NULL AND stage IS NOT NULL` 推断草稿。

---

## 21. Proposed Target Data Model

> 本节仅设计，不实施。

### 21.1 Master Data

```
Customer
  ├─ 身份：id, customerNo, status, deletedAt
  ├─ 名称：companyName, englishName
  ├─ 画像：industry, website, customerLevel, customerTypeCode(FK→CustomerType.code),
  │         intentLevel, isKeyAccount, tags[], notes
  ├─ 来源：sourceChannelId(FK→Channel), sourceShopId(FK→Channel)   ← 唯一权威来源
  ├─ 地域：countryCode(ISO alpha-2), region
  ├─ 归属：ownerId(FK→User, null=公海)
  ├─ 联系方式：→ Contact[]（见下；删除标量 contactName/email/phone/wechat 与 contactMethods Json）
  └─ 派生（标注 + 事务内回写 或 计算列）：firstOrderAt, lastOrderAt, totalOrderAmountCny

Contact  【新增】
  ├─ id, customerId(FK), name, position
  ├─ methods: ContactMethod[]  ← 关系表（toolCode FK→CommunicationTool.code, account, isPrimary）
  └─ 约束：一个 Customer 至多一个 isPrimary=true

Product
  ├─ 身份：id, productNo, sku, model, name, status, deletedAt
  ├─ 分类：crafts[](FK), audienceId(FK), categoryId(FK)
  ├─ 属性：material, sizeL/W/H, weight, colors[], packaging, features(Json), description
  ├─ 供货：supplyModes[], moq, leadTime, hsCode
  ├─ 价格：defaultPrice, defaultCurrency, defaultTaxRate   ← 标准价 SSOT
  ├─ 可见性：visibility, visibleUsers[]
  └─ ⚠️ ProductTask 迁出（过程数据不应挂主数据）

ComboProduct  ← 需决策：接入业务链 或 下线
Supplier
Channel（自关联树：Channel → Platform）
字典：CustomerType（加 code 供 FK）/ CommunicationTool（加 code）/ Unit（加 code）/
      CurrencyRate / Certificate / ProductCraft / ProductAudience / ProductCategory
```

### 21.2 Business Process — Sales Process Domain

```
Lead   （Customer 建档前的 intake 容器；建档后字段降级为历史留痕）
  ├─ 身份：id, leadNo
  ├─ 过程：status(NEW/CONFIRMED/SAMPLED/WON，下游驱动)、ownerId(null=公海)
  ├─ 来源：source, channelId(FK), shopId(FK)          ← 来源 SSOT 的起点
  ├─ intake 录入值（建档后只读，不参与展示）：
  │     intakeCompanyName, intakeContactName, intakeEmail, intakePhone,
  │     intakeCountry, intakeCustomerTypeCode
  ├─ 需求：productInterest, quantity, targetPrice, currencyCode, unitCode,
  │         expectedDelivery, targetMarket, usdRate(时点快照)
  ├─ 关联：customerId(FK, 建档后必填), items[]
  └─ 完整度标志（替代 draft/customerLocked/productLocked 双轨，全部派生）：
        customerLinked = !!customerId
        productLinked  = items.some(i => i.productId)

LeadItem（需求明细）
  ├─ productId(FK, 可空), productName(候选名), productDesc(需求描述)
  ├─ quantity, craftIds[](FK), audienceId(FK), categoryId(FK), sizeL/W/H, weight

Opportunity
  ├─ 身份：id, opportunityNo
  ├─ 关联：customerId(FK, Restrict), leadId(FK), sourceChannelId/sourceShopId(FK)
  ├─ 过程：ownerId, estimatedAmount, currency, exchangeRate(快照),
  │         estimatedCloseDate, intentLevel, probability, notes
  ├─ 终态（二选一决策）：outcome(OPEN/WON/LOST) + outcomeAt + wonAt + lostReason
  │         ← 接线为唯一真相，或整组删除
  ├─ 阶段：**派生不落库**（保持现状 ✔）
  └─ 下游：items[], quotations[], sampleOrders[], salesOrders[]
```

### 21.3 Quotation Domain

```
Quotation
  ├─ 身份：id, quotationNo, version, parentId(版本链)
  ├─ 关联：opportunityId(FK, Restrict), customerId(FK, 可保留——报价单需独立成立)
  ├─ 商务：currency, exchangeRate(快照), totalAmount, totalAmountCny,
  │         tradeTerms, paymentTerms, leadTime, validUntil, portOfLoading
  ├─ 状态：status(服务端校验流转) + submittedAt/sentAt/acceptedAt/rejectedAt
  ├─ 快照：**移除空壳 customerSnapshot**（客户名用 FK 联查）；
  │         **termsSnapshot 由表头标量条款承担**（已存在，无需 JSON）
  └─ items[]
QuotationItem
  ├─ productId(FK), quantity, unit(→unitCode FK), unitPrice, amount, currency, costPrice, leadTime
  └─ 快照（不可变）：productName, productSku, spec, craft, size, packaging
```

### 21.4 Sample Domain

```
SampleOrder
  ├─ 身份：id, sampleNo
  ├─ 关联：opportunityId(FK, 可空), customerId(FK, Restrict)
  ├─ 过程：status, currentRound, sampleType, requirement, targetPrice, ownerId
  ├─ 费用：feeAmount, feeCurrency, feeRecoverable
  ├─ 快照：**移除空壳 customerSnapshot**
  └─ rounds[] / 【建议】items[]（替代表头单产品）
SampleRound
  └─ roundNo, designAt, moldAt, sentAt, feedbackAt, trackingNo, feeAmount, result, feedback, improvements
```

### 21.5 Order Domain

```
SalesOrder
  ├─ 身份：id, orderNo
  ├─ 关联：opportunityId(FK, Restrict), customerId(FK) ← 保留（Restrict 保障），
  │         quotationId(FK, 可空), sampleOrderId(FK, 可空)
  ├─ 状态：status(服务端校验) + 8 个时间戳
  ├─ 金额（事实）：currency, exchangeRate(快照), totalAmount, totalAmountCny,
  │         depositRatio, depositAmount, balanceAmount
  ├─ 派生：paidAmountCny（标注 + Payment 事务内回写 ✔）
  ├─ 贸易：orderDate, deliveryDate, actualDeliveryDate, tradeTerms, paymentTerms,
  │         portOfLoading, portOfDischarge
  ├─ 快照：**移除 customerSnapshot / termsSnapshot**（条款已由标量承担）
  └─ items[] / productionOrders[] / shipments[] / payments[] / profit
SalesOrderItem
  ├─ orderId, lineNo, productId(FK), customerProductId(FK, 待决策), quantity, unit,
  │   unitPrice, amount, currency, costPrice, costAmount, deliveryDate
  ├─ 派生：shippedQty（标注 + Shipment 事务内回写 ✔）
  └─ 快照（不可变）：productName, productSku, spec, craft, size, material, packaging, colors[]
```

### 21.6 Fulfillment / Procurement / Finance / Platform

```
ProductionOrder + ProductionOrderItem（progress 改为真汇总回写）
Shipment + ShipmentItem
QualityInspection（exact-one 宿主：ProductionOrder | Shipment）
PurchaseOrder + PurchaseOrderItem（arrivedQty/status 接线或改语义）
Payment（exact-one 宿主：SalesOrder | PurchaseOrder；customerId 评估删除）
Profit（salesOrderId @unique；costSnapshot 保留；前端展示补齐）
DailyExchangeRate
Attachment / ApprovalConfig / ApprovalRecord / NumberSequence / OperationLog / Notification / LoginLog
```

### 21.7 Relationship / Historical

```
Relationship
  ├─ LeadItem                  ← Lead × Product（需求行）
  ├─ OpportunityItem           ← Opportunity × Product（意向行）
  ├─ QuotationItem             ← Quotation × Product（报价行，含快照 + 事实）
  ├─ SalesOrderItem            ← SalesOrder × Product（订单行，含快照 + 事实）
  ├─ ProductionOrderItem / ShipmentItem / PurchaseOrderItem / ComboItem
  ├─ CustomerProduct           ← 客户定制版本（需接线或下线）
  ├─ ProductPrice              ← 客户专属价（需接线或下线）
  ├─ Contact + ContactMethod   ← 【新增】
  ├─ ProductCraftLink / ProductVisibleUser / ProductCertification
  └─ ShopChannel：不需要（Channel 自关联树已覆盖）

Historical / Snapshot
  ├─ 单据行快照字段（见各 Item）        ← 时点冻结
  ├─ 商务条款标量（表头）                ← 时点冻结
  ├─ exchangeRate / Lead.usdRate        ← 时点汇率
  ├─ Profit.costSnapshot                ← 成本构成
  ├─ ApprovalRecord / OperationLog      ← 留痕
  └─ Quotation 版本链（version/parentId）← 历史版本
  删除：customerSnapshot / termsSnapshot 空壳
```

---

## 22. Migration Risks

| # | 风险 | 证据 | 等级 | 缓解 |
|---|---|---|---|---|
| R1 | **在途变更把渠道复制从 2 处扩大为 3 处** | 工作区未提交的 `Opportunity.channelId/shopId` + 迁移 `20260928120000` | **高** | 先做 §24-D1 决策，再决定该迁移是否合并 |
| R2 | **快照被权限投影改写为 null** | `quotation.controller.ts:44-56`、`sales.controller.ts:78-86`、`projectProductRows(..., { nameField: 'productName' })` | **高** | 投影只作用于 `item.product`，不动快照字段 |
| R3 | **`Lead.status` 弱一致性** | `advanceLeadStatus` 在主事务外，失败仅 `console.error`（`leadStatus.ts:30-40`） | **中** | 移入事务或加重试/补偿 |
| R4 | **状态机由客户端指定** | `quotation.controller.ts:113`、`salesOrder.controller.ts:122`（`status: z.nativeEnum(...).optional()`） | **中** | 加服务端流转校验 |
| R5 | **Lead 建档由前端编排、非事务** | `convertLead.ts:60-65` `findCustomerByName`（pageSize 200 + 模糊匹配）；`LeadFormModal.createCustomerFromForm` | **中** | 收编为服务端事务端点 + 唯一键 |
| R6 | **15 个「已声明未实现」字段/模型** | `Opportunity.outcome*`(0 引用)、`ProductPrice`(0 读写)、`CustomerProduct`(无 CRUD)、4 个 Snapshot 空壳、`Customer.totalOrderAmountCny/lastOrderAt`(0 写入)、`ProductionOrder.progress`(入参)、`PurchaseOrderItem.arrivedQty/status`(入参) | **中** | 逐项决策：接线 或 删除（**不要留悬空**） |
| R7 | **表内双表示（标量 vs JSON）** | `Customer.contactName/email/phone/wechat` vs `contactMethods`；`Lead.email/phone` vs `contactMethods` | **中** | 定一侧为权威，另一侧迁移+下线（需数据决策） |
| R8 | **删除死列可能破坏历史报表** | `customerSnapshot` 等虽 0 消费，但可能被外部 BI 直连数据库读取 | 低 | 先确认无外部消费方 |
| R9 | **`Opportunity.outcome` 删除后无赢单表达** | 当前赢单靠 `Lead.status=WON` + `SalesOrder` 存在性 | 中 | 二选一：接线 outcome，或明确「赢单=有 SalesOrder」并写进契约 |
| R10 | **`ProductPrice` 删除后客户专属价无处落** | 当前只能落进 `QuotationItem/SalesOrderItem.unitPrice` | 中 | 先决策能力是否需要，再删 |
| R11 | **`OperationLog.customerId` 冗余** | `01-system.prisma:159-161`；迁移 `20260927001000` 已回填 | 低 | 保留（客户时间线查询性能需要），但需标注为**审计快照**（历史事实，不随客户变更） |
| R12 | **`Channel` 删除 SetNull 导致历史归因丢失** | 各表 `onDelete: SetNull`（`03-customer.prisma:28-30` 等） | 低 | 渠道停用而非删除（已有 `MasterStatus`） |
| R13 | **`ProductTask.refType/refId` 软关联** | `04-product.prisma:289-292` | 低 | 有意设计，保留但需文档化 |
| R14 | **迁移 `20260927002000_lead_lock_flags` 引入的双轨状态** | `customerLocked/productLocked` + 前端派生 | 低 | 收敛为派生 |

---

## 23. Recommended Migration Sequence

> 本轮只完成 **Phase 0**。以下为后续建议顺序，**均不得在本轮执行**。

```
Phase 0  架构决策冻结（本轮 = Audit + Decision Proposal）
         ├─ 输出本报告
         ├─ 冻结 §24 全部决策项
         └─ 冻结「数据建模规则」（§17–§20 共 35 条规则）
         Gate：决策签字；在途改动（Opportunity.channelId）先合入或先回退

Phase 1  主数据归属冻结
         ├─ 定义 Customer / Contact / Product / Supplier / Channel / Organization 的权威字段清单
         ├─ 决定 Contact 是否新增（决定标量 vs JSON 的去留）
         └─ 决定 ProductPrice / CustomerProduct / ComboProduct 的接线或下线
         Gate：主数据字段清单 + 字典 FK 清单签字

Phase 2  业务过程模型冻结
         ├─ 定义 Sales Process Domain 边界（Lead / Opportunity 归入同域、保留两张表）
         ├─ 确认阶段派生规则（保持 pipelineStage）
         └─ 定义状态机权威（服务端校验）
         Gate：过程状态机转移表签字

Phase 3  字段所有权冻结
         ├─ 逐字段标注 A–F 六类（§6 分类）
         ├─ 输出「最终数据所有权矩阵」并冻结
         └─ 明确「允许冗余 vs 禁止冗余」清单
         Gate：所有权矩阵签字

Phase 4  关系模型冻结
         ├─ 决定 Quotation/SampleOrder/SalesOrder/Shipment/Payment.customerId 的去留
         ├─ 决定 customerProductId 的去留
         └─ 冻结「引用 vs 复制」规则
         Gate：FK 图签字

Phase 5  Draft 模型冻结
         ├─ Lead.draft 语义重命名（完整度标志）
         ├─ 收敛 customerLocked/productLocked 为派生
         └─ 定义统一「建档」服务端事务端点（替代前端编排）
         Gate：Draft 规则签字

Phase 6  Snapshot 模型冻结
         ├─ 六类必需快照清单
         ├─ 删除 4 个空壳 Snapshot
         ├─ 修正可见性投影不修改快照
         └─ 统一快照构造工具函数
         Gate：快照规则签字

Phase 7  数据库 Migration Design
         ├─ 逐条设计 up/down
         ├─ 明确数据回填策略（禁止启发式猜测，DR-7）
         └─ 死列 / 死模型的废弃策略（先停写 → 再停读 → 再 drop）
         Gate：Migration Review

Phase 8  Backend Contract Migration
         ├─ API 响应契约变更（移除被删字段、补齐联查）
         ├─ 派生回写归位（progress / arrivedQty / Customer 统计）
         ├─ 状态机校验落地
         └─ leadStatus 移入事务
         Gate：接口回归

Phase 9  Frontend Sync
         ├─ 页面联查改造（Lead 建档后不再展示 intake 值）
         ├─ Draft 重命名后的 UI 文案与状态
         └─ 快照字段的「现值 vs 当时值」展示规则
         Gate：UI 回归

Phase 10 Runtime Verification
         ├─ 全链路端到端：Lead → Customer → Opportunity → Quotation → SampleOrder → SalesOrder → Production → Shipment → Payment → Profit
         ├─ 数据一致性校验脚本（重复客户、customerId 不一致、快照被改写）
         └─ 旧数据抽样核对
         Gate：验收

Phase 11 Commit Gate
         └─ 分阶段 commit / push（每阶段可独立回滚）
```

---

## 24. Decision Freeze Candidates

> 以下为**需要用户确认**的架构决策。未签字前不得实施。

### D1 · 渠道/平台的唯一权威位置（**最紧急**，因为代码正在写）

**背景**：工作区未提交改动把 `channelId/shopId` 加进 `Opportunity`，使同一事实出现在 `Lead` + `Customer` + `Opportunity` 三处。

**证据**：
```
03-customer.prisma:212-215   Lead.channelId / shopId
03-customer.prisma:27-30     Customer.channelId / shopId
05-opportunity.prisma:41-45  Opportunity.channelId / shopId（在途）
03-customer.prisma:25-26     "与 Lead.channelId / Lead.shopId 同义；线索转客户时原样带入"
convertLead.ts:166-167       "原样带入线索的 channelId / shopId"
```

**候选方案**：
- **A（推荐）**：渠道归属 **Lead**（来源事实的起点）。`Customer.channelId` 保留为「首单来源」（客户可来自多渠道，但需一个主来源）；`Opportunity` **不存** channelId，筛选通过 `opportunity.lead.channelId` 联查。→ 需要回退在途改动，或改为 `opportunity.lead` include。
- **B**：渠道归属 **Customer**（客户是长期对象）。Lead/Opportunity 均通过 customerId 联查。
- **C**：承认「来源是每个过程实例的属性」，三处各自独立持有（**接受冗余**），但需明确它们**可以不同**，并放弃「同义」表述。

**必须回答**：客户换渠道后，历史商机的渠道应显示旧值还是新值？（这决定它是「事实」还是「引用」）

### D2 · `Opportunity.outcome` 接线 或 删除

当前 0 引用。若删，则「赢单」的唯一定义 = 存在 `SalesOrder`；若接线，则需定义赢单/输单的产生入口（当前没有输单入口）。

### D3 · 销售过程的赢单定义

`Lead.status=WON`（已实现） vs `Opportunity.outcome=WON`（未实现）：哪个是权威？

### D4 · `ProductPrice`（客户专属价）接线 或 删除

若保留：需要 CRUD + 从报价生成（`sourceType=QUOTATION`）+ 报价/下单时取价优先级规则。
若删除：需明确「客户专属价」能力由 `CustomerProduct.agreedPrice` 承担还是根本不需要。

### D5 · `CustomerProduct`（客户定制版本）接线 或 删除

当前 `SalesOrderItem.customerProductId` 是**未被维护的 FK**——客户端可传任意 id。

### D6 · 是否新增 `Contact` 主数据

决定 `Customer.contactName/email/phone/wechat` 与 `contactMethods` JSON 的去留（当前表内双表示）。

### D7 · `Lead` 是否重命名 intake 字段

建议把 `companyName/contactName/email/phone/country/customerType` 改为 `intake*` 语义。**但**这会影响前端所有线索展示——需确认「建档后是否仍展示线索录入值」。

### D8 · 是否统一「字典 FK 化」

目前 6 类字典用裸字符串（`customerType`/`unit`/`craftIds`/`audienceId`/`categoryId`/`crafts`/`categories`）。FK 化会引入迁移成本与前端改动。

### D9 · `Quotation.customerId` / `SampleOrder.customerId` / `Shipment.customerId` / `Payment.customerId` 的去留

它们**可以**从上游派生。保留的理由：① 查询性能；② `Restrict` 保护；③ 报价/打样可独立成立。删除的理由：SSOT。
**建议保留 Quotation/SampleOrder，评估删除 Shipment/Payment。**

### D10 · `Customer.totalOrderAmountCny / lastOrderAt` 接线 或 删除

目前是「声明由履约层回写」但 0 写入的空列。

### D11 · 状态机是否服务端校验

`Quotation.status` / `SalesOrder.status` 当前由客户端任意指定。

### D12 · `customerSnapshot` / `termsSnapshot` 定义 或 删除

若不删除，必须给出字段清单与消费方（当前 4 个空壳）。

### D13 · 快照与权限投影的边界

是否同意「快照字段不因当前可见性被置 null」？（当前实现会置 null）

### D14 · `ProductTask` 是否迁出 Product

过程任务挂在主数据上（`04-product.prisma:282`）。

### D15 · `Product.stock` 是否接入库存事件

当前无入库/出库联动，`stock` 与实际脱节。

### D16 · `Profit.costSnapshot` 是否补齐前端展示

唯一真实实现的快照，前端只声明类型未渲染（`client/src/api/profits.ts:62`）。

### D17 · 是否冻结「单租户」为永久契约

当前无 Organization/Tenant，若未来要支持多组织，现在是最便宜的引入时机。

---

## 25. Final Audit Conclusion

### 25.1 对任务 13 问的逐条回答

**1. 什么是 YSEM 的主数据？**
6 类实体 + 9 类字典。实体：**Customer、Product（+ComboProduct）、Supplier、Channel、Organization（User/Department/Role/Permission）、Currency 值域**。字典：CustomerType、CommunicationTool、Unit、CurrencyRate、Certificate、ProductCraft、ProductAudience、ProductCategory、DailyExchangeRate。
**不是主数据**：Lead、Opportunity、Quotation、SampleOrder、SalesOrder、ProductionOrder、PurchaseOrder、Shipment、QualityInspection、Payment、Profit、ProductTask、Attachment。
**缺失的主数据**：Contact（联系人）、Country（国家）。

**2. 什么是业务过程？**
Lead、Opportunity、Quotation、SampleOrder、SalesOrder、ProductionOrder、PurchaseOrder、Shipment。判定特征：有 status 状态机、有 ownerId、有 nextAction 类字段、生命周期有限、不描述「东西是什么」。
**不是业务过程而是业务事实**：Payment、Profit、QualityInspection、Shipment 的运费/装载量。

**3. 线索、商机、报价、订单之间到底是什么关系？**
同一条销售链上的四个环节，但**生命周期性质不同**：
- `Lead` → `Opportunity`：**同一 Sales Process 域内的两个阶段**；`Lead 1:N Opportunity`；Lead 的状态由 Opportunity 的下游事件驱动（`NEW→CONFIRMED→SAMPLED→WON`）
- `Opportunity` → `Quotation` / `SampleOrder`：商机是「销售过程实例」，报价与打样是它派生出的**独立生命周期实体**（有各自编号、状态机、有效期、历史事实）
- `Quotation` / `SampleOrder` → `SalesOrder`：二者都是订单的**可能来源**（均可空），订单的核心上游是 Opportunity（必填 Restrict）

**4. 哪些东西应该合并成业务过程？**
- **Lead 与 Opportunity 应合并到同一个「销售过程域」**（模块边界层面），但**保留两张表**（基数 1:N + 字段集不重叠 + 生命周期长度不同）。
- **Activity / Follow-up / Task 已经合并进 OperationLog**（4 个副表已删）——**保持，禁止复活**。
- **不应合并**：Quotation、SampleOrder、SalesOrder（各自有独立生命周期与历史事实）。

**5. 哪些东西必须独立生命周期？**
Quotation（版本链 + 有效期 + 法律留痕）、SampleOrder（多轮次）、SalesOrder（交易事实）、ProductionOrder、PurchaseOrder、Shipment、QualityInspection、Payment、Profit。
**理由**：每个都有独立状态机 + 独立业务事实 + 被独立引用（FK）。

**6. 哪些字段只能有一个权威来源？**
见 §11 全表 + §17 规则。核心：客户名称/编号/等级/类型/国家、产品名称/SKU/分类/工艺/标准价、供应商名称、渠道名称、组织人员名称、币种值域、单据编号。
**当前违规清单**（必须收敛）：`Lead.customerType`（应删）、`Lead.unit/currency/country`（应 FK 化或冻结）、`LeadItem.craftIds/audienceId/categoryId`（裸 String）、`Supplier.crafts/categories`（存 name）、`Customer/Lead.contactMethods` + 标量双表示、`Lead.companyName` 等（建档后应降级）。

**7. 哪些字段可以通过 JOIN 得到？**
- `customerName` / 客户国家 / 客户类型 / 客户等级 → `Customer` （**Opportunity 已合规**；Lead 在建档后应合规）
- `productName` / 产品分类 / 工艺 → `Product`（**但单据行允许且必须有快照**，见规则 DUP-3）
- `Opportunity.stage` → 关联单据（**已合规，最优秀的现有实践**）
- `Lead.status` → 下游单据事件（**已合规**）
- `Quotation/SampleOrder/SalesOrder/Shipment/Payment.customerId` → 上游（**当前冗余，靠 app 层校验**）
- `Customer.totalOrderAmountCny/lastOrderAt` → `SalesOrder` 聚合
- `SalesOrder.paidAmountCny` → `Payment` 聚合（**已合规**）
- `SalesOrderItem.shippedQty` → `ShipmentItem` 聚合（**已合规**）

**8. 哪些字段必须作为业务事实保存？**
`QuotationItem`/`SalesOrderItem`/`PurchaseOrderItem` 的 `unitPrice/quantity/amount/currency`；`SalesOrder.totalAmount/depositRatio/depositAmount/balanceAmount`；`Payment.amount/amountCny/ratio/payDate/method`；`Profit.*`（含 `costSnapshot`）；`Shipment.freightAmount/freightAmountCny`；`SampleOrder.feeAmount`；`QualityInspection.sampleQty/defectQty/defectRate`；各表 `exchangeRate` 与 `Lead.usdRate`。（见 §7）

**9. 哪些字段必须 Snapshot？**
六类（见规则 SN-2）：① 单据行产品快照 ② 交易价格与金额 ③ 商务条款 ④ 汇率 ⑤ 成本构成 ⑥ 审批/操作留痕。
**明确不需要 Snapshot**：客户名称、国家、联系人、产品分类/工艺/证书、人员姓名（可用 FK 追溯；`Customer` 有软删不需要快照）。

**10. Draft 到底应该是什么？**
Draft 只是**状态 / 工作态**问题，**不应**创建一套重复主数据。
YSEM 当前有两种不同东西共用一个词：① 状态机首态（Quotation/SampleOrder/SalesOrder/Production/Purchase/Profit 的 `DRAFT`）；② 数据完整度标志（`Lead.draft`）。
**结论**：Lead 的 draft **应重命名**（如 `customerLinked`/`productLinked` + `stage`），并收敛 `customerLocked/productLocked` 为派生；其余六模块的 `DRAFT` 保持状态机首态语义。**Draft 不建独立表，不需要独立 ID。**（见 §20）

**11. 哪些数据应该删除重复字段？**
- `Lead.customerType`（Customer 侧已有）
- `Opportunity.channelId/shopId`（**在途，建议不要加**，见 D1）
- `Opportunity.outcome/outcomeAt/wonAt/lostReason`（0 引用）
- `Customer.contactName/email/phone/wechat` **或** `contactMethods`（二选一）
- `Lead.email/phone` **或** `contactMethods`（二选一）
- `Quotation/SampleOrder/SalesOrder.customerSnapshot/termsSnapshot`（空壳）
- `Customer.totalOrderAmountCny/lastOrderAt`（空列，接线或删）
- `Lead.customerLocked/productLocked`（可派生）
- `Shipment.customerId`、`Payment.customerId`（评估）
- `ProductPrice` / `CustomerProduct` 死模型（决策后）
- `Lead.companyName/contactName/email/phone/country` 的**展示用途**（保留为 intake 留痕）

**12. 哪些当前表实际上只是「错误的数据边界」？**
- **`Lead`**：边界最大错误——它同时是「销售过程前段」与「客户资料暂存所」。客户资料不该住在 Lead 里。
- **`ProductTask`**：过程任务住在主数据 `Product` 下（错误方向）。
- **`Product.stock` / `Product.lowStockAlert`**：库存事实住在产品主数据下，且无事件源。
- **`Customer.firstOrderAt/lastOrderAt/totalOrderAmountCny`**：履约聚合住在客户主数据下（可接受但必须回写，当前未回写）。
- **`ProductPrice` / `CustomerProduct`**：声明了关系事实但无任何写入口——「有边界无内容」。
- **`ShopChannel` 的缺失**：不是错误边界，而是 Channel 自关联树替代，✅ 正确。
- **`Opportunity` 的 `outcome`**：终态声明与派生 stage 并存 → 双边界。

**13. 未来新增模块应该遵守什么数据建模规则？**
直接采用 §17–§20 的 35 条规则，核心 7 条：
1. 先问「这是主数据 / 关系 / 过程 / 事实 / 快照 / 派生」中的哪一类，再决定落点（§6 六分类）。
2. 主数据只维护一份，过程通过 FK 引用（SSOT-1/2）。
3. 能 JOIN 得到的展示数据不落库（SSOT-4）。
4. 字典只用枚举或 FK，禁止 String 存 name（SSOT-5）。
5. 真实业务事实独立保存，不随主数据变化（DUP-1/2/3）。
6. Snapshot 只在六类时点冻结，且一旦落库不可变、不被权限投影改写（SN-1～SN-7）。
7. Draft 是状态不是表；状态机串行权在服务端（DR-1/2、SSOT-7）。
补充：**不要为了少表而合并**（Lead/Opportunity 保留两表）；**也不要为了一个页面而拆表**（ProductTask 应迁出而非新增模块）。

### 25.2 项目实际健康度评估（修正任务预设）

| 任务预设的问题 | 实测结论 |
|---|---|
| 「Customer/Lead/Opportunity/Product/Order 之间存在大量相似字段」 | ⚠️ **部分成立**：`Lead` ↔ `Customer` 有 6 个相似字段；`Opportunity/Quotation/SalesOrder` **没有** `customerName/productName` 等展示冗余 |
| 「一些基础资料可能被重复存储」 | ✅ 成立：渠道（Lead/Customer/Opportunity 在途）、联系人（Lead/Customer/Supplier/Dept/User）、字典名称裸字符串（6 处） |
| 「一些业务数据可能同时出现在多个表」 | ✅ 成立但范围小：`customerId`（5 处）、`currency/exchangeRate/totalAmount*` 三件套（5 表，模式一致非冗余） |
| 「Draft / Snapshot / 当前主数据 / 历史业务事实的边界可能不清晰」 | ✅ **成立且是主要问题**：4 个空壳 Snapshot + 2 种 Draft 语义 + 9 个未实现字段 |
| 「按‘一个业务概念一张表’增长」 | ⚠️ 部分成立：确实一对象一 controller 一 page，但**阶段已改为派生不落库**（先进做法），且 **Activity 域已收敛为单表** |
| 「模块之间逐渐产生重复字段、重复维护和数据同步问题」 | ❌ **反向证据**：全仓库**无任何反向同步代码**（改 Product/Customer 不同步业务表），且**无冗余 customerName 落库** |

> **总体判断**：YSEM 的数据架构**比任务预设健康得多**。它已经完成了两次成功的收敛（Activity 域单一化、阶段派生不落库），且**没有**引入反向同步反模式。
> 真正的风险不在「重复字段」，而在 **「架构承诺与实现脱节」**：Schema 声明了 `outcome` / `customerSnapshot` / `ProductPrice` / `CustomerProduct` / `Customer.totalOrderAmountCny` 等 15 处能力，但代码从未接线。这造成三种危害：① 后来者以为能力已存在；② 每个新功能都可能各自造一套替代实现（如客户专属价被塞进 `QuotationItem.unitPrice`）；③ 数据库契约与运行时事实不一致。

### 25.3 本轮最小必要动作（仍未实施，仅供决策参考）

按「风险 × 成本」排序，若只做三件事：

1. **立即冻结 D1**（渠道归属）——因为工作区正在写这段代码。这是唯一「今天不做、明天就要还债」的决策。
2. **冻结「15 处已声明未实现」的接线/删除决策**（D2/D3/D4/D5/D10/D12/D16）——这是当前最大的架构债，且**删除成本远低于接线成本**。
3. **把 §17–§20 的规则写进项目规范**（`docs/`）——因为代码库里已有的 ADR 注释（ADR-03/04/08/12/14/18/20、Q8/Q9/Q10/Q11/Q12/Q14、DQ-3/DQ-5）证明团队已有「先决策后实现」的习惯，只缺一份**数据归属规则**的正式文本。

---

**本轮结束。未修改任何文件。等待下一步指令。**
