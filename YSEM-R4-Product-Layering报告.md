# Round R-4 · Product Layering Report

> 状态：**实施完成 · 验证通过 · 未提交（NO COMMIT / NO PUSH）**
> 范围：Product 相关后端代码四层拆层（Controller → Business → Operation → Data → Prisma）
> 性质：**拆层，不是重新设计 Product**

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| **HEAD** | `1210c7efcaf32c5c9b36be166d68e4433fb0f973` |
| **origin/master** | `1210c7efcaf32c5c9b36be166d68e4433fb0f973`（**一致**，无前置未推送提交） |
| **BRANCH** | `master` |
| **WORKTREE（开始时）** | 无 tracked 改动（`git diff --stat` 为空）；仅 1 个未跟踪文件 `YSEM-R3.1-Backend基线冻结报告.md`（上一轮报告交付物，**与本轮无关**，未删除、未提交） |
| **verify** | ✅ **PASS**（`prisma validate` valid 🚀 / `prisma generate` v5.22.0 / `tsc --noEmit` **0 error**） |
| **layering** | **29** violations / 12% / **R1 = 0 · R3 = 0 · R4 = 0** |
| **数据库** | 18 migrations 全部已应用（up to date） |

硬门规则全部满足，未出现「无关用户修改 / verify 失败 / schema 无法验证 / TS 已存在错误 / checker 无法执行」。

---

## 2. PRODUCT BUSINESS MAP

### A. Product Master（`Product`）

**产品主数据本体**。字段归属按 `04-product.prisma` 现状分类（**本轮未改任何字段**）：

| 类别 | 字段 | 归属 |
|---|---|---|
| 身份 | `productNo`（PRD 序列）、`sku`（工艺-受众-序号）、`model`、`name` | **Master Data** |
| 三级分类 | `crafts`(ProductCraftLink)、`audienceId`、`categoryId` | **Master Data**（分类字典） |
| 固有属性 | `material`/`sizeL/W/H`/`weight`/`colors`/`packaging`/`features`/`description` | **Master Data** |
| 供货与商务 | `supplyModes`/`moq`/`leadTime`/`hsCode`/`defaultPrice`/`defaultCurrency`/`defaultTaxRate` | **Master Data** |
| 可见性与归属 | `visibility`/`visibleUsers`/`ownerId` | **Master Data + 对象级授权** |
| 图片 | `coverImage`（列表页免 join 的冗余列）+ `Attachment(ownerType=PRODUCT)` | **Presentation 冗余（已冻结的既有范式）** |
| 软删除 | `status`(MasterStatus)/`deletedAt`/`source`/`remark`/`createdBy`/`updatedBy` | **审计 / 主数据状态** |
| **库存** | `stock` / `lowStockAlert` | ⚠️ **见下方 D 条** |

### B. ProductTask

| 项 | 取证结论 |
|---|---|
| Schema | ✅ 存在（`04-product.prisma:282`），关系 `Product.tasks ProductTask[]`（注释：「替代旧 sampleNo + progress(JSON)」） |
| **谁创建** | **无人**（`server/src` 全量搜索：`productTask\|ProductTask` **仅 1 处命中，且是注释**） |
| **谁更新 / 读取** | **无人**（前端 `client/src` **0 命中**） |
| **是否有真实业务写入口** | ❌ **没有** |
| 归属判定 | **独立业务过程（生产/打样/报价阶段的子任务）**，不是 Product 主数据。**设计意图是替代 `Product.progress`(JSON)**，但从未落地 |
| 运行时行数 | `ProductTask = 0` |
| 本轮处置 | **不为它制造假 Business / Operation / Repository**（符合 §10）。未新增入口、未删除模型 |

### C. ProductPrice

| 项 | 取证结论 |
|---|---|
| Schema | ✅ 存在（注释：`customerId` 必填、不含 `customerProductId`、`sourceType: QUOTATION`） |
| 真实写入口 | ❌ **没有**（全量搜索仅 1 处命中：`product.controller.ts:362` 的注释） |
| 读取 | ❌ **没有** |
| 归属判定 | **关系/定价事实**（Customer × Product 的客户级标准价），**不是 Product 主数据的一部分** |
| 运行时行数 | `ProductPrice = 0` |
| 本轮处置 | 保持现状，记录为 **`Declared but currently unused`**。未新增 CRUD |

