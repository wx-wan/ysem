# YSEM Architecture Decision Register

> Round：Architecture Decision Freeze · **Read Only**
> 本轮未修改任何代码 / Prisma Schema / Migration / 数据库 / API / 前端，未 commit，未 push。
> 仅新增本登记册文件。
>
> BASELINE：HEAD = origin/master = `66ebebec`；Working Tree **dirty**（含在途 `Opportunity.channelId/shopId`）

---

## 0. 全局术语与状态说明

### 0.1 本登记册引入的核心术语

| 术语 | 定义（基于本轮业务说明 + 代码事实） | 当前代码实体 |
|---|---|---|
| **Master Data** | 独立生命周期、被多个业务过程引用、只有唯一权威来源、其他模块只应引用 ID 的数据 | `Customer` / `Product` / `Supplier` / `Channel` / `User`+`Department` / 9 类字典 |
| **Sales Record** | **一条销售业务过程**的载体。Lead / Opportunity / Quotation / Order 是它的阶段、节点或具有独立生命周期的业务对象 | **当前不存在此实体** → 需要决定是否引入（见 D0/D13） |
| **Sales Record Channel** | 这条销售记录的获客 / 销售渠道 | `Lead.channelId/shopId`（+ 在途 `Opportunity.channelId/shopId`） |
| **Customer.source** | （新定义）客户首次正式获客渠道 | `Customer.source`（`LeadSource` 枚举）+ `Customer.channelId/shopId` ← **存在冲突，见 D12** |
| **Draft** | Sales Record 的工作状态（尚未确认） | 仅 `Lead.draft`（其余 6 模块的 `DRAFT` 是状态机首态） |
| **Snapshot** | 已发生且必须冻结的历史事实 | 明细行快照 + 条款标量 + 汇率 + `Profit.costSnapshot` |

### 0.2 状态定义

| 状态 | 含义 |
|---|---|
| **CONFIRMED** | 规则已明确，无需人工再决策；可直接进入后续实施设计 |
| **CONFIRMED（含 ACTION）** | 规则已明确，但实施时有一组附带动作需执行 |
| **NEED REVIEW** | 存在未定项，**必须**人工 Decision Freeze 后才可实施 |
| **CONFLICT** | 新业务定义与既有冻结规则**直接冲突**，必须人工裁决（不可自行选择） |

### 0.3 一览表

| # | 决策 | 状态 | 阻塞下一轮？ |
|---|---|---|---|
| D1 | Sales Record Channel Ownership | **CONFIRMED**（含 1 处子冲突） | 是（在途代码） |
| D2 | Sales Record Draft | **CONFIRMED（含 ACTION）** | 是 |
| D3 | Lead vs Customer Draft Data | **NEED REVIEW** | 是 |
| D4 | Customer Contact Model | **CONFIRMED（含 ACTION）** | 否 |
| D5 | Product / Production / Inventory Boundary | **NEED REVIEW** | 否 |
| D6 | Snapshot Immutability | **CONFIRMED（含 ACTION）** | 是 |
| D7 | Snapshot Scope | **CONFIRMED** | 否 |
| D8 | Draft vs Snapshot | **CONFIRMED** | 否 |
| D9 | Unimplemented Models | **NEED REVIEW** | 是 |
| D10 | Derived Fields | **CONFIRMED（含 ACTION）** | 否 |
| D11 | State Machine Authority | **CONFIRMED（含 ACTION）** | 是 |
| D12 | Customer.source | **CONFLICT** | **是（最高优先）** |
| D13 | Customer / Sales Record Lifecycle | **NEED REVIEW** | 是 |
| D14 | Lead / Opportunity | **CONFIRMED（含 ACTION）** | 否 |
| D15 | Quotation / SampleOrder | **CONFIRMED（修正假设）** | 否 |
| D16 | ProductPrice / CustomerProduct | **NEED REVIEW** | 否 |
| D17 | Final Module Boundary | **NEED REVIEW** | 是 |

### 0.4 两处对上一轮假设的修正（重要）

> **修正 1（D15）**：`Quotation → SampleOrder → SalesOrder` **不是串行链路**。代码实证为 **并行**：`Opportunity → {Quotation | SampleOrder} → SalesOrder`。上一轮审计报告的流程图中「Quotation → SampleOrder」的连线**不准确**，本登记册修正。
>
> **修正 2（D6）**：`withProductVisibility` 改写历史快照的范围**比上一轮报告估计的窄**。仅 4 个读侧调用点会改写快照，且**每个点只改写 1 个字段**（`productName`），且仅在 `productId` 非空时触发。`SalesOrderItem` / `ProductionOrderItem` / `ShipmentItem` 的快照**不受影响**（这三个 controller 无投影逻辑）。

---

## D0 · Sales Record 概念的引入（前置决策）

**状态：NEED REVIEW（先于 D2/D13/D17）**

### 当前事实
代码中**不存在** `SalesRecord` 实体、表、枚举或任何命名。销售过程由 4 个独立实体串联表达：

```
Lead ──leadId──> Opportunity ──opportunityId──> Quotation / SampleOrder ──> SalesOrder
```

### 业务含义
新业务模型把上述 4 个实体统称为「一条 Sales Record」的不同阶段/节点。这引入一个**新的抽象层**。抽象层的实现方式有三种，必须选择：

| 方案 | 描述 | 代价 |
|---|---|---|
| **A · 概念层**（推荐） | 「Sales Record」只作为**领域概念与模块边界**存在，不落库。Lead/Opportunity/Quotation/Order 保留各自表与 ID，通过现有 FK 链串成一条记录 | 零迁移成本；需靠文档与命名规范维持概念一致性 |
| **B · 实体层** | 新增 `SalesRecord` 表，4 个实体挂 `salesRecordId` | 需要大规模迁移；与现有 `opportunityId`/`leadId` 链重复；可能引入新的冗余 FK（与 D1 教训冲突） |
| **C · 视图层** | 建 DB View / API 聚合端点，把一条链投影为「Sales Record 视图」 | 中等成本；适合列表页/看板，不改变数据所有权 |

### 当前代码证据
- 无 `SalesRecord` / `salesRecord` 任何命中
- 阶段派生已存在，可作为「Sales Record 当前状态」的读时表达：`server/src/utils/pipelineStage.ts:52-64`
- 端点已存在，可作为视图层落点：`GET /api/sales/:id`（`sales.controller.ts:276`）

### 需要人工确认
1. 「Sales Record」是**概念**还是**实体**？（建议 A）
2. 一条 Sales Record 的边界是一个 `Lead` 还是一次 `Opportunity`？**关键**：`Lead 1:N Opportunity`（`05-opportunity.prisma:16-18`），若一个线索产出 2 个商机，是 1 条还是 2 条 Sales Record？
3. 「Sales Record 的当前阶段」是否就等于现有派生 stage？

### 依赖
D2（Draft 挂在什么上）、D13（Customer 何时创建）、D14、D17

---

## D1 · Sales Record Channel Ownership

**状态：CONFIRMED（用户已明确规则）；含 1 处子冲突待裁决**

### 当前事实
| 实体 | 字段 | 类型 | 可写？ |
|---|---|---|---|
| `Lead` | `channelId` / `shopId` | FK → `Channel`（SetNull） | ✅ create（`lead.controller.ts:669-670`）+ update（白名单 `:180-181`） |
| `Customer` | `channelId` / `shopId` | FK → `Channel`（SetNull） | ✅ create（`customer.controller.ts:963-967` 来源 `splitSourceKey` 优先于显式入参）+ update（**允许改写**，`:1129-1136`、`:1156-1157`） |
| `Opportunity` | `channelId` / `shopId` | FK → `Channel`（SetNull） | ⚠️ **在途未提交**（`05-opportunity.prisma:41-46` + 迁移 `20260928120000`），由 `convertLead.ts:166-167` 从 Lead 带入 |

`Customer` schema 注释明确二者「同义」：

```25:30:server/prisma/schema/03-customer.prisma
  // ---- 获客来源（照搬线索渠道·平台组合，F-CRM-CHANNEL）----
  // 与 Lead.channelId / Lead.shopId 同义；线索转客户时原样带入，不另设 source 枚举语义。
  channelId String? // 来源渠道
  channel   Channel? @relation("CustomerChannel", fields: [channelId], references: [id], onDelete: SetNull)
  shopId    String? // 来源平台
  shop      Channel? @relation("CustomerShop", fields: [shopId], references: [id], onDelete: SetNull)
```

### 业务含义（用户已冻结）
> Channel 描述「**这一条销售记录的**获客 / 销售渠道」，因此 `Sales Record → Channel`，而非 `Customer → Channel`。
> 同一个 Customer 可拥有多条 Sales Record，各自 Channel 不同，互不覆盖。
> 不能因为 Customer 发生了新的销售机会，就覆盖历史 Sales Record 的 Channel。

### 当前代码证据
- ✅ **无反向覆盖**：全仓 `prisma.customer.update` 仅 5 处（`customer.controller.ts:1138/1237/1284/1345/1496`），除 `1138`（编辑抽屉路径，可改 channelId）外均只改 `ownerId`/`tags`，**不存在**「新销售记录 → 覆盖 Customer.channelId」的代码
- ✅ **Channel 定义本身就是「渠道/平台树」**，与具体 Customer 无关：`03-customer.prisma:152-173`
- ⚠️ `Customer.channelId` 前端**不可改**（`CustomerEditDrawer.tsx:26-41` 白名单不含 channelId），但服务端 schema 接受 update → **仅 API 可改**

### 当前问题
1. **同一事实三处存储**，且「同义」表述与「多 Sales Record 各自 Channel」在语义上**矛盾**：
   - 若 Customer 有 3 条 Sales Record、Channel 分别为 Alibaba / Exhibition / Referral → `Customer.channelId` 只能存**其中 1 个**，那它代表哪一个？现有代码语义是「最近一次线索转客户时带入的值」→ **可被覆盖**（人工编辑路径）
2. **在途改动方向与规则不一致**：`Opportunity.channelId/shopId` 从 `Lead` 复制而来（`convertLead.ts:166-167`），属**阶段内复制**。按新规则，Opportunity 是同一 Sales Record 的下一节点 → 复制可解释为「同一记录内部继承」；但也意味着**今后 Lead.channel 变更不会同步 Opportunity**（复制即脱钩），产生「同一 Sales Record 内两个阶段 Channel 不一致」的可能
3. **`Customer.source` 的定位被本规则挤压**：`03-customer.prisma:26` 注释「不另设 source 枚举语义」→ 与 D12 的新定义直接相关

### 目标规则（建议冻结文本）
```
R-D1-1  Channel 的权威归属是「销售记录」。
        Lead 是第一条 Sales Record 的起点，因此 Lead.channelId/shopId
        是 Sales Record Channel 的唯一落库点。

R-D1-2  同一 Sales Record 内的后续节点（Opportunity）不重复落库 Channel，
        通过 leadId 联查读取。→ 需回退在途的 Opportunity.channelId/shopId。

R-D1-3  Customer 不得持有「当前销售渠道」。
        Customer 侧只允许保留「首次获客渠道事实」（见 D12），
        且该事实一经写入不得因后续销售记录而变更。

R-D1-4  历史 Sales Record 的 Channel 永不因新销售记录而改变。
```

### 需要人工确认（子冲突）
| # | 问题 | 说明 |
|---|---|---|
| **D1-Q1** | **在途的 `Opportunity.channelId/shopId` 是否合入？** | ① 回退（严格按 R-D1-2，靠 `opportunity.leadId → lead.channelId` 联查，商机页筛选需 JOIN）；② 合入并承认它是「Sales Record 内的继承副本」（接受可控冗余）；③ 合入但改为必填 + 同步约束（Lead 改则商机改 → 与 R-D1-4 冲突） |
| **D1-Q2** | **`Customer.channelId/shopId` 的定位** | ① 删除（渠道全部归 Sales Record，Customer 只保留 `source` 首获渠道）；② 保留但重定义为「首次获客渠道」（与 D12 的 `source` 语义合并/二选一）；③ 保留现语义（= 最近一次线索带入值，可被改写） |
| **D1-Q3** | **一条 Sales Record 的 Channel 是否可以中途改变？** | 例：线索阶段记 Alibaba，成交时实际来自 Exhibition。是否允许改？改了要不要留痕？ |

### 依赖
**D12**（Customer.source 语义与 `Customer.channelId` 是否合一）、**D0**（Sales Record 边界）、D14

---

## D2 · Sales Record Draft

**状态：CONFIRMED（含 ACTION）**

### 当前事实
| 实体 | Draft 表达 | 语义 |
|---|---|---|
| `Lead` | `draft Boolean @default(false)` + `stage Int?` + `customerLocked` + `productLocked` | **数据完整度标志**（「客户/产品尚未建档」） |
| `Quotation` | `QuotationStatus.DRAFT` | 状态机首态 |
| `SampleOrder` | `SampleStatus.DRAFT` | 状态机首态 |
| `SalesOrder` | `SalesOrderStatus.DRAFT` | 状态机首态 |
| `ProductionOrder` | `ProductionStatus.DRAFT` | 状态机首态 |
| `PurchaseOrder` | `PurchaseStatus.DRAFT` | 状态机首态 |
| `Profit` | `ProfitStatus.DRAFT` | 状态机首态 |

