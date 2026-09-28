# Round R-2 · Lead Pilot · Refactor Report

> 本轮为 **Lead 四层分层样板**（Lead 路径重构）。未 commit、未 push。
> 未修改 Frontend / API Contract / Prisma schema / migration / 其它业务模块。

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| **HEAD** | `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c` |
| **BRANCH** | `master`（领先 origin/master `66ebebec` 1 个提交） |
| **WORKTREE** | 干净启动：`M server/package.json`、`M server/prisma/schema/03-customer.prisma`、`M server/src/middleware/errorHandler.ts` + R-1/R-1.1/R-1.2 新增文件与 6 份报告（均为前几轮产物，**无用户未提交的代码改动**） |
| **npm run verify** | ✅ **PASS**（exit 0；`prisma validate` valid 🚀 / `prisma generate` v5.22.0 / `tsc --noEmit` 0 error） |
| **npm run lint:layering** | 违规 **31** 处（全为 `R2-CONTROLLER-PRISMA`）；Controller 去 Prisma 化进度 **6%**；文件 96 |

基线门结论：HEAD/工作树与 R-1.2 结束时**完全一致** → 情况 A/B 均未触发，正常开工。

---

## 2. LEAD CURRENT STATE

### 2.1 Lead Controller

`server/src/controllers/lead.controller.ts`，**1277 行**，导出 10 个 handler：

| # | 路由 | handler | 职责 |
|---|---|---|---|
| 1 | `GET /api/leads` | `getLeads` | 列表：分页 + 关键字/渠道/平台/状态/来源/归属/产品/scope 筛选 + 排序白名单 |
| 2 | `GET /api/leads/:id` | `getLead` | 详情 + 附件 |
| 3 | `GET /api/leads/:id/logs` | `getLeadLogs` | 操作记录（OperationLog，含关联 CUSTOMER/PRODUCT） |
| 4 | `POST /api/leads` | `createLead` | 创建（含 LeadItem / Attachment / 汇率快照） |
| 5 | `PUT /api/leads/:id` | `updateLead` | 更新（含明细维护 / 附件整组替换 / diff 审计） |
| 6 | `DELETE /api/leads/:id` | `deleteLead` | 删除（路由 `authorize('admin')`） |
| 7 | `DELETE /api/leads/:id/attachments/:attachmentId` | `deleteLeadAttachment` | 删除参考图 |
| 8 | `POST /api/leads/:id/release` | `releaseLead` | 释放到公海（联动客户/产品） |
| 9 | `POST /api/leads/:id/claim` | `claimLead` | 认领（联动客户/产品） |
| 10 | `POST /api/leads/:id/transfer` | `transferLead` | 转交（联动客户/私有产品可见人） |

### 2.2 Lead Prisma access **before**

`lead.controller.ts` 内 **55 处 `prisma.*`**，分布：

| 模型 | 调用点 | 模型 | 调用点 |
|---|---|---|---|
| `lead` | 14 | `attachment` | 5 |
| `product` | 8 | `channel` | 4 |
| `customer` | 8 | `user` | 3 |
| `leadItem` | 6 | `dailyExchangeRate` | 2 |
| `$transaction` | 3 | `operationLog` | 1 |

### 2.3 职责分布（12 问逐条回答）

