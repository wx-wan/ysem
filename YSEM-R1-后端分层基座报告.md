# Round R-1 · Backend Layering Foundation Report

> 本轮为**基础架构轮**：只建立分层边界、依赖方向、最小基座接口，不迁移业务模块、不改业务规则。
> **未 commit、未 push。** 未修改 Prisma schema、未生成 migration、未改数据库、未改 API contract、未改前端。

---

## 0. 紧急发现（BLOCKER，既有缺陷，非本轮引入）

> **`HEAD` 的 Prisma schema 当前无法通过校验，Prisma Client 无法重新生成。**

### 证据

```
$ npx prisma validate
Error code: P1012
error: Error validating field `channel` in model `Opportunity`: The relation field `channel`
       on model `Opportunity` is missing an opposite relation field on the model `Channel`.
--> prisma/schema/05-opportunity.prisma:43
error: Error validating field `shop` in model `Opportunity`: The relation field `shop`
       on model `Opportunity` is missing an opposite relation field on the model `Channel`.
--> prisma/schema/05-opportunity.prisma:45
Validation Error Count: 2
```

### 根因链（已逐步取证）

| 步 | 事实 | 证据 |
|---|---|---|
| 1 | 提交 `bfa45fc` 给 `Opportunity` 加了 `channel`/`shop` 两条**具名关系** `"OpportunityChannel"` / `"OpportunityShop"` | `05-opportunity.prisma:41-45` |
| 2 | 但**未**在 `Channel` 上补对应反向 relation | `03-customer.prisma:166-169` 只有 `leads` / `leadShops` / `customers` / `customerShops`，**无** `opportunities` / `opportunityShops` |
| 3 | → `prisma validate` / `prisma generate` 均失败（P1012，2 处） | 上方输出 |
| 4 | → 本地 `node_modules/.prisma/client` **停留在 Sep 27 18:33**，而 schema 改动时间为 **Sep 28 10:59**；生成物中 `OpportunityChannel` 出现 **0** 次 | 文件 mtime + `grep -c` |
| 5 | → `tsc` 因**过期生成物**报错（唯一 1 条，见 §7） | `sales.controller.ts(412,11) TS2353` |

### 影响评估

- **构建**：`npm run build`（= `tsc`）在当前工作副本**失败**。
- **CI/生产**：`Dockerfile.server:10` 在 `npm run build` 之前执行 `npx prisma generate` → 该步骤**同样会失败**，即**构建流水线会被阻断**。
- **运行时（未用真实数据库复核，属推断）**：当前过期生成物不含 `Opportunity.channelId`，`prisma.opportunity.create({ data: { channelId } })` 预期抛 `PrismaClientValidationError: Unknown argument 'channelId'`。而 `convertLead.ts:166-167` 在**线索转商机时总会传** `channelId`/`shopId` → 该路径预期失败。
  > 说明：本轮**未启动服务、未连接数据库**，故此项为基于生成物与调用点的推断，建议修复后复核。
- **与上一轮审计的呼应**：上一轮 §11-3 已记录「Opportunity 的两条 relation 未在 `Channel` 上声明反向（不对称）」——当时判定为「不对称」，实际后果比判定更严重：**schema 不可编译**。

### 本轮处理

**未修复**（Round R-1 明确禁止「修改 Prisma schema」/「创建 migration」）。已列入 §10 DECISION REQUIRED 第 1 项。

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| HEAD | `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c` |
| origin/master | `66ebebec42e1937482f6753ff92703310cb49d2f` |
| branch | `master`（**本地领先 origin/master 1 个提交**） |
| 领先提交 | `bfa45fc refactor: 商机列表/详情/筛选栏全面重构为线索式（移除看板）` — 14 files, +783 / −868 |
| working tree（开工时） | 仅有上一轮 3 个未跟踪审计文档；**无用户未提交的代码改动**（在途改动已于 `bfa45fc` 提交） |
| working tree（收工时） | 2 modified + 7 new（见 §3）+ 上一轮 3 个 md |

