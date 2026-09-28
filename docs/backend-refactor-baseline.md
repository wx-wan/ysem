# YSEM Backend Refactor Baseline

> 本文档记录 **截至当前时间点，YSEM 后端分层重构已经固化到什么程度**。
> 它不是业务规则说明书，也不是目标架构设计文档；只记录**已完成的事实**与**明确的边界**。
>
> 冻结时间：2026-09-28
> 冻结轮次：Round R-3.1（Lead + Customer）→ **Round R-4.1（Lead + Customer + Product）**
> 冻结版本：见 §4 Completed Rounds

---

## 1. Architecture

统一分层目标（唯一命名，禁止平行目录）：

```
Controller
    ↓
Business        (services/)
    ↓
Operation       (operations/)
    ↓
Data            (repositories/)
    ↓
Prisma / PostgreSQL
```

| 层 | 目录 | 职责 | 禁止 |
|---|---|---|---|
| Controller | `src/controllers/` | HTTP request/response、参数解析、DTO/zod 校验、auth context、状态码、响应格式化 | Prisma、复杂业务判断、事务编排、跨实体流程 |
| Business | `src/services/` | 业务规则、状态转换、跨实体流程、业务前置条件、权限的业务部分、事务编排入口、审计留痕 | 读写 `req`/`res`、返回 HTTP、依赖 Express、**直接调用 Prisma** |
| Operation | `src/operations/` | 多 Repository 组合、可复用数据操作流程、查询组合、`$transaction` 编排 | 决定业务政策 |
| Data | `src/repositories/` | `find/findMany/findUnique/count/create/update/delete/aggregate/groupBy` 及明确的数据查询组合 | 业务状态判断、业务流程、HTTP、业务政策 |

依赖方向**单向**。反向依赖由 `npm run lint:layering` 自动阻断：

```
✗ Data → Business / Controller
✗ Operation → Controller
✗ Business → Controller
✗ Controller → Prisma
✗ lib | utils | middleware → Business（共享层不得反向依赖业务层）
```

---

## 2. Completed Modules

| 模块 | 状态 | Controller 行数变化 | Business | Operation | Data |
|---|---|---|---|---|---|
| **Lead** | ✅ 四层拆分完成（R-2） | 1277 → 310 | `services/lead.service.ts` | `operations/lead.operations.ts` | `repositories/lead.repository.ts`（+ Channel / Attachment / Customer / Product / User / DailyExchangeRate / OperationLog） |
| **Customer** | ✅ 四层拆分完成（R-3） | 1661 → 330 | `services/customer.service.ts` | `operations/customer.operations.ts` | `repositories/customer.repository.ts`（+ SalesOrder / Opportunity / SampleOrder 只读读模型） |
| **Product** | ✅ 四层拆分完成（R-4） | 874 → 240 | `services/product.service.ts` | `operations/product.operations.ts` | `repositories/product.repository.ts`（+ ProductTaxonomy / Certificate / User） |
| **ProductGroup**（ComboProduct） | ✅ 四层拆分完成（R-4） | 399 → 115 | `services/productGroup.service.ts` | `operations/productGroup.operations.ts` | `repositories/productGroup.repository.ts` |
| **ProductTaxonomy**（工艺/受众/品类） | ✅ 四层拆分完成（R-4） | 147 → 125 | `services/productTaxonomy.service.ts` | （单仓储操作，Business 直接调用 Data） | `repositories/productTaxonomy.repository.ts` |
| **Opportunity** | ⏸ **DEFERRED** | — | — | — | — |

**Product 范围内的 Controller 直接 Prisma = 0**（`product` / `productGroup` / `productTaxonomy` 三个 Controller 均无 Prisma import）。

### Lead 的产品需求载体（**已冻结，不得改建新表**）

```
Lead ──1:N──→ LeadItem
```

**Lead Product Demand = `LeadItem`。**

`LeadItem` 是 Lead 的 **1:N 产品需求载体**，当前承载：