### D. CustomerProduct

| 项 | 取证结论 |
|---|---|
| Schema | ✅ 存在（注释：定制差异只存差异、`agreedPrice` 随版本走、`salesOrderItems` 反向） |
| 创建 / 更新入口 | ❌ **没有**（无任何 CRUD；全量命中均为注释） |
| 唯一「接触点」 | `SalesOrderItem.customerProductId` 作为 **可选透传字段**（`salesOrder.controller.ts:89` zod 声明 / `:248` 写入；`client/src/api/salesOrders.ts:73` 类型）。**该实体本身从不被创建** |
| 归属判定 | **客户 × 产品的定制关系数据**（Relationship Data），不是 Product 主数据 |
| 运行时行数 | `CustomerProduct = 0` |
| 本轮处置 | 保持现状（`SalesOrderItem` 属订单模块，**本轮未触碰**）。未新增虚假 CRUD |

### E. Lead Product Demand（本轮重点）

**真实数据载体（代码取证，非假设）**：

```
Lead ──1:N──→ LeadItem
                ├── productId?      → Product（未建档产品时为 NULL）
                ├── productName?    → 未建档产品的名称兜底 / 已建档产品的名称快照
                ├── productDesc?    → 采购产品的描述（材质/规格/工艺/用途）
                ├── quantity        意向数量（Int）
                ├── craftIds[]      工艺 id 数组（多对多，落数组避免关联表）
                ├── audienceId?     受众（二级分类）
                ├── categoryId?     品类（三级分类）
                └── sizeL/W/H/weight  需求规格（与产品主数据字段对齐，建档时带入产品）
```

| 问题 | 回答 |
|---|---|
| **当前数据载体** | **`LeadItem`（JSON 数组列）** —— 不存在独立 ProductDemand 表；`LeadItem.craftIds` 为 `String[]`，需求规格为标量列 |
| **写入入口** | `POST/PUT /api/leads`（`lead.controller` → `leadService` → `leadOperation` → `leadRepository`）。表单：`LeadFormModal.tsx` 第 2 步「需求详情」内联（`productKey` AutoComplete + `craftIds` 多选 + 受众→品类级联 + 尺寸/克重 + 数量 + 单价 + `productDesc`） |
| **读取入口** | `GET /api/leads`（列表 `items`）/ `GET /api/leads/:id`（详情 `items`），经 `projectProductRows` 投影 |
| **是否参与 Lead Confirm** | **是（数据层面）** —— LeadItem 于 Lead 创建/更新时写入并保留；但**服务端不存在 `POST /leads/:id/confirm` 端点**，Confirm 由前端编排（详见 §8） |
| **是否存在 Product Master 与 Product Demand 混用** | **NO（结构性分离）** —— 需求落在 `LeadItem`（明细行），Product 主数据落在 `Product`；`productId` 为 **nullable 引用**，未建档时退化为 `productName` 文本 |
| **本轮处置** | **零改动**。R-2 已完成其四层拆分（`lead.repository` / `lead.operations` / `lead.service`）；本轮只验证**既有行为完全保持**（§7-⑫⑬⑭） |

### F. Product.stock（§9 特别处理）

| 项 | 取证结果 |
|---|---|
| **谁写** | ① `POST /api/products`、`PUT /api/products/:id`（`productSchema.stock`，人工录入）；② `POST /api/products/import`（Excel 列「库存」） |
| **谁读** | 仅作为 Product 记录字段回传（列表 / 详情）。**无任何业务逻辑消费** |
| **是否有库存流水** | ❌ **无**。订单 / 出运 / 生产 / 采购 controller **均不引用 `stock`**（无扣减、无加总、无预留） |
| **Schema 注释（既有决定）** | `// ---------- 库存（V1 保留冗余字段：不引入独立库存域）----------` |
| **判定** | `Product.stock` = **Business Fact / Inventory concern（人工录入的标量）**，落在主数据表上且无库存域支撑。这是 **V1 已明确记录的简化决定**（不是本轮缺陷，也不是新增问题） |
| **本轮处置** | **未删除、未迁移、未新增 Inventory 模块**。仅在报告中记录（符合 §9） |