**未覆盖任何既有改动**：开工前 `git status --short` 仅显示 3 个 `??` 文档，无 `M`。

---

## 2. CURRENT ARCHITECTURE

### 2.1 四层现状总览

| 层 | 现状 | 文件数 |
|---|---|---|
| **Controller** | 存在（33 个），但**同时承担了 Controller / Business / Operation / Data / 校验解析 五种职责** | 33 |
| **Business（services）** | ❌ **不存在独立层**。业务规则全部内联在 controller；部分领域派生规则寄居 `utils/` | 0 → 本轮建 1（仅契约） |
| **Operation（operations）** | ❌ **不存在独立层**。事务编排散落在 controller 的 `prisma.$transaction` 回调内 | 0 → 本轮建 1（仅契约） |
| **Data（repositories）** | ❌ **不存在独立层**。`lib/prisma.ts` 是唯一 Prisma 实例 | 0 → 本轮建 3（类型+事务+桶） |
| **Prisma** | ✅ 集中：`src/lib/prisma.ts` 单例，**无第二实例** | 1 |
| 其它 | `routes/` 32、`middleware/` 2、`utils/` 9、`lib/` 6、`scripts/` 4、组装根 3（app/index/swagger） | — |

`src/` 下**不存在** `services/` / `repositories/` / `operations/` / `modules/` / `schemas/` 目录（与任务假设一致，未做假设）。

### 2.2 实测依赖关系（Step 3 输出）

```
Controller ──(31/33 文件, 464 处调用)──────────────────────────► Prisma (lib/prisma.ts)
     │
     ├──(广泛)──► utils/  (scope, response, query, currency, pipelineStage, leadStatus, customerIntent, notify, deptTree)
     ├──(广泛)──► lib/    (activity-logger, numberSequence, skuCode, business-type, operation-diff)
     └──(接线)──► middleware/ (auth)
```

- **Controller → Prisma**：**31 / 33** 个 controller 文件 `import prisma from '../lib/prisma'`，共 **464** 处 `prisma.*` 调用点
  - 例外：`notify.controller.ts`、`upload.controller.ts`（0 处）
- **Controller → Repository / Service / Operation**：**0**（这三层此前不存在）
- **Service / Operation / Repository → 任何东西**：**0**（此前不存在）
- **反向依赖（lib / utils / middleware → 业务层）**：**0 处**（唯一疑似项 `utils/scope.ts → middleware/auth` 为 `import type`，仅类型引用，无运行时耦合）
- **Controller 内的非 Controller 职责**：
  - `z.object(...)` 内联 DTO：**28 / 33** 个 controller
  - `xlsx` 解析：4 个 controller（customer / lead / product / sales）
  - 巨型文件：`customer.controller.ts` 67KB / 71 处 prisma 调用点

### 2.3 `utils/` 与 `lib/` 中的层次错位（实测）

| 文件 | `prisma.*` 调用 | 实际所属层 |
|---|---|---|
| `utils/pipelineStage.ts` | 3 | **Business/Operation**（商机阶段派生，含批量查询） |
| `utils/leadStatus.ts` | 3 | **Business/Operation**（线索状态机推进 + 查询） |
| `utils/deptTree.ts` | 3 | **Data**（部门树加载） |
| `utils/notify.ts` | 3 | **Operation/Data**（通知落库） |
| `utils/customerIntent.ts` | 1（**注释中的示例，非调用**，已核实） | Business（纯内存派生，层次正确） |
| `utils/query.ts` | 0（`paginateList(delegate: any, …)`） | **Data**（分页查询，但 `delegate: any` 绕过类型安全） |
| `utils/scope.ts` | 0 | **Data 关注点**（查询条件构建）与 **HTTP 关注点**（`AuthRequest`）混合 |
| `lib/activity-logger.ts` | 1 | **Operation + Data**（写 OperationLog） |
| `lib/numberSequence.ts` | 3 | **Operation + Data**（编号分配，接收 `tx`） |
| `lib/skuCode.ts` | 1 | **Operation + Data**（SKU 生成，接收 `tx`） |