```
productId      可空外键 → Product（未建档产品时为 NULL）
productName    未建档产品的名称兜底 / 已建档产品的名称快照
productDesc    采购产品的描述（材质 / 规格 / 工艺 / 用途）
quantity       意向数量
craftIds       工艺 id 数组（多对多，落数组避免引入关联表）
audienceId     受众（二级分类）
categoryId     品类（三级分类）
sizeL/W/H      需求规格（长/宽/高 cm）
weight         需求克重 g
sort           排序
```

> **禁止**创建独立的 `ProductDemand` 表或模型。
> **禁止**把 `LeadItem` 改成新表。产品需求当前结构已冻结为「明细行 + 可空产品引用 + 名称文本兜底」。

---

## 3. Current Layering Status

| 规则 | 数量 | 含义 |
|---|---|---|
| `R1-UPWARD`（反向依赖） | **0** | 无上游被下游 import |
| `R3-SHARED-BUSINESS`（共享层依赖业务层） | **0** | `lib`/`utils`/`middleware` 未依赖 `services` |
| `R4-HTTP-IN-DOMAIN`（领域层依赖 HTTP） | **0** | Business/Operation/Data 未依赖 express |
| `R2-CONTROLLER-PRISMA`（Controller 直连 Prisma） | **26** | **待拆分模块余量** |
| **Total remaining** | **26** | 见下方说明 |

```
业务层文件：controllers=33  services=6  operations=5  repositories=17
Controller 内 prisma.* 调用点：291
分层迁移进度（Controller 去 Prisma 化）：21%
```

### 关于这个 26

```
26 = 当前剩余待拆分模块（Backend Refactor Baseline）
26 ≠ 本轮失败，也 ≠ 需要立即消灭
```

**逐模块推进**：每拆分一个模块，该数字自然下降，进度上升。

已出列（5 个 Controller）：

```
lead.controller.ts
customer.controller.ts
product.controller.ts
productGroup.controller.ts
productTaxonomy.controller.ts
```

**不要为了压低这个数字而机械拆分** —— 见 §11。

---

## 4. Completed Rounds

| 轮次 | 内容 | 结果 |
|---|---|---|
| **R-1** | Backend Layering Foundation：建立四层目录、领域错误契约（`lib/errors.ts`）、事务入口（`repositories/transaction.ts`）、分层检查器（`scripts/check-layering.ts`） | ✅ 完成 |
| **R-1.1** | Prisma Relation Repair：修复 `Opportunity` 具名关系缺失反向 relation 导致的 schema 不可校验（P1012） | ✅ 完成 |
| **R-1.2** | Dev DB Migration + Verify Script：应用待执行迁移；新增 `npm run verify`；固化「禁止用 `prisma format` 做校验」 | ✅ 完成 |
| **R-2** | **Lead Pilot**：Lead 四层拆分；Controller 1277 → 310 行；运行时核验 9 项 PASS | ✅ 完成 |
| **R-3** | **Customer Pilot**：Customer 四层拆分；Controller 1661 → 330 行；运行时核验 20 项 PASS | ✅ 完成 |
| **R-3.1** | Backend Refactor Baseline Freeze（Lead + Customer）：验证 + 固化 + 提交 `1210c7e` | ✅ 完成 |
| **R-4** | **Product Layering**：Product / ProductGroup / ProductTaxonomy 四层拆分；Controller 874/399/147 → 240/115/125；运行时核验 **76 项 PASS / 0 FAIL** | ✅ 完成 |
| **R-4.1** | **Backend Layering Baseline Freeze（Lead + Customer + Product）**：验证 + 固化 + 提交 | ✅ **本轮** |

---

## 5. API Contract

| 项 | 策略 |
|---|---|
| **Strategy** | **Keep API Stable** |
| **Frontend** | 重构期间**未修改**（`client/**` 零改动） |
| endpoint / HTTP method | 未变 |
| request field / response shape | 未变 |
| 错误码与文案 | 未变 |

### 冻结范围（截至 R-4.1）

```
Lead API     = unchanged
Customer API = unchanged
Product API  = unchanged
```