---

## 3. FRONTEND CONTRACT

### Lead Product Demand flow（前端实际链路）

```
LeadFormModal（第 2 步「需求详情」，全部内联，无独立子组件）
  ├─ 产品选择：AutoComplete  ← GET /api/products/options   （useLeadOptions.ts:38）
  │     └─ 选中/失焦 → handleProductResolved（:327-352）
  │           └─ GET /api/products/:id（:339）
  │                 └─ applyProductFieldValues（:305-324）自动带出：
  │                     productKey=name / images / craftIds / categoryCascade=[audienceId,categoryId] / sizeL/W/H / weight
  ├─ 手工补充：craftIds / 受众→品类级联 / 尺寸 / 克重 / quantity / unit / targetPrice / productDesc
  └─ 提交：buildLeadPayload（:928-1006）→ productId（单值 string|null）+ 未命中时 productName 文本兜底
        → POST /api/leads 或 PUT /api/leads/:id

未建档产品：convertLead.ts:68 用 GET /api/products 按名查重 → 未命中经 openProductForm 回调
            打开 ProductEditModal → POST /api/products（LeadFormModal:1286 / :436 / :1223）
```

**关键契约（拆层后必须零变化，已核验）**：产品为**单个 `productId`**（非数组）；未建档时走 **`productName` 文本兜底**（`productId = null`）。

### Product API 契约（前端消费方式）

| 端点 | 前端消费 | 依赖的响应形状 |
|---|---|---|
| `GET /products/options` | `useLeadOptions.ts:38`、`SalesOrders.tsx:127`、`SamplePage.tsx:113`、`QuotePage.tsx:109`、`SalesFormModal.tsx:89` | `{id,name,sku?}[]`（`res.data.data` 直接为数组） |
| `GET /products` | `convertLead.ts:68`、`PurchaseFormModal.tsx:92` | `{list,total,page,pageSize}` |
| `GET /products/mixed` | `Products.tsx:131,144` | `{list:[{type:'PRODUCT'\|'GROUP',data}],total,page,pageSize}`；条目依赖 `data.id` |
| `GET /products/:id` | `LeadFormModal.tsx:339,904`、`Products.tsx:106,332`、`productCache.ts:83` | `data.data`（含 `crafts` 摊平 + `images`） |
| `GET /products/sku-preview` | `ProductEditModal.tsx:162` | `data.data.sku` |
| `GET /products/:id/logs` | `ProductDetailModal.tsx:111` | `data.data.list` |
| `POST/PUT/DELETE /products` | `LeadFormModal.tsx:371,436,1223`、`ProductEditModal.tsx:308,312`、`Products.tsx:178` | — |
| `POST /products/import` | `ProductImportModal.tsx:25` | `data.data.{successCount,failCount}` |
| `GET /products/template` | `ProductImportModal.tsx:47` | `window.open`（文件名/内容未改） |
| `/product-groups/*` | `Products.tsx:187`、`ProductGroupManageModal.tsx:44,74,86,107` | `{list,total,page,pageSize}`；行含 `productCount`/`products`（**无 `items`**） |
| `/product/taxonomy/*` | `ProductTaxonomy.tsx:42-44,95-97`、`Products.tsx:157-158`、`useLeadOptions.ts:47` | 数组 |

**API contract**：✅ **unchanged**（请求字段 / 响应结构 / 错误码 / 错误文案 / 筛选 / 排序 / 分页 / 可见性口径逐项未改；无死端点 —— 11 个 Product 端点全部有前端消费者）。

---

## 4. FOUR-LAYER RESULT

```
Controller ──→ services/ (Business) ──→ operations/ (Operation) ──→ repositories/ (Data) ──→ Prisma
```

### Controller（HTTP only）

| 文件 | 行数 | 保留职责 |
|---|---|---|
| `controllers/product.controller.ts` | 874 → **240** | DTO 校验（复用 Business 导出的 schema）、actor/scope 注入、可见性投影注入、状态码与文案、**Excel 文件解码与模板生成（HTTP/文件边界）** |
| `controllers/productGroup.controller.ts` | 399 → **115** | 同上 |
| `controllers/productTaxonomy.controller.ts` | 147 → **125** | 同上 |