> 结论：**Data / Operation 层的能力事实上已经存在，但寄居在 `lib/` 与 `utils/` 中**——因此本轮采用「**复用 + 收敛入口**」而非「另建平行目录」（见 §5）。

---

## 3. CREATED / MODIFIED FILES

### 3.1 新增（7 个文件 / 5 个新路径）

| # | 文件 | 层 | 作用 |
|---|---|---|---|
| 1 | `server/src/repositories/types.ts` | Data | `DbClient`（事务内外通用）与 `TxClient`（必须处于事务）类型；纯类型、零运行时 |
| 2 | `server/src/repositories/transaction.ts` | Data | `runInTransaction(fn, options)` + `TransactionOptions`；包装既有 `prisma.$transaction` |
| 3 | `server/src/repositories/index.ts` | Data | 层入口（桶）+ 职责契约注释 |
| 4 | `server/src/lib/errors.ts` | 共享基础设施 | 领域错误契约：`DomainError` / `DomainValidationError`(400) / `DomainNotFoundError`(404) / `DomainForbiddenError`(403) / `DomainConflictError`(409) |
| 5 | `server/src/services/index.ts` | Business | 层入口（桶）+ 职责契约注释；再导出 `lib/errors` |
| 6 | `server/src/operations/index.ts` | Operation | 层入口 + `OperationContext`（`db` + `actor`）调用约定 |
| 7 | `server/src/scripts/check-layering.ts` | 工具 | 分层依赖检查器（报告 / `--strict` 两种模式） |

### 3.2 修改（2 个文件）

| # | 文件 | 改动 | 性质 |
|---|---|---|---|
| 1 | `server/src/middleware/errorHandler.ts` | +13 行：新增 `DomainError → HTTP 状态码` 映射分支；import 由 `../services/errors` 改为 `../lib/errors` | **纯新增分支**（既有 ZodError / P2002 / 500 路径不变） |
| 2 | `server/package.json` | +3 行：`lint:layering` / `lint:layering:strict` 两个脚本 | 纯新增 |

### 3.3 本轮内的自我修正（透明记录）

初版把错误契约放在 `services/errors.ts`，被自建检查器判定为 **`R3-SHARED-BUSINESS`（middleware → services 反向依赖）**。
已把该文件移至 **`lib/errors.ts`**（共享层），并删除 `services/errors.ts`。理由：该契约同时被 **HTTP 边界**与**领域层**使用，放 `services/` 必然造成共享层反向依赖业务层。
→ 现 `R3` 违规为 **0**，且未为此增加任何规则豁免。

---

## 4. LAYERING RULE

### 4.1 依赖方向（已冻结）

```
Controller            HTTP request/response、参数接收、DTO/schema 校验、
    │                 authentication context、permission/dataScope 接入、
    │                 HTTP 状态码、response formatting
    ↓                 ── 禁止：Prisma 查询、Prisma 增删改、复杂业务规则、
    │                        状态机、跨实体业务流程、数据库事务编排
Business (services)   业务规则、状态转换、跨实体业务流程、业务前置条件、
    │                 业务事务编排、领域级数据组合
    ↓                 ── 禁止：读 req/res、返回 HTTP Response、处理 status code、
    │                        依赖 Express 对象
Operation (operations) 多 Data 操作组合、可复用数据操作流程、查询组合、
    │                 事务中的操作编排、跨 Repository 访问
    ↓                 ── 禁止：决定业务政策
Data (repositories)   find / findMany / findUnique / count / create /
    │                 update / delete / aggregate + 明确查询组合
    ↓                 ── 禁止：业务状态判断、业务流程、HTTP、用户提示、业务政策
Prisma / PostgreSQL   唯一实例 src/lib/prisma.ts
```

### 4.2 检查器强制规则

