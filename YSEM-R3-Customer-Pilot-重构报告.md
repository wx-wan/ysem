# Round R-3 · Customer Pilot · Refactor Report

> 本轮为 **Customer 四层分层**（拆架构，不重新设计 Customer 业务）。
> 未 commit、未 push。未修改 Frontend / API Contract / Prisma schema / migration / Lead / Opportunity / Product。

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| **HEAD** | `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`（与 R-2 结束时一致，**未变化**） |
| **BRANCH** | `master` |
| **WORKTREE** | R-2 改动完好保留（未提交 = 预期状态）：`M package.json`、`M prisma/schema/03-customer.prisma`、`M src/controllers/lead.controller.ts`、`M src/middleware/errorHandler.ts` + R-1/R-2 新增分层文件与 7 份报告。**未执行** reset / clean / checkout / stash / commit |
| **verify** | ✅ PASS（exit 0；`prisma validate` 🚀 / `prisma generate` v5.22.0 / `tsc --noEmit` **0 error**） |
| **layering** | 违规 **30**（全为 `R2-CONTROLLER-PRISMA`）；去 Prisma 化进度 **9%**；文件 106 |

基线门结论：与 R-2 结束时完全一致 → 正常开工。

---

## 2. CUSTOMER CURRENT STATE

### 2.1 Controller

`server/src/controllers/customer.controller.ts`，**1661 行**，导出 **17 个 handler**（对应 18 条路由）：

| # | 路由 | handler | 职责 |
|---|---|---|---|
| 1 | `GET /api/customers/my` | `listMy` | 私海列表 + 统计 + 子筛选计数 + 全量聚合 + enrichment（最重） |
| 2 | `GET /api/customers/public` | `listPublic` | 公海列表 |
| 3 | `GET /api/customers/ownership` | `checkOwnership` | 线索表单去重（跨全员，不套 scope） |
| 4 | `GET /api/customers/options` | `listOptions` | 下拉选项 |
| 5 | `GET /api/customers/all` | `listAll` | 管理员视图 + 业务员分组 + 全库统计 |
| 6 | `GET /api/customers/:id` | `getById` | 详情（含 salesOrders / opportunities / leads） |
| 7 | `POST /api/customers` | `create` | 创建（去重 409 / 归属授权 / 渠道契约 / 编号事务） |
| 8 | `PUT /api/customers/:id` | `update` | 更新 |
| 9 | `DELETE /api/customers/:id` | `remove` | 删除 |
| 10 | `POST /api/customers/:id/claim` | `claim` | 公海 → 私海 |
| 11 | `POST /api/customers/:id/release` | `release` | 私海 → 公海 |
| 12 | `POST /api/customers/:id/transfer` | `transfer` | 转交 |
| 13 | `POST /api/customers/import` | `importExcel` | Excel 逐行导入（多部分上传） |
| 14 | `GET /api/customers/countries` | `getCountries` | 国家 distinct |
| 15 | `PATCH /api/customers/:id/tags` | `updateTags` | 标签更新 |
| 16 | `GET /api/customers/report` | `getReportStats` | 报表统计（漏斗/转化率） |
| 17 | `GET /api/customers/:id/logs` | `getCustomerLogs` | 操作记录 |

### 2.2 Prisma access **before**

`customer.controller.ts` 内 **71 处 `prisma.*`**：

| 模型 | 调用点 | 模型 | 调用点 |
|---|---|---|---|
| `customer` | 44 | `user` | 4 |
| `salesOrder` | 10 | `channel` | 2 |
| `opportunity` | 7 | `sampleOrder` | 1 |
| `$transaction` | 2 | `operationLog` | 1 |

### 2.3 Business logic locations（迁移前）