3 个 Controller 均已 **0 Prisma**（`grep -c "lib/prisma"` = 0 / 0 / 0）。

### Business（3 新增）

| 文件 | 行 | 承载的业务规则 |
|---|---|---|
| `services/product.service.ts` | 837 | 旧字段→V1.0 列映射、默认 supplyMode/source、SKU 上下文判定（`hasFullContext`）、可见性 403/404 口径（**403 详情 vs 404 更新，沿用既有不对称**）、删除的 admin 门槛、组合混排合并/排序/分页、Excel 表头映射与「名称→id」解析、操作日志 diff 构造、审计留痕 |
| `services/productGroup.service.ts` | 356 | 组合明细「行内快速新建必须有名称」、整组替换语义、组合可见性投影、审计留痕 |
| `services/productTaxonomy.service.ts` | 103 | 分类字典 DTO 契约与读写编排（既有除 DTO 约束外**无额外业务规则**，如实保持很薄） |

### Operation（2 新增）

| 文件 | 行 | 事务边界 |
|---|---|---|
| `operations/product.operations.ts` | 77 | `createProductOperation`（`getNextNumber('PRD')` + `buildSkuCode` + 落库，**同一事务** + `withSkuRetry`）、`updateProductOperation`（SKU 重生成与 update 同事务） |
| `operations/productGroup.operations.ts` | 108 | `createProductGroupOperation`（`CMB`/`PRD` 编号 + 内部 Product 创建 + Combo/ComboItem 创建**同一事务**）、`replaceProductGroupItemsOperation`（整组替换：先删后建，**沿用既有非事务语义**） |

`$transaction` 出现位置：**仅 Operation 层**（Controller / Business 均为 0）。

### Data（4 新增 + 2 扩展）

| 文件 | 行 | 说明 |
|---|---|---|
| `repositories/product.repository.ts` | 65 → **201** | R-2 的 7 个方法**逐字保留**；新增列表/详情/下拉/混排读取、写入、`nextSku`（**只提供数据客户端**给冻结的 `lib/skuCode`，使 Operation/Business 无需持有 prisma 单例） |
| `repositories/productTaxonomy.repository.ts` | 111 | 工艺 / 受众 / 品类（字典 CRUD + 名称↔id 解析）。**被分类管理页、Product 关联 include、Excel 导入、日志 diff 四处共用** |
| `repositories/productGroup.repository.ts` | 157 | ComboProduct / ComboItem；`COMBO_ITEM_PRODUCT_SELECT` 收敛原两份重复 select |
| `repositories/certificate.repository.ts` | 24 | 只读（导入名称解析 + diff 名称解析），**不迁移 Certificate 模块 CRUD** |
| `repositories/user.repository.ts` | +16 | 纯新增 `findIdentityPairs` / `findNamesByIds`（**不影响 Lead / Customer**） |
| `repositories/index.ts` / `operations/index.ts` / `services/index.ts` | +7/+4/+12 | 分层入口导出 |

**未创建任何平行目录**：仍只有 `services/` `operations/` `repositories/`。

---

## 5. PRISMA DECOUPLING

| 指标 | before | after | 变化 |
|---|---|---|---|
| **Product Controller 直接 Prisma** | 3 文件（product / productGroup / productTaxonomy） | **0** | ✅ **−3（目标达成）** |
| 仍直接 import Prisma 的 Controller | 29 / 33 | **26 / 33** | −3 |
| Controller 内 `prisma.*` 调用点 | 338 | **291** | −47 |
| 分层迁移进度（去 Prisma 化） | 12% | **21%** | **+9pt** |
| `services` / `operations` / `repositories` 文件数 | 3 / 3 / 14 | **6 / 5 / 17** | +3 / +2 / +3 |

**Layering 违规清单中已无任何 `product*` 文件**（唯一残留匹配 `productionOrder.controller.ts` 属**生产订单**模块，非 Product）。

---

## 6. LAYERING

```
R1（反向依赖）        = 0
R3（共享层依赖业务层）  = 0
R4（领域层依赖 HTTP）   = 0
R2（Controller→Prisma）= 26   （29 → 26；本轮 −3）
```