| 规则 | 内容 | 当前命中 |
|---|---|---|
| `R1-UPWARD` | 业务层 import 只能向下或同级（`controllers(1) → services(2) → operations(3) → repositories(4)`） | **0** |
| `R2-CONTROLLER-PRISMA` | `controllers/`、`routes/` 不得 import `lib/prisma` | **31** |
| `R3-SHARED-BUSINESS` | `lib/`、`utils/`、`middleware/` 不得依赖业务层（`import type` 除外） | **0** |
| `R4-HTTP-IN-DOMAIN` | `services/`、`operations/`、`repositories/` 不得依赖 `express*` | **0** |

运行方式：

```bash
npm run lint:layering         # 报告模式（默认；始终退出 0，只记录迁移点）
npm run lint:layering:strict  # 严格模式（存在违规时退出 1，可用于后续 CI 门禁）
```

---

## 5. EXISTING INFRASTRUCTURE REUSED

> 原则：**先复用现有基础设施，再决定是否抽象。未重复创建任何第二套机制。**

| 设施 | 现有位置 | 本轮处理 |
|---|---|---|
| Prisma Client 单例 | `lib/prisma.ts`（单例 + 开发期 query 日志） | ✅ 复用。`repositories/transaction.ts` 直接包装它，**未新建实例** |
| 事务 | `prisma.$transaction` | ✅ 复用。`runInTransaction` **只收敛入口与客户端类型**，语义完全一致（无额外包装、无错误吞并） |
| 认证上下文 | `middleware/auth.ts` → `AuthRequest`（`userId` / `username` / `realName` / `roleCode` / `dataScope` / `userPermissions`） | ✅ 复用。`OperationContext.actor` 由 Controller 从 `req` 取值注入，**未新建上下文对象** |
| 权限（粗/细） | `authenticate` / `authorize(roles)` / `requirePerm(codes)` | ✅ 复用，本轮未改动 |
| dataScope | `utils/scope.ts`：`roleScope` / `publicSeaScope` / `includePublicSea` / `applyScope` / `isAdmin` | ✅ 复用，本轮未改动 |
| 产品可见性投影 | `utils/scope.ts`：`productVisibilityWhere` / `canReadProduct` / `projectProductRow(s)` | ✅ 复用，本轮未改动 |
| 分页 | `utils/query.ts` → `paginateList(delegate, where, options)` | ✅ 复用，本轮未改动（保留为后续 Data 层候选） |
| 错误处理 | `middleware/errorHandler.ts` | ✅ 复用 + **纯新增** `DomainError` 分支 |
| 响应格式 | `utils/response.ts`：`success` / `created` / `fail` / `error` | ✅ 复用，本轮未改动 |
| 审计日志（OperationLog） | `lib/activity-logger.ts`（**唯一合法落点**，禁止第二套） | ✅ 复用，本轮未改动、未包装 |
| 编号生成 | `lib/numberSequence.ts` → `getNextNumber(tx, code)` | ✅ 复用，本轮未改动 |
| SKU 生成 | `lib/skuCode.ts` → `buildSkuCode(tx, …)` / `withSkuRetry` | ✅ 复用，本轮未改动 |
| 变更 diff | `lib/operation-diff.ts` | ✅ 复用，本轮未改动 |
| 通知/SSE | `utils/notify.ts` | ✅ 复用，本轮未改动 |
| 业务类型常量 | `lib/business-type.ts` → `BUSINESS_TYPE` | ✅ 复用，本轮未改动 |
| 汇率换算 | `utils/currency.ts` | ✅ 复用，本轮未改动 |

**明确未创建的第二套**：PrismaClient、logger、error handler、pagination、dataScope、activity 表、队列。

---

## 6. ARCHITECTURAL VIOLATIONS FOUND

> 本轮**只记录迁移点**，不全部修复（R-1 明确要求）。共 **31 处机器可检违规 + 7 项结构性违规**。

### 6.1 机器可检违规（`check-layering` 输出）