`Lead.draft` 的**唯一硬性效果**：

```559:564:server/src/controllers/lead.controller.ts
  // draft=true 时放宽「至少一条联系方式」必填校验
  if (!data.contactMethods || data.contactMethods.length === 0) { ... }
```

`Lead.draft` **不创建** Customer、**不创建** Opportunity（`LeadFormModal.tsx:1011-1051` saveDraft 仅调 `leadApi.update/create`，只写 `Lead` + `LeadItem`）。

### 业务含义（用户已冻结）
> 草稿不是独立主数据，也不是一套复制的表。草稿属于 **Sales Record 的工作状态**。目标概念：`Sales Record = DRAFT | CONFIRMED`。

### 当前代码证据
- **无服务端 confirm 端点/事务**：`server/src/routes/lead.routes.ts` 无 confirm/提交端点
- Confirm 完全由前端编排（详见 D13）
- `Lead.stage` 由前端写入（`LeadFormModal.tsx:1033`）；`customerLocked/productLocked` 由前端写入（`:1030-1031`）
- 服务端**无冻结**：`updateLead` 对已 set 的 `customerId`/`productId`/`companyName` 不做拒绝（仅 scope 校验 `lead.controller.ts:789-798/818-828`）；「锁定」只是前端 `readonly`（`LeadDetailPanel.tsx:111`）

### 当前问题
1. 同一概念两种表达：`Lead.draft`（完整度）vs 其余 6 模块 `status=DRAFT`（状态机首态）
2. `Lead.draft` 与其派生规则双轨：
   ```
   customerLocked ?? (!!customerId && !draft)     // LeadFormModal.tsx:892
   productLocked  ?? (!!pid && !draft)            // LeadFormModal.tsx:897
   ```
3. 历史数据回填靠启发式猜测：`20260926010000_lead_draft/migration.sql` → `UPDATE "Lead" SET "draft"=TRUE WHERE "customerId" IS NULL AND "stage" IS NOT NULL`
4. 「Draft → Confirm」的 Confirm **无服务端权威**，用户提出的 8 个问题目前**均无代码答案**

### 目标规则（建议冻结文本）
```
R-D2-1  Draft 只存在两种合法语义，且必须命名区分：
        ① 状态机首态（status = DRAFT）—— Quotation/SampleOrder/SalesOrder/Production/Purchase/Profit
        ② 数据完整度标志 —— 仅 Lead，且应重命名（如 customerLinked / productLinked）

R-D2-2  Draft 不建独立表、不需独立 ID，与正式数据同行同主键。
        ✅ 现状已合规。

R-D2-3  Draft 期允许引用主数据（customerId/productId 可空或已填）。
        ✅ 现状已合规。

R-D2-4  Draft → Confirm 必须是服务端原子操作，且必须幂等（禁止前端多端点编排）。

R-D2-5  Draft 取消时不连带删除已创建的主数据，仅解除引用。

R-D2-6  历史数据回填必须基于权威依据，禁止启发式猜测。
```

### 需要人工确认（用户提出的 8 问）
| # | 问题 | 代码现状 |
|---|---|---|
| D2-Q1 | 什么条件可以 Confirm？ | 无服务端定义；前端 `reachedConfirm = stage==null ? true : stage>=2`（`LeadDetailPanel.tsx:114`） |
| D2-Q2 | Confirm 谁负责？ | 无定义；任意 `NEW` 状态线索的可见持有者均可（由 `roleScope` 管） |
| D2-Q3 | Confirm 后哪些字段冻结？ | **全无服务端冻结**，仅前端置灰 |
| D2-Q4 | Confirm 后是否生成 Customer？ | 是——但是**在 Draft 期就建了**（见 D13），Confirm 阶段不再生成 |
| D2-Q5 | Confirm 后是否生成 Lead？ | 不生成新 Lead（Lead 就是 Draft 的载体本身，Draft 不是独立表） |
| D2-Q6 | Confirm 后是否进入 Opportunity？ | **是**——Confirm 的动作即 `convertLeadToOpportunity`（`LeadFormModal.tsx:1308-1360`） |
| D2-Q7 | Confirm 后 Channel 如何确定？ | 沿用 `Lead.channelId/shopId`（新规则下这就是 Sales Record Channel，符合 D1） |
| D2-Q8 | Confirm 后 `Customer.source` 如何确定？ | **当前代码完全不处理**（见 D12） |
| D2-Q9 | 是否允许修改原始获客 Channel？ | 当前 `updateLead` 白名单含 `channelId/shopId` → **允许**；与 D1-Q3 联动 |

### 依赖
**D0**（Draft 挂在 Sales Record 还是 Lead）、**D11**（Confirm 的权威）、**D13**（Confirm 与 Customer 创建顺序）、**D12**

---

## D3 · Lead vs Customer Draft Data

**状态：NEED REVIEW**

### 当前事实（Lead 中的非 Lead 字段，逐项归类）

| Lead 字段 | 当前类型 | 归类判断 | 说明 |
|---|---|---|---|
| `companyName` | `String?` | **Customer Master Data（候选）+ Lead intake 留痕** | 与 `Customer.companyName` 同名同义 |
| `contactName` | `String?` | **Contact Data** | 与 `Customer.contactName` 同义 |
| `contactMethods` | `Json?` `[{tool,account}]` | **Contact Data** | 与 `Customer.contactMethods` 同义 |
| `email` | `String?` | **Contact Data（legacy 标量）** | 与 `Customer.email` 同义 |
| `phone` | `String?` | **Contact Data（legacy 标量）** | 与 `Customer.phone` 同义 |
| `country` | `String?` | **Customer Master Data（候选）** | 与 `Customer.country` 同义 |
| `customerType` | `String?` | **Customer Master Data（字典 name，无 FK）** | 与 `Customer.customerType` 同义 |
| `customerId` | `String?` FK | **Lead 自身业务事实**（引用） | ✅ 正确 |
| `channelId` / `shopId` | FK | **Lead 自身业务事实**（按 D1 新规则） | ✅ 正确 |
| `source` | `LeadSource` enum | **Lead 自身业务事实** | ✅ 正确（录入方式） |
| `productInterest` / `quantity` / `targetPrice` / `currency` / `unit` / `expectedDelivery` / `targetMarket` | — | **Lead 自身业务事实（需求）** | ✅ 正确 |
| `usdRate` | `Decimal?` | **Lead 自身业务事实（时点汇率快照）** | ✅ 正确 |
| `leadName` / `remark` | `String` | **Lead 自身业务事实** | ✅ 正确 |
| `status` / `stage` / `draft` / `customerLocked` / `productLocked` | — | **过程状态（派生候选）** | 见 D2 |
| `convertedAt` | `DateTime?` | **过程事实** | ⚠️ **0 写入**（全仓无赋值）→ 见 D9 |
| `ownerId` | FK | Lead 自身业务事实 | ✅ 正确 |

`LeadItem` 同样混装：`productId`（引用）、`productName`（未建档候选名）、`productDesc`（需求描述）、`craftIds/audienceId/categoryId`（**裸 String，无 FK**）、`sizeL/W/H/weight`（需求规格）

### 业务含义（用户已冻结）
> `Lead = Sales Process 中的业务节点`，**不是** `Customer + Sales Process`。

### 当前代码证据
- Lead → Customer 建档时**确实复制**：`convertLead.ts:126-133`（`companyName/contactName/email/phone/country`）→ `openCustomerForm` → `LeadFormModal.tsx:1093-1101` `createCustomerFromForm`（写 `companyName/contactName/country←targetMarket/customerType/contactMethods/channelId/shopId`）
- `country ← targetMarket` 的字段错位：`LeadFormModal.tsx:1099` 用 `targetMarket`（目标市场）填 `Customer.country`（国家）——**语义映射可疑**
- 回写：`leadApi.update(leadId, { customerId })`（`convertLead.ts:116/137`）
- **建档后 Lead 侧字段未清理**，仍可被 `updateLead` 修改（白名单 `lead.controller.ts:177-207` 含全部这些字段）

### 当前问题
1. **同一事实两个落库点且无同步机制**（无反向同步代码——这本身是好事，但意味着二者会**永久分叉**）
2. 「Customer Draft Data」这一概念**在代码中不存在**：既不是独立结构，也不是带标记的行；它就是「Customer 表里的真实行」
3. **无「建档前/建档后」区分**：Lead 在 `customerId` 已存在的情况下，`companyName` 等字段仍可编辑，且前端仍从 Lead 读取展示

### 目标规则（建议冻结文本）
```
R-D3-1  Lead 只保留「自身业务事实」+「Customer 尚未建档时的 intake 录入值」。
        必须重命名以标明性质（如 intakeCompanyName / intakeContactName /
        intakeEmail / intakePhone / intakeCountry / intakeCustomerType）。

R-D3-2  Lead.customerId 一旦存在，intake* 字段进入只读历史留痕态，
        不得再参与任何展示与写入（展示一律联查 Customer）。

R-D3-3  intake* 字段不得作为 Customer 建档的数据来源（建档应在服务端事务内
        由显式入参完成），避免「隐式复制」。
```

### 需要人工确认
| # | 问题 |
|---|---|
| D3-Q1 | 建档后，线索详情页是否仍需展示「线索录入时的公司名/联系人」？若需要，它是**历史留痕**（只读）还是**可编辑**？ |
| D3-Q2 | `Lead.country ← Customer.country` 是否应改用 `targetMarket`？（`Customer.country` 是客户所在地，`targetMarket` 是目标市场，二者可能不同） |
| D3-Q3 | `LeadItem.craftIds/audienceId/categoryId` 是否 FK 化？ |
| D3-Q4 | 建档后是否允许 `updateLead` 修改 intake* 字段？（建议：禁止） |

### 依赖
**D4**（Contact 模型决定 contactMethods/contactName 归属）、**D13**（建档时机）、**D12**

---

## D4 · Customer Contact Model

**状态：CONFIRMED（含 ACTION）**

### 当前事实

`Customer` 上存在**两套联系方式表示**：

| 结构 | 字段 | 当前定位（代码注释已明确） |
|---|---|---|
| **新（权威）** | `contactName` + `position` + `contactMethods Json [{tool, account}]` | 「沟通方式（与线索一致）；删除旧的邮箱/电话/微信独立字段，统一用该组件录入」 |
| **旧（legacy）** | `email` / `phone` / `wechat` | 「旧字段保留项（**仅用于回填、不再编辑**，避免 PUT 全量替换导致历史数据丢失）」 |

证据：

```
26:41:client/src/components/customer/modals/CustomerEditDrawer.tsx
  /** 沟通方式（与线索一致：[{tool, account}]）；删除旧的邮箱/电话/微信独立字段，统一用该组件录入 */
  contactMethods?: { tool: string; account: string }[] | null;
  /** 旧字段保留项（仅用于回填、不再编辑，避免 PUT 全量替换导致历史数据丢失） */
  email: string;
  phone: string;
  wechat: string;
```

展示侧已有**统一降级规则**：

```
138:153:client/src/components/customer/shared/utils.ts
// ========== 联系方式统一展示（与线索 contactMethods 一致） ==========
 * - 优先用 `contactMethods`（与线索建档同步过来的数据结构 [{tool, account}]）；
 * - 无则兼容旧数据 email / phone / wechat，退化成「工具:账号」列表。
  if (customer.email)   legacy.push({ tool: '邮箱', account: customer.email });
  if (customer.phone)   legacy.push({ tool: '电话', account: customer.phone });
  if (customer.wechat)  legacy.push({ tool: '微信', account: customer.wechat });
```

**字典**：`CommunicationTool`（`03-customer.prisma:190`）提供 `tool` 的可选值，但 `contactMethods` 里的 `tool` 是**裸字符串 name，无 FK**。

**校验强度不对称**：
- `Lead.contactMethods`：有结构校验（`lead.controller.ts:121` zod array）+ 非 draft 必填（`:559-564`）
- `Customer.contactMethods`：`z.any().nullish()` —— **无任何结构校验**（`customer.controller.ts:898` create / `:927` update）

### 业务含义
一个联系人事实（「该客户的某个人、通过某渠道联系」）目前被**两个数据结构**同时表达 → 若 `contactMethods` 有值而 legacy 标量也有值，读取方必须自行决定用哪个。

### 当前问题
1. **表内双表示**：`Customer` 的 `contactMethods` 与 `email/phone/wechat` 并存；`Lead` 的 `contactMethods` 与 `email/phone` 并存
2. **同一个标量在不同表不一致**：`Customer` 有 `position`/`wechat`，`Lead` 没有；`Supplier` 有第三套结构（`contact/phone/email`）
3. **无法表达多联系人**：`contactName` 是单值标量 → 同一客户两个采购联系人无法录入
4. **无 Contact 主数据**：全仓无 `model *Contact*`
5. `Customer.contactMethods` 无结构校验 → 可写入任意 JSON