- Controller direct Prisma：**Product 范围内 = 0**
- Product 三个 Controller **无 Prisma client 数据操作**，且**无 Prisma 类型 import 残留**（全部 0）
- 检查器输出中未出现 `[R1-*]` / `[R3-*]` / `[R4-*]` 段落 ⇒ **R1 / R3 / R4 均无命中**
- IDE 诊断：**0**
- 路由一致性：3 个 `*.routes.ts` 引用的 **28 个导出全部存在**（`product.routes` 无需改动）

---

## 7. RUNTIME VERIFICATION

执行环境：本地开发库 `localhost:5432/ysem`；脚本置于 `/tmp`（**未进入仓库**，已删除）；`ACTOR = admin / role=admin` + 一个非 admin ACTIVE 用户；测试数据统一前缀 `__R4VERIFY__`。

**结果：PASS = 76 · FAIL = 0 · 残留 = 0**

| # | 项 | 结果 | 要点 |
|---|---|---|---|
| 1 | **Product list** | ✅ PASS | `{list,total,page,pageSize}`；行含 `crafts` 摊平 + `images` + `audience`/`category` |
| 2 | **Product detail** | ✅ PASS | 含 `images`/`crafts`；不存在 → **404「产品不存在」** |
| 3 | **Product create** | ✅ PASS | `productNo` 生成；`sku` 生成（craft+audience 齐备）；`price→defaultPrice`、`images→coverImage`、`sizeL` 字符串→Float、`createdBy`、默认 `supplyModes=[DEEP_CUSTOM]`、默认 `source=MANUAL`、默认 `visibility=PUBLIC` |
| 4 | **Product update** | ✅ PASS | 名称/库存生效；`productNo`/`sku` 未动；**工艺变化 → SKU 重新生成**；不存在 → 404 |
| 5 | **Product delete** | ✅ PASS | 非管理员 → **403「仅管理员可删除产品」** |
| 6 | **Product search / filter** | ✅ PASS | `keyword`（无匹配 → `total=0`）、`craftIds`、`audienceId`、`visibility` 全部生效；`sku-preview` 返回 `string\|null` |
| 7 | **Product dataScope** | ✅ **N/A + 已核验** | Product **不使用** `ALL/DEPT/SELF`（`utils/scope` 明确禁止在 Product 上注入公海／owner 范围）——使用**对象级可见性**。已核验其口径未变（见 #8） |
| 8 | **Product permission** | ✅ PASS | 他人访问 PRIVATE 详情 → **403「无权查看该不公开产品」**；他人更新 PRIVATE → **404**（scope 外不泄露存在性）；他人列表/下拉不含该产品；管理员可见 |
| 9 | **ProductTask 现有入口** | **NOT APPLICABLE** | 无任何入口（代码 0 引用、运行时 0 行）。**未为了测试而新增 API** |
| 10 | **ProductPrice 现有入口** | **NOT APPLICABLE** | 同上 |
| 11 | **CustomerProduct 现有入口** | **NOT APPLICABLE** | 无创建入口（运行时 0 行）；仅 `SalesOrderItem.customerProductId` 透传字段，**属订单模块，本轮未触碰** |
| 12 | **Lead Product Demand 保存** | ✅ PASS | `LeadItem.productId` = 请求产品；`productName` 快照写入；`quantity=4` 正确；`productDesc` 落明细行；未建档产品走 `productName` 文本兜底（`productId=null`） |
| 13 | **Lead Product Demand 读取** | ✅ PASS | Lead 列表正常（`{list,total}`）；详情含 `items` + `product` 关联 |
| 14 | **Lead 现有 Customer + Product 操作链路** | ✅ PASS | `releaseLead` → 关联产品置公开（`releaseToPublic`）；`claimLead` → 无归属产品归属认领人（`updateOwnerMany`）；`transferLead` → **私密**产品新归属人加入可见人（`connectVisibleUser`）；公开产品转交不联动（符合既有规则） |

**附加验证**（超出 §20 清单，覆盖本轮新增层）：

- 产品组合 CRUD：创建（含**行内快速新建单品**，获得 `productNo`/`sku`）、列表、详情、更新、整组替换（旧明细 0 残留）、删除
- 组合明细缺名称 → **400「组合明细中快速新建单品时名称不能为空」**，且**未残留孤儿 Product**
- 组合成员产品投影白名单**仅 `id/name/sku`**（内部授权字段不泄露）
- 分类字典：工艺 / 受众 / 品类 **create / update / delete** 全通
- Excel 导入：`{total,successCount,failCount,created,failed}`；缺名称行进 `failed`（原因「缺少产品名称」）；成功行已落库
- **清理 0 残留**（products / leads / combos / crafts / audiences / categories 全部归零）