### 明确未新增的 API

```
Lead Confirm API = 未新增
```

> 系统当前**不存在** `POST /api/leads/:id/confirm` 端点。Lead → Customer 由**既有前端流程**编排
> （`LeadFormModal` → `POST /api/customers` → `PUT /api/leads/:id`）。本阶段**未新增** Confirm API，
> 也未改变该链路。

**重构铁律**：架构重构不得改变 API Contract 与前端行为。
若内部重构发现必须改 API → **STOP / REPORT**，不自行修改。

---

## 6. Business Freeze

| 模块 | 状态 |
|---|---|
| **Lead** | business baseline established |
| **Customer** | business baseline established |
| **Product / ProductGroup / ProductTaxonomy** | business baseline established（**纯拆层，未改任何业务规则**） |
| **Opportunity** | **business design NOT FINAL** → **do not refactor yet** |

---

## 7. Product Business Boundary

> 本节记录 R-4 取证确认的**既有事实与边界**，不新增任何业务定义。
> 原则：**没有真实入口的模型，不制造假 Business / Operation / Repository 层。**

### 7.1 Product

```
Product = Product Master Data
```

当前已存在的字段（**均未改动，仅分类登记**）：

| 类别 | 内容 |
|---|---|
| 身份 | `productNo`（PRD 序列）/ `sku`（工艺-受众-序号）/ `model` / `name` |
| **产品分类** | `crafts`（ProductCraftLink 中间表）/ `audienceId` / `categoryId` |
| **产品属性** | `material`/`sizeL`/`sizeW`/`sizeH`/`weight`/`colors`/`packaging`/`features`/`description` |
| **供货商务信息** | `supplyModes`/`moq`/`leadTime`/`hsCode`/`defaultPrice`/`defaultCurrency`/`defaultTaxRate` |
| **可见性** | `visibility`（PUBLIC/PRIVATE）+ `visibleUsers` + `ownerId` |
| 图片 | `coverImage`（已冻结的展示范式冗余列）+ `Attachment(ownerType=PRODUCT)` |
| 审计 / 状态 | `source`/`remark`/`status`/`deletedAt`/`createdBy`/`updatedBy` |

> **不得在 baseline 中新增不存在的业务定义。**

### 7.2 Lead Product Demand

见 §2「Lead 的产品需求载体」。**`Lead Product Demand = LeadItem`**，`Lead 1:N LeadItem`。
**不创建 `ProductDemand`，不创建新表。**

### 7.3 ProductTask

```
schema exists            ✅ 04-product.prisma:282（关系 Product.tasks ProductTask[]）
code entrypoint = 0      ✅ server/src 仅 1 处命中（注释）；client/src 0 命中
runtime rows   = 0       ✅ 实测
```

设计意图与 **`Product.progress` JSON** 存在历史关系（schema 注释：「替代旧 sampleNo + progress(JSON)」），
但**没有实际落地**。

因此当前：

```
NO SERVICE
NO OPERATION
NO REPOSITORY
```

> **不要制造假业务层。** 归属判定：**独立业务过程**（打样 / 报价阶段的子任务），不是 Product 主数据。

### 7.4 ProductPrice

```
code entrypoint = 0      ✅ server/src 仅 1 处命中（注释）
runtime usage   = 0      ✅ 实测 0 行
```

状态：

```
Declared but currently unused
```

**保持现状**（未新增 CRUD）。归属判定：**关系 / 定价事实**（Customer × Product 的客户级标准价），不是 Product 主数据。

### 7.5 CustomerProduct

```
independent create/update entrypoint = none
runtime rows = 0
```

现有唯一接触点：

```
SalesOrderItem.customerProductId
```

该字段**属于订单模块的既有字段**（可选透传），CustomerProduct 实体本身从不被创建。

> 本阶段**不建立独立 CustomerProduct CRUD**，也不改动订单模块。

### 7.6 Product.stock

```
Product.stock = Business Fact / Inventory concern
```

当前事实：