| 层（现状） | 内容 |
|---|---|
| Controller 内联 DTO | `customerCreateSchema` / `customerUpdateSchema` / `customerImportSchema` / `tagsField` / `coverImageField` / `dateField` |
| Controller 内联业务规则 | 创建去重 409、归属授权（存在+ACTIVE+scope）、actor 门（owner\|admin）、公海语义、渠道契约 `shop.parentId === channelId`、`coverImage` 归一、`firstOrderAt` 别名兼容、`source` 固定值 |
| Controller 内联跨表流程 | 列表 enrichment（order/pipeline groupBy）、意向派生装配、统计/子筛选/报表聚合、Excel 逐行事务导入 |
| Controller 内联审计 | 7 处 `activityLogger.log`（CREATED / UPDATED / CLAIM / RELEASE / TRANSFERRED） |
| **既有独立 util（未在 Controller）** | `utils/customerIntent.ts`（**意向派生规则本体**：`deriveCustomerIntentLevel(s)` / `withCustomerIntent`）、`utils/pipelineStage.ts`（阶段派生）、`utils/scope.ts`（dataScope / 公海 / 可见性） |

### 2.4 创建路径 / 更新路径 / Lead → Customer 路径

| 项 | 取证结论 |
|---|---|
| **创建入口** | **仅 1 个**：`POST /api/customers`（`create`）。另有 **Excel 导入**（`POST /api/customers/import`，逐行创建，`ownerId=null` 默认进公海）。**无其它独立创建入口** |
| **创建的业务含义** | 服务端只提供「建档」能力，不承担「客户获取流程」。实际由 **前端编排**驱动：`LeadFormModal` → `POST /api/customers` → `PUT /api/leads/:id { customerId }` |
| **更新路径** | `PUT /api/customers/:id`（单表单次 update，**原本就没有事务**）+ `PATCH /:id/tags` |
| **Lead → Customer** | **不在后端**（由前端编排，见上）。R-3 **未改动该路径**：`routes/lead.routes.ts`、`lead.service.ts`、`lead.controller.ts` 本轮 mtime 无变化 |

---

## 3. ARCHITECTURE

| 层 | 落地文件 | 行数 | 职责 |
|---|---|---|---|
| **Controller** | `src/controllers/customer.controller.ts` | **330**（原 1661） | HTTP、参数解析、zod DTO 校验、auth context 组装、响应格式化、错误映射 |
| **Business** | `src/services/customer.service.ts` | **1082** | 客户业务规则、状态规则、意向派生装配、Lead→Customer 语义、channel/shop 不变量、权限感知决策、审计留痕 |
| **Operation** | `src/operations/customer.operations.ts` | **388** | 多仓储组合（统计/聚合/分页/enrichment）、跨表事务编排（创建 / 逐行导入） |
| **Data** | `repositories/customer.repository.ts` / `salesOrder.repository.ts` / `opportunity.repository.ts` / `sampleOrder.repository.ts` + 复用 `channel` / `user` / `operationLog` | **233**（4 新文件） | 纯数据访问 |
| **Prisma** | `src/lib/prisma.ts` | — | 唯一实例 |

### Dependency

```
Controller (330 行)
    │  zod 校验 → buildActorContext(req) → customerService.*
    ↓
Business  services/customer.service.ts (1082 行)
    │  业务规则/授权/意向派生/审计 → operations 调用 / repositories 直读
    ↓
Operation operations/customer.operations.ts (388 行)
    │  多仓储组合 + runInTransaction（创建 / 逐行导入）
    ↓
Data      repositories/{customer,salesOrder,opportunity,sampleOrder,channel,user,operationLog}.repository.ts
    │  唯一 Prisma 访问点
    ↓
Prisma / PostgreSQL
```

依赖方向验证（`lint:layering` 自动判定）：**R1-UPWARD = 0 · R3-SHARED-BUSINESS = 0 · R4-HTTP-IN-DOMAIN = 0**；`$transaction` 仅出现在 Operation 层。

---

## 4. FILES CHANGED

### 修改（1）
- `server/src/controllers/customer.controller.ts` — **1661 → 330 行**（薄 Controller；17 个导出名保持与路由一致，`routes/customer.routes.ts` **零改动**）