| # | 问题 | 答案 |
|---|---|---|
| 1 | 有哪些 endpoint | 见 2.1（10 个） |
| 2 | 每个 endpoint 直接做了什么 | 参数解析 → 内联 zod → Prisma 读写 → 业务判断 → 响应拼装，**五层职责混在同一函数** |
| 3 | 哪些属 HTTP 层 | 参数解析、zod schema、`projectProductRows` / `projectAttachments` 响应投影、`fail/success/created` 状态码与文案 |
| 4 | 哪些属业务规则 | draft 放宽联系方式必填；leadName 自动生成；归属人可指派判定；客户引用授权（owner ∪ 公海 ∪ admin）；渠道/平台父子一致性；释放/认领/转交的 actor 与幂等判定；mutation 时刻重新授权（TOCTOU）；审计摘要只描述实际发生的联动 |
| 5 | 哪些只是数据访问 | 上表 55 处 Prisma 调用 |
| 6 | 哪些是多数据操作组合 | ① 列表（分页 + 附件批量）② 创建事务（编号 + Lead + Attachment）③ 更新（Lead + Attachment 整组替换 + LeadItem 维护）④ 释放/认领/转交事务（Lead + Customer + Product） |
| **7** | **Lead Confirm 当前在哪里实现** | ⚠️ **服务端不存在**。无 confirm 端点；`Lead.status = CONFIRMED` 由 `sales.controller.ts:442` `advanceLeadStatus` 在**创建 Opportunity 时**自动推进（`utils/leadStatus.ts`，无人工入口） |
| **8** | **Lead → Customer 当前在哪里实现** | ⚠️ **服务端不存在**。由**前端编排**：`LeadFormModal.createCustomerFromForm` → `POST /api/customers` → 再 `PUT /api/leads/:id { customerId }` 回写 |
| **9** | **Lead → Opportunity 当前在哪里实现** | **前端**调 `POST /api/sales`（`sales.controller.createOpportunity`，`leadId` 非 unique）；服务端随后自动推进线索状态 |
| 10 | `Lead.channelId / shopId` 写入点 | `createLead`（原 669-670 行）与 `updateLead`（原 812-813 行，含 sourceKey 拆分与有效组合覆盖） |
| 11 | `Lead.source` 写入点 | `createLead`（`data.source ?? 'MANUAL'`）与 `updateLead`（`LEAD_WRITABLE_FIELDS` 白名单含 `source`） |
| **12** | **Customer.channelId / shopId 从 Lead 继承的写入点** | ⚠️ **不在后端**。由前端把 `sourceKey`（`{channelId, shopId}` 的 JSON）带进 `POST /api/customers`，服务端 `customer.controller` 用 `splitSourceKey` 拆列写入 |
| 13 | 是否存在 `Customer.source` 写入 | ✅ **Lead 路径 0 处**（全仓仅 customer.controller 的 create/import 两处，均为 `MANUAL`/`EXCEL` 常量；本轮未新增） |
| 14 | Opportunity 是否反向覆盖 `Customer.channelId/shopId` | ✅ **NOT FOUND**（Lead 路径与全仓均无此类代码） |

> **边界结论（重要）**：本轮 §3 描述的生命周期「Draft → 资料准备并锁定 → **Confirm** → Customer → Opportunity」中，
> **Confirm / Customer 建档 / Opportunity 创建三者都在前端编排**，服务端只有 Draft 与锁定字段 + 状态自动推进。
> 因此 **无法**把「Lead Confirm」搬进 Business Layer —— 那需要一个**新的服务端端点**，
> 会同时改变 API Contract 与前端调用方式，属本轮明令禁止的范围。
> 按 §「最重要执行原则」：**已停在边界并报告**，未自行扩大（见 §11）。

---

## 3. ARCHITECTURE

| 层 | 落地文件 | 行数 | 职责 |
|---|---|---|---|
| **Controller** | `src/controllers/lead.controller.ts` | **310** | HTTP、参数解析、zod DTO 校验、auth context 组装、响应投影、状态码与错误映射 |
| **Business** | `src/services/lead.service.ts` | **800** | 业务规则、不变量、状态语义、跨实体流程决策、审计留痕；`DomainError` 表达业务失败；**不直接调用 Prisma** |
| **Operation** | `src/operations/lead.operations.ts` | **458** | 查询组合（列表 where）、多仓储组合（详情/日志）、`$transaction` 编排（创建聚合 / 更新聚合 / 释放 / 认领 / 转交） |
| **Data** | `src/repositories/{lead,channel,attachment,customer,product,user,dailyExchangeRate,operationLog}.repository.ts` | **378**（8 文件） | 纯数据访问：find / findMany / findUnique / count / create / update / delete / aggregate |
| **Prisma** | `src/lib/prisma.ts` | — | 唯一实例（未新建第二套） |

### Dependency

