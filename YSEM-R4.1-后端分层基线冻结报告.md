# Round R-4.1 · Backend Layering Baseline Freeze Report

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| **HEAD before** | `1210c7efcaf32c5c9b36be166d68e4433fb0f973`（= R-3.1 冻结提交） |
| **HEAD after** | `c94319724b2b4c795652aedd63138e249b8a708b`（= `c943197`） |
| **origin/master** | `c94319724b2b4c795652aedd63138e249b8a708b`（**与 HEAD 一致**） |

**Baseline Gate（§1）逐项结果**

| 门 | 结果 |
|---|---|
| `git status --short` | 9 modified + 10 untracked（全部属 R-3.1 / R-4 有意产物，无无关用户改动） |
| `git rev-parse HEAD` before | `1210c7e` |
| `git rev-parse origin/master` before | `1210c7e`（一致，无前置未推送提交） |
| `npm run verify` | ✅ **PASS** |
| `npm run lint:layering` | ✅ **PASS**（报告模式；26 violations） |
| `git diff --check` | ✅ **PASS**（无 whitespace error） |
| **R1 = 0** | ✅ |
| **R3 = 0** | ✅ |
| **R4 = 0** | ✅ |

**§2 R-4 修改范围检查**：✅ **PASS —— Unexpected files = NONE**

```
Product Controller      ✅ product / productGroup / productTaxonomy
Product Business        ✅ 3 个 service
Product Operation       ✅ 2 个 operation
Product Repository      ✅ 3 新增 + product.repository / user.repository 扩展
共享基础设施            ✅ 仅 index.ts 导出 + user.repository 两个只读方法
baseline/documentation  ✅ docs/backend-refactor-baseline.md + 2 份轮次报告
```

未出现：`frontend/` · `prisma/schema` · `prisma/migrations` · Opportunity business code · Lead business redesign · Customer business redesign。

---

## 2. VERIFY

| 项 | 结果 |
|---|---|
| **npm run verify** | ✅ **PASS**（exit 0）<br>`prisma validate` → `The schemas at prisma/schema are valid 🚀`<br>`prisma generate` → v5.22.0 成功<br>`tsc --noEmit` → 通过 |
| **TypeScript** | ✅ **0 error**（文档更新前后各跑一次，均为 0） |

文档更新后（§10）复跑：`npm run verify` **PASS** · `git diff --check` **PASS**。
提交后（§12）再复跑：`npm run verify` **exit 0**。

---

## 3. LAYERING

| 规则 | 数量 |
|---|---|
| **R1**（反向依赖） | **0** |
| **R2**（Controller → Prisma） | **26** |
| **R3**（共享层依赖业务层） | **0** |
| **R4**（领域层依赖 HTTP） | **0** |

```
业务层文件：controllers=33  services=6  operations=5  repositories=17
Controller 内 prisma.* 调用点：291
分层迁移进度（Controller 去 Prisma 化）：21%
违规总数：26
```

**26 = 当前剩余待拆分模块（Backend Refactor Baseline）**，不是本轮失败，也不需要立即消灭。
已出列 5 个 Controller：`lead` · `customer` · `product` · `productGroup` · `productTaxonomy`。

---

## 4. COMPLETED MODULES

### Lead

```
R-2 completed
Controller → Business → Operation → Data
Lead Controller direct Prisma = 0
```

- Controller：1277 → **310** 行
- Business `services/lead.service.ts` · Operation `operations/lead.operations.ts` · Data `repositories/lead.repository.ts`

**已写入 baseline**：

```
Lead Product Demand = LeadItem
Lead 1:N LeadItem
```

`LeadItem` 是 Lead 的 **1:N 产品需求载体**，承载 `productId`（可空）/ `productName` / `productDesc` / 尺寸 / 工艺数组（`craftIds[]`）/ `quantity` / `audienceId` / `categoryId` 等既有需求字段。
**未创建独立 ProductDemand，未创建新表。**

### Customer