- 人工录入（`POST /api/products`、`PUT /api/products/:id`）
- Excel 导入（模板列「库存」）
- **没有库存流水**（无扣减 / 无加总 / 无预留）
- **订单 / 生产 / 采购当前没有引用** `stock`
- **V1 保留字段**（schema 注释：`库存（V1 保留冗余字段：不引入独立库存域）`）
- **本阶段不引入独立 Inventory Domain**，字段未删、未迁移

---

## 8. Important Business Rules

> 本节仅登记**已冻结的关键业务语义**，避免后续重构无意中改变它们。完整规则见各轮决策文档。

| 规则 | 内容 |
|---|---|
| `Lead.source` | **retained**（枚举 `MANUAL/EXCEL/RPA/SYNC`，表示线索数据进入系统的方式） |
| `Customer.source` | **不再新增业务写入**（deprecated / 既有写入沿用，未扩展） |
| `Lead.channelId` | **first acquisition channel**（最初获客渠道） |
| `Lead.shopId` | **first acquisition shop**（最初获客店铺） |
| `Customer.channelId` | **inherited from Lead**（首次获客渠道，非「当前渠道」） |
| `Customer.shopId` | **inherited from Lead**（首次获客店铺） |
| `Opportunity.channelId/shopId` | **independent sales-record fields**（本次销售记录归属） |
| Opportunity → Customer | Opportunity **must not overwrite** Customer 首次获客 channel/shop |
| `shopId` ↔ `channelId` | **shopId must belong to channelId**（`shop.parentId === channelId`，服务端强制校验） |
| `Customer.intentLevel` | **highest linked Opportunity.intentLevel**（读时派生，非人工字段） |
| `Customer.coverImage` | **customer business card / 客户名片**（字段名与语义均冻结） |
| Lead → Customer | **保持既有前端 / API 链路**（未新增 Confirm API，未改数据流） |
| 状态机权威 | 业务状态流转必须由**服务端**作为权威；前端只展示与发起 |
| Draft | Draft 是**工作状态**，不是独立主数据，不建复制表 |
| Snapshot | Snapshot 只用于冻结**必须保持历史一致性的业务事实**，不为展示/查询便利复制主数据 |
| Product SKU 契约 | `${工艺代码}-${受众代码}-${序号(3位)}`（**冻结格式**）；写入路径必须在事务内用 `tx` 生成 |
| Product 可见性 | `PUBLIC ∨ (PRIVATE ∧ 本人创建) ∨ (PRIVATE ∧ 在可见人名单) ∨ admin`；详情越权 **403**、更新越权 **404**（既有不对称，刻意保留） |

---

## 9. Runtime Verification

| 模块 | 结果 | 覆盖 |
|---|---|---|
| **Lead** | ✅ **PASS** | 列表 / 详情 / 操作记录 / 创建（草稿）/ Draft 读取 / 更新 / `shop⊄channel` 负例 / 不存在→404 / 清理（0 残留） |
| **Customer** | ✅ **PASS** | 列表 / 详情+关联 / 创建 / 更新 / 关系读取 / dataScope / `shop⊄channel` 负例 / release+claim / 清理（0 残留） |
| **Product** | ✅ **PASS（76 项 / 0 FAIL）** | 列表 / 详情 / 创建（productNo+SKU+旧字段映射）/ 更新（**工艺变化→SKU 重生成**）/ 删除（403）/ 搜索筛选 / 权限（403 详情 · 404 更新 · 列表与下拉过滤）/ 混排列表 / 组合 CRUD（含行内快速新建单品）/ 分类字典 CRUD / Excel 导入（部分成功语义）/ **Lead 产品需求保存与读取回归** / **Lead release·claim·transfer 的产品联动回归** / 清理（0 残留） |

未覆盖项（如实记录，未伪造 PASS）：

- Lead **Confirm** —— 服务端不存在该端点（由前端编排）
- Customer `intentLevel` 的**非 null 派生分支** —— 当时本地库无 `intentLevel != null` 的商机数据
- **ProductTask / ProductPrice / CustomerProduct** —— **NOT APPLICABLE**（无任何入口，未为测试新增 API）