### 新增（6）
- `server/src/services/customer.service.ts`（Business）
- `server/src/operations/customer.operations.ts`（Operation）
- `server/src/repositories/customer.repository.ts`（Data）
- `server/src/repositories/salesOrder.repository.ts`（Data，仅 Customer 读模型所需的只读聚合）
- `server/src/repositories/opportunity.repository.ts`（Data，同上）
- `server/src/repositories/sampleOrder.repository.ts`（Data，同上，仅 1 个 count）

### 共享基础设施最小调整（1，符合 §3 允许项）
- `server/src/repositories/user.repository.ts` — **纯新增 1 个方法** `findActiveAssignees()`（管理员客户页业务员列表）
  - `shared infrastructure:` repositories/user.repository.ts（R-2 为 Lead 建立）
  - `reason:` Customer 管理员视图需要「ACTIVE 非 admin 用户 + 客户数/重点数」
  - `impact on Lead:` **零影响**（原有 `findScopedById` / `findScopedTransferTarget` 签名与实现未动；仅追加方法）

### 层入口（必要 exports/index）
- `server/src/repositories/index.ts`、`server/src/operations/index.ts`、`server/src/services/index.ts` — 追加 R-3 导出

### 明确**未**改动
`routes/**`（含 `customer.routes.ts`）· `lead.controller.ts` / `lead.service.ts` / `lead.operations.ts` / `lead.repository.ts`（mtime 仍为 R-2 的 12:39，本轮零触碰）· `sales.controller.ts` / `product.controller.ts` · `client/**` · `prisma/schema/**` · `prisma/migrations/**`

---

## 5. BUSINESS PRESERVATION

| 项 | 结果 | 证据 |
|---|---|---|
| **Customer.source** | **PASS（无新写入）** | 新 Business 层仅逐字沿用既有 **2 个写入点**（`create` → `'MANUAL'`；`importExcel` → `'EXCEL'`），**未新增任何写入规则**、未新增 API 字段、未改 DTO（`source` 仍不在 create/update schema 中）。运行时 `Customer.source` 分布仍为 `MANUAL×2`。**旧规则既未扩展也未恢复** |
| **Customer.channelId** | **PASS** | 语义仍为「首次获客渠道」；写入路径（sourceKey 拆分 → 显式 → 保留原值）逐字沿用；运行时核验 `Customer.channelId = 请求渠道` |
| **Customer.shopId** | **PASS** | 同上（「首次获客店铺」）；运行时核验通过 |
| **shop ∈ channel** | **PASS** | 服务端校验保留（`channelRepository` 复用 R-2 的 `findStatusById` / `findStatusWithParentById`，**未实现第二套**）；运行时**负例** → `DomainValidationError: 来源平台不属于所选来源渠道` |
| **intentLevel** | **PASS** | 派生依据仍为「关联 Opportunity 中的最高 `Opportunity.intentLevel`」（`utils/customerIntent.ts` 原样调用，**未改业务定义、未重新引入 `isKeyAccount`、未新增第二套计算**）；`isKeyAccount` 仅作为**筛选/标记**维度（类型筛选 `key` 与释放时清零），未参与意向派生。运行时：详情/列表**全量** `intentLevel === deriveCustomerIntentLevel(opportunities)` 一致；新建客户 `intentLevel=null`（无商机，确定性结果） |
| **coverImage** | **PASS** | 语义与字段名保持「客户名片」：`normalizeCoverImage`（`coverImage` 优先、`images` 兼容、数组取首个非空）逐字搬迁；**未重命名**为 avatar/logo/profileImage；运行时按 `/api/uploads/...` 原样写入 |
| **Lead → Customer** | **UNCHANGED** | 该路径由**前端编排**；R-3 未改 `routes/lead.routes.ts`、`lead.service.ts`、`lead.controller.ts`（mtime 证据见 §4）。**未把它改造成 `LeadService.confirm() → CustomerService.create()`** |
| **Opportunity → Customer reverse overwrite** | **NOT FOUND** | 代码层面：Customer 模块**从不读取** `Opportunity.channelId/shopId`（`opportunity.repository.ts` 仅暴露 estimatedAmount / intentLevel / (id,leadId) 只读投影，**无 channel/shop 字段**）。运行时：测试客户创建→更新→释放→认领全程 `Customer.channelId/shopId` 未被改写 |
| **Contact/contactMethods** | **PASS** | 双轨**均保留、未合并、未新增 migration**：`contactMethods`（Json，`z.any()` 既有宽松校验）+ scalar `contactName`/`position`/`email`/`phone`/`wechat`。运行时 `contactMethods` 写入与 scalar `contactName`/`wechat` 更新均成功 |
| **dataScope** | **PASS** | 权限系统**未重新设计**；既有三档 `ALL/DEPT/SELF` 与公海语义（`includePublicSea` / `publicSeaScope`）原样复用。`scope` 由 Controller 以闭包注入，Data Layer **不含**「是否管理员」判断。运行时：`listMy` / `listAll` / `listOptions` / `getById` 全部经 scope 路径正常返回 |