```
Controller (310 行)
    │  zod 校验 → buildActorContext(req) → service 调用
    ↓
Business  services/lead.service.ts (800 行)
    │  业务规则判定 → operations 调用 / repositories 直读
    ↓
Operation operations/lead.operations.ts (458 行)
    │  多仓储组合 + runInTransaction 事务编排
    ↓
Data      repositories/*.repository.ts (8 文件)
    │  唯一 Prisma 访问点
    ↓
Prisma / PostgreSQL
```

依赖方向验证（均由 `lint:layering` 自动判定）：

| 规则 | 结果 |
|---|---|
| `R1-UPWARD`（反向依赖：上游被下游 import） | ✅ **0** |
| `R3-SHARED-BUSINESS`（lib/utils/middleware → 业务层） | ✅ **0** |
| `R4-HTTP-IN-DOMAIN`（业务/操作/数据层依赖 express） | ✅ **0** |
| 手工自查：`repositories/`、`operations/` 是否引用 `services/`、`controllers/` | ✅ 0（grep 确认） |
| `$transaction` 是否出现在 Controller / Business | ✅ 0（全部收在 Operation 层） |

---

## 4. FILES CHANGED

### 4.1 修改（1 个）

| 文件 | 变化 |
|---|---|
| `server/src/controllers/lead.controller.ts` | **1277 → 310 行**（薄 Controller；导出名保持 10/10 与路由一致） |

### 4.2 新增（11 个）

**Business（1）**
- `server/src/services/lead.service.ts`

**Operation（1）**
- `server/src/operations/lead.operations.ts`

**Data（8）**
- `server/src/repositories/lead.repository.ts`（Lead + LeadItem 同聚合）
- `server/src/repositories/channel.repository.ts`
- `server/src/repositories/attachment.repository.ts`
- `server/src/repositories/customer.repository.ts`
- `server/src/repositories/product.repository.ts`
- `server/src/repositories/user.repository.ts`
- `server/src/repositories/dailyExchangeRate.repository.ts`
- `server/src/repositories/operationLog.repository.ts`

**层入口 / 索引（1 组，必要的 index/export）**
- `server/src/repositories/index.ts`（R-1 建立，本轮补充 8 个仓储导出）
- `server/src/operations/index.ts`（R-1 建立，本轮 `export * from './lead.operations'`）
- `server/src/services/index.ts`（R-1 建立，本轮 `export * as leadService`）

### 4.3 明确**未**改动

`server/src/routes/lead.routes.ts`（`git diff` 为空）；`customer.controller.ts` / `sales.controller.ts` / `product.controller.ts`；`client/**`；`prisma/schema/**`（工作树中的 `03-customer.prisma` 改动是 **R-1.1 遗留**）；`prisma/migrations/**`。

---

## 5. BUSINESS PRESERVATION

| 项 | 结果 | 证据 |
|---|---|---|
| **Lead.source** | **PASS** | 服务端 `Lead.source` 保留：创建时 `data.source ?? 'MANUAL'`，更新白名单含 `source`；运行时核验创建后 `source=MANUAL`、更新后仍为 `MANUAL`（未被更新路径改写）。语义未变（仍为「来源 / 数据进入来源」，未改造成 channel）。**未删除** |
| **Lead.channelId** | **PASS** | 语义仍为「首次获客渠道」；创建/更新写入路径与 sourceKey 拆分逻辑逐字沿用；运行时核验 `channelId` 正确落库 |
| **Lead.shopId** | **PASS** | 同上（`shopId` = 首次获客店铺） |
| **shop belongs to channel** | **PASS** | 服务端校验保留并复用（未实现第二套）：运行时**负例**核验 → `DomainValidationError: 来源平台不属于所选来源渠道` |
| **Lead → Customer channelId** | **PASS（行为不变）** | 该继承为**前端编排**（本后端 Lead 路径不写 Customer.channelId）；本轮未改动任何相关代码路径，后端继承逻辑与既有完全一致（`customer.controller` 的 `sourceKey` 拆列未动） |
| **Lead → Customer shopId** | **PASS（行为不变）** | 同上 |
| **Opportunity → Customer reverse overwrite** | **NOT FOUND** | Lead 路径无 Opportunity 写入；全仓检索无「Opportunity 渠道回写 Customer」代码。运行时核验中 `Customer.channelId/shopId` 未被任何 Lead 操作触碰 |
| **Customer.source** | **NOT WRITTEN** | 新 Business 层**零** `source` 写入；运行时核验 `Customer.source` 非空行数保持 2（本轮未新增）。**未恢复、未改造、未新增字段** |