---

## 10. Database

| 项 | 状态 |
|---|---|
| Current migration status | **up to date**（18 migrations，全部已应用） |
| Prisma Client | 与 schema 同步（`prisma generate` 通过） |
| schema 校验 | `The schemas at prisma/schema are valid 🚀` |

### R-4 的数据库影响（明确记录）

```
Prisma schema    = unchanged by R-4
Migration        = none
Database structure = unchanged
```

> **R-4 是纯代码架构拆层**，未改任何字段、未生成迁移、未变更表结构。
> 运行时验证仅临时写入测试数据（统一前缀）并全部清理，**残留 = 0**。

---

## 11. Refactor Rule

> **Do not refactor a business module before its business rules are sufficiently defined.**

架构重构必须保持：

```
API Contract
Frontend behavior
existing business semantics
```

具体要求：

1. **业务未定，不动架构。** 业务规则尚未最终确定的模块（当前为 Opportunity）不做分层重构 —— 否则等于把「还没想清楚的业务」提前固化成代码结构。
2. **拆架构 ≠ 重新设计业务。** 重构是**职责搬迁**，业务规则、字段语义、状态机、错误文案都必须逐字保持。
3. **单模块推进 + 完整验证。** 一次只拆一个模块，且必须通过 `npm run verify` + `npm run lint:layering` + 真实运行时核验。
4. **不制造空层。** 禁止 `Controller → Operation → Repository` 这类纯转发；Operation 只放真正有复用价值的多仓储组合与事务编排。
5. **没有入口的模型，不造层。** schema 存在但无业务写入口的模型（如 ProductTask / ProductPrice / CustomerProduct）**不得**为其创建虚假 Business / Operation / Repository。
6. **不新增平行目录。** 只有 `services/` / `operations/` / `repositories/` 三个名字，禁止 `service/`、`business/`、`data/`、`dao/`。
7. **复用既有基础设施。** 错误契约、事务入口、分页、dataScope、OperationLog、编号序列、SKU 生成都只有一个实现。
8. **共享层调整必须报告**（shared file / reason / impact）。
9. **Schema 纪律**：迁移文件只应用不修改；禁止用 `prisma format` 做校验（见 `docs/prisma-schema-rules.md`）。
10. **既有缺陷不顺手修。** 发现既有问题时记录为 `Observed existing issue`，留待对应业务规则阶段处理。

---

## 12. Verification Commands

```bash
cd server
npm run verify          # prisma validate && prisma generate && tsc --noEmit
npm run lint:layering   # 分层依赖检查（报告模式）
npm run lint:layering:strict   # 严格模式（未纳入门禁）
npx prisma migrate status      # 数据库迁移状态（只读）
```

`npm run verify` **不连接数据库**，可离线运行，是 TypeScript / Prisma 的基线门。

> ⚠️ 已知工具链缺口：`npm run lint`（eslint）因**未安装 eslint 且无配置**而不可用，属既有问题，未在本阶段处理。

---

## 13. Deferred

### Opportunity Refactor = **DEFERRED**

**原因**：`Business logic not finalized`

说明：

- 这是**计划性暂缓**，不是「Opportunity 架构有问题」。
- 商机的业务逻辑（终态语义、状态机、channel/shop 规则、与 Customer 的关系）**尚未完成设计**。
- 在业务规则冻结之前，不对 Opportunity 做 Controller / Business / Operation / Repository 的任何拆分，不新增 API，不重设计生命周期。
- 待商机业务模型确定后，再依据最终业务模型决定下一轮如何拆分。

其余待拆分模块同样遵循 §11 第 1 条：**先定业务，再定架构**。

---

## 14. Next Action

```
1. 把注意力转回 Opportunity 的业务设计（业务规则 / 状态机 / 终止态 / 与 Customer 关系）
2. 业务模型冻结后，再决定下一轮拆分哪个模块
3. 不要因为剩余 26 个 layering violations 而继续机械拆分
```

**本基线已 FROZEN。R-5 不自动开始。**