---

## 6. API / FRONTEND

**API changed: NO**

| 项 | 状态 |
|---|---|
| endpoint path（18 条） | ✅ 未变（`routes/customer.routes.ts` **零改动**） |
| HTTP method | ✅ 未变 |
| request body | ✅ 未变（zod schema 逐字搬迁；`sourceKey` / `images` / `firstOrderDate` 等 legacy 兼容入参全部保留） |
| response shape | ✅ 未变（`listMy` 的 `stats` / `noOrderBreakdown` / `doneBreakdown` / `estimatedBreakdown` / `contractBreakdown` / `ownerStats` / `publicCount` 等字段全保留；`getById` 的 salesOrders/opportunities/leads 投影逐字保留） |
| 错误码与文案 | ✅ 未变（`400/404/409` 及「客户不存在」「客户已存在（公司名称重复）：X」「来源平台不属于所选来源渠道」「业务归属人不存在或无权限指派」「目标用户不存在或已停用」「该客户已被认领」「该客户已在公海」「请选择新负责人」「companyName required」「请上传文件」全部逐字保留） |
| 特殊契约 | ✅ 保留：`getCustomerLogs` 客户不可见时返回 **200 + `{code:'NOT_FOUND'}`**（不是 404）；`checkOwnership` 未命中返回 **200 + `{code:'NOT_FOUND'}`** |
| 分页结构 | ✅ 未变 |
| 成功状态码 | ✅ 保留既有差异：`create` 用 `success`（HTTP 200 + `"创建成功"`），与 Lead 的 `created`（201）不同 —— 未"顺手统一" |

> 错误处理说明：Customer 既有实现用 `next(err)`，与 R-2 Lead（自建 `fail` 映射）不同。
> 本轮**保留 `next(err)`**：Business 抛 `DomainError` 后经既有 `middleware/errorHandler` 的
> DomainError 分支输出 `{code, message}` + 同状态码，**与既有 `error(res, msg, code)` 的响应体逐字相同**。
> `ZodError` 仍由 Controller 以既有 `；` 拼接文案返回 400。

**Frontend changed: NO** — `client/**` 零改动。

---

## 7. VALIDATION