### 目标规则（建议冻结文本）
```
R-D4-1  联系方式的权威结构是 contactMethods: [{toolCode, account}]。
        必须收敛为一处，legacy 标量（email/phone/wechat）迁移完成后删除。

R-D4-2  联系方式的归属是 Contact（联系人），而非 Customer / Lead 标量。

R-D4-3  ContactMethod.toolCode 应 FK 化到 CommunicationTool.code（当前无 FK）。

R-D4-4  Lead 的联系人信息同样归入 Contact，Lead 只保留 contactId 引用
        （Customer 尚未建档的 intake 场景允许 Lead 持有 intake 联系人快照，见 R-D3-1）。
```

### 候选模型
```
【方案 A · 引入 Contact 主数据（推荐）】
Customer
  └── Contact[]            ← 新增，一客户多联系人
         ├── name, position, isPrimary
         └── methods: ContactMethod[]     ← 新增
                ├── toolCode  FK → CommunicationTool.code
                ├── account
                └── isPrimary / sort

Customer / Lead 侧：
  - Customer.contactName / position / email / phone / wechat / contactMethods  → 迁移后删除
  - Lead.contactName / email / phone / contactMethods                          → 收敛为 intake* 留痕

【方案 B · 保持当前 JSON（证明必要性的条件）】
若确认「一个客户永远只有一个联系人 + 联系方式不超过 3 项 + 不需要独立联系方式级别元数据」，
则 JSON 结构可保留，但必须：
  ① 补 zod 结构校验（至少 [{tool:string, account:string}]）
  ② 停止写入 legacy 标量并在一个版本后 drop
  ③ tool 值域 FK 化或冻结为常量

【方案 C · 折中】
保留 Customer.contactMethods JSON 作为唯一联系方式结构，
并保留 Customer.contactName/position 单联系人标量（即现状），
明确接受「不支持多联系人」为已知限制。
```

### 需要人工确认
| # | 问题 |
|---|---|
| D4-Q1 | 业务上是否需要**一个客户多个联系人**？（这是选 A 还是 B/C 的唯一判据） |
| D4-Q2 | 是否需要「联系方式级别」的属性（如「主联系方式」「仅报价用」「仅物流用」）？ |
| D4-Q3 | legacy 标量（`email/phone/wechat`）中现存历史数据是否已确认全部可由 `contactMethods` 覆盖？未覆盖时如何回填？ |
| D4-Q4 | `Lead` 是否也需要多联系人？ |

### 依赖
**D3**（Lead intake 联系人字段处置）、**D17**

---

## D5 · Product / Production / Inventory Boundary

**状态：NEED REVIEW**

### 当前事实

| 对象 | 定义 | 写入点 | 读取点 | 实际状态 |
|---|---|---|---|---|
| `Product` | 产品主数据（`04-product.prisma:146`） | `product.controller.ts` CRUD + Excel 导入 | 全系统 | ✅ 主数据 |
| **`ProductTask`** | 产品任务（`04-product.prisma:282`），含 `type/title/status/refType/refId/refNo/ownerId/dueDate` | **`server/src` 0 写入** | **`server/src` 0 读取** | ❌ **死模型**（仅 `product.controller.ts:310` 一条注释提及） |
| **`Product.stock` / `lowStockAlert`** | 「V1 保留冗余字段：不引入独立库存域」（`04-product.prisma:184-186`） | 仅 `product.controller.ts:101-102`（zod）、`:798-799`（create/update）、`:710-711`（Excel 列） | 仅产品列表/详情展示 | ⚠️ **纯人工维护，无任何业务事件源** |

### 业务含义
- `ProductTask` 描述「打样/报价准备/设计/开模/认证」等**生产过程任务** → 属 Production Process，不属 Product Master Data
- `Product.stock` 描述「当前库存数量」→ 这是**库存业务事实的当前状态**，其真正来源应是入库/出库流水（收货、发货），而非人工输入

### 当前代码证据
- `ProductTask`：schema 有 `@@index([productId, status])` 与 `@@index([refType, refId])`，设计完整；`refType` 候选值注释为 `SAMPLE_ORDER / QUOTATION`——但**无任何 controller / route / 前端 API**
- `Product.stock`：`grep -rn "stock" server/src` 仅命中 `product.controller.ts` 自己的 9 处（zod、字段标签映射、Excel 列映射、create/update 赋值）→ **零业务联动**；`shipment.controller.ts` 发货**不扣减**，`purchaseOrder.controller.ts` 到货**不增加**
- `ProductTask` 曾替代 `Product.progress(JSON)` 与 `Product.sampleNo`（`04-product.prisma:280-281`）；但前端仍引用旧字段：`client/src/api/products.ts:102` `progress?: string | null;  // 产品进度 JSON` → **前端仍在用已废弃的 JSON 进度**

### 当前问题
1. **过程数据挂在主数据上**：`ProductTask`（生产任务）与 `Product.stock`（库存状态）都挂在 `Product` 下
2. **`ProductTask` 是死模型**：建模完整但零接线，且前端还在用被它替代的 `Product.progress`
3. **`Product.stock` 无事件源**：库存数字与实际业务脱节（发货不扣、采购不入），是「易失真的手工缓存」
4. **`Product` 承担了 4 种职责**：主数据 + 可见性权限 + 任务进度 + 库存

### 目标规则（建议冻结文本）
```
R-D5-1  Product 只承载产品主数据（是什么）+ 可见性（谁能看）。
        不承载任务进度、不承载库存状态。

R-D5-2  生产过程任务归属 Production Process（可复用 ProductionOrder，或保留
        ProductTask 表但必须接入生产过程，明确 owner 与触发点）。

R-D5-3  库存是业务事实的当前状态，必须由入库/出库事件推导：
        入库 ← PurchaseOrderItem.arrivedQty / ProductionOrderItem.completedQty
        出库 ← ShipmentItem.quantity
        在当前无独立库存域的前提下，Product.stock 应明确标注为
        「手工维护的参考值，非权威库存」，或直接下线。
```

### 需要人工确认
| # | 问题 |
|---|---|
| D5-Q1 | **`ProductTask` 删除还是接线？** 若接线，宿主是 `Product` 还是 `ProductionOrder`？触发点在哪（打样/开模/认证）？ |
| D5-Q2 | **`Product.stock` 删除、保留为参考值、还是引入独立库存域（StockMovement 流水）？** |
| D5-Q3 | 前端 `products.ts:102` 的 `progress` JSON 是否确实已废弃？前端清理是否属本轮范围？ |
| D5-Q4 | `Product.stock` / `lowStockAlert` 是否被任何报表/看板使用（决定能否直接删除）？ |

### 依赖
**D17**

---

## D6 · Snapshot Immutability

**状态：CONFIRMED（含 ACTION）**

### 当前事实（精确证据）

`projectProductRow` 的改写逻辑：

```202:219:server/src/utils/scope.ts
  产品不可见 ⇒ product = null，
  且仅当 options.nameField 存在 且 record.productId != null 时，
  把「唯一一个」nameField 字段置 null。
  不连带影响 spec/craft/size/packaging 等其它快照列。
```

**全部会改写快照的读侧调用点（4 处）**：

| controller | 影响对象 | 被改写的字段 | file:line |
|---|---|---|---|
| `quotation.controller.ts` | `QuotationItem` | `productName` | `:44-59`（list `:252` / get `:278` / create `:393` / update `:543` 同模式） |
| `sales.controller.ts` | `OpportunityItem` | `productName` | `:71-82` |
| `lead.controller.ts` | `LeadItem` | `productName` | `:441`、`:476` |
| `sampleOrder.controller.ts` | `SampleOrder.productName` | `productName` | `:44-45`，调用于 `:252/278/393/543` |

**确认不受影响的实体（重要修正）**：

| controller | 投影 | 结论 |
|---|---|---|
| `salesOrder.controller.ts` | 仅 import `productVisibilityWhere`（`:7`），**无 project\***；`SALES_ORDER_INCLUDE:40-46` 无 product 关联 | ✅ `SalesOrderItem` 快照**不被改写** |
| `productionOrder.controller.ts` | 仅 import `applyScope/roleScope`（`:8`） | ✅ `ProductionOrderItem` 快照**不被改写** |
| `shipment.controller.ts` | 仅 import `applyScope/roleScope`（`:15`） | ✅ `ShipmentItem` 快照**不被改写** |

此外 `product.controller.ts:671`、`productGroup.controller.ts:33/106/145` 调用 `projectProductRows` 但**不传 `nameField`** → 只置 `product=null`，不改快照 ✅。

写入期的快照生成（非读侧改写）：`quotation.controller.ts:203`、`salesOrder.controller.ts:219`、`lead.controller.ts:597/827`（均为 `input.productName ?? product.name`）。

### 业务含义（用户已冻结）
> 权限控制决定「用户是否能够访问业务记录」，**不得**决定「历史 Snapshot 的内容」。
> 若历史 `productName = "ABC Duck"` 因当前权限不足变成 `null`，则权限投影改变了历史事实。

### 当前问题
1. 4 个读侧调用点会把已落库的历史快照 `productName` 改写为 `null`
2. **前端 fallback 因此失效**：
   ```
   client/src/components/lead/LeadFormModal.tsx:186,848,895   item.product?.name || item.productName
   client/src/components/lead/LeadCardList.tsx:39
   client/src/components/lead/LeadDetailPanel.tsx:107
   client/src/components/sales/OpportunityCardList.tsx:27
   client/src/components/sales/OpportunityDetailPanel.tsx:243
   ```
   投影把 `product` 与 `productName` **同时**置 null → 回退值也为空 → 用户看到空单元格
3. `QuotePage.tsx:443` 明细列直接用 `productName`（无 fallback）→ 直接空白
4. 触发条件包含 **fail-closed**：`canReadProduct` 在 `visibility` 字段缺失时视为不可见（`scope.ts:180-192`）→ 任何未投影路径都可能意外触发

### 目标规则（建议冻结文本）
```
R-D6-1  快照字段（xxxItem.productName/productSku/spec/material/colors…）
        一经落库即不可变：
        ① 不因主数据更新而回写
        ② 不因当前用户权限而改写或置 null

R-D6-2  权限投影只作用于「关联对象」：
        允许 product = null（切断对主数据现值的访问）
        禁止 productName = null（抹除历史事实）

R-D6-3  权限判定应作用于「业务记录访问」层级：
        无权限者不应看到该单据；可见单据的历史快照一律完整返回。

R-D6-4  快照的可见性控制若必须存在，应通过「按单据授权」而非
        「按快照字段抹除」实现。
```

### ACTION（实施时需执行）
1. 移除 4 个调用点的 `{ nameField: 'productName' }` 选项（保留 `product = null` 的现值切断）
2. 或改为「单据级授权」：不可见产品不影响单据可见性判定
3. 前端 fallback 逻辑需重新评估（若不再置 null，fallback 可简化）

### 需要人工确认
| # | 问题 |
|---|---|
| D6-Q1 | 当产品 `visibility=PRIVATE` 且当前用户不可见时，**该单据本身是否应不可见**？（若是，问题在单据层解决，快照无需动） |
| D6-Q2 | 若单据可见但产品不可见，`item.product`（现值引用）是否允许为 null 而 `productName`（历史快照）保留？ |
| D6-Q3 | `OpportunityItem.productName` 是商机**创建时刻**由 `buildItems` 恒取 `Product.name`（`sales.controller.ts:118-125`，无入参覆盖）——它算「快照」还是「冗余展示字段」？（若是后者，按 D7 应改联查） |

### 依赖
**D7**（快照边界）、D11（权限模型）、D3

---

## D7 · Snapshot Scope

**状态：CONFIRMED**

### 当前事实

| 快照类别 | 落点 | 状态 |
|---|---|---|
| 明细行产品快照 | `OpportunityItem` / `QuotationItem` / `SampleOrder` / `SalesOrderItem` / `ShipmentItem` / `ProductionOrderItem` / `PurchaseOrderItem.itemName` | ✅ 已实现，冻结语义正确（主数据更新不回写） |
| 商务条款 | `Quotation.tradeTerms/paymentTerms/leadTime/validUntil/portOfLoading`、`SalesOrder.*`、`SampleOrder.targetPrice` | ✅ 已实现（**实质承担了空壳 `termsSnapshot` 的职责**） |
| 汇率 | 各表 `exchangeRate`、`Lead.usdRate` | ✅ 已实现 |
| 成本构成 | `Profit.costSnapshot` | ✅ 唯一完整实现（`profit.controller.ts:252-288`），⚠️ 前端未渲染（`client/src/api/profits.ts:62` 仅类型） |
| 客户快照 | `Quotation/SampleOrder/SalesOrder.customerSnapshot`、`SalesOrder.termsSnapshot` | ❌ **4 个空壳**：0 写入 0 消费（Deferred 注释见 `quotation.controller.ts:30`、`sampleOrder.controller.ts:26`、`salesOrder.controller.ts:33`） |