### 附加不变量核验

| 项 | 结果 |
|---|---|
| `Lead.status` 仍**只**由单据事件推进 | ✅ 创建恒为 `'NEW'`；`status` 不在 DTO 与更新白名单内；未新增任何人工改状态入口 |
| Draft 语义 | ✅ `draft=true` 放宽联系方式必填；`draft/customerLocked/productLocked/stage` 仍为落库字段（运行时核验 `draft=true stage=null customerLocked=false`） |
| 归属/公海语义 | ✅ `ownerId=null` = 公海；release 需有主、claim 需无主、transfer 需 actor 为 owner 或 admin（`isStrictAdmin`） |
| 两个 admin 判据的差异被保留 | ✅ `isAdmin`（`admin`\|`ADMIN`，列表筛选）与 `isStrictAdmin`（严格 `admin`，release/transfer）**并列保留**，未改写既有行为 |
| 审计摘要只描述实际联动 | ✅ 摘要文案沿用「跳过时不虚报」口径 |
| `503`/`404` 防 oracle 口径 | ✅ 越权与不存在同响应（404「线索不存在」） |

---

## 6. API CONTRACT

**API changed: NO**

逐项确认未变：

| 项 | 状态 |
|---|---|
| endpoint path（10 个） | ✅ 未变（`routes/lead.routes.ts` 零改动） |
| HTTP method | ✅ 未变 |
| request field | ✅ 未变（zod schema 逐字搬迁，含 `sourceKey` / `sourceChannel` / `productType` 等 legacy 接受但不落库的字段） |
| response field / shape | ✅ 未变（`created(res, item)` / `success(res, {list,total,page,pageSize})` / `success(res,{...item,items,attachments})` 逐字保留；`projectProductRows` + `projectAttachments` 仍在 HTTP 边界执行） |
| 错误码语义 | ✅ 未变（`400/404/500` 与文案逐字保留；**500 文案仍为「服务器错误」**，未改成 errorHandler 的通用文案） |
| 分页结构 | ✅ 未变 |
| 前端依赖字段 | ✅ 未变 |

> 说明：R-1 在 `middleware/errorHandler.ts` 增加的 `DomainError → HTTP` 分支**保持存在**（供其它模块后续使用）；
> Lead 路径**未**使用它，而是在 Controller 内显式映射（`fail(res, err.code, err.message)`），
> 以**保证 500 文案等既有响应与改动前逐字一致**。

**Frontend changed: NO** — `client/**` 零改动。

---

## 7. VALIDATION

### 7.1 `npm run verify`

**PASS**（exit 0）：`prisma validate` → `The schemas at prisma/schema are valid 🚀`；`prisma generate` → `Generated Prisma Client (v5.22.0) in 2.32s`；`tsc --noEmit` → **0 error**。

### 7.2 layering

| 项 | BEFORE | AFTER |
|---|---|---|
| 违规总数 | **31** | **30** |
| `R2-CONTROLLER-PRISMA` | 31 | **30** |
| `R1-UPWARD` | 0 | **0** |
| `R3-SHARED-BUSINESS` | 0 | **0** |
| `R4-HTTP-IN-DOMAIN` | 0 | **0** |
| Controller 去 Prisma 化进度 | 6% | **9%** |
| `lead.controller.ts` 是否在违规清单 | 是 | **否** |
| 各层文件数 | 33/1/1/3 | **33 / 2 / 2 / 11** |

→ **无新增违规，且既有违规净减 1（Lead）**。

### 7.3 Lead Controller direct Prisma

**0**（`grep -c "prisma" src/controllers/lead.controller.ts` = 0）

### 7.4 Runtime verification

**PARTIAL**（读 + 写 + 清理均已实测；「Lead Confirm」因服务端不存在而无法验证）