| 项 | 结果 |
|---|---|
| **npm run verify** | ✅ **PASS**（exit 0；`tsc --noEmit` **0 error**） |
| **layering BEFORE** | 违规 **30**（全 `R2-CONTROLLER-PRISMA`）；进度 **9%**；文件 106 |
| **layering AFTER** | 违规 **29**；进度 **12%**；文件 111（`services=3 operations=3 repositories=14`） |
| **Customer Controller direct Prisma BEFORE** | **71 处 `prisma.*`**（44 customer / 10 salesOrder / 7 opportunity / 4 user / 2 channel / 1 sampleOrder / 1 operationLog / 2 `$transaction`） |
| **Customer Controller direct Prisma AFTER** | **0**（`grep -lc "lib/prisma"` = 0；唯一 `prisma` 字样为第 3 行 `import { CustomerLevel } from "@prisma/client"` 的**类型导入**，非实例访问） |
| **Reverse dependencies R1 / R3 / R4** | **0 / 0 / 0**（唯一违规规则为 `R2-CONTROLLER-PRISMA`，Lead 与 Customer 均已从清单出列） |
| IDE 诊断（`read_lints`） | ✅ 全部新增/修改文件 **0 diagnostics** |

---

## 8. RUNTIME

**总体：PASS**（20 项断言全通过；2 项因库中无数据无法验证，已如实标注）

执行环境：本地开发库 `localhost:5432/ysem`；脚本置于 `/tmp`（**未进入仓库**），已删除；`ACTOR = admin / role=admin`。

| # | 覆盖项 | 结果 | 详情 |
|---|---|---|---|
| ① | **List（listMy）** | ✅ PASS | rows=2 total=2；响应字段 `stats / noOrderBreakdown / doneBreakdown / estimatedBreakdown / contractBreakdown / estimatedAmount / totalContractAmount` 全部存在 |
| ② | **Detail + relation reads** | ✅ PASS | `salesOrders=0 opportunities=1 leads=1 owner=true`；`intentLevel` 派生一致 |
| ③ | **列表侧不变量** | ✅ PASS | 全量 `intentLevel` 派生一致；`coverImage` 字段名与语义未变；`contactMethods` 与 scalar 双轨均在 |
| ④ | **其它读路径** | ✅ PASS | `listOptions`(2) / `getCountries`(2) / `getReportStats`(12 键完整) / `getCustomerLogs`(`list(1)`) / `checkOwnership`(`{code:'NOT_FOUND'}`) |
| ⑤ | **dataScope 路径** | ✅ PASS | `listAll` total=2 ownerStats=1 publicCount=0 |
| ⑥ | **Create（当前创建路径）** | ✅ PASS | `customerNo=CUS-20260928-0001`；`channelId`/`shopId` 正确落库；`coverImage` 原样写入；新建 `intentLevel=null`；`tags` 落 PG 数组 |
| ⑦ | **Update** | ✅ PASS | `notes` / `contactName`（scalar） / `wechat`（legacy scalar）均更新成功 |
| ⑧ | **shop ∈ channel（负例）** | ✅ PASS | 非法组合被拒 → `DomainValidationError: 来源平台不属于所选来源渠道` |
| ⑨ | **Opportunity 反向覆盖** | ✅ PASS（代码 + 运行时） | 测试客户全程 `channelId/shopId` 未变；`opportunity.repository` **无 channel/shop 读取能力** |
| ⑩ | **公海语义 + 清理** | ✅ PASS | `release → ownerId=null`；`claim → 归属认领人`；测试客户已删除，**0 残留** |
| ⑪ | intentLevel **非 null 分支** | ⚪ **NOT VERIFIED** | 原因：本地库 `opportunity` 表中**不存在 intentLevel 非 null 的商机分组**（`非 null 意向商机分组 = 0`），无法用现有数据验证「多商机取最高」的排序分支。已通过结构一致性（派生值 === util 输出）与代码路径验证，但**不伪造 PASS** |

**运行时数据的诚实披露**：

| 项 | 残留 | 说明 |
|---|---|---|
| `Customer` 测试行 | **0** | 已删除；总数回到 2 |
| `OperationLog` | **3 行**（CREATE / UPDATE / CLAIM / RELEASE 等 CUSTOMER 事件） | 审计日志按设计保留，无删除入口 |
| `NumberSequence`（CUS） | `currentValue` → **1**、period `20260928` | 编号已消费，**按设计不回滚** |
| `Customer.source` | 非空行仍为 2（均 `MANUAL`） | 本轮未新增写入规则 |