### 业务含义（用户已冻结）
> Snapshot 只用于保存必须长期保持历史一致性的业务事实。**不得**为了页面展示、查询方便、减少 JOIN、前端性能而随意复制主数据。

### 当前问题
1. `customerSnapshot` / `termsSnapshot` 形状未定、无消费方 → 架构债务
2. 明细行快照被当作**展示字段**使用（`QuotePage.tsx:443-444`、`SalesOrders.tsx:642-643`、`SamplePage.tsx:263/393`、`salesOrder.controller.ts:44` 用打样单快照当展示名）→ 使「展示需求」成为修改快照的动机
3. 快照构造**5 套独立实现**：`buildItems`（`sales.controller.ts:107`）、`parseItems`（quotation）、`parseItems`（salesOrder）、`resolveProductSnapshot`（`sampleOrder.controller.ts:156-189`）、纯入参（`purchaseOrder.controller.ts:179-283`）
4. `SampleOrder` 表头即单产品（无明细表），多产品打样无法表达

### 目标规则（建议冻结文本）——**Snapshot 适用边界**

```
【必须 Snapshot】（六类）
SN-1  单据行产品识别信息：productName / productSku / spec / craft / size /
      material / packaging / colors
SN-2  交易价格与金额：unitPrice / quantity / amount / currency
SN-3  商务条款：tradeTerms / paymentTerms / leadTime / validUntil /
      portOfLoading / portOfDischarge
SN-4  汇率：exchangeRate（各表）、Lead.usdRate
SN-5  成本构成：Profit.costSnapshot
SN-6  审批与操作留痕：ApprovalRecord、OperationLog（含 username/realName/businessNo）

【不得 Snapshot】
SN-N1  客户基础资料（名称/国家/联系人/类型/等级）
       —— 理由：Customer 有软删除，可用 FK 追溯历史；复制会导致永久分叉
SN-N2  产品主数据现值（分类/工艺/证书/标准价/供应商）
       —— 唯一例外：SN-1 已覆盖的「识别信息」，且仅限单据行
SN-N3  组织与人员名称 —— 用 userId 追溯
SN-N4  为展示/减少 JOIN 而复制的任何字段
       —— 若确需缓存，必须标注为派生（见 D10）

【构造与消费】
SN-C1  快照构造必须只有一套工具函数（统一 buildSnapshot），
       禁止每个 controller 各自实现
SN-C2  快照字段可以被展示，但展示方必须知道它可能落后于主数据现值；
       需要「当前值」时应 include 主数据并优先展示现值
SN-C3  未定义形状与消费方的 Snapshot 字段不得存在于 Schema
```

### 需要人工确认
| # | 问题 |
|---|---|
| D7-Q1 | 4 个空壳（`customerSnapshot` × 3 + `termsSnapshot`）**删除**还是**定义形状**？（若定义：字段清单是什么？消费方是谁？） |
| D7-Q2 | `SampleOrder` 是否需要明细表（支持多产品打样）？ |
| D7-Q3 | `OpportunityItem.productName` 按 SN-1 保留，还是按 SN-N2 改联查？（它是创建时恒取 `Product.name` 的复制，属「衍生复制」而非「时点事实」，见 D6-Q3） |
| D7-Q4 | `Profit.costSnapshot` 是否补齐前端展示？ |

### 依赖
**D6**（不可变性）、**D9**（空壳字段处置）、D8

---

## D8 · Draft vs Snapshot

**状态：CONFIRMED**

### 当前事实
- Draft：仅 `Lead.draft`（+ 6 模块的 `status=DRAFT`）
- Snapshot：明细行快照 / 条款标量 / 汇率 / `costSnapshot` / 4 个空壳
- **两者无任何字段交叉**，但**概念上被混淆**：`Lead.customerLocked/productLocked` 被注释为「锁定标志」（一种「冻结」语义），与 Snapshot 的「历史冻结」语义接近但完全不同

### 业务含义（用户已冻结）
```
Draft    = 尚未确认的工作状态
Snapshot = 已经发生且需要冻结的历史事实
```

### 当前问题
唯一风险是**术语混用**：`customerLocked` / `productLocked` 使用「锁定」措辞，容易被误读为「数据已冻结（Snapshot）」，实际是「UI 输入锁定（Draft 工作态）」。

### 目标规则（建议冻结文本）
```
R-D8-1  Draft 与 Snapshot 在概念、表结构、命名上彻底分离，禁止互相借用字段。
R-D8-2  Draft 相关字段命名禁止使用 lock/freeze/snapshot 等词
        （建议 customerLinked / productLinked，见 R-D2-1）。
R-D8-3  Snapshot 相关字段命名统一使用快照语义（xxxName / xxxSnapshot /
        exchangeRate），且必须标注「快照」注释。
R-D8-4  判据：该值是否描述「已发生的事实」？
        是 → Snapshot（写一次，永不变）
        否 → Draft / Process（随工作流变化）
R-D8-5  「Draft 期的客户信息在编辑中」不得称为 Snapshot；
        只有「订单确认时的产品名称」才可能是 Snapshot。
```

### 需要人工确认
无需新增决策，仅需确认规则文本。**（若确认，`Lead.customerLocked/productLocked` 的重命名将进入 D2 的 ACTION）**

### 依赖
D2

---

## D9 · Unimplemented Models

**状态：NEED REVIEW**

### 当前事实（完整清单）

| # | 对象 | 类型 | server 写入 | server 读取 | client | 判定 |
|---|---|---|---|---|---|---|
| 1 | `Opportunity.outcome` | 列 | **0** | **0** | **0** | 死列 |
| 2 | `Opportunity.outcomeAt` | 列 | **0** | **0** | **0** | 死列 |
| 3 | `Opportunity.wonAt` | 列 | **0** | **0** | **0** | 死列 |
| 4 | `Opportunity.lostReason` | 列 | **0** | **0** | **0** | 死列 |
| 5 | `ProductPrice` | **模型** | **0** | **0** | **0** | 死模型（仅 `product.controller.ts:362` 注释提及） |
| 6 | `CustomerProduct` | **模型** | **0 CRUD** | 仅 `salesOrder.controller.ts:248` 写入 `customerProductId`（**来自客户端任意入参**） | 仅 `client/src/api/salesOrders.ts:73` 类型声明 | 死模型 + 未维护 FK |
| 7 | `ProductTask` | **模型** | **0** | **0** | **0**（前端仍用旧 `progress` JSON，`products.ts:102`） | 死模型（见 D5） |
| 8 | `Quotation.customerSnapshot` | 列 | **0** | **0** | **0** | 空壳 |
| 9 | `SampleOrder.customerSnapshot` | 列 | **0** | **0** | **0** | 空壳 |
| 10 | `SalesOrder.customerSnapshot` | 列 | **0** | **0** | **0** | 空壳 |
| 11 | `SalesOrder.termsSnapshot` | 列 | **0** | **0** | **0** | 空壳 |
| 12 | `Quotation.parentId` + `revisions` | 关系 | **0**（写入 Deferred，`quotation.controller.ts:31`） | 仅 `orderBy version desc`（`:270`） | 0 | 半成品版本链 |
| 13 | `Lead.convertedAt` | 列 | **0** | 0 | 0 | 死列 |
| 14 | **`Customer.intentLevel`** | 列 | **0**（D-INTENT v2「不再接受人工输入」） | **0**（D-INTENT v2「不读取 legacy 列」） | 0 | **死列（本轮新发现）** |
| 15 | `Customer.totalOrderAmountCny` | 列 | **0** | 部分（见 D10） | ? | 未回写 |
| 16 | `Customer.lastOrderAt` | 列 | **0** | ? | ? | 未回写 |
| 17 | `Product.progress`（旧 JSON，已被 ProductTask 替代） | 列 | 0 | 0 | ✅ 仍在使用（`products.ts:102`） | 前端残留 |

证据摘录：

```
81:83:server/src/controllers/customer.controller.ts
 * 唯一新增：末位「无意向」条目 —— 无商机 / 全部商机 intentLevel 为 null 时派生结果为 `null`
 * 数据来源为**派生计数**（商机意向聚合），不读取 legacy 列 `Customer.intentLevel`。
```
```
904:904:server/src/controllers/customer.controller.ts
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，**不再接受人工输入**（无 intentLevel 入参）
```

### 业务含义（逐项判断）

| # | 对象 | 是否真实业务需要 | 判断 |
|---|---|---|---|
| 1-4 | `Opportunity.outcome*` | **是**（需要「赢/输单」结论）。但当前真相由 `Lead.status=WON` + `SalesOrder` 存在性表达 | **架构债务**：声明了能力但未接线，且已有替代真相 → 二选一 |
| 5 | `ProductPrice` | 取决于「是否需要客户专属协议价」 | **未完成业务模型** |
| 6 | `CustomerProduct` | 取决于「是否需要客户定制版本管理」 | **未完成业务模型 + 危险**（未维护 FK 可被任意填） |
| 7 | `ProductTask` | 取决于「是否需要跟踪打样/开模/认证任务」 | **未完成业务模型** |
| 8-11 | 4 个 Snapshot 空壳 | **否**（客户名/条款已由 FK + 标量承担） | **架构债务 → 建议删除** |
| 12 | Quotation 版本链 | **是**（报价改版是真实业务） | **未完成业务模型** |
| 13 | `Lead.convertedAt` | **是**（转化时间是过程事实） | 未接线（`Lead.status=CONFIRMED` + 商机 `createdAt` 已可替代） |
| 14 | `Customer.intentLevel` | **否**（已被读时派生替代） | **架构债务 → 建议删除** |
| 15-16 | Customer 统计 | **是**（客户列表需要） | 见 D10 |
| 17 | `Product.progress` | **否** | 残留 |

### 当前问题
> **这不是「重复字段」问题，而是「架构承诺与实现脱节」**。危害：
> ① 后来者以为能力已存在（如以为「客户专属价」有模型就去查 `ProductPrice`）；
> ② 每个新功能各自造替代实现（如客户专属价被塞进 `QuotationItem.unitPrice`）；
> ③ DB 契约与运行时事实不一致（`customerProductId` 可写任意值）。

### 目标规则（建议冻结文本）
```
R-D9-1  每条模型/列必须至少有一个写入点与一个读取点，否则必须显式声明为
        「预留（Reserved）」并在 schema 注释中标注目标版本与负责人。
R-D9-2  禁止「有声明无接线」的中间态长期存在。
        废弃流程：停写 → 停读 → 观察一个版本 → drop。
R-D9-3  外形上未被维护的 FK（如 SalesOrderItem.customerProductId）
        要么补齐 CRUD + 校验，要么从 API 入参移除。
R-D9-4  legacy 列（Customer.intentLevel）在派生实现上线后必须在同一
        Release 内下线，禁止长期并存。
```

### 需要人工确认（逐项决策）
| # | 决策 |
|---|---|
| D9-Q1 | `Opportunity.outcome/outcomeAt/wonAt/lostReason`：**接线**（定义赢/输单入口）还是**删除**（承认「赢单=有 SalesOrder」）？若接线，输单入口在哪？ |
| D9-Q2 | `ProductPrice`：接线还是删除？若接线，取价优先级如何定义？ |
| D9-Q3 | `CustomerProduct`：接线还是删除？`SalesOrderItem.customerProductId` 是否保留？ |
| D9-Q4 | `ProductTask`：接线还是删除？（与 D5-Q1 同一决策） |
| D9-Q5 | 4 个 Snapshot 空壳：删除还是定义？ |
| D9-Q6 | `Quotation` 版本链：接线（自动生成新 version + parentId）还是删除？ |
| D9-Q7 | `Lead.convertedAt`：接线还是删除？ |
| D9-Q8 | `Customer.intentLevel`：删除？（D-INTENT v2 已用读时派生替代） |
| D9-Q9 | `Product.progress`（旧 JSON）：前端是否清理？ |

### 依赖
**D5**、**D7**、**D10**、**D16**

---

## D10 · Derived Fields

**状态：CONFIRMED（原则）+ 逐项 NEED REVIEW**

### 当前事实