**`R2-CONTROLLER-PRISMA`（31 处）** — 31 个 controller 直接 `import '../lib/prisma'`：

```
approvalConfig · approvalRecord · auth · certificate · channel · commTool · currency ·
customer · customerType · department · exchangeLog(exchange) · lead · operationLog ·
payment · permission · product · productGroup · productTaxonomy · productionOrder ·
profit · purchase · purchaseOrder · qualityInspection · quotation · role · sales ·
salesOrder · sampleOrder · shipment · unit · user
```

- 伴随 **464 处 `prisma.*` 调用点**
- 迁移进度指标（Controller 去 Prisma 化）：**6%**（33 个中已有 2 个不访问 Prisma）

**`R1-UPWARD`**：0 · **`R3-SHARED-BUSINESS`**：0 · **`R4-HTTP-IN-DOMAIN`**：0

### 6.2 结构性违规（检查器暂无法自动判定，需后续轮次）

| # | 违规 | 证据 |
|---|---|---|
| 1 | **Controller 单文件承载 5 层职责**（DTO 校验 + Prisma 访问 + 业务规则 + 事务编排 + 审计日志） | zod 内联 28/33；prisma 31/33；`xlsx` 4 个 |
| 2 | **Data 层能力寄居 `utils/query.ts`**，且 `delegate: any` 绕过类型安全 | `utils/query.ts:28` |
| 3 | **Business 规则寄居 `utils/`** | `utils/pipelineStage.ts`(3)、`utils/leadStatus.ts`(3) |
| 4 | **Operation + Data 能力寄居 `lib/`** | `lib/activity-logger.ts`(1)、`lib/numberSequence.ts`(3)、`lib/skuCode.ts`(1) |
| 5 | **跨关注点文件**：`utils/scope.ts` 同时含 HTTP 上下文（`AuthRequest` 类型）与查询条件构建 | `utils/scope.ts:1` |
| 6 | **Data 层能力寄居 `utils/`** | `utils/deptTree.ts`(3)、`utils/notify.ts`(3) |
| 7 | **巨型 controller** | `customer.controller.ts` 67KB / 71 处 prisma 调用点 |

### 6.3 边界澄清（**未发现**的违规）

- ❌ 未发现 Controller → Controller 的横向依赖
- ❌ 未发现 `lib` / `utils` / `middleware` 运行时依赖业务层
- ❌ 未发现第二个 Prisma 实例
- ❌ 未发现第二套日志 / 分页 / dataScope 机制

---

## 7. VALIDATION

### 7.1 TypeScript

```
$ npx tsc --noEmit
src/controllers/sales.controller.ts(412,11): error TS2353: Object literal may only specify
  known properties, and 'channelId' does not exist in type
  'Without<OpportunityCreateInput, OpportunityUncheckedCreateInput> & OpportunityUncheckedCreateInput'.
```

| 项 | 结果 |
|---|---|
| 错误总数 | **1**（仅上述 1 条） |
| 是否本轮引入 | ❌ **否**。根因见 §0 BLOCKER（schema 无效 → 生成物过期）；`sales.controller.ts` 本轮**未修改** |
| 本轮新增/修改的 9 个文件 | ✅ **0 error**（tsc 全量输出仅 1 条，均不在新文件） |
| IDE 诊断（`read_lints`） | ✅ 全部新增/修改文件 **0 diagnostics** |

### 7.2 Lint

| 项 | 结果 |
|---|---|
| `npm run lint`（`eslint src/`） | ❌ **不可用**：`eslint` **未安装**（`node_modules/.bin` 无该二进制），仓库**无 eslint 配置文件**。脚本存在但必然失败 —— 属**既有工具链缺口**，本轮未安装/未配置（不属本轮范围） |
| `npm run lint:layering` | ✅ 运行成功，输出 31 处违规 + 指标（**该脚本本身即为本轮新增并已实测**） |

### 7.3 Tests