| # | 覆盖项 | 结果 | 详情 |
|---|---|---|---|
| ① | **Lead 查询（列表）** | ✅ PASS | `listLeads({page:1,pageSize:3})` → 3 行 / total=5 / page=1 / size=3；include 完整性 `customer/items/owner/channel/shop` 全部存在 |
| ② | **Lead 详情** | ✅ PASS | `getLeadDetail` → `items=1 attachments=1` |
| ③ | **Lead 操作记录** | ✅ PASS | `getLeadLogs` → 26 条 |
| ④ | **Lead 创建（草稿路径）** | ✅ PASS | `createLead` → `leadNo=XS-202609-0023 status=NEW source=MANUAL`；`channelId/shopId` 正确落库；`usdRate` 快照 = `6.7132116` |
| ⑤ | **Lead Draft / 状态读取** | ✅ PASS | 创建后 `draft=true stage=null customerLocked=false`；`status=NEW`（创建恒为 NEW） |
| ⑥ | **Lead 更新** | ✅ PASS | `updateLead`（remark/quantity/draft）→ 回读 `remark=...-updated quantity=7 draft=false`；`source` 仍为 `MANUAL`（未被改写） |
| ⑦ | **业务不变量：shop 属于 channel** | ✅ PASS | 负例（shop 指向另一渠道）被拒绝 → `DomainValidationError: 来源平台不属于所选来源渠道` |
| ⑧ | **数据范围门** | ✅ PASS | 不存在的线索 → `DomainNotFoundError httpStatus=404 msg=线索不存在` |
| ⑨ | **清理（不污染数据）** | ✅ PASS | 测试线索已删除；`LeadItem` 级联残留 **0** 行；`Lead` 总数回到 **5**（与开工一致） |
| ⑩ | **Lead Confirm** | ⚪ **NOT EXECUTED** | 原因：**服务端无 confirm 端点**（见 §2.3 #7 / §11 B1）。未伪造 PASS |

**运行时数据的诚实披露**：

| 项 | 残留 | 说明 |
|---|---|---|
| `Lead` 测试行 | **0** | 已清理 |
| `LeadItem` | **0** | 级联清理 |
| `Attachment` | **0** | 测试未创建附件 |
| `OperationLog` | **6 行**（CREATE/UPDATE/DELETE × 2 轮） | **审计日志按设计保留，不可清理**（`OperationLog` 无删除入口） |
| `NumberSequence`（LEAD） | `currentValue` 22 → **23**、period `202609` | 编号已消费，**按设计不回滚**（与既有创建逻辑一致） |
| `Customer.source` | 非空行数保持 **2** | 本轮未写入 |

执行环境：本地开发库 `localhost:5432/ysem`（PostgreSQL）；脚本置于 `/tmp`（未进入仓库），已删除。

---

## 8. DIFF SCOPE

| 项 | 结果 |
|---|---|
| **Unexpected files** | **NONE** |
| **Unexpected schema change** | **NO**（`prisma/schema/**` 本轮零改动；工作树中 `03-customer.prisma` 的 `+6` 行为 **R-1.1 遗留**） |
| **Unexpected migration** | **NO**（`git status server/prisma/migrations` 为空） |

`git diff --stat`（tracked，含前几轮遗留）：

```
 server/package.json                       |    5 +-      ← R-1/R-1.2
 server/prisma/schema/03-customer.prisma   |    6 +       ← R-1.1
 server/src/controllers/lead.controller.ts | 1249 ++++---  ← 本轮（1277 → 310 行）
 server/src/middleware/errorHandler.ts     |   13 +       ← R-1
 4 files changed, 164 insertions(+), 1109 deletions(-)
```

逐文件检查结论：

| 文件 | 是否在允许清单内 | 说明 |
|---|---|---|
| `controllers/lead.controller.ts` | ✅ Lead Controller | 薄层化 |
| `services/lead.service.ts` | ✅ Lead Business | 新增 |
| `operations/lead.operations.ts` | ✅ Lead Operation | 新增 |
| `repositories/*.repository.ts`（8） | ✅ Lead Repository + 其真实依赖 | 每个仓储均有 ≥1 个真实调用者，无「机械创建」 |
| `services/index.ts`、`operations/index.ts`、`repositories/index.ts` | ✅ 必要的 index/export | 层入口补导出 |
| `routes/lead.routes.ts` | — | **未改动**（导出名保持一致） |
| `customer` / `product` / `opportunity` / `frontend` | — | **零改动** |