| 字段 | 声明语义 | 实际实现 | 事务 | 判定 |
|---|---|---|---|---|
| `SalesOrder.paidAmountCny` | 「由 Payment(direction=IN, status=CONFIRMED) 汇总回写」 | ✅ `payment.controller.ts:225-242` `recalcPaidAmountCny`（aggregate → update），批量 `:245-252`；行锁 `lockSalesOrders:188-217` | ✅ 事务内 | ✅ **正确** |
| `SalesOrderItem.shippedQty` | 「由 ShipmentItem 汇总回写」 | ✅ `shipment.controller.ts:303-329` `recalcShippedQty`（groupBy → update）；行锁 `lockSalesOrderItems:215-297` | ✅ 事务内 | ✅ **正确** |
| `ProductionOrder.progress` | 「由明细汇总回写」 | ❌ `productionOrder.controller.ts:218-227` 是**纯计算**，值来自 `body.progress ?? parsed.progress ?? 0`（**入参**） | ✅ | ❌ **语义与实现不符** |
| `ProductionOrderItem.completedQty/defectQty` | 明细 | 行输入（`productionOrder.controller.ts:186-203`），非汇总 | ✅ | ⚠️ 实为事实，命名误导 |
| `PurchaseOrderItem.arrivedQty` | 到货汇总 | ❌ **入参**保留（`purchaseOrder.controller.ts:268-288`），非到货单汇总 | ✅ | ❌ **语义与实现不符** |
| `PurchaseItemStatus` | 「自动同步」 | ❌ 仅见注释（`purchaseOrder.controller.ts:45`），`status` 始终取自入参 `:288` | — | ❌ **未实现** |
| `Customer.firstOrderAt` | 「由履约层回写，只读」 | ❌ 由**人工**在客户 create/update 时写入（`customer.controller.ts:935-936` `dateField`、`:1167`） | — | ❌ **语义与实现不符** |
| `Customer.lastOrderAt` | 同 | ❌ **0 写入** | — | ❌ 空列 |
| `Customer.totalOrderAmountCny` | 同 | ❌ **0 写入** | — | ❌ 空列 |
| `Product.stock` | 库存 | ❌ 仅人工维护 | — | ❌ 见 D5 |
| `Customer.intentLevel` | 意向等级 | ❌ legacy，读取已改为商机聚合派生（`customer.controller.ts:131-180`） | — | ❌ 死列，见 D9 |
| `Opportunity.stage` | 阶段 | ✅ **读时派生不落库**（`pipelineStage.ts:52-64`） | — | ✅ **最佳实践** |
| `Lead.status` | 线索状态 | ✅ `advanceLeadStatus`（`leadStatus.ts:30-40`），⚠️ **在主事务之外，失败仅 `console.error`** | ❌ | ⚠️ 弱一致性 |

### 业务含义（用户已冻结）
> 优先考虑「通过业务数据实时计算」，而不是「长期维护一份容易失真的缓存」。

### 当前问题
1. **同类型字段实现质量两极分化**：`paidAmountCny`/`shippedQty` 是教科书级实现（行锁 + 事务 + 唯一回写函数）；`progress`/`arrivedQty`/`firstOrderAt` 则是「声明是派生、实为入参」的**语义欺骗**
2. **空列**：`Customer.lastOrderAt` / `totalOrderAmountCny` 声明了回写者（履约层）但从未回写 → 客户列表若读取将恒为 0/null
3. **`Lead.status` 弱一致性**：`advanceLeadStatus` 在 `sales.controller.ts:442`、`sampleOrder.controller.ts:390`、`salesOrder.controller.ts:527` 三处调用，**均在主事务之外**

### 目标规则（建议冻结文本）
```
R-D10-1  能通过 JOIN / 聚合实时得到的数据，优先实时计算，不落库。
         （现有最佳实践：Opportunity.stage 读时派生）

R-D10-2  确需落库的派生缓存必须同时满足四条件：
         ① schema 注释标注「派生（derived）」
         ② 在同一事务内回写
         ③ 回写函数唯一（禁止多 controller 各自汇总）
         ④ 有行锁或等效并发保护
         （现有最佳实践：recalcPaidAmountCny / recalcShippedQty）

R-D10-3  禁止「声明为派生但由入参写入」。（当前违规：progress / arrivedQty）

R-D10-4  派生缓存的字段名必须能被识别为派生（如 paidAmountCny），
         或集中在一个可识别的分组中。

R-D10-5  弱一致性链路（如 Lead.status）必须显式声明为「最终一致」，
         并具备补偿机制（重试 / 对账任务），不得仅 console.error。
```

### 需要人工确认
| # | 问题 |
|---|---|
| D10-Q1 | `Customer.totalOrderAmountCny` / `lastOrderAt`：**删除**（列表实时聚合）还是**接线回写**（在 Payment/Profit 确认时）？ |
| D10-Q2 | `Customer.firstOrderAt`：改为履约层自动回写（首个 SalesOrder 创建时），还是保持人工录入？ |
| D10-Q3 | `ProductionOrder.progress` / `PurchaseOrderItem.arrivedQty`：改为真汇总，还是承认它们是「人工填报字段」并重命名？ |
| D10-Q4 | `Lead.status` 的弱一致性是否可接受？若否，是否移入主事务或加对账任务？ |
| D10-Q5 | 客户列表页当前是否读取 `totalOrderAmountCny`/`lastOrderAt`？（决定能否直接删除） |

### 依赖
**D9**、**D5**

---

## D11 · State Machine Authority

**状态：CONFIRMED（原则）+ ACTION（补齐校验）**

### 当前事实（逐实体）

| 实体 | 字段 | create 收 status？ | update 收 status？ | 服务端流转校验 | 时间戳 |
|---|---|---|---|---|---|
| `Lead` | `status` | ❌ 硬编码 `'NEW'`（`lead.controller.ts:674`） | ❌ 白名单排除（`:177-207`） | ✅ `advanceLeadStatus`（`leadStatus.ts:30`，仅前进不降级） | — |
| `Quotation` | `status` | ✅ `:350` | ✅ `:477-481` | ❌ **无** | 自动（`STATUS_TIME_FIELD:72`） |
| `SampleOrder` | `status` | ✅ `:361` | ✅ `:497` | ❌ **无** | 无 |
| `SalesOrder` | `status` | ✅ `:470,495` | ✅ `:654-656` | ❌ **无** | 自动（`:60`） |
| `ProductionOrder` | `status` | ✅ `:474,484` | ✅ `:582` | ✅ **有** `checkProductionStatusTransition`（`:306`，白名单 `:262-279`），gate 于 `:575` | 入参（`:485-488`） |
| `PurchaseOrder` | `status` | ✅ `:520` | ✅ `:682` | ❌ **无** | 入参 `arrivedAt`（`:522`） |
| `Profit` | `status` | ✅ `:408,435` | ✅ `:566` | ❌ **无** | 无 |
| `Shipment` | `status` | ✅ `:683` | ✅ `:777` gate / `:863` | ✅ **有** `checkShipmentStatusTransition`（`:513`，白名单 `:491-498`） | 无 |
| `Payment` | `status` | ✅ `:388,414` | ✅ `:513,523` | ❌ **无** | 自动 `confirmedAt`（`:415-417/534-541`） |
| `QualityInspection` | `result` | ✅ `:264` | ✅ `:384` | ⚠️ **半冻结**：离开 `PENDING` 后不可变（`:356-363`） | 无 |

（行号均属各 `server/src/controllers/*.controller.ts`）

**通用校验工具函数**：仅 3 处，且**非通用**——`productionOrder.controller.ts:262/306`、`shipment.controller.ts:491/513`、`leadStatus.ts:30`。无 `ALLOWED_TRANSITIONS` / `canTransit` / `validateStatus` / `STATUS_FLOW` 之类工具。

**前端**：状态下拉一律取**全量枚举**，无流转过滤（`QuotePage.tsx:49`、`SamplePage.tsx:48`、`SalesOrders.tsx:55/736`、`Purchases.tsx:282`、`components/customer/modals/OrderFormModal.tsx:29`；Shipment/Production 前端无状态下拉）。

### 业务含义（用户已冻结）
> 状态机必须由后端业务规则作为权威。前端只能展示和发起操作。

### 当前问题
1. **6 个实体完全无流转校验**（Quotation / SampleOrder / SalesOrder / PurchaseOrder / Profit / Payment）→ 客户端可把 `SalesOrder` 从 `SHIPPED` 直接设回 `DRAFT`，只需一次 PUT
2. **仅 2 个实体有校验**（ProductionOrder / Shipment），风格不统一，且校验函数各自私有、不可复用
3. **`Lead` 是唯一「无人工入口」的正确范例**（`routes/lead.routes.ts:23` 注释明确「状态只由单据事件推进」），但推进器在主事务外（D10）
4. **校验位置不一致**：ProductionOrder gate 在 `:575`，Shipment 在 `:777`；其余无

### 目标规则（建议冻结文本）
```
R-D11-1  状态只能由服务端根据业务事件推进。create/update 的入参**不得**
         直接携带目标状态（现有 Quotation/SalesOrder 等的 status 入参应移除）。

R-D11-2  每个状态机必须有显式的转移表（allowed transitions）+ 单一校验函数，
         统一放置（如 server/src/utils/stateMachine/）。

R-D11-3  状态推进必须与业务写入同事务；状态时间戳由服务端自动写入，
         不接受入参（例外：需人工填报的时间戳须显式标注为「人工」）。

R-D11-4  前端不得自行限制状态选项；前端下拉应基于服务端返回的
         availableTransitions（或只展示状态 + 提供动作按钮）。

R-D11-5  状态机的「权威真相」只允许一处：
         若有派生状态（如 Opportunity.stage），必须以派生为准，不得落库。
```

### ACTION（实施时需执行）
1. 为 6 个实体补齐转移表 + 校验
2. 移除 create/update schema 中的 `status` 入参
3. 统一校验函数位置与错误文案
4. （可选）新增 `availableTransitions` 于详情响应

### 需要人工确认（用户提出的问题，需逐状态机定义）
| # | 问题 | 当前状态 |
|---|---|---|
| D11-Q1 | 谁可以修改状态？ | 由 `roleScope` 决定可见性；但**无角色级动作权限**（有 edit 权即可改任意状态） |
| D11-Q2 | 哪些状态可以互相转换？ | 仅 ProductionOrder / Shipment 有白名单；其余需定义 |
| D11-Q3 | 什么条件才能 Confirm？ | 无定义（如 SalesOrder `DRAFT → CONFIRMED` 需满足什么？） |
| D11-Q4 | 什么条件才能 Won？ | `Lead.status=WON` 由「创建 SalesOrder」触发（`salesOrder.controller.ts:527`）；`Opportunity.outcome=WON` 未实现（D9-Q1） |
| D11-Q5 | 什么条件才能 Lost？ | **完全无入口**（无输单端点、无 `outcome=LOST` 写入） |
| D11-Q6 | 什么条件才能进入 Order？ | 创建 SalesOrder 时仅校验上游存在性 + customerId 一致（`salesOrder.controller.ts:296-349`） |

### 依赖
**D9-Q1**（赢/输单）、**D2**（Confirm 条件）、**D10**（Lead.status 一致性）

---

## D12 · Customer.source

**状态：CONFLICT** ← **最高优先级，必须人工裁决**

### 当前事实

**`Customer.source` 的技术定义**：

```38:38:server/prisma/schema/03-customer.prisma
  source        LeadSource?
```

而 `LeadSource` 枚举为：

```115:121:server/prisma/schema/00-enums.prisma
/// 线索来源（03 §1）。旧 Customer.source 的 XIAOMAN 无对应值，迁移归入 SYNC（见 05 §2.1）。
enum LeadSource {
  MANUAL // 手工录入
  EXCEL  // Excel 导入
  RPA    // RPA 抓取
  SYNC   // 第三方同步
}
```

→ **`Customer.source` 的语义是「录入方式 / 来源系统」，不是「获客渠道」**。

**既有冻结规则（`D-SOURCE-2/3/4`，仅存在于代码注释）**：

```
899:899:server/src/controllers/customer.controller.ts
  // D-SOURCE-2：Customer.source 由 API 业务语义固定为 MANUAL ⇒ create 不接受 source 入参
```
```
928:928:server/src/controllers/customer.controller.ts
  // D-SOURCE-4：普通 update 不得修改 Customer.source ⇒ 不接受 source 入参
```
```
950:950:server/src/controllers/customer.controller.ts
  // D-SOURCE-3：Excel 导入的 source 由 API 业务语义固定为 EXCEL ⇒ 不接受「来源 / source」列
```

**全部写入点（只有 2 处）**：

| 位置 | 值 | 触发 |
|---|---|---|
| `customer.controller.ts:1017` | `"MANUAL"` | 手工建档（`POST /api/customers`） |
| `customer.controller.ts:1405`、`:1436` | `"EXCEL"` | Excel 导入 |

**线索转化路径**：`LeadFormModal.tsx:1093-1101`（`createCustomerFromForm`）与 `:1200-1211`（`createCustomerSilently`）**均不传 source** → 落到 `MANUAL`。

> ⚠️ 即：**线索 `source = EXCEL`（Excel 导入的线索）转成客户后，`Customer.source` 变成 `MANUAL`** → 信息丢失。

`server/src/scripts/**` 4 个脚本均不写 Customer。**全仓无第三次 source 写入。**