---

## 9. DIFF SCOPE

| 项 | 结果 |
|---|---|
| **Unexpected files** | **NONE** |
| **Schema changed** | **NO**（工作树中 `03-customer.prisma` 的 `+6` 行为 **R-1.1 遗留**） |
| **Migration changed** | **NO** |
| **Frontend changed** | **NO** |
| **API changed** | **NO** |

`git status --short`（tracked 改动，含前几轮遗留）：

```
 M server/package.json                       ← R-1/R-1.2
 M server/prisma/schema/03-customer.prisma   ← R-1.1
 M server/src/controllers/customer.controller.ts  ← 本轮（1661 → 330 行）
 M server/src/controllers/lead.controller.ts      ← R-2（本轮未触碰）
 M server/src/middleware/errorHandler.ts          ← R-1
```

**mtime 证据（本轮当前时间 13:01）**：

| 文件 | mtime | 归属 |
|---|---|---|
| `customer.controller.ts` | 12:58 | **R-3** |
| `customer.operations.ts` | 12:59 | **R-3** |
| `customer.service.ts` | 13:00 | **R-3** |
| `customer.repository.ts` / `user.repository.ts` | 12:56 | **R-3** |
| `lead.controller.ts` / `lead.service.ts` | 12:39 | R-2（**本轮零触碰**） |
| `routes/customer.routes.ts` | 16:07（前一日） | 原始（**零改动**） |

允许清单核对：Customer Controller ✅ / Customer Business ✅ / Customer Operation ✅ / Customer Repository ✅ / 必要 shared infrastructure（`user.repository.ts` 纯新增，已报告）✅ / 必要 exports-index ✅。

---

## 10. RESULT

**R-3: PASS**

**Blocking issue: NONE**

成功标准逐项（§28）：

| # | 标准 | 结果 |
|---|---|---|
| [x] | Customer Controller 不再直接 Prisma | ✅ 0 处（71 → 0） |
| [x] | Customer Business 建立 | ✅ `services/customer.service.ts`（1082 行） |
| [x] | Customer Operation 建立 | ✅ `operations/customer.operations.ts`（388 行） |
| [x] | Customer Data Layer 建立 | ✅ 4 个新仓储 + 3 个既有仓储复用 |
| [x] | Controller → Business → Operation → Data → Prisma | ✅ `$transaction` 仅在 Operation |
| [x] | 无反向依赖 | ✅ R1/R3/R4 = 0 |
| [x] | API Contract 不变 | ✅ 见 §6 |
| [x] | Frontend 不变 | ✅ `client/**` 零改动 |
| [x] | Customer.source 没有新业务写入 | ✅ 沿用既有 2 个写入点，未新增规则 |
| [x] | Customer.channelId/shopId 语义保持 | ✅ |
| [x] | shopId ∈ channelId | ✅ 服务端校验 + 运行时负例 |
| [x] | intentLevel 规则保持 | ✅ 最高关联商机意向；非 null 分支数据不足（已标注） |
| [x] | coverImage 语义保持 | ✅ 「客户名片」，未重命名 |
| [x] | Lead → Customer 当前交互保持 | ✅ UNCHANGED（mtime 证据） |
| [x] | Opportunity 不反向覆盖 Customer 首获字段 | ✅ NOT FOUND（代码 + 运行时） |
| [x] | npm run verify PASS | ✅ 0 error |
| [x] | layering 无新增违规 | ✅ 30 → **29**（净减 1，Customer 出列） |
| [x] | runtime verification 有真实结果 | ✅ 20 PASS / 1 NOT VERIFIED（如实） |
| [x] | diff scope PASS | ✅ 见 §9 |
| [x] | 未 commit / 未 push | ✅ |

---

## 11. COMMIT

**Commit: NOT DONE**
**Push: NOT DONE**

HEAD 仍为 `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`；`origin/main` 未做任何写入。