> **关于 8 个仓储的说明**（防「平行架构 / 机械创建」嫌疑）：
> 它们不是为「凑四层」而建，而是 Lead 路径**真实 Prisma 调用面**（14 lead / 8 product / 8 customer / 6 leadItem / 5 attachment / 4 channel / 3 user / 2 rate / 1 log）的最小映射。
> 其中 `leadItem` 与 `lead` 同聚合**已合并进同一仓储**；`operationLog`、`dailyExchangeRate`、`user` 各只 1–2 个方法，未做无意义包装。
> `attachment`、`customer`、`product` 的方法均为 Lead 路径专用（customer/product 仅含归属与可见性联动，未迁移其模块自身 CRUD）。
> **未出现** `Controller → Operation → Repository` 的空转发：所有 Operation 都是真正的多仓储组合或事务编排。

---

## 9. RESULT

**R-2: PASS**

**Blocking issue: NONE**

成功标准逐项核对（§30）：

| # | 成功标准 | 结果 |
|---|---|---|
| [x] | Lead Controller 不再直接访问 Prisma | ✅ 0 处 |
| [x] | Lead 主要业务逻辑进入 Business Layer | ✅ `services/lead.service.ts`（800 行） |
| [x] | Lead 数据访问进入 Data Layer | ✅ 8 个仓储 |
| [x] | Lead 跨数据操作进入 Operation Layer | ✅ `operations/lead.operations.ts`（458 行） |
| [x] | 无反向依赖 | ✅ R1/R3/R4 = 0 |
| [x] | API Contract 未变化 | ✅ 见 §6 |
| [x] | Frontend 未修改 | ✅ `client/**` 零改动 |
| [x] | `Lead.source` 保留 | ✅ 见 §5 |
| [x] | `Customer.source` 不被新逻辑继续建设 | ✅ 零写入 |
| [x] | `Lead.channelId/shopId` 保持原业务含义 | ✅ 见 §5 |
| [x] | `shopId` 必须属于 `channelId` | ✅ 复用既有校验 + 运行时负例通过 |
| [x] | `Lead → Customer` 首次获客信息继承逻辑保持 | ✅ 未改动该（前端编排的）路径 |
| [x] | Opportunity 不反向覆盖 Customer 首次获客信息 | ✅ NOT FOUND |
| [x] | `npm run verify` PASS | ✅ exit 0 / tsc 0 error |
| [x] | layering check 无新增违规 | ✅ 31 → 30（净减 1，Lead 出列） |
| [~] | Lead 运行时关键路径完成可验证的行为核验 | ⚠️ **PARTIAL**：9 项 PASS；「Lead Confirm」服务端不存在 → NOT EXECUTED（已如实报告，未伪造） |
| [x] | diff 范围通过 | ✅ 见 §8 |
| [x] | 未 commit | ✅ |
| [x] | 未 push | ✅ |

---

## 10. COMMIT

**Commit: NOT DONE**
**Push: NOT DONE**

HEAD 仍为 `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`；`origin/master` 未做任何写入。

---

## 11. 边界报告（§「最重要执行原则」要求：停在边界，报告，不扩大）

### B1 · Lead Confirm 在服务端不存在

```
Dependency:      Lead 生命周期（Draft → Confirm → Customer → Opportunity）
Reason:          服务端没有 Confirm 端点/事务；Confirm 由前端编排：
                 LeadFormModal.handleConfirmLead → customerApi.create/update
                 → leadApi.update({customerId}) → POST /api/sales（建商机）
                 → 服务端 sales.controller.ts:442 自动推进 Lead.status = CONFIRMED
Required change: 新增服务端 Confirm 端点（如 POST /api/leads/:id/confirm），
                 并把「建客户 + 建商机 + 推进状态」收进一个事务
Impact:          ❌ 新增 endpoint（API Contract 变更）
                 ❌ 前端必须改为调用新端点（Frontend 修改）
                 ❌ 涉及 customer.controller / sales.controller（跨模块）
本轮处理:        未实施。Lead 侧仅保留 Draft/锁定字段与「状态只由单据事件推进」的既有语义。
```