**`Customer.channelId/shopId`**（真正的渠道字段）：
- create：`splitSourceKey(body.sourceKey)` 优先于显式 `channelId/shopId`（`customer.controller.ts:963-967`），并校验（`:858-879`）
- update：**允许改写**（注释 `:923`「编辑时也允许改写」）
- 线索带入：`LeadFormModal.tsx:1099-1100`（表单 sourceKey）、`:1209-1210`（`editing.channelId/shopId`）、`buildCustomerUpdate` 补丁（`:1264-1266`）

**注释中的「同义」表述**：

```25:26:server/prisma/schema/03-customer.prisma
  // 与 Lead.channelId / Lead.shopId 同义；线索转客户时原样带入，不另设 source 枚举语义。
```

**前端**：`CustomerEditDrawer.tsx` 白名单（`:26-41`、`:100-123`）与渲染字段（`:219-259`）**均无 `source`、无 `channelId/shopId`** → 不可见不可改。`CustomerDetailModal.tsx:327-335` 仅展示**线索**来源标签。

### 业务含义（用户本轮新定义）
```
Customer.source
    = 该 Customer 第一条正式 Sales Record 的「首次获客 Channel」

Customer.source ≠ 当前销售渠道
Customer.source ≠ 最新销售渠道
Customer.source ≠ 所有销售渠道
Customer.source = 首次获客事实，且不随后续销售记录变化
```

### **冲突点（必须人工裁决）**

| 维度 | 旧规则（已实现） | 新业务定义 | 冲突性质 |
|---|---|---|---|
| **数据类型** | `LeadSource` 枚举（MANUAL/EXCEL/RPA/SYNC） | 应是一个 **Channel 引用**（FK → `Channel`） | **类型冲突**：枚举值域与 Channel 集合无交集 |
| **语义** | 录入方式 / 来源系统 | 获客渠道 | **语义冲突** |
| **赋值时机** | 建档那一刻（create / import） | 首次正式 Sales Record 成立时（首销/首次成交？） | **时机冲突** |
| **可变性** | 永不修改（D-SOURCE-4 冻结 update） | 首次写入后永不修改（**一致**） | ✅ 无冲突 |
| **与 channelId 的关系** | 二者**无关**（source=录入方式，channelId=渠道） | 二者**同一件事**（source 就是渠道） | **结构冲突**：现有 `Customer.channelId/shopId` 已承担该职责 |
| **导入场景** | Excel 导入 → `EXCEL` | 导入既是「录入方式=EXCEL」也是「首次获客渠道=？」（未知） | **二义性** |

**冲突的核心**：用户新定义把 `Customer.source` 的语义从「**录入方式**」改成「**获客渠道**」，而系统中已有 `Customer.channelId/shopId` 专门表达「获客渠道」。三套东西（`source` 枚举 / `channelId` / `sourceKey` 组合串）在同一实体上重叠。

### 目标规则（候选，需人工选择）

```
【方案 A】Customer.source 保持「录入方式」枚举，首次获客渠道用另一字段承载
  Customer.source          → LeadSource（MANUAL/EXCEL/RPA/SYNC），语义不变
  Customer.firstChannelId  → FK → Channel，= 首次正式 Sales Record 的 Channel
  Customer.channelId/shopId → 删除（渠道全部归 Sales Record）
  新字段在「第一条 Sales Record 确认」时由服务端一次写入，此后冻结

【方案 B】Customer.source 改为 Channel 引用（按用户新定义）
  Customer.source → 类型改为 channelId（FK → Channel）    ← 破坏性类型变更
  原 LeadSource 枚举语义需另找落点（或直接废弃）
  Customer.channelId/shopId → 删除（与 source 合并）
  风险：旧数据（MANUAL/EXCEL）无法映射为 Channel，回填需人工或置 null

【方案 C】Customer.source 保持枚举，Customer.channelId/shopId 重定义为「首次获客渠道」
  Customer.source → 保持 LeadSource（录入方式）
  Customer.channelId/shopId → 语义变为「首次获客渠道」，删除其「可编辑」能力
                              （D-SOURCE-4 扩展到它）
  业务概念「首次获客渠道」映射到 channelId，而不是映射到 source 列
  优点：零类型变更；缺点：列名 source 与业务概念「首次获客渠道」不对应（命名混淆）
```

### 需要人工确认（用户提出的 8 问 + 冲突裁决）

| # | 问题 | 代码现状 |
|---|---|---|
| **D12-Q0（裁决）** | **采用方案 A / B / C？** 即「首次获客渠道」落在哪个列？ | 三个候选如上 |
| D12-Q1 | 第一次 Draft 是否产生 `Customer.source`？ | 否（`Customer` 在 Draft 期由前端手工建档，`source` 固定 `MANUAL`） |
| D12-Q2 | Draft 未 Confirm 时是否可以创建 Customer？ | **可以**（当前 Draft 期就建档，见 D13） |
| D12-Q3 | Confirm 时如何确定首次获客 Channel？ | 无代码；候选：取该 Draft 的 `Lead.channelId` |
| D12-Q4 | 已存在 Customer 时，新 Sales Record 是否修改 `Customer.source`？ | **不应**（按新定义）；当前代码也不会（source 不可 update） |
| D12-Q5 | `Customer.source` 是否允许人工修改？ | **不允许**（D-SOURCE-4）；前端已不可见 |
| D12-Q6 | 导入 Customer 时如何处理？ | 当前固定 `EXCEL`；若改用渠道语义，导入客户的「首次获客渠道」未知 → 需定义（置 null？手工补录？） |
| D12-Q7 | Excel Import 是否属于首次获客？ | 无定义 |
| D12-Q8 | 历史 Customer 没有 source 时如何处理？ | 迁移 `20260913000000_v1_0_baseline/migration.sql:307` `"source" "LeadSource"`（**可空、无默认**）→ 存在 null |
| D12-Q9 | 「线索 `source=EXCEL` 转客户后变 `MANUAL`」是否要修正？ | 当前**信息丢失**（`LeadFormModal` 不传 source） |
| D12-Q10 | `Customer.channelId/shopId` 与新的「首次获客渠道」是否合并为同一字段？ | 与 D1-Q2 同一决策 |

### 依赖
**D1-Q2**（`Customer.channelId` 定位）、**D13**（Customer 创建时机决定 source 写入时机）、**D2-Q8**、**D0**

---

## D13 · Customer / Sales Record Lifecycle

**状态：NEED REVIEW**

### 当前事实（实际时序，来自代码）

```
【阶段 1 · 暂存】(LeadFormModal.saveDraft:1011-1051)
  仅写 Lead + LeadItem
  draft = editing?.draft ?? true            (:1028)
  stage = step                              (:1033)
  customerLocked = step0.locked             (:1030)
  productLocked  = step1.locked             (:1031)
  → 不创建 Customer、不创建 Product、不创建 Opportunity

【阶段 2 · 建档】(handleFileOrUpdateCustomer:1107 / handleFileOrUpdateProduct:356)
  客户：customerApi.create (:1093) + leadApi.update/create (:1174/1177) 回写 customerId
  产品：productApi.create (:436/1223) 或 update (:371) + leadApi.update/create (:409/413) 回写 productId
  → Customer 在 Draft 期即被创建（不在 Confirm 期）
  → 客户与线索的关联由前端两次 API 调用完成，非事务

【阶段 3 · 正式提交】(submit:1053-1087)
  置 draft = false (:1066)
  → 不创建任何其他实体

【阶段 4 · 确认转商机】(handleConfirmLead:1308-1360)
  可选 customerApi.update (:1323)
  leadApi.update({customerId}) (:1324)
  convertLeadToOpportunity (:1328) → 内部：
    leadApi.get / update(customerId/productId) (convertLead.ts:116-121/137/145)
    salesApi.create (convertLead.ts:152)  ← 创建 Opportunity
  前端本地 setEditing status='CONFIRMED' (:1330)
  → 服务端在「创建商机绑定 leadId」时自动推进 Lead.status = CONFIRMED
     (sales.controller.ts:442)
```

**已知风险点**：
- 客户建档检测为**前端模糊匹配**：`convertLead.ts:60-65` `findCustomerByName` 拉 `pageSize:200` 后 `toLowerCase()` 比对 → **重复客户风险**
- 回退路径 `openCustomerForm`（`convertLead.ts:126-134`）同样无服务端唯一性约束
- 每步都是独立 API 调用，**无事务**：任一步失败即产生半成品（如 Customer 已建但 `Lead.customerId` 未回写）

### 业务含义（用户已提出）
```
销售记录 Draft → 补充信息 → Confirm → 正式 Sales Record → Lead/Opportunity/Quote/Order
```
需明确：`Customer` 是在 Draft 阶段创建、Confirm 阶段创建、还是「首次形成正式客户事实时」创建？

### 当前问题
1. **Confirm 无服务端语义**：`draft=false` 是一个布尔写入，没有任何校验或副作用编排
2. **Customer 在 Draft 期即创建**，而按新业务模型 Draft「数据尚未成为正式销售记录」→ Customer 产生时机**早于** Confirm，两个后果：
   - 草稿被放弃时，Customer 已存在（孤儿客户）
   - `Customer.source` 在被放弃的 Draft 上已被写入 `MANUAL`
3. **无幂等键**：同一线索重复点击「确认转商机」可能产出多个 Opportunity（`Opportunity.leadId` 非 unique）
4. **`Lead.status` 推进在主事务外**（D10）

### 候选模型

```
【候选 A · Confirm 时创建 Customer（推荐）】
  Draft 阶段：只写 Lead + LeadItem（不创建 Customer/Product），Lead.customerId 为空
  Confirm（服务端单事务）：
    ① 校验必填（客户名/联系方式/产品需求）
    ② 查重：Customer 按唯一键（建议 companyName + 国家，或外部编码）找到或创建
    ③ 创建 Opportunity（绑定 leadId）
    ④ 回写 Lead.customerId / status=CONFIRMED / convertedAt
    ⑤ 写入 Customer.source = 该 Sales Record 的 Channel（见 D12）
    ⑥ 全部同一事务 + 幂等（Lead 已有 customerId + opportunityId 则拒绝重复）
  优点：符合「Draft 尚未成为正式记录」；符合 D12「首次正式 Sales Record → Customer.source」
  代价：草稿期无法引用已建客户（需支持「选择既有 Customer」作为 Draft 的引用）

【候选 B · Draft 期创建 Customer（现状）】
  保持现状，但补：
    ① 服务端幂等建档端点（替代前端模糊匹配）
    ② Draft 放弃时的孤儿清理策略
  优点：改造量最小；缺点：与「Draft 尚未成为正式记录」语义不符

【候选 C · 混合】
  Draft 期允许「选择既有 Customer」或「填写 intake 信息（不落 Customer）」；
  Customer 的实际创建延迟到 Confirm。
  → 实质是在 Draft 期用 Lead.intake* 字段暂存（与 R-D3-1 天然衔接）
```

### 需要人工确认
| # | 问题 |
|---|---|
| D13-Q1 | 采用候选 A / B / C？ |
| D13-Q2 | `Lead` 与 `Opportunity` 的创建是否必须原子（替代当前「前端多次调用」）？ |
| D13-Q3 | 客户查重的**唯一键**是什么？（`companyName` 单独不可靠） |
| D13-Q4 | 草稿被放弃时，已创建的 Customer/Product 如何处理？ |
| D13-Q5 | 「确认转商机」是否允许重复执行？幂等键是什么？ |
| D13-Q6 | Draft 期是否需要「引用既有 Customer」（老客户新线索）？若需要，候选 A/C 必须支持 |

### 依赖
**D0**、**D2**、**D3**、**D12**、**D11**

---

## D14 · Lead / Opportunity

**状态：CONFIRMED（含 ACTION）**

### 当前事实

| 维度 | `Lead` | `Opportunity` |
|---|---|---|
| 表 | `03-customer.prisma:205` | `05-opportunity.prisma:8` |
| 编号 | `leadNo`（`XS-yyyyMM-0001`） | `opportunityNo`（`BO-yyyyMMdd-0001`） |
| 基数 | `Lead 1:N Opportunity`（`Opportunity.leadId` **非 unique**，`:16-18`） | — |
| 状态 | `LeadStatus` = `NEW/CONFIRMED/SAMPLED/WON`（4 态，**无人工入口**） | `OpportunityOutcome` = `OPEN/WON/LOST`（**0 引用，死列**） |
| 阶段 | `stage Int?`（前端向导步骤，非业务阶段） | **派生不落库**（`pipelineStage.ts`） |
| 归属 | `ownerId`（null = 公海，有 claim/release/transfer 端点） | `ownerId`（注释明确「V1.0 不允许创建无主公海商机」，`sales.controller.ts:386`） |
| 业务字段 | 需求（productInterest/quantity/targetPrice/currency/unit/expectedDelivery/targetMarket/usdRate）+ intake 客户资料 + 来源渠道 | 商务（estimatedAmount/currency/exchangeRate/estimatedCloseDate/intentLevel/probability）+ 来源渠道（在途） |
| 下游 | `opportunities[]` | `items[]` / `quotations[]` / `sampleOrders[]` / `salesOrders[]` |
| 转化 | `convertedAt`（**0 写入**）；`status` 由下游驱动 | 创建时绑定 `leadId`（`sales.controller.ts:411`） |