**一次测试脚本自身的缺陷（如实披露）**：首轮 2 项 FAIL 是**我的断言写错**（我假设 `transferLead` 会设置产品 `ownerId`，并使用了 PUBLIC 产品）。读码确认真实规则为「**仅 PRIVATE 产品**执行 `connectVisibleUser`，且**不改 `ownerId`**」（`lead.service.ts:767-770`）后修正断言 → 全绿。**非代码回归**。

---

## 8. BUSINESS INVARIANTS

| 不变式 | 结果 | 证据 |
|---|---|---|
| **Lead Product Demand** | ✅ **PASS** | 数据载体仍为 `LeadItem`（未改 JSON/标量结构）；`productId` 单值 + `productName` 兜底契约不变；未建档分支不变；R-2 的 `lead.repository` / `lead.operations` / `lead.service` **零改动** |
| **Customer** | ✅ **PASS（零改动）** | `customer.*` 文件**未触碰**；仅新增 `user.repository` 两个只读方法（纯新增） |
| **Product** | ✅ **PASS** | 字段语义/默认值/`productNo`、`sku` 生成规则（冻结格式）/旧字段映射/可见性模型/403-404 口径/筛选与排序**全部逐字保留**；`stock`/`lowStockAlert` 未删未迁 |
| **Opportunity** | ✅ **PASS（零改动）** | `sales.controller.ts`、`05-opportunity.prisma` **未触碰** |
| **API** | ✅ **unchanged** | 端点 / method / 请求字段 / 响应结构 / 状态码 / 错误文案 / 分页 / 筛选 / 排序 逐项未改 |
| **Frontend** | ✅ **unchanged** | `client/**` **零改动**；调用方式与依赖字段未变 |
| **Lead Confirm** | ✅ **未新增** | 系统仍无 `POST /leads/:id/confirm`；本轮**未新增该 API** |
| **事务架构** | ✅ 复用 | `$transaction` 仅在 Operation 层；`runInTransaction` / `withSkuRetry` / `getNextNumber` / `buildSkuCode` / `activityLogger` / `DomainError` **全部复用既有基础设施**，无第二套 |
| **快照不可变** | ✅ 未恶化 | 本轮**未触碰**任何 `withProductVisibility` / `productName` 快照改写点（quotation / sample / sales 侧）；**既有 snapshot projection issue 未扩大、未修复**（留待业务规则阶段） |

### 必须明示的两处「仅在实现层面等价」的搬迁

1. **组合行内快速新建的名称校验时点**
   原实现：在**事务内**抛出 `ProductGroupRuleError`（靠回滚撤销同事务内已创建的 Product）。
   现实现：在**开启事务之前**判定并抛 `DomainValidationError`。
   **对外完全一致**：状态码 400、文案相同、且「不残留孤儿 Product / 不消耗 CMB、PRD 编号」的最终结果相同（已运行时验证）。**不再依赖回滚**。
2. **`updateGroupProducts` 的整组替换**
   原实现：`deleteMany` + `update` 两步**各自独立、不包事务**。
   现实现：**逐字保留该语义**（收敛为 `replaceProductGroupItemsOperation` 的两个仓储调用），**未擅自改为原子操作**。

### Observed existing issues（**本轮未修改，仅记录**）

| # | 现象 | 位置 | 性质 |
|---|---|---|---|
| O1 | 组合明细 `items[].name` 被 schema 接收但**未被使用** | `updateGroupProducts` 旧实现 | 既有冗余入参 |
| O2 | `Product.progress` 被 schema 接收后**静默丢弃**（`progress: _progress`）；前端仅在类型定义中存在（`api/products.ts:102`），无组件发送 | `productSchema` | 死字段（且其**设计替代者 `ProductTask` 从未落地**） |
| O3 | 多个 V1.0 主数据列**无法经 API 写入**：`model`/`material`/`moq`/`leadTime`/`hsCode`/`colors`/`packaging`/`features` | `productSchema` | 既有契约缺口（**未扩大**） |
| O4 | `Product` 详情 = **403**，`Product` 更新 = **404**（同一 PRIVATE 不可见场景两种码） | 既有实现 | 刻意保留的不对称，**未统一** |