### B2 · Lead → Customer 首次获客继承在服务端不存在

```
Dependency:      Customer.channelId/shopId ← Lead.channelId/shopId
Reason:          该继承由前端把 sourceKey（JSON {channelId, shopId}）带进 POST /api/customers，
                 服务端 customer.controller.splitSourceKey 拆列写入。Lead 后端不写 Customer。
Required change: 若要把继承收敛为服务端行为，需改造 POST /api/customers 的调用方式
Impact:          ❌ 涉及 customer.controller + 前端表单
本轮处理:        未实施（后端该路径零改动 → 继承行为与既有完全一致）。
```

### B3 · Opportunity 渠道写入在 Lead 路径之外

```
Dependency:      Opportunity.channelId/shopId（R-1.1 修复的 schema 字段）
Reason:          Lead→商机 由前端调 POST /api/sales；且 sales.controller 的
                 channelId/shopId 入参**无** Channel/Shop 契约校验（与 Lead/Customer 不一致）
Required change: 为 Opportunity 补 validateChannelShop（需改 sales.controller）
Impact:          ⚠️ 跨模块（Opportunity）；不属 Lead Pilot
本轮处理:        仅记录（R-0/R-3 已记录该不一致），未修。
```

### B4 · `withProductVisibility` 会改写历史快照（既有缺陷）

```
Dependency:      LeadItem.productName 读取侧投影
Reason:          lead.controller 的 projectProductRows(..., { nameField: 'productName' })
                 会把不可见产品的**快照字段**置 null（既有行为）
Required change: 移除 nameField 选项（涉及 lead/quotation/sales/sampleOrder 四处一致口径）
Impact:          ⚠️ 影响 4 个模块的响应内容（属「历史快照不可变」议题，非纯 Lead 范围）
本轮处理:        逐字保留既有口径（未改投影行为），仅记录。
```

### B5 · `updateLead` 未包裹事务（既有行为）

```
Dependency:      Lead 更新流程（Lead + Attachment + LeadItem 三次写入）
Reason:          既有实现没有 $transaction（部分失败会留下中间态）
Required change: 包裹事务
Impact:          ⚠️ 会改变「部分失败」的既有语义（属行为变更，非纯架构移动）
本轮处理:        保持原样（未新增事务），仅记录。是否收敛请指示。
```

### B6 · `splitSourceKey` 在 `customer.controller.ts` 存在同实现副本

```
Dependency:      Channel/Shop 来源拆分
Reason:          customer.controller.ts:842 复制了一份「与 lead.controller.splitSourceKey 同语义」的实现
Required change: 抽为共享 util，两处复用
Impact:          ⚠️ 涉及 customer.controller
本轮处理:        Lead 侧的实现已迁入 Business 层；对方副本未动（不扩大范围）。
```

### B7 · 保留的既有死代码

```
Item:            LEAD_STATUS_LABEL（lead.controller.ts 中的状态中文名映射，全仓无使用）
本轮处理:        保留（未删除任何既有代码），仅标注。如需清理请指示。
```

---

## 12. 后续建议（不实施）

| # | 建议 | 依赖 |
|---|---|---|
| 1 | 若确认需要服务端 Confirm：先在 R-3 之外单独立项设计事务边界与幂等键 | B1 |
| 2 | 把 `Customer.channelId/shopId ← Lead` 的继承收敛为服务端事务（消除前端编排） | B1/B2 |
| 3 | 为 Opportunity 补 Channel/Shop 契约校验（对齐 Lead/Customer） | B3 |
| 4 | 统一快照不可变口径（移除 `nameField` 投影改写） | B4 |
| 5 | `updateLead` 收敛为事务（需先确认是否接受行为变更） | B5 |
| 6 | `splitSourceKey` 抽共享 util | B6 |
| 7 | 按本轮样板推进下一个模块（建议 `channel` / `unit` / `certificate` 等低复杂度模块先验证模式，再攻 `customer`） | — |

---

**本轮结束。未 commit、未 push。未继续 R-3。**