### 业务含义（上一轮已冻结，本轮保留）
> Lead 与 Opportunity 属于同一个 Sales Process，但**不应为了减少表数量而强行合并**。

**保留两表的四条理由（代码证据）**：
1. 基数不同：`Lead 1:N Opportunity` → 合并会退化为自关联
2. 生命周期长度不同：`LeadStatus` 到 `WON` 即终止；Opportunity 才进入报价/打样/订单
3. 字段集几乎不重叠：Lead 有 `draft/stage/customerLocked/productLocked/usdRate/contactMethods/targetMarket`；Opportunity 有 `estimatedAmount/intentLevel/probability/estimatedCloseDate/outcome`
4. 已有清晰的单向 FK，且**已正确避免双向 FK**
   ```
   258:260:server/prisma/schema/03-customer.prisma
     /// 基数 **Lead 1:N Opportunity**；此处**不得**再声明 opportunityId 冗余列
     /// （双向真实 FK 会产生循环外键与双写不一致）。
   ```

### 目标规则（建议冻结文本）

```
R-D14-1  Lead 与 Opportunity 同属 Sales Process 域，但保留两张独立表。
         禁止合并（基数不同），禁止双向 FK（已合规）。

R-D14-2  职责边界：
         Lead        = 未建档/未确认阶段的销售机会容器。
                       承载「客户 intake 信息」「产品需求」「来源渠道」「公海归属」。
                       状态由下游单据事件驱动，无人工入口。
         Opportunity = 已确认的销售机会。承载「商务意向」（金额/概率/预计成交日）。
                       阶段读时派生，不落库。
                       下游 Quotation / SampleOrder / SalesOrder 的必填上游。

R-D14-3  进入条件（Lead → Opportunity）：
         · Lead.status = NEW（未确认）
         · 客户已确定（customerId 存在，或确认时服务端建档）
         · 至少一条产品需求（LeadItem）
         · 有 owner（不允许创建无主公海商机）
         【需人工确认，见 D14-Q1】

R-D14-4  退出条件（Opportunity 终止）：
         · 赢单：生成 SalesOrder（当前隐含真相）
         · 输单：**当前无入口**（需 D11-Q5 定义）
         · 长期未跟进：**当前无机制**

R-D14-5  Lead 与 Opportunity 共享同一 Sales Record Channel（见 D1）。
         Channel 变更需明确是否允许（D1-Q3）。
```

### ACTION
1. `Opportunity.outcome*` 接线或删除（D9-Q1）
2. `Lead.convertedAt` 接线或删除（D9-Q7）
3. `Lead.intake*` 重命名（R-D3-1）
4. `Lead.draft/customerLocked/productLocked` 收敛（D2）

### 需要人工确认
| # | 问题 |
|---|---|
| D14-Q1 | `Lead → Opportunity` 的**进入条件**是否如 R-D14-3 所列？是否需要额外校验（如必填客户联系方式）？ |
| D14-Q2 | 「一个 Lead 产出多个 Opportunity」是否**允许**？（若允许，UI 需支持「继续建商机」入口——当前不存在） |
| D14-Q3 | 是否存在「**无 Lead 直接建 Opportunity**」的合法场景？（schema 允许：`leadId` 可空。当前 UI 是否有此入口？） |
| D14-Q4 | `Opportunity.ownerId` 是否允许为空（公海商机）？（当前禁止） |
| D14-Q5 | Lead 的「公海/认领/转移」机制（`releaseLead`/`claimLead`/`transferLead`）是否适用于 Opportunity？ |

### 依赖
D1、D9、D11、D0

---

## D15 · Quotation / SampleOrder

**状态：CONFIRMED（修正用户假设）**

### 当前事实（**关键修正**）

上一轮报告与用户模板假设的链路是：
```
Sales Process → Quotation → SampleOrder → SalesOrder     ← ❌ 与代码不符
```
**代码实证的真实关系是并行分支**：
```
Opportunity ──┬──> Quotation ──────┐
              │                    ├──> SalesOrder
              └──> SampleOrder ────┘
                （也允许直接 Opportunity → SalesOrder）
```

**证据 1 · `SampleOrder` 没有 `quotationId`**：

```26:27:server/prisma/schema/07-sample.prisma
  // 与 Quotation 的关系：**不声明 quotationId**（第三批 §9 定案）。
  // SampleOrder 经 opportunityId 间接追溯来源报价（免费打样 / 老客重打 / 内部开发样均可能没有正式报价单）。
```

**证据 2 · 打样创建不校验报价**：
- `sampleOrder.controller.ts:78-98` `createSchema` **完全没有 `quotationId` 字段**
- `:192-212` `resolveCustomerId` 仅从商机回填客户，无报价校验
- `:17` 注释明确链路为「Opportunity → SampleOrder → SampleRound[] → SalesOrder」

**证据 3 · 订单的两个上游各自独立可选**：
```111:134:server/src/controllers/salesOrder.controller.ts
  opportunityId: z.string().min(1, ...),          // 必填
  quotationId: ...optional().nullable(),          // 可空
  sampleOrderId: ...optional().nullable(),        // 可空
```
- `resolveRefs`（`:296-349`）对 quotation 与 sampleOrder **各自独立校验**（各自可选），唯一一致性约束是 `customerId` 相等（`:332-340`）
- **不校验** sampleOrder 是否源于该 quotation；**不要求**二者互斥或同时存在

**证据 4 · 前端无「报价→打样」入口**：
| 页面 | 「生成打样」 | 「生成订单」 | 其他 |
|---|---|---|---|
| `QuotePage.tsx` | ❌ 无 | ❌ 无（仅列表/详情/编辑/删除 `:328-341,:375`） | 支持 `?quotationId=` 自动开详情（`:260-265`） |
| `SamplePage.tsx` | — | ❌ 无（仅新建+编辑/删除；详情只读展示下游销售订单 `:436-450`） | 支持 `?sampleOrderId=`（`:243-248`） |
| `SalesOrders.tsx` | — | — | 创建表单同时提供**两个独立可空下拉**：「来源报价单」（`:713-721`）+「来源打样单」（`:724-731`） |
| `components/sales/QuotationSection.tsx` | — | — | **该文件不存在**（全仓 `QuotationSection` 0 命中） |
| `CreateOrderFromProductModal.tsx` | ✅（产品→报价/打样双分支 `:9,:47,:241`） | — | 跨页跳转 |

**证据 5 · 顺序假设仅存在于派生命名**：
- `leadStatus.ts:19-24`：`NEW 0 < CONFIRMED 1 < SAMPLED 2 < WON 3`（**无 QUOTED 态**）
- `pipelineStage.ts:26-34`：`QUOTED=2 < SAMPLE=3 < ORDER=4`；`deriveStage:52-64` 先判 sample 再判 quotation → **代码假设报价先于打样**，但该顺序**不被任何写入校验强制**

### 业务含义（结论）
> `Quotation` 与 `SampleOrder` **都是 Opportunity 的直接下游分支**，各自独立可选。
> 「Quotation → SampleOrder → SalesOrder」的串行链**在业务与代码上都不成立**。
> 但二者**都有独立生命周期与历史事实**（`QuotationStatus` 6 态 + 有效期 + 金额；`SampleStatus` 8 态 + 多轮次 + 打样费）→ **保持独立模型成立**。

### 当前问题
1. **打样单表头即单产品**（无明细表）→ 多产品打样无法表达
2. **`LeadStatus` 缺 `QUOTED` 态**：报价发生后线索状态**不变**（仍为 CONFIRMED），而 `pipelineStage` 却有 QUOTED 阶段 → 两套阶段模型不一致
3. **`pipelineStage` 的优先级让 QUOTED 列几乎不可达**：只要有打样就是 SAMPLE（`SAMPLE=3 > QUOTED=2`），看板「已报价」列仅对「已报价但未打样」的商机可见
4. **报价 → 生成客户专属价**（`ProductPrice.sourceType=QUOTATION`）**未实现**（`ProductPrice` 是死模型，见 D16）

### 目标规则（建议冻结文本）
```
R-D15-1  确认链路为并行分支（不是串行）：
         Opportunity ─┬─> Quotation ──┐
                      ├─> SampleOrder ┤──> SalesOrder
                      └────────────────┘
         （直连 Opportunity → SalesOrder 亦合法，如老客复购）

R-D15-2  Quotation 与 SampleOrder 保留独立模型。
         理由：独立编号 + 独立状态机 + 独立有效期/轮次 + 独立业务事实
         （报价金额/条款 vs 打样费/轮次反馈）。

R-D15-3  SalesOrder 的 quotationId / sampleOrderId 保持可空且独立，
         不建立「打样必须源于报价」的约束。

R-D15-4  「打样是否免费」「是否针对报价中的产品」属业务判断，
         不应转译为强制 FK。
```

### 需要人工确认
| # | 问题 |
|---|---|
| D15-Q1 | 确认上述并行链路与业务实际相符？ |
| D15-Q2 | 是否需要「从报价单直接发起打样」的入口？（当前不存在；若需要，是便利性还是业务强制？） |
| D15-Q3 | `LeadStatus` 是否应新增 `QUOTED` 态（与 `pipelineStage` 对齐）？ |
| D15-Q4 | `SampleOrder` 是否需要明细表（多产品打样）？ |
| D15-Q5 | 报价确认后是否应生成客户专属价（`ProductPrice` 接线）？见 D16 |

### 依赖
**D16**、**D11**（各状态机）、D7

---

## D16 · ProductPrice / CustomerProduct

**状态：NEED REVIEW**

### 当前事实

| 对象 | 定义 | 写入 | 读取 | schema 注释 |
|---|---|---|---|---|
| `ProductPrice` | 客户级标准产品价格（`04-product.prisma:56`），`@@unique([productId, customerId, minQty, currency])` | **0** | **0** | 「Q11 定案：customerId 必填；彻底不含 customerProductId」；「价格来源：报价确认后自动生成」 |
| `CustomerProduct` | 客户定制产品版本（`04-product.prisma:7`），`@@unique([customerId, productId, version])`，含 `customName/customColors/agreedPrice/agreedCurrency/sourceType/sourceId` | **0 CRUD** | 仅 `SalesOrderItem.customerProductId` 可被客户端任意传入（`salesOrder.controller.ts:89` zod、`:248` 写入） | 「首次来源：由哪张打样单/报价单确认」 |

**全仓证据**：
```
server/src grep "ProductPrice"    → 1 命中：product.controller.ts:362（仅注释）
server/src grep "CustomerProduct" → 仅注释 2 处（productionOrder.controller.ts:125-126、
                                     shipment.controller.ts:160）+ salesOrder.controller.ts:89/248
client/src grep 两者 → 0 命中（client/src/api/salesOrders.ts:73 仅 customerProductId 类型声明）
```

**被声明但不存在的链路**：
```
Quotation 确认 ──X──> ProductPrice（sourceType=QUOTATION）        ← 未实现
SampleOrder/Quotation ──X──> CustomerProduct（sourceType=...）    ← 未实现
```

**当前替代实现**：价格只能落进 `QuotationItem.unitPrice` / `SalesOrderItem.unitPrice`（每次重新录入）。

### 分类判断

| 对象 | 分类 | 理由 |
|---|---|---|
| `ProductPrice` | **Pricing Fact + Relationship Data**（客户×产品×数量×币种的**协议价**） | 不是「主数据」（不是产品本身的价格），也不是纯「过程」（不随某次销售结束而失效——有 `validFrom/validTo`），而是**长期有效的关系型业务事实** |
| `CustomerProduct` | **Relationship Data + Snapshot 混合** | 「客户×产品的定制版本」，含差异字段（注释「只存与标准品的差异，避免整行复制」→ 设计正确）+ 协议价 `agreedPrice` + 首次来源 |

### 判断：未完成业务模型，还是无效模型？

| 判据 | `ProductPrice` | `CustomerProduct` |
|---|---|---|
| 是否有 schema 设计意图记录 | ✅ 有（Q11 定案、唯一约束、validFrom/To、sourceType） | ✅ 有（三层产品模型第 2 层、差异存储、版本号） |
| 是否有业务需求 | **待用户确认** | **待用户确认** |
| 是否有写入链路 | ❌ 完全缺失 | ❌ 完全缺失 |
| 是否被其他模块依赖 | 无（无 FK 指向它） | ⚠️ `SalesOrderItem.customerProductId`（**未维护的 FK**） |
| **结论** | **未完成业务模型**（设计完整、实现为零）→ 但需确认业务需求 | **未完成业务模型 + 危险**（未维护 FK 可被任意填） |