| 项 | 结果 |
|---|---|
| 测试框架 / `test` 脚本 | ❌ 不存在（`package.json` 无 `test`） |
| 既有 `src/scripts/test-number-sequence*.ts` | 需数据库连接，**本轮未运行**（与本轮改动无关） |

### 7.4 本轮实际执行的验证（4 项）

| # | 验证 | 结果 |
|---|---|---|
| 1 | `npx tsc --noEmit` | ⚠️ 1 处**既有**错误（§7.1） |
| 2 | `npx tsx src/scripts/check-layering.ts` | ✅ 成功；31 处违规 + 指标输出正确 |
| 3 | **冒烟验证**（临时文件置于 `/tmp`，未进入仓库） | ✅ 全部通过：`DomainNotFoundError instanceof DomainError = true`；`name/httpStatus/code = DomainNotFoundError 404 404`；`400/403/409` 分别正确；中文 message 保留；`runInTransaction` 为 function；`DbClient`/`TxClient` 类型可用 |
| 4 | `npx prisma validate` / `npx prisma generate` | ❌ **失败 P1012**（§0） |

---

## 8. DIFF SCOPE

| 边界 | 状态 | 证据 |
|---|---|---|
| Prisma schema 修改 | ✅ **无** | `git diff --name-only \| grep prisma/` → 空 |
| Migration | ✅ **无新增** | 同上 |
| 数据库结构 | ✅ **无变更** | 未执行任何 DDL / `db push` / `migrate` |
| API contract | ✅ **无变更** | 未改任何 route / controller 的请求或响应结构；`DomainError` 分支仅在「抛出 DomainError」时生效，而当前**无任何代码抛它** → 既有响应完全不变 |
| Frontend | ✅ **无变更** | `git diff --name-only \| grep client/` → 空 |
| 业务规则 | ✅ **无变更** | 未改 Lead / Customer / Opportunity 规则、`Customer.source`、`channelId/shopId` 语义 |
| 既有代码删除 | ✅ **仅 1 处、纯本轮自建** | 删除本轮先建后移的 `services/errors.ts`（最终状态不存在，非既有代码） |

`git status --short`（收工）：

```
 M server/package.json
 M server/src/middleware/errorHandler.ts
?? server/src/lib/errors.ts
?? server/src/operations/
?? server/src/repositories/
?? server/src/scripts/check-layering.ts
?? server/src/services/
?? YSEM全域数据架构审计.md            ← 上一轮产物
?? YSEM决策冻结-渠道归属最终规则.md    ← 上一轮产物
?? YSEM架构决策冻结登记册.md          ← 上一轮产物
```

`git diff --stat`（tracked）：`2 files changed, 16 insertions(+), 1 deletion(-)`

---

## 9. COMMIT STATUS

**本轮未 commit、未 push。**

- HEAD 仍为 `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`
- 所有改动（含 §0 的 BLOCKER）均留在工作树，等待人工裁决
- 未对 `origin/master`（`66ebebec`）做任何写入

---

## 10. DECISION REQUIRED

> 仅列真正需要用户决定的问题。**未自行创造任何业务规则。**

### D1（BLOCKER · 最高优先）· schema 无效如何处置？

`Opportunity.channel` / `shop` 缺少 `Channel` 侧反向 relation，导致 `prisma validate` / `generate` 失败、`tsc` 报错、构建流水线被阻断。

**候选**：
- **A** 补 `Channel.opportunities Opportunity[] @relation("OpportunityChannel")` + `Channel.opportunityShops Opportunity[] @relation("OpportunityShop")`（与 `Customer`/`Lead` 的既有模式完全对齐）
- **B** 改成匿名关系（去掉具名）——与既有 `Customer`/`Lead` 的具名风格不一致，不推荐
- **C** 回退该字段（与上一轮渠道归属决策相关）

**需要授权**：我**不会**自行修改 schema（本轮明确禁止）。请确认是否授权修复，以及选哪个候选。

### D2 · lint 工具链缺失如何处置？

`package.json` 声明了 `"lint": "eslint src/"`，但 eslint 既未安装也无配置 → 该脚本目前必然失败。