```
R-3 completed
Controller → Business → Operation → Data
```

Controller：1661 → **330** 行。已冻结的业务规则在 baseline 中原样保留（**未修改**）：

```
Customer.intentLevel = highest linked Opportunity.intentLevel   （读时派生，非人工字段）
Customer.coverImage  = 客户名片                                  （字段名与语义冻结）
Customer.source      = 不再新增业务写入                          （deprecated，既有写入沿用）
Lead → Customer      = 保持既有前端 / API 链路                    （未新增 Confirm API）
```

### Product

```
R-4 completed
Product
ProductGroup
ProductTaxonomy
```

三者均已完成：

```
Controller → Business → Operation → Data
```

| 模块 | Controller 行数 |
|---|---|
| Product | 874 → **240** |
| ProductGroup（ComboProduct） | 399 → **115** |
| ProductTaxonomy（工艺/受众/品类） | 147 → **125** |

```
Product Controller direct Prisma = 0
R1 = 0
R3 = 0
R4 = 0
```

### Opportunity

`⏸ DEFERRED`（business design NOT FINAL）—— 本轮**零改动**。

---

## 5. PRODUCT BOUNDARY

### Product

```
Product = Product Master Data
```

已记录：产品分类（`crafts`/`audienceId`/`categoryId`）、产品属性（`material`/尺寸/克重/`colors`/`packaging`/`features`/`description`）、供货商务信息（`supplyModes`/`moq`/`leadTime`/`hsCode`/`defaultPrice`/`defaultCurrency`/`defaultTaxRate`）、可见性（`visibility`/`visibleUsers`/`ownerId`）、SKU / `productNo` 等**既有业务字段**。
**未在 baseline 中新增任何不存在的业务定义。**

### LeadItem

```
Lead Product Demand = LeadItem
Lead 1:N LeadItem
```

`LeadItem` 当前承载：`productId` · `productName` · `productDesc` · 尺寸（`sizeL/W/H`）· 工艺数组（`craftIds`）· 其他既有需求字段。
**未创建 `ProductDemand`，未创建新表。**

### ProductTask

```
schema exists       ✅（04-product.prisma:282；关系 Product.tasks）
code entrypoint = 0 ✅（server/src 仅 1 处注释命中；client/src 0 命中）
runtime rows    = 0 ✅（实测）
```

设计意图与 `Product.progress` JSON 存在历史关系（schema 注释「替代旧 sampleNo + progress(JSON)」），但**没有实际落地**。

```
NO SERVICE
NO OPERATION
NO REPOSITORY
```

**未制造假业务层。**

### ProductPrice

```
code entrypoint = 0 ✅
runtime usage   = 0 ✅（实测 0 行）
```

```
Declared but currently unused
```

**保持现状**（未新增 CRUD）。

### CustomerProduct

```
independent create/update entrypoint = none
runtime rows = 0
```

现有 `SalesOrderItem.customerProductId` **属于订单模块的既有字段**（可选透传）。
**本阶段未建立独立 CustomerProduct CRUD**，未改动订单模块。

### Product.stock

```
Product.stock = Business Fact / Inventory concern
```

当前事实：人工录入（create/update API）· Excel 导入 · **没有库存流水**（无扣减/加总/预留）· 订单/生产/采购**当前没有引用** · **V1 保留字段** · **本阶段不引入独立 Inventory Domain**（字段未删、未迁移）。

---

## 6. API / FRONTEND

| 项 | 结果 |
|---|---|
| **API changed** | ❌ **NO** |
| **Frontend changed** | ❌ **NO**（`client/**` 零改动） |
| **Lead Confirm API** | ❌ **未新增**（系统仍不存在 `POST /api/leads/:id/confirm`） |

```
Lead API     = unchanged
Customer API = unchanged
Product API  = unchanged
```

端点 / HTTP method / 请求字段 / 响应结构 / 状态码 / 错误文案 / 分页 / 筛选 / 排序 —— 逐项未改。

---

## 7. DATABASE