### 当前问题
1. **设计完整但零实现**：两者都有精心设计的唯一约束与注释，却无任何 CRUD → 典型「架构承诺与实现脱节」（D9 同类）
2. **`SalesOrderItem.customerProductId` 是未维护的 FK**：客户端可提交任意 id（`salesOrder.controller.ts:89` zod 仅校验字符串），服务端在 `:248` 直接写入 `item.customerProductId ?? null`，**无存在性校验** → 可产生指向不存在记录的脏外键
3. **`ProductPrice` 唯一的 `sourceType=QUOTATION` 路径未接线** → 报价确认不会沉淀客户专属价 → 每次报价/下单重复录入
4. **三层产品模型（标准品 / 客户定制版本 / 客户专属价）有 2 层是空的**

### 目标规则（候选）
```
【方案 A · 接线（若业务确实需要）】
  ProductPrice：
    · 新增 CRUD（客户价目表页）
    · 报价 ACCEPTED 时自动生成/更新（sourceType=QUOTATION, sourceId）
    · 定义取价优先级：ProductPrice(命中 minQty) > CustomerProduct.agreedPrice > Product.defaultPrice
  CustomerProduct：
    · 新增 CRUD（客户定制版本管理）
    · 打样 APPROVED / 报价 ACCEPTED 时自动创建版本（sourceType/sourceId）
    · SalesOrderItem.customerProductId 增加存在性 + 归属校验（必须属于同一 customerId）

【方案 B · 删除（若业务不需要）】
  · 删除两个模型 + SalesOrderItem.customerProductId
  · 客户专属价能力明确由「每次报价/下单录入」承担（写进规范，避免后来者再建模型）

【方案 C · 部分保留】
  · 例如：仅保留 CustomerProduct（定制规格确有业务价值，且 SalesOrderItem 已引用），
    删除 ProductPrice（专属价用定制版本的 agreedPrice 承担）
```

### 需要人工确认
| # | 问题 |
|---|---|
| D16-Q1 | 业务上是否需要**客户专属协议价**（同产品对不同客户不同价、且有有效期/数量档）？ |
| D16-Q2 | 业务上是否需要**客户定制版本**管理（同标准品对不同客户的定制规格）？ |
| D16-Q3 | 若保留 `ProductPrice`：报价确认是否**自动**生成？取价优先级如何？谁可修改？ |
| D16-Q4 | 若保留 `CustomerProduct`：`SalesOrderItem.customerProductId` 是否必填（当客户有定制版本时）？ |
| D16-Q5 | `CustomerProduct.agreedPrice`、`ProductPrice.price`、`Product.defaultPrice` 三者的**权威优先级**是什么？ |

### 依赖
**D9-Q2、D9-Q3**、**D15-Q5**、**D17**

---

## D17 · Final Module Boundary

**状态：NEED REVIEW**

### 当前事实

现状边界 = `一对象一 controller 一 page`：
- 33 controllers ↔ 32 routes ↔ 31 pages ↔ 52 models
- `sales.controller.ts` = **Opportunity**（路由 `/api/sales`）← 命名错位
- `salesOrder.controller.ts` = SalesOrder（`/api/sales-orders`）
- `client/src/components/` 按对象分目录；`client/src/components/order/` **目录为空**
- `customer.controller.ts` 67KB（最大）并内嵌 `salesOrders/opportunities/leads` 聚合（`:706-767`）

### 业务含义（用户已冻结）
> 不以「一张表 = 一个模块」为原则。应按 **业务职责 + 数据所有权 + 生命周期 + 状态机 + 业务过程** 划分。

### 建议模块边界（候选）

```
① Master Data Domain
   生命周期：人工维护；无业务状态机（仅 ACTIVE/INACTIVE）
   ├── Customer           客户（+ 公海归属、等级、类型）
   ├── Contact            【新增，待 D4 决策】联系人 + ContactMethod
   ├── Product            标准品（含分类/工艺/证书/可见性）
   ├── ComboProduct       组合产品（需接入或下线）
   ├── Supplier           供应商
   ├── Channel            渠道/平台（被 Sales Record 引用）
   └── 字典：CustomerType / CommunicationTool / Unit / CurrencyRate /
              Certificate / ProductCraft / ProductAudience / ProductCategory
   规则：只被引用，不被业务过程回写；不承载过程状态（→ ProductTask/stock 迁出）

② Sales Process Domain
   生命周期：从线索到成交终止；有过程状态机；不产生交易事实
   ├── Lead            阶段 1（未确认；承载 intake + 需求 + 来源渠道）
   ├── Opportunity     阶段 2（已确认；承载商务意向）
   └── 阶段派生服务     pipelineStage（读时计算，不落库）
   规则：只存过程属性；不复制客户资料（intake* 除外，且建档后只读）；
         不存成交价；Channel 唯一落点在 Lead

③ Quotation Domain
   生命周期：独立（版本链 + 有效期）；有独立状态机；产生报价历史事实
   └── Quotation + QuotationItem

④ Sample Domain
   生命周期：独立（多轮次）；状态机 SampleStatus + SampleRoundResult
   └── SampleOrder + SampleRound +【待定】SampleItem

⑤ Order Domain
   生命周期：独立；SalesOrderStatus（10 态）；产生交易事实
   └── SalesOrder + SalesOrderItem

⑥ Fulfillment Domain（与销售域职责与干系人不同）
   ├── ProductionOrder + ProductionOrderItem
   ├── Shipment + ShipmentItem
   └── QualityInspection

⑦ Procurement Domain（Supplier 侧）
   └── PurchaseOrder + PurchaseOrderItem

⑧ Finance Domain
   ├── Payment（exact-one 宿主）
   ├── Profit（1:1 订单 + costSnapshot）
   └── DailyExchangeRate

⑨ Platform Domain
   ├── User / Role / Permission / Department
   ├── Attachment（多态旁挂）
   ├── ApprovalConfig / ApprovalRecord（多态旁挂）
   ├── NumberSequence
   ├── OperationLog（**唯一时间线**，禁止新增 XxxActivity 表）
   └── Notification / LoginLog
```

### 与现状的差异
| # | 差异 | 类型 |
|---|---|---|
| 1 | 把 `sales.controller.ts`（实为 Opportunity）重命名/归位到 Sales Process Domain | 命名 |
| 2 | `Lead` 与 `Opportunity` 归入同一域 | **边界合并** |
| 3 | `ProductTask` 从 Product 域迁出（进 Production 域或删除） | 边界纠正 |
| 4 | `Product.stock` 从 Product 域迁出或标注为参考值 | 边界纠正 |
| 5 | `Profit` / `Payment` 明确为 Finance Domain（不再与 Order 混讲） | 边界明确 |
| 6 | `Customer` 详情页的过程聚合（salesOrders/opportunities/leads）收敛为独立查询服务 | 边界解耦 |
| 7 | `ComboProduct` 需决策（接入 Order/Sales 域 或 下线） | 未决 |

### 需要人工确认
| # | 问题 |
|---|---|
| D17-Q1 | 上述 9 个域的划分是否认可？ |
| D17-Q2 | `Lead` + `Opportunity` 归入同一域后，是否合并 controller / 路由（如 `/api/sales-process/leads`）？还是保持路由不变只调整文档与目录？ |
| D17-Q3 | `sales.controller.ts` 是否重命名为 `opportunity.controller.ts`（涉及路由前缀 `/api/sales` 的兼容性）？ |
| D17-Q4 | `ComboProduct` 接入还是下线？ |
| D17-Q5 | Quotation 与 Sample 是否同域（「报价打样域」）还是各自独立域？ |

### 依赖
**全部 D1–D16**（D17 是汇总决策，建议最后签字）

---

## 附录 A · 下一轮必须人工回答的问题清单（按优先级）

### A1 最高优先（阻塞在途代码）
| # | 问题 | 所属 |
|---|---|---|
| A1-1 | 在途的 `Opportunity.channelId/shopId` 合入、回退、还是改为同步约束？ | D1-Q1 |
| A1-2 | `Customer.channelId/shopId` 删除、重定义为首获渠道、还是保持现语义？ | D1-Q2 / D12-Q10 |
| A1-3 | **`Customer.source` 的「首次获客渠道」落在哪个列？**（方案 A/B/C） | **D12-Q0** |

### A2 高优先（决定后续迁移范围）
| # | 问题 | 所属 |
|---|---|---|
| A2-1 | 「Sales Record」是概念还是实体？边界为一个 Lead 还是一个 Opportunity？ | D0-Q1/Q2 |
| A2-2 | Draft→Confirm 的 8 问（条件、负责人、冻结字段、副作用、Channel、source） | D2-Q1~Q9 |
| A2-3 | Customer 在 Draft 期创建还是 Confirm 期创建？ | D13-Q1 |
| A2-4 | `Opportunity.outcome*` 接线还是删除？赢/输单入口在哪？ | D9-Q1 / D11-Q4/Q5 |
| A2-5 | 6 个无校验实体的状态转移表 | D11-Q2 |

### A3 中优先
| # | 问题 | 所属 |
|---|---|---|
| A3-1 | 是否需要「一个客户多个联系人」？ | D4-Q1 |
| A3-2 | `ProductTask` / `Product.stock` 接线还是删除？ | D5-Q1/Q2 |
| A3-3 | `ProductPrice` / `CustomerProduct` 接线还是删除？ | D16-Q1/Q2 |
| A3-4 | 4 个 Snapshot 空壳删除还是定义？ | D7-Q1 / D9-Q5 |
| A3-5 | `Customer.totalOrderAmountCny/lastOrderAt` 删除还是回写？ | D10-Q1 |
| A3-6 | `Lead` 与 `Opportunity` 是否合并 controller/路由？ | D17-Q2/Q3 |

### A4 低优先（可批量确认规则文本）
| # | 项 | 所属 |
|---|---|---|
| A4-1 | §D7 的 SN-1~SN-C3 快照规则文本 | D7 |
| A4-2 | §D8 的 R-D8-1~R-D8-5 Draft/Snapshot 分离规则 | D8 |
| A4-3 | §D10 的 R-D10-1~R-D10-5 派生字段规则 | D10 |
| A4-4 | §D9 的 R-D9-1~R-D9-4 模型生命周期规则 | D9 |

---

## 附录 B · 本轮新增/修正的事实（相对上一轮审计）

| # | 项 | 上一轮 | 本轮 |
|---|---|---|---|
| 1 | `Quotation → SampleOrder` 链路 | 描述为串行链的一环 | **修正为并行分支**（`SampleOrder` 无 `quotationId`，前端无入口，订单侧两上游独立可选） |
| 2 | `withProductVisibility` 影响范围 | 描述为影响 Quotation + SalesOrder | **修正**：影响 Quotation / Opportunity(items) / Lead / SampleOrder **共 4 处**；`SalesOrderItem` / `ProductionOrderItem` / `ShipmentItem` **不受影响**（无投影逻辑） |
| 3 | 投影改写的字段数 | 未精确 | **只改写 1 个字段**（`productName`），且**仅当 `productId` 非空** |
| 4 | `ProductTask` | 判定「过程数据挂在主数据上」 | **加强判定：`server/src` 0 引用 → 死模型**；且前端仍在用其前身 `Product.progress` JSON |
| 5 | `Customer.intentLevel` | 未列入死字段清单 | **新增**：D-INTENT v2 明确「不读取 legacy 列」「不接受人工输入」→ 死列 |
| 6 | `Customer.source` | 仅作为「字典裸字符串」示例 | **升级为最高优先 CONFLICT**：`LeadSource` 枚举语义（录入方式）与用户新定义（获客渠道）类型冲突 |
| 7 | Lead 转化 `source` 传递 | 未审计 | **新发现**：`LeadFormModal` 转化建档不传 source → 线索 `source=EXCEL` 转客户后变 `MANUAL`（信息丢失） |
| 8 | Customer 联系方式 | 「表内双表示」 | **细化**：`contactMethods` 已是权威（前端已停止编辑标量，注释「仅用于回填」），legacy 标量仅为防 PUT 全量替换丢数据；展示侧已有降级规则 |
| 9 | `Customer.contactMethods` 校验 | 未审计 | **新发现**：`z.any()` → **无结构校验**（而 `Lead.contactMethods` 有 zod array 校验） |
| 10 | 状态机校验覆盖 | 「6 个实体无校验」 | **精确**：ProductionOrder / Shipment **有**白名单校验；QualityInspection result **半冻结**；其余 6 个无 |
| 11 | `CustomerProduct` FK | 「未维护的 FK」 | **精确**：`salesOrder.controller.ts:89` zod 仅校验字符串、`:248` 直接写入，**无存在性校验** |
| 12 | `Customer.channelId` 是否会被覆盖 | 未确认 | **确认：无自动覆盖代码**（`customer.update` 5 处仅 1 处碰 channelId，是编辑抽屉路径） |

---

**本轮结束（Phase 0 · Architecture Decision Freeze）。**

**未修改任何代码。未生成 Migration。未 Commit。未 Push。等待下一轮人工 Decision Freeze。**