- **A** 安装并配置 eslint（涉及依赖变更，需授权）
- **B** 正式废弃 `lint` 脚本，只保留本轮新增的 `lint:layering`
- **C** 保持现状（本轮不动）

### D3 · 分层检查器是否纳入门禁？采用哪种门槛？

当前存量违规 31 处。

- **A** 保持报告模式（不阻断），仅作进度指标
- **B** 启用 `--strict` 但**先豁免存量**（只对新增/修改文件严格）
- **C** 立即启用 `--strict` 全量阻断（会立刻阻断所有提交，不建议）

### D4 · 寄居在 `lib/` 与 `utils/` 的层次错位，归属如何决定？

涉及：`lib/activity-logger.ts`、`lib/numberSequence.ts`、`lib/skuCode.ts`（Operation+Data）；
`utils/query.ts`、`utils/deptTree.ts`、`utils/notify.ts`（Data）；
`utils/pipelineStage.ts`、`utils/leadStatus.ts`、`utils/customerIntent.ts`（Business）；
`utils/scope.ts`（Data + HTTP 混合）。

- **A** 保持原位，只在试点模块中按需提取（零风险，渐进取）
- **B** 在 R-2 中一次性搬迁到对应层（改动面大，需逐个验证行为不变）
- **C** 混合：先搬 Data 类（`query`/`deptTree`），Business 类留待其宿主模块试点时再动

### D5 · `OperationContext` 的调用约定是否认可？

当前定义为 `{ db: DbClient; actor: { userId; username; realName? } }`。

- 是否需要额外携带 `dataScope` / `roleCode` / `requestId` / `ip`（写入 OperationLog 时可能需要 `ip`）？
- 若需要 `ip`，是否纳入 `OperationContext`？

### D6 · R-2 试点模块选哪个？

本轮**未自行选择**。建议候选（按「依赖清晰度 × 规模」）：

| 候选 | prisma 调用点 | 业务规则复杂度 | 备注 |
|---|---|---|---|
| `channel.controller.ts` | 7 | 低 | 最易验证，但代表性弱 |
| `certificate.controller.ts` | 5 | 低 | 同上 |
| `unit.controller.ts` | 9 | 低 | 纯字典 CRUD |
| `quotation.controller.ts` | 15 | 中 | 含状态机 + 快照 + 编号，代表性好 |
| `lead.controller.ts` | 55 | 高 | 含 draft/状态推进/Excel，代表性强但风险高 |
| `customer.controller.ts` | 71 | 高 | 最大文件，建议最后 |

请指定 R-2 试点模块。

### D7 · 是否需要 `services/` 与 `operations/` 的目录级约定文件（如 `README` / 命名规范）

本轮已把契约写在各层 `index.ts` 的头部注释中。若希望有独立的层规范文档，请指定位置（仓库根 `docs/` 或 `server/src/ARCHITECTURE.md`）。

---

## 附录 · 本轮执行顺序（对应任务 Step 1–5）

| Step | 内容 | 状态 |
|---|---|---|
| Step 1 | BASELINE（git status / branch / HEAD / origin/master） | ✅ 完成（§1） |
| Step 2 | 读取现有后端目录（未假设目录存在，实际 `find src -type d`） | ✅ 完成（§2.1） |
| Step 3 | 建立现状映射（Controller/Service/Operation/Data/Prisma 依赖关系） | ✅ 完成（§2.2 / §2.3），并**自动化**为 `check-layering` |
| Step 4 | 确认现有基础设施（Prisma 集中性、transaction、permission、dataScope、错误处理、OperationLog） | ✅ 完成（§5） |
| Step 5 | 建立最小分层基座（单一命名，无平行目录） | ✅ 完成（§3 / §4），并新增 `lint:layering` |
| — | 未进入 R-2 / R-3，未自动继续下一轮 | ✅ |

**本轮结束。未 commit。等待人工裁决与 R-2 试点模块指令。**