---

## 9. FILE SCOPE

### Modified（8）

```
server/src/controllers/product.controller.ts        874 → 240
server/src/controllers/productGroup.controller.ts   399 → 115
server/src/controllers/productTaxonomy.controller.ts 147 → 125
server/src/repositories/product.repository.ts        65 → 201
server/src/repositories/user.repository.ts              +16
server/src/repositories/index.ts                         +7
server/src/operations/index.ts                           +4
server/src/services/index.ts                            +12
```

### Added（8）

```
server/src/services/product.service.ts                 837
server/src/services/productGroup.service.ts            356
server/src/services/productTaxonomy.service.ts         103
server/src/operations/product.operations.ts             77
server/src/operations/productGroup.operations.ts       108
server/src/repositories/productTaxonomy.repository.ts  111
server/src/repositories/productGroup.repository.ts     157
server/src/repositories/certificate.repository.ts       24
```

`git diff --stat`（tracked）：**8 files changed, 386 insertions(+), 1151 deletions(-)**

**Unexpected files: NONE** —— 无 frontend、无 schema、无 migration、无无关业务模块、无 Opportunity。

**注意事项（非本轮产物）**：工作区仍存在上一轮的未跟踪文件 `YSEM-R3.1-Backend基线冻结报告.md`。**本轮未删除、未提交**。

---

## 10. DATABASE

| 项 | 结果 |
|---|---|
| **schema changed** | ❌ **NO**（`prisma/schema/**` 零改动） |
| **migration** | ❌ **NO**（未生成、未修改；`prisma/migrations/**` 零改动） |
| **database changed** | ❌ **NO（结构性）** —— 未执行 migrate / push / seed；`prisma validate` + `generate` 通过 |
| **运行时数据** | 验证脚本临时写入测试数据（前缀 `__R4VERIFY__`）并**全部清理，残留 = 0**；另产生少量 `OperationLog` 审计记录（由既有 `activityLogger` 正常留痕，属预期行为，未删改） |

---

## 11. REMAINING FINDINGS

1. **ProductTask / ProductPrice / CustomerProduct 三者均为「已声明未实现」**：schema 完备、运行时空表、代码零入口。三者的**设计意图都可读出来**（ProductTask←替代 `progress`；ProductPrice←报价确认后自动生成；CustomerProduct←打样/报价确认的定制版本），但**业务流程从未落地**。本轮按 §10/§11/§12 **未新增虚假 CRUD**，保持现状。
2. **`Product.stock` 是主数据表上的库存事实**，无库存流水支撑（V1 schema 已明确「不引入独立库存域」）。是否引入库存域属**业务决策**，本轮未动。
3. **Product 主数据有较宽的「不可达」区域**（O3）：`model`/`material`/`moq`/`leadTime`/`hsCode`/`colors`/`packaging`/`features` 在 DB 层存在、API 层不可写。这是**既有契约缺口**，与本轮拆层无关，但会影响后续「产品主数据完整性」类需求。
4. **`lib/skuCode.buildSkuCode` 仍是共享基础设施**（R-1 未迁移）。本轮通过 `productRepository.nextSku` 提供数据客户端，**规避了 Operation/Business 直接持有 prisma 单例**；若后续要彻底归位，可在专门的 SKU/编号轮次处理。
5. **既有快照投影问题未扩大**：`withProductVisibility` 改写历史 `productName` 的问题仍在 quotation / sample / sales 侧，本轮未触碰、未修复。
6. **R-2 的 Product 联动方法（`releaseToPublic` / `updateOwnerMany` / `connectVisibleUser` / `findVisibleIds` / `findVisibleOwners`）在仓储重写后行为不变**，已由 Lead release/claim/transfer 三条真实链路运行时验证。

---

## 12. COMMIT STATUS

```
NO COMMIT
NO PUSH
```

未执行 `git add` / `git commit` / `git push`。改动全部保留在工作区，等待审阅。

**请审阅后再决定是否提交。**