| 项 | 结果 |
|---|---|
| **Schema changed** | ❌ **NO**（`prisma/schema/**` 零改动） |
| **Migration** | ❌ **NONE**（未生成、未修改；`prisma/migrations/**` 零改动） |
| **DB structure changed** | ❌ **NO** |

R-4 **是纯代码架构拆层**。
迁移状态：**18 migrations 全部已应用（up to date）**；`prisma generate` 与 schema 同步。
运行时验证临时写入的测试数据（统一前缀）**全部清理，残留 = 0**（另产生少量 OperationLog 审计记录，属既有 `activityLogger` 预期留痕）。

---

## 8. COMMIT

| 项 | 值 |
|---|---|
| **Commit** | ✅ **DONE** |
| **Message** | `refactor: freeze lead customer product layering baseline` |
| **hash** | `c94319724b2b4c795652aedd63138e249b8a708b`（短：`c943197`） |

**Commit 前门（§11）**：verify PASS · layering expected（26 / 21%）· R1=R3=R4=0 · `git diff --cached --check` 无 whitespace error · staged 范围正确。

```
19 files changed, 3048 insertions(+), 1177 deletions(-)
```

**staged 文件（19）**

| 类型 | 文件 |
|---|---|
| Product Controller（3） | `product.controller.ts` · `productGroup.controller.ts` · `productTaxonomy.controller.ts` |
| Business（3） | `product.service.ts` · `productGroup.service.ts` · `productTaxonomy.service.ts` |
| Operation（2 + index） | `product.operations.ts` · `productGroup.operations.ts` · `operations/index.ts` |
| Data（3 新增 + 2 扩展 + index） | `productGroup.repository.ts` · `productTaxonomy.repository.ts` · `certificate.repository.ts` · `product.repository.ts` · `user.repository.ts` · `repositories/index.ts` |
| Business index | `services/index.ts` |
| baseline / documentation | `docs/backend-refactor-baseline.md` · `YSEM-R3.1-Backend基线冻结报告.md` · `YSEM-R4-Product-Layering报告.md` |

提交后 `git status --short` = **空（clean）**。

---

## 9. PUSH

| 项 | 结果 |
|---|---|
| **Push** | ✅ **PASS** |
| 推送内容 | `1210c7e..c943197  master -> master`（快进，**非 force**） |
| remote | `git@github.com:wx-wan/ysem.git` |
| **HEAD = origin/master** | ✅ **YES**（两侧均为 `c94319724b2b4c795652aedd63138e249b8a708b`） |
| **Working tree** | ✅ **CLEAN**（`git status --short` 为空） |
| `git branch -vv` | `* master c943197 [origin/master]`（无 `ahead` 标记，已同步） |
| 提交后复跑门禁 | `npm run verify` exit 0 · layering 26 / 21% |

---

## 10. STOP

```
R-4.1 completed.
No R-5 executed.
No Opportunity changes.
```

同时确认本轮**未**：

- 拆其他模块（26 个 layering violations **保持原样，未继续消灭**）
- 修改 Opportunity（`sales.controller.ts` / `05-opportunity.prisma` 零改动）
- 修改前端（`client/**` 零改动）
- 修改 Prisma schema / 生成 migration / 变更数据库结构
- 新增 Lead Confirm API
- 为 ProductTask / ProductPrice / CustomerProduct 制造假业务层
- 删除任何既有字段

**Backend Layering Baseline（Lead + Customer + Product）= FROZEN。**

> 说明：本报告文件在 commit/push **之后**生成，因此当前工作树较「CLEAN」多出 1 个未跟踪文件
> `YSEM-R4.1-后端分层基线冻结报告.md`（§13 报告交付物，与已随 `c943197` 提交的 2 份同性质报告等价）。
> §9 的 CLEAN 与 HEAD=origin/master 均为**验证时刻的真实结果**；如需完全归零，可授权一次 follow-up commit。

**下一步：回到 Opportunity 的业务设计。等待指令，不自动开始下一轮。**