---

## 12. 边界报告（停在边界，未扩大）

### B1 · Client「创建」承担 Lead → Customer 关键动作（**特别判断项**）

```
Dependency:      Lead → Customer 业务流
Reason:          服务端 POST /api/customers 只提供「建档」；真实业务动作由前端编排：
                 LeadFormModal → POST /api/customers（带 sourceKey）→ PUT /api/leads/:id {customerId}
Frontend dependency: ✅ 强依赖（LeadFormModal 依赖 create 的响应取得 customerId 后再回写线索）
本轮处理:        保持行为不变。未把它包装成新的 Confirm 流程，未新增 Confirm API，
                 未改前端编排。Customer Business 层只承担「建档」本身的既有语义。
```

### B2 · `Customer.source` 废弃节奏

```
现状:            2 个既有写入点（create → 'MANUAL'；importExcel → 'EXCEL'），0 个读取/过滤/统计/展示使用
本轮处理:        逐字沿用既有写入（保持 API 与存储不变），**未新增规则、未删除字段、未改 DTO**
未决:            彻底删除（先停写 → 观察 → drop）需要一个会改变「新建客户 source 值」的独立决策
```

### B3 · `splitSourceKey` 仍在 Lead 与 Customer 各有一份实现

```
file:            services/lead.service.ts（R-2 搬迁的副本）、services/customer.service.ts（本轮搬迁的副本）
Reason:          §3 禁止在 R-3 重构 Lead，故未抽共享 util（抽 B6 需要改动 lead.service.ts）
本轮处理:        保持两份（纯函数、实现一致）。建议在专门的「共享 util 归并」轮次处理
```

### B4 · `withProductVisibility` 快照投影（既有缺陷，Customer 无此路径）

```
Lead / Quotation / Sales / SampleOrder 的读侧会把不可见产品的快照 productName 置 null（R-0/R-2 已记录）
Customer：无此路径（客户列表/详情不投影产品快照）→ 本轮不涉
```

### B5 · `opportunity.repository` 为只读读模型

```
范围:            仅有 estimatedAmount / intentLevel / (id,leadId) 投影，**无任何写方法、无 channel/shop 读取**
理由:            Customer 领域只需读；不迁移 Opportunity 模块自身 CRUD（§27 禁止重构 Opportunity）
后续:            Opportunity / Product 模块轮次可在此基础上扩展
```

### B6 · `listAll` 的 `getCustomerStats(ownerId)` 分支

```
现状:            getCustomerStats 保留「无 ownerId ⇒ 管理员视图（排除公海）」分支，
                 但既有调用点 `getCustomerStats(userId)` 中 userId 恒存在 ⇒ 该分支实际不可达。
                 R-3 **逐字保留了该分支语义**（Business 中 statsWhere/statsTotalWhere 两函数），
                 未"顺手清理"，以免改变任何既有行为。
```

---

## 13. 后续建议（不实施）

| # | 建议 | 依赖 |
|---|---|---|
| 1 | 若需把 Lead → Customer 收回服务端：作为**独立业务/API 立项**（需改前端 + 新增端点） | B1 |
| 2 | `Customer.source` 彻底废弃：先停写 → 观察一个版本 → drop（需独立决策） | B2 |
| 3 | 共享 util 归并（`splitSourceKey` 等），需同时改动 Lead 与 Customer | B3 |
| 4 | 统一快照不可变口径（移除 `nameField` 投影改写），涉及 4 个模块 | B4 |
| 5 | 为 `opportunity` / `salesOrder` / `sampleOrder` 仓储补齐各自模块的完整 CRUD（模块轮次） | B5 |
| 6 | **下一个模块建议**：`opportunity`（读模型已部分就绪、链路清晰）或 `product`（独立性强）—— 由你根据实际结果决定 R-4，本轮不提前锁死 | — |

---

**本轮结束。未 commit、未 push。R-4 方向未锁死。**
