# YSEM Decision Freeze · Round 3 — Lead / Customer / Sales Record Channel Ownership Final Rules

> 本轮性质：**Decision Freeze 修订阶段**（只读）
>
> **CODE CHANGE = 0 · SCHEMA CHANGE = 0 · MIGRATION CHANGE = 0 · DATABASE CHANGE = 0 · API CHANGE = 0 · FRONTEND CHANGE = 0 · COMMIT = 0 · PUSH = 0**
>
> 本文件**取代** `YSEM架构决策冻结登记册.md` 中 **D1** 与 **D12** 的条目（其余 D2–D17 条目保持有效，见 §12 连带影响）。
> 本轮新增文档一项，未修改任何既有文件。
>
> BASELINE：HEAD = origin/master = `66ebebec`；Working Tree **dirty**（含在途 `Opportunity.channelId/shopId`）

---

## 1. STATUS BOARD

### 1.1 本轮冻结（CONFIRMED）

| 编号 | 规则 | 状态 |
|---|---|---|
| **D1-A** | Channel / Shop 的首次获客归属属于最开始的 Lead | **CONFIRMED** |
| **D1-B** | `Lead.channelId/shopId` = 最初获客归属 | **CONFIRMED** |
| **D1-C** | Lead 转 Customer：`Lead.channelId/shopId → Customer.channelId/shopId` | **CONFIRMED** |
| **D1-D** | `Customer.channelId/shopId` = 首次获客渠道 / 首次获客店铺（永久保持） | **CONFIRMED** |
| **D1-E** | 后续 Sales Record 可拥有不同 channelId/shopId，不得反向覆盖 Customer | **CONFIRMED** |
| **D12-A** | `Customer.source` 不再承担业务职责 | **CONFIRMED** |
| **D12-B** | 不得使用 `Customer.source` 表示首次获客渠道 | **CONFIRMED** |
| **SSOT-GLOBAL-01** | 同一业务事实必须具有唯一权威来源 | **CONFIRMED** |
| **SSOT-GLOBAL-02** | 不同业务事实即使名称相似，也不得强行合并 | **CONFIRMED** |
| **STRUCT-GLOBAL-01** | 同一类关系使用统一字段结构（`channelId` / `shopId`） | **CONFIRMED** |
| **STRUCT-GLOBAL-02** | 不因页面、模块或前端组件不同而重复设计同一关系 | **CONFIRMED** |
| **STRUCT-GLOBAL-03** | 展示名称通过 JOIN 获取，不在多个业务表重复保存 | **CONFIRMED** |
| **STRUCT-GLOBAL-04** | 通用组件建立在稳定的数据结构之上，不为每个页面创建专用字段 | **CONFIRMED** |

### 1.2 仍待人工裁决（NEED REVIEW）

| 编号 | 问题 | 优先级 |
|---|---|---|
| **R3-Q1** | 「Shop」的载体：`shopId` 当前指向 `Channel` 表（无独立 Shop 模型），与 STRUCT-GLOBAL-01 的 `shopId → Shop` 字面要求不符 → 需裁决（见 §11-2） | **高（结构级）** |
| **R3-Q2** | `Quotation` / `SampleOrder` / `SalesOrder` 是否各自需要 `channelId/shopId`（见 §5） | **高** |
| **R3-Q3** | 「FIRST ACQUISITION FACT」的权威事件：当前 = Customer 建档（早于 Confirm）→ 需与 D13 联动裁决（见 §7） | **高** |
| **R3-Q4** | `Customer.source` 的废弃节奏（直接删 vs deprecated → migration → drop） | 中 |
| **R3-Q5** | 是否保留独立的「数据进入系统的方式」字段 | 中 |
| **R3-Q6** | `Lead.source` 是否保留（已确认有独立业务价值，但 `RPA`/`SYNC` 无代码路径） | 中 |
| **R3-Q7** | `Customer.channelId/shopId` 在 Customer 建档后**当前可被改写**（与 D1-D「永久保持」冲突）→ 需确认禁止改写（见 §10-1） | **高** |
| **R3-Q8** | 商机模块存在**第三套渠道词汇表**且用户选择被静默丢弃（见 §11-4）→ 需确认处置 | **高** |

---

## 2. FINAL FROZEN RULES（正式规则文本）

### 2.1 D1-A ~ D1-E · Channel / Shop 归属

```
D1-A  Channel / Shop 的「首次获客归属」属于最开始的 Lead。
      Lead 是 Customer 正式建立之前、最初销售线索的业务事实载体。
      首次获客 Channel / Shop 不得首先定义在 Customer 上。

D1-B  Lead.channelId  = 最初获客渠道
      Lead.shopId     = 最初获客店铺
      · Draft 阶段可补充与调整
      · 进入 CONFIRMED 后成为正式首次获客事实（冻结，见 §2.3）

D1-C  Lead → Customer 转化时：
      Lead.channelId → Customer.channelId
      Lead.shopId    → Customer.shopId
      必须保持原始首次获客事实的传递一致性。

D1-D  Customer.channelId = First Acquisition Channel
      Customer.shopId    = First Acquisition Shop
      其业务性质是「Customer 的首次获客来源事实」，不是：
        · 当前渠道 · 最近渠道 · 主渠道 · 销售渠道集合
      原则上永久保持，不得因后续 Sales Record 改变而覆盖。

D1-E  后续每一条正式 Sales Record / Opportunity 拥有自己的
      channelId / shopId，含义为「本次销售记录实际归属的 Channel / Shop」。
      允许与 Customer 的首次获客事实不同。
      不得反向覆盖 Customer 的首次获客事实。

【三层语义对照表】（字段结构相同，业务事实不同 —— 见 SSOT-GLOBAL-02）
┌─────────────────────┬──────────────────────┐
│ Lead.channelId      │ 最初获客渠道          │
│ Customer.channelId  │ 首次获客渠道          │
│ SalesRecord.channelId│ 本次销售记录所属渠道  │
├─────────────────────┼──────────────────────┤
│ Lead.shopId         │ 最初获客店铺          │
│ Customer.shopId     │ 首次获客店铺          │
│ SalesRecord.shopId  │ 本次销售记录所属店铺  │
└─────────────────────┴──────────────────────┘
```

### 2.2 D12-A / D12-B · Customer.source

```
D12-A  Customer.source 不再承担任何业务职责。
       原因：Customer.source 旧语义（MANUAL/EXCEL/RPA/SYNC）属「数据进入系统的
       方式 / 录入方式」，与新的业务定义「首次获客渠道」不是同一个事实。
       系统已由 Customer.channelId 承担「首次获客渠道」。

D12-B  不得使用 Customer.source 表示首次获客渠道。
       不得机械新增 ingestionSource 之类字段替代它 —— 仅当业务确实需要统计
       「数据是如何进入系统的」时才保留该事实。
```

### 2.3 Lead Draft / Confirm 与渠道冻结

```
R3-D1-CH1  Draft 阶段：Lead.channelId / shopId 可补充与调整。
R3-D1-CH2  进入 CONFIRMED：channelId / shopId 成为正式首次获客事实（冻结）。
R3-D1-CH3  Lead → Customer 传递必须保持一致（D1-C）。
R3-D1-CH4  已存在 Customer 时新增不同渠道的 Sales Record：
           不得执行 Customer.channelId = 新渠道（D1-E / §8 场景）。
```

### 2.4 STRUCT-GLOBAL · 统一数据结构原则

```
STRUCT-GLOBAL-01  同一类关系使用统一字段结构。
                  全系统统一使用 channelId + shopId：
                    channelId → Channel
                    shopId    → Shop
                  禁止出现：leadChannel / customerChannel / salesChannel /
                  sourceChannel / acquisitionChannel / channelName / shopName
                  等仅为不同页面而产生的重复关系字段
                  （除非经独立 Decision Freeze 证明业务语义确实不同）。

STRUCT-GLOBAL-02  不因页面、模块或前端组件不同而重复设计同一关系。
                  ★ 当前存在一处实证违规，见 §11-4（商机模块第三套渠道词汇表）。

STRUCT-GLOBAL-03  展示名称通过 JOIN 获取，不在多个业务表重复保存。
                  业务表只保存 channelId / shopId，不保存 channelName / shopName。
                  ✅ 当前已合规（见 §11-3 证据）。

STRUCT-GLOBAL-04  通用组件优先建立在稳定的数据结构之上，而不是为每个业务页面
                  创建专用字段。
                  ★ 当前存在一处实证违规，见 §11-5（splitSourceKey 复制两份）。
```

---

## 3. D1 更新条目（8 段结构）

**状态：CONFIRMED（D1-A ~ D1-E）**

### 当前事实
| 实体 | 字段 | 类型 | onDelete | 可写？ |
|---|---|---|---|---|
| `Lead` | `channelId` / `shopId` | `Channel?` | SetNull | ✅ create + update |
| `Customer` | `channelId` / `shopId` | `Channel?` | SetNull | ✅ create + **update（可改写）** |
| `Opportunity` | `channelId` / `shopId` | `Channel?` | SetNull | ⚠️ **在途未提交**，create 直接落库，**无校验** |
| `Quotation` / `SampleOrder` / `SalesOrder` / `Shipment` | — | — | — | ❌ **字段不存在** |

`Channel` 反向 relation 仅 4 个：`leads` / `leadShops` / `customers` / `customerShops`（`03-customer.prisma:166-169`）—— **Opportunity 的两条 relation 未在 Channel 上声明反向**（不对称）。

### 业务含义
三层语义（最初获客 / 首次获客 / 本次销售记录归属）结构相同、事实不同，允许出现相同值但**不得互相覆盖**。

### 当前代码证据（关键）
`Lead → Customer` 的渠道传递**已实现**，但**不是服务端从 Lead 读取**，而是前端把值带进 Customer 建档请求：

```
1092:1101:client/src/components/lead/LeadFormModal.tsx（createCustomerFromForm）
        写入 companyName / contactName / country←targetMarket / customerType /
        contactMethods / channelId / shopId
```
```1204:1216:client/src/components/lead/LeadFormModal.tsx（createCustomerSilently）
        editing.channelId / editing.shopId → Customer
```
```
322:322:server/src/controllers/quotation.controller.ts（同类模式参考）
  const customerId = body.customerId ?? opportunity.customerId;
```

服务端 Customer 写入点：`customer.controller.ts:1012-1013`（create）、`:1156-1157`（update）。

### 当前问题
1. **D1-D「永久保持」与现状冲突**：`customer.controller.ts:1138-1169` 的 update **恒写** `channelId/shopId`；触发点 `LeadFormModal.tsx:1132`（已建档且来源变更）、`:1323`（转商机前同步）→ **Customer 首获事实可被改写**
2. **D1-B「CONFIRMED 后冻结」无服务端保障**：`updateLead` 白名单含 `channelId`（`:180`）`shopId`（`:181`），写入 `:812-813`，**全程不读 status/draft/锁定**（`lead.controller.ts:751-830`）→ 任何状态都能改
3. **在途 `Opportunity.channelId/shopId`** 直接落库、**无校验**（`sales.controller.ts:412-413`），与 Lead/Customer 不一致
4. 四张单据无 channelId/shopId → 无法承载「本次销售记录归属」（见 §5）

### 目标规则
见 §2.1（D1-A ~ D1-E）与 §2.3（R3-D1-CH1~CH4）。

### 需要人工确认
| # | 问题 |
|---|---|
| R3-Q1 | Shop 的载体（见 §11-2） |
| R3-Q5-1 | 在途 `Opportunity.channelId/shopId` 合入 / 回退 / 改同步约束？（上一轮 D1-Q1 未决） |
| R3-Q7 | 是否禁止 Customer 建档后改写 `channelId/shopId`（落实 D1-D）？ |
| R3-Q7-1 | 是否禁止 Lead 进入 CONFIRMED 后改写 `channelId/shopId`（落实 D1-B）？ |
| R3-Q7-2 | Lead 公海/认领/转移（`releaseLead`/`claimLead`/`transferLead`）是否影响 channelId/shopId？ |

### 依赖
**D12**（source 废弃）、**D13**（首获事实形成时点）、**D17**（模块边界）、**R3-Q2**

---

## 4. D12 更新条目（8 段结构）

**状态：CONFIRMED（D12-A / D12-B）；废弃节奏 NEED REVIEW**

### 当前事实
`Customer.source` 类型为 `LeadSource?`（可空无默认）：
```
38:38:server/prisma/schema/03-customer.prisma
  source        LeadSource?
```
```
115:121:server/prisma/schema/00-enums.prisma
enum LeadSource { MANUAL  EXCEL  RPA  SYNC }
```
baseline DDL：`migrations/20260913000000_v1_0_baseline/migration.sql:307` → `"source" "LeadSource",`（可空、无默认）。

既有冻结规则（仅存在于代码注释）：`D-SOURCE-2`（create 固定 MANUAL，`:899`）、`D-SOURCE-3`（import 固定 EXCEL，`:948/1391`）、`D-SOURCE-4`（update 不得改，`:928`）。

全部写入点 **2 处**：`customer.controller.ts:1017`（`"MANUAL"`）、`:1405` + `:1436`（`"EXCEL"`）。

### 业务含义
旧语义 = 录入方式；新定义 = 首次获客渠道 → **两个不同事实**（SSOT-GLOBAL-02：不得合并）。系统已有 `Customer.channelId` 承担「首次获客渠道」→ `source` 失去职责。

### 当前代码证据
**无任何过滤 / 排序 / 统计 / groupBy / 报表 / 导出 / 前端展示使用 `Customer.source`**：
- `listMy`（`:195`）过滤仅 keyword/country/type；`getReportStats`（`:1527`）不用 source
- `server/src` 中 `\bsource\b` 无出现在 `where` / `orderBy` / `groupBy`
- zod schema **不含** `source`（create `:884-907`、update `:909-940`）
- **无 `/export` 端点**（`customer.routes.ts` 全量：my / public / all / options / countries / report / import / claim / release / transfer / tags / ownership / logs / :id / POST / PUT / DELETE）
- 前端 `CustomerEditDrawer` 白名单与渲染字段**均无 source**
- `client/src/api/customers.ts:133` 的 `CustomerLeadSummary.source` ⚠️ **实为 `Lead.source`**，与本项无关（重要区分）

### 当前问题
1. 语义与业务定义冲突（已由 D12-A/B 裁定）
2. 线索转化建档时**不传 source** → 线索 `source=EXCEL` 转客户后变 `MANUAL`（信息丢失，`LeadFormModal.tsx:1093-1101/1200-1211` 均不传）
3. `D-SOURCE-2/3/4` 规则**仅存在于注释**，无文档化、无测试保障

### 目标规则
见 §2.2（D12-A / D12-B）+ §6（SOURCE_DEPRECATION_PLAN）。

### 需要人工确认
R3-Q4（废弃节奏）、R3-Q5（是否保留录入方式事实）。

### 依赖
**D1**（首获渠道已由 channelId 承担）、**D13**（Customer 建档时机）

---

## 5. CHANNEL / SHOP OWNERSHIP MATRIX

> §12 要求：**不得因为 Lead / Customer 已确定，就自动推导 Quotation / SampleOrder / SalesOrder。**
> 以下逐项给出代码取证结论。

| Entity | channelId | shopId | Meaning | Can Change? | 取证依据 |
|---|---|---|---|---|---|
| **Lead** | ✅ 存在 | ✅ 存在 | 最初获客归属 | ❓ 应「Draft 可调 / CONFIRMED 后冻结」，**当前服务端无限制**（`lead.controller.ts:180-181/812-813` 全程不读 status） | `03-customer.prisma:213/215` |
| **Customer** | ✅ 存在 | ✅ 存在 | 首次获客归属 | ❓ 应「永久保持」，**当前可被 update 改写**（`customer.controller.ts:1156-1157`，触发 `LeadFormModal.tsx:1132/1323`） | `03-customer.prisma:28/30` |
| **Opportunity / Sales Record** | ⚠️ 在途 | ⚠️ 在途 | 本次销售记录归属 | 按该记录生命周期（**未定义**） | `05-opportunity.prisma:43/45`（未提交）+ 迁移 `20260928120000` |
| **Quotation** | ❌ **字段不存在** | ❌ **字段不存在** | — | — | schema 全量检索无命中；`quotation.controller.ts` 无 channel 相关代码 |
| **SampleOrder** | ❌ **字段不存在** | ❌ **字段不存在** | — | — | schema 全量检索无命中；`sampleOrder.controller.ts` 无 channel 相关代码 |
| **SalesOrder** | ❌ **字段不存在** | ❌ **字段不存在** | — | — | schema 全量检索无命中；`salesOrder.controller.ts` 无 channel 相关代码 |
| （Shipment） | ❌ 不存在 | ❌ 不存在 | — | — | `11-shipment.prisma` 无命中 |

### 5.1 取证结论与待决

**已确认（无需再取证）**：
- `Quotation` / `SampleOrder` / `SalesOrder` / `Shipment` **当前均无** `channelId` / `shopId` 列
- 这四个模块的 controller 中**无** channel/shop 相关校验或写入
- 因此**不存在**「自动从 Customer 复制渠道」的代码 → §12「不得自动复制 Customer」**当前已合规**

**需人工裁决（R3-Q2）**：
| 候选 | 描述 | 影响 |
|---|---|---|
| **A** | 四张单据**不引入** channelId/shopId，渠道归属统一由「所属 Sales Record / Opportunity」联查 | 零迁移；但「一次订单来自不同渠道」无法表达（如老客户经展会追加订单） |
| **B** | 仅在 `SalesOrder` 引入（成交时归属），Quotation/SampleOrder 联查上游 | 中等成本；可表达「订单渠道」 |
| **C** | 全部引入（每张单据记录自己的渠道归属） | 成本最高；需为每张单据定义「可否与上游不同」与冻结规则 |

**建议倾向（仅供决策参考，未冻结）**：候选 A 或 B。理由：Quotation/SampleOrder 的渠道归属可由 `opportunity.channelId` 完全表达（它们都是商机的直接下游分支，见上一轮 D15 并行链路结论）；只有「老客复购、无商机直连订单」的场景才需要订单自己的渠道 —— 而该场景**当前 UI 不存在**（`SalesOrders.tsx` 的 `opportunityId` 必填）。

---

## 6. SOURCE_DEPRECATION_PLAN

> §7 要求：先完整取证，再形成计划。**本轮不删除任何 Schema。**

### 6.1 使用点清单（`Customer.source`）

| # | 位置 | 类型 | 用途 | 废弃影响 |
|---|---|---|---|---|
| 1 | `server/prisma/schema/03-customer.prisma:38` | **列定义** | `source LeadSource?` | 需 DROP COLUMN 迁移 |
| 2 | `migrations/20260913000000_v1_0_baseline/migration.sql:307` | **DDL** | 列创建（可空无默认） | 新迁移 drop |
| 3 | `server/src/controllers/customer.controller.ts:1017` | **写入** | create 固定 `"MANUAL"`（D-SOURCE-2） | 删除该赋值 |
| 4 | `customer.controller.ts:1405`、`:1436` | **写入** | importExcel 固定 `"EXCEL"`（D-SOURCE-3） | 删除该赋值 |
| 5 | `customer.controller.ts:899 / 928 / 948 / 1016 / 1159 / 1391 / 1435` | **注释** | D-SOURCE-2/3/4 规则文本 | 规则文档化后删除 |
| 6 | `client/src/api/customers.ts:20` | **类型声明** | `source?: string` | 随契约移除（无渲染点） |
| （排除）| `client/src/api/customers.ts:133` `CustomerLeadSummary.source` | **类型声明** | ⚠️ **实为 Lead.source** | **不受影响，勿误删** |
| （排除）| `server/src/scripts/**` 4 个脚本 | — | **不写 Customer** | 无影响 |
| （排除）| `/export` 端点 | — | **不存在** | 无影响 |
| （排除）| 过滤 / 排序 / 统计 / groupBy / 报表 | — | **0 命中** | 无影响 |
| （排除）| 前端表单 / 列表 / 筛选器 | — | **0 渲染点** | 无影响 |

### 6.2 逐问回答（§7 的 8 个问题）

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| **1** | 哪些地方使用 source | 仅 4 个**写入点**（2 处代码 + 2 处 DDL/类型），**零读取/过滤/统计/导出/展示** | §6.1 |
| **2** | 哪些地方必须停止使用 | `customer.controller.ts:1017`、`:1405`、`:1436`（三处赋值） | 同上 |
| **3** | 哪些 API contract 受影响 | ⚠️ **无「语义级」contract 变更**。仅需清理**响应体积与类型**：`listMy`（`:192`）与 `getById`（`:695`）使用 `include`（无 select）→ 隐性回传全部标量 → 删列后自动消失；`client/src/api/customers.ts:20` 类型移除 | §6.1 #6 |
| **4** | 历史数据如何处理 | **无法恢复**为渠道。`source ∈ {MANUAL, EXCEL, RPA, SYNC}` 是录入方式，**不能推导获客渠道**（用户规则明确禁止）。处理方式见 6.3 | `20260925030000` 迁移无 channel 回填 |
| **5** | 是否需要 migration | **需要一条 DROP COLUMN 迁移**（`ALTER TABLE "Customer" DROP COLUMN "source";`），但**非本轮** | — |
| **6** | 是否最终删除字段 | **是**（D12-A + 系统性废弃规则 R-D9-2：停写 → 停读 → 观察一个版本 → drop） | — |
| **7** | 是否需要另一独立字段保存「录入方式」 | **取决于业务是否需要统计「数据是如何进入系统的」**。当前无任何统计/报表使用它（§6.1）→ **当前无证据支持保留** | — |
| **8** | 如果录入方式不是业务需求，不要为保存旧字段而新建字段 | **遵守**。不新建 `ingestionSource` / `entryMode` 等。若未来出现该需求，应作为**独立 Decision** 提出并绑定真实消费方（报表/看板） | 用户规则 §7 |

### 6.3 废弃节奏（三候选，需 R3-Q4 裁决）

```
【候选 1 · 直接删除（一个 Release 内）】
  ① 删除 3 处写入（1017 / 1405 / 1436）
  ② 删除 schema 列 + 生成 DROP COLUMN 迁移
  ③ 删除 client 类型
  优点：一步到位；缺点：若存在未发现的消费方（如外部 BI 直连 DB）会立即中断

【候选 2 · 三阶段（推荐）】
  Phase A（停写）：删除 3 处写入；保留列（值冻结在写入时刻，新数据为 NULL）
  Phase B（观察一个 Release）：确认无消费方、无外部直连依赖
  Phase C（删除）：DROP COLUMN + 清理注释 + 删除 client 类型

【候选 3 · 保留为 deprecated 只读】
  列保留但标注 @deprecated；永不写入
  优点：零风险；缺点：违反 R-D9-2（禁止「有声明无接线」长期存在），
        且会成为后来者的误读源（以为 source 有意义）
```

### 6.4 历史数据处置（与 §16 一致）

| 情形 | 现状 | 处置建议（未冻结） |
|---|---|---|
| `Customer.source = MANUAL/EXCEL/RPA/SYNC` | 存在（列可空，亦可能为 NULL） | **不推导为 Channel**。随列一起删除 |
| `Customer.channelId/shopId` 为 NULL（2026-09-25 之前建档） | **存在**。`20260925030000_customer_channel_contactmethods` 仅 ADD 列，**无回填** | **保留 NULL = UNKNOWN**，不得伪造历史事实（用户规则 §16） |
| `Lead.channelId/shopId` | 自 baseline 即存在（`migration.sql:417-418`），可能有值 | 可作为旁证（若线索留存），但**不得自动回填 Customer** |
| `Lead.source` | 有值 | 保留（见 §7） |

**明确记录**：**2026-09-25 之前建档的 Customer，其「首次获客渠道」在当前数据中不可恢复**（无法由录入方式推导，且迁移未做回填）。这将进入 Migration Decision。

---

## 7. Lead.source 独立分析（§8 要求）

**状态：CONFIRMED —— 保留，与 `Lead.channelId` 语义独立**

### 结论先行
`Lead.source` 与 `Customer.source` **必须拆开判断**。取证证明二者地位不同：

| 维度 | `Customer.source` | `Lead.source` |
|---|---|---|
| 写入点 | 2 处（固定常量） | 2 处（`createLead:672` `data.source ?? 'MANUAL'`；`updateLead:182` 白名单 + `:759-761` 透传） |
| 是否有**过滤**能力 | ❌ 无 | ✅ **有**：`lead.controller.ts:371,393` `req.query.source → where.source` |
| 是否有**前端展示** | ❌ 无渲染点 | ✅ **有**：`LeadTable.tsx:102-108`（SOURCE_META 列） |
| 是否有 i18n | ❌ 无 | ✅ **有**：`zh.json:684-688`、`en.json:656-660`（`sourceManual/Excel/Rpa/Sync`） |
| 是否在关联投影中出现 | 仅类型声明（实为 Lead.source） | ✅ `customer.controller.ts:763` 客户详情内线索投影 |
| 是否进入操作日志 diff | ❌ | ✅ `lead.controller.ts:19` 中文名 `'来源'` |
| 默认值 | 无（可空） | `@default(MANUAL)` + 索引 `Lead_source_idx` |
| RPA / SYNC 是否有代码路径 | — | ❌ **无任何写入路径**（纯声明：枚举 + zod 枚举 `:105` + i18n + SOURCE_META） |

### 目标规则
```
R3-SRC-1  Lead.source 保留，语义为「Lead 数据进入系统的方式」，与
          Lead.channelId（最初获客渠道）是两个不同事实，禁止合并
          （SSOT-GLOBAL-02）。

R3-SRC-2  Lead.source 的写入应以「数据入口」为唯一依据（当前 createLead
          是唯一业务入口）。updateLead 若能改 source，需定义业务理由，
          否则应收紧白名单。

R3-SRC-3  LeadSource.RPA / LeadSource.SYNC 当前无任何代码路径。
          按 R-D9-1（禁止「有声明无接线」），应二选一：
            ① 删除未启用的枚举值
            ② 显式声明为 Reserved 并标注目标版本与负责人
```

### 需要人工确认
**R3-Q6**：`Lead.source` 是否保留？（证据支持保留）是否收紧 `updateLead` 的 source 白名单？`RPA`/`SYNC` 删除还是 Reserved？

---

## 8. FIRST ACQUISITION FACT · 事件取证（§15 要求）

**状态：NEED REVIEW（R3-Q3）**

> §15 要求：**不要自行假设状态名**，必须查清实际系统中哪一个事件才是「首次获客事实」。

### 8.1 候选事件与实测

| # | 候选事件 | 确切触发点 | channelId 已定？ | Customer 已存在？ | 服务端强制？ |
|---|---|---|---|---|---|
| ① | Lead 创建 | `lead.controller.ts:551`（`POST /leads`），channel 来自 `sourceKey` 拆分 `:555-557` | ✅ 创建即定 | ❌ 否 | ✅ 端点强制 |
| ② | 暂存 `draft=true` | `LeadFormModal.tsx:1011-1041`（`:1028` `draft = editing?.draft ?? true`） | ✅ 已定 | ❌ 否 | ❌ 前端可选 |
| ③ | 正式提交 `draft=false` | `LeadFormModal.tsx:1053-1079`（`:1066`） | ✅ 已定 | ⚠️ 可能已存在 | ❌ **服务端只接收布尔值，无校验** |
| ④ | **Customer 建档** | `customer.controller.ts:956`，写 channel `:1012-1013`；由 `LeadFormModal.tsx:1090-1103` / `:1193-1216` 调用 | ✅ 已定 | ✅ **本点为诞生点** | ❌ 前端调用 |
| ⑤ | `Lead.customerId` 回写 | `lead.controller.ts:830`；前端 `LeadFormModal.tsx:1167-1179`、`:1495`、`convertLead.ts:116/137`、`:1324` | ✅ 已定（之后仍可改） | ✅ 是 | ❌ 前端调用 |
| ⑥ | **建商机 → `status=CONFIRMED`** | **服务端强制**：`sales.controller.ts:442` `advanceLeadStatus`；`utils/leadStatus.ts:30-40` 单调推进 | ✅ 已定 | ✅ **必存在**（`sales.controller.ts:379` 校验） | ✅ **是（无人工入口）** |
| ⑦ | `customerLocked/productLocked` 置位 | 前端 `LeadFormModal.tsx:1171`（建档）、`:1030/:1067`（暂存/提交）；服务端仅落库 `lead.controller.ts:696-697` | ✅ 已定 | 视路径 | ❌ 前端 |

### 8.2 典型时序（新建线索路径）

```
② 暂存（Lead 创建，draft=true）
      ↓
④ Customer 建档 ← ★ Customer.channelId/shopId 首次落库（首次获客事实实际形成点）
      ↓
③⑤⑦ 同一次 leadApi.update（LeadFormModal.tsx:1167-1181）
     = customerId 回写 + customerLocked=true + draft=false
      ↓
⑥ 建商机 → 服务端 advanceLeadStatus → Lead.status = CONFIRMED
```

### 8.3 关键结论（必须人工裁决）

1. **`Lead.status=CONFIRMED` 的实际语义 = 「已转商机」**，而**不是**「已建档/已确认客户」。它由**创建 Opportunity** 触发（`sales.controller.ts:442`），且**无人工入口**（`routes/lead.routes.ts:23` 注释明确「状态只由单据事件推进」）。
2. **`Customer.channelId/shopId` 的首次落库发生在事件 ④（Customer 建档）**，**早于** 事件 ⑥（CONFIRMED）。数据来源是**请求体 `sourceKey` / 显式 channelId**（`splitSourceKey` `customer.controller.ts:844-855`），**不是服务端从 Lead 读取**。
3. **因此当前系统中「首次获客事实」没有单一权威事件**：它由前端在 Customer 建档请求里带值决定，服务端不校验、不与 Lead 对账、不幂等。
4. **`draft=false`（事件 ③）同样不构成权威事件**：服务端只落库布尔值（`lead.controller.ts:692-697`），不触发任何渠道冻结。

### 8.4 建议冻结（需 R3-Q3 确认）

```
【建议】FIRST ACQUISITION FACT 的权威事件 = Customer 建档（事件 ④）
        理由：Customer.channelId/shopId 的首次落库就是该事件，且语义上
              「首次获客」本就随 Customer 主数据的诞生而成立。

        但必须补三个约束（否则 D1-D 无法成立）：
        ① 建档必须在服务端事务内由 Lead 派生 channelId/shopId
           （而非信任前端传来的 sourceKey）
        ② 建档时 channelId/shopId 一次写入后冻结（禁止后续 update 改写）
        ③ 建档必须幂等（同一 Lead 重复建档不得产生两个 Customer）

【替代选项】若业务认可「Confirm（=转商机）才是正式确认」，
        则需把 Customer 创建时机推迟到 Confirm（即上一轮 D13 候选 A），
        使「首获事实」与「正式确认」合一时点。→ 与 D13-Q1 联动
```

### 依赖
**D13**（Customer 创建时机）、**D1-D**（永久保持）、**D11**（状态机权威）

---

## 9. 剩余问题逐条回答（§20 的 6 问）

### Q1 · `Customer.source` 是直接废弃，还是先 deprecated → migration → 删除？
**答**：建议**三阶段**（§6.3 候选 2）。理由：`Customer` 表被外部 BI / 报表直连的可能性无法从代码排除（代码证据只能证明「应用内 0 消费」），而 DROP COLUMN 不可逆。
**需裁决**：R3-Q4。

### Q2 · 如果业务仍需要「数据进入系统的方式」，是否保留独立字段？
**答**：**当前无证据支持保留**。`Customer.source` 无任何统计/报表/筛选/展示消费（§6.1）。按用户规则 §7「不要为了保存旧字段而机械新增 `ingestionSource`」→ **不新增**。
若未来需要，应作为**独立 Decision** 提出，并强制绑定真实消费方（具体报表/看板 + 字段清单）。
**需裁决**：R3-Q5。

### Q3 · `Lead.source` 是否仍具有独立业务价值？
**答**：**是，保留**。它有前端列表展示（`LeadTable.tsx:102-108`）、i18n（`zh.json:684-688`）、后端过滤（`lead.controller.ts:371,393`）、操作日志 diff（`:19`）、默认值与索引。与 `Lead.channelId` 是两个不同事实（SSOT-GLOBAL-02 明确不得合并）。
附带问题：`RPA`/`SYNC` 两个枚举值**无任何代码路径**（纯声明）→ 建议删除或标注 Reserved（R3-SRC-3）。
**需裁决**：R3-Q6。

### Q4 · Lead Confirm 的实际状态/事件是什么？
**答**：**两个不同的东西共用了「Confirm」这个词**（必须区分）：
- **`Lead.draft = false`（前端「正式提交」）**：`LeadFormModal.tsx:1066`。服务端仅落库布尔值（`lead.controller.ts:692-697`），**无校验、无副作用、无冻结**。
- **`Lead.status = CONFIRMED`（服务端「已转商机」）**：由**创建 Opportunity** 触发（`sales.controller.ts:442` → `advanceLeadStatus`）。**唯一服务端强制事件**，无人工入口。

→ 业务上的「正式确认」若指「客户已确认/线索已成立」，当前**没有对应事件**；若指「已转为商机」，则为 `status=CONFIRMED`。**需业务明确**（R3-Q3）。

### Q5 · Customer 首次获客事实在历史数据中哪些可以恢复？
**答**：
| 数据 | 可恢复性 | 依据 |
|---|---|---|
| `Customer.channelId/shopId`（2026-09-25 之后建档） | ✅ 有值（前端带入） | `20260925030000` 迁移 ADD 列后由应用写入 |
| `Customer.channelId/shopId`（2026-09-25 之前建档） | ❌ **不可恢复**（迁移无回填） | `20260925030000_customer_channel_contactmethods/migration.sql` **仅 ADD 列，无 UPDATE** |
| `Customer.source` | ⚠️ 有值但**不能推导渠道**（录入方式 ≠ 获客渠道） | 用户规则 §16 明确禁止推导 |
| `Lead.channelId/shopId` | ✅ 自 baseline 即存在（`migration.sql:417-418`），**可能有值** | 可作旁证，但**不得自动回填 Customer**（需人工 Migration Decision） |

**结论**：**2026-09-25 之前建档的 Customer，「首次获客渠道」在当前数据中不可恢复** → 必须保留为 `NULL = UNKNOWN`，**不得伪造历史事实**（用户规则 §16）。

### Q6 · `Quotation` / `SampleOrder` / `SalesOrder` 是否各自需要 `channelId/shopId`？
**答**：见 **§5**。
**已确认**：三者当前**均无**该字段，controller 中也无 channel 相关代码 → §12「不得自动复制 Customer」**当前已合规**。
**需裁决（R3-Q2）**：候选 A（不引入，联查）/ B（仅 SalesOrder 引入）/ C（全部引入）。

---

## 10. 实施影响范围（标记，不实施）

| # | 影响项 | 位置 | 性质 | 依赖裁决 |
|---|---|---|---|---|
| 1 | **Customer 建档后可改写 channelId/shopId** | `customer.controller.ts:1138-1169`（update 恒写 `:1156-1157`）；触发 `LeadFormModal.tsx:1132`、`:1323` | ❌ 与 **D1-D** 冲突 | R3-Q7 |
| 2 | **Lead 任意状态可改 channelId/shopId** | `lead.controller.ts:180-181`（白名单）+ `:812-813`（写入）；全程不读 status | ❌ 与 **D1-B**（CONFIRMED 后冻结）冲突 | R3-Q7-1 |
| 3 | **在途 `Opportunity.channelId/shopId`** | `05-opportunity.prisma:41-46` + 迁移 `20260928120000` + `sales.controller.ts:412-413` | ⚠️ 与 **STRUCT-GLOBAL-01** 关系（合入则三层结构完整，回退则靠联查） | R3-Q5-1 |
| 4 | **Opportunity 侧无渠道校验** | `sales.controller.ts:412-413` 直接落库；`Channel` 上无反向 relation | ❌ 与 Lead/Customer 的 `validateChannelShop*` 不一致 | 随 #3 一并裁决 |
| 5 | **商机第三套渠道词汇表 + 静默丢弃** | `SalesFormModal.tsx:161-177`（12 枚举）、`:261`（表单字段）、`api/sales.ts:15`（`source?`）、`OpportunityDetailPanel.tsx:214`；`sales.controller.ts` 中 `source` **0 命中** | ❌ **STRUCT-GLOBAL-02 违规 + 静默数据丢失** | R3-Q8 |
| 6 | **`splitSourceKey` 复制两份** | `lead.controller.ts:316` + `customer.controller.ts:844`（实现完全相同） | ❌ **STRUCT-GLOBAL-04 违规** | 可直接归并（无需业务裁决） |
| 7 | **`Customer.source` 三处写入** | `customer.controller.ts:1017`、`:1405`、`:1436` | 废弃计划（§6） | R3-Q4 / Q5 |
| 8 | **`LeadSource.RPA/SYNC` 无代码路径** | `00-enums.prisma:119-120` + `lead.controller.ts:105` + i18n + SOURCE_META | ⚠️ R-D9-1 违规 | R3-Q6 |
| 9 | **Channel 树无层级约束 / 孤儿 shop 风险** | `channel.controller.ts:109-117`（注释称级联删除，实为 `onDelete: SetNull`）；`@@unique([parentId, name])` 对根节点无效 | ⚠️ 影响 STRUCT-GLOBAL-01 落地（「Shop 必须属于 Channel」无 DB 兜底） | R3-Q1 |
| 10 | **Shop 无独立模型** | 全量 52 model 无 `Shop`/`Platform`/`Store`；`shopId → Channel` | ⚠️ 与 STRUCT-GLOBAL-01 的 `shopId → Shop` 字面要求不符 | **R3-Q1** |
| 11 | **`Customer.channelId/shopId` 历史 NULL** | `20260925030000` 迁移仅 ADD 列 | 不可恢复（§9-Q5） | 进入 Migration Decision |

---

## 11. 本轮新发现（7 项，含 1 项静默数据丢失 bug）

### 11-1 · 「首次获客事实」当前没有单一权威事件（高）
`Customer.channelId` 首次落库于 **Customer 建档**（`customer.controller.ts:1012-1013`），**早于** `Lead.status=CONFIRMED`（由建商机触发 `sales.controller.ts:442`）。且落库值来自**前端请求体**，服务端不校验、不与 Lead 对账、不幂等。
→ 直接威胁 D1-C（传递一致性）与 D1-D（永久保持）的落地。

### 11-2 · 「Shop」不是独立模型（结构级，高）
`shopId` 当前指向 **`Channel` 表**（同一张自关联树，`parentId` 非空即平台）。用户的 STRUCT-GLOBAL-01 写的是 `shopId → Shop`，但**系统里没有 `Shop` 表**。
→ 这是 STRUCT-GLOBAL-01 落地时必须先裁决的结构选择：

| 候选 | 描述 | 代价 |
|---|---|---|
| **A** | 承认「Shop = Channel 树中的平台节点」，**保持** `shopId → Channel`，字段名不变 | 零迁移；代价：FK 目标名（Channel）与字段名（Shop）语义轻微错位，但符合「禁止新增字段名」的约束 |
| **B** | 新增独立 `Shop` 模型（`shop.channelId` FK），`shopId` 改指向 Shop | 需迁移 + 新表；语义最清晰，最符合 STRUCT-GLOBAL-01 字面 |
| **C** | 把 `Channel` 概念统一（如 `ChannelNode`），`channelId` 指根、`shopId` 指子节点 | 重命名成本高；破坏现有 FK 与前端契约 |

**注**：用户规则 §11 要求「`shop.channelId === channelId` 服务端校验」——该规则在 **Customer/Lead 侧已实现**（见 11-3），**Opportunity 侧缺失**。

### 11-3 · 一致性校验现状（部分合规）
**已实现**（语义等价，文案相同）：
- `validateChannelShopCustomer`（`customer.controller.ts:858-882`）：channel 存在 + `ACTIVE`；shop 存在 + `ACTIVE`；`channelId && shopId` 时校验 **`shop.parentId === channelId`**（`:876`，文案「来源平台不属于所选来源渠道」）
- `validateChannelShop`（`lead.controller.ts:329-360`）：语义等价，改用 `fail()`
**缺失**：
- `Opportunity`（`sales.controller.ts:412-413`）**无任何校验**
- `Quotation`/`SampleOrder`/`SalesOrder`/`Shipment` 无字段，自然无校验
**无冗余展示字段（STRUCT-GLOBAL-03 已合规）**：全量搜索 `channelName`/`shopName`/`sourceName`/`storeName`/`platformName` → 仅 `seed.ts:525` 一个局部变量；展示一律走关系嵌套 select（`sales.controller.ts:89-90`）。
**前端行为一致**：`flattenChannelOptions`（仅根节点=渠道）+ `flattenPlatformOptions`（选中渠道后列其下平台）（`lead/constants.ts:22/26`）；`SalesLeads.tsx:228/240`、`Sales.tsx:169/179` 已按 channel 过滤 shop；且前端**刻意不做 `shopId=channelId` 兜底**（`LeadFormModal.tsx:270-274/838-844`）以避开后端 400。

### 11-4 · 商机存在「第三套渠道词汇表」，且用户选择被静默丢弃（**bug**，高）
`client/src/components/sales/SalesFormModal.tsx:161-177` 定义了 **12 个硬编码获客渠道**：

```
ALIBABA / MADE_IN_CHINA / INDEPENDENT_SITE / FACEBOOK / INSTAGRAM /
LINKEDIN / GOOGLE / EXHIBITION / OLD_CUSTOMER / REFERRAL / OTHER / LEAD_CONVERT
```
该字段是**活的表单字段**（`SalesFormModal.tsx:261` `<Form.Item name="source" label={t('sales.source.label')}>`），提交时经 `payload = { ...values, ... }`（`:143-149`）**交给服务端**。

而服务端 `createOpportunitySchema`（`sales.controller.ts`）**不含 `source`**，且 `server/src/controllers/sales.controller.ts` 中 **`source` 0 命中** → zod 白名单**静默剥离**该字段。

后果：
1. 用户选择「ALIBABA」→ 保存成功 → **值从不落库** → 重开表单来源为空 → **静默数据丢失**
2. `OpportunityDetailPanel.tsx:214` 仍展示 `t('sales.source.label')`（值恒为空）
3. `convertLead.ts:161` 也传 `source: lead.channel?.name || lead.shop?.name` → **同样被丢弃**
4. `api/sales.ts:15` 的 `SalesItem.source?: string` 是**永不为真的类型声明**

→ 这同时是 **STRUCT-GLOBAL-02 的教科书级违规**（同一关系「获客渠道」在 `Channel` 表、`LeadSource` 枚举之外又发明了第三套词汇），也是 D9「声明与实现脱节」的又一实例。
**需裁决（R3-Q8）**：删除该字段与 12 个枚举（推荐）／接入 `Channel`（改为 `channelId`）。

### 11-5 · `splitSourceKey` 被复制两份（STRUCT-GLOBAL-04 违规）
`lead.controller.ts:316` 与 `customer.controller.ts:844` 实现完全相同（注释也自称「与 lead.controller.splitSourceKey 同语义」）。调用点：lead create `:555` / update `:803`；customer create `:964` / update `:1129`。
→ 应归并为单一 util。**无需业务裁决**。

### 11-6 · Channel 树的数据完整性缺口（影响 STRUCT-GLOBAL-01 落地）
- **孤儿 shop（确认存在）**：`deleteChannel`（`channel.controller.ts:109-117`）注释称「删除父级时级联删除子平台」，但 relation 实为 **`onDelete: SetNull`**（`03-customer.prisma:157`）→ 实际把子节点 `parentId` 置 NULL，**成为根节点/孤儿**，而非删除。**注释与行为矛盾**。
- **同名根渠道可重复**：`@@unique([parentId, name])`（`:171`）在 PG 中 `parentId = NULL` 视为互异 → 多个同名根渠道可创建。
- **无层级深度约束**：`createChannel`（`channel.controller.ts:66-69`）只让子级继承父级 category，不校验父级必为根节点 → **可造 shop-under-shop（3+ 层）**。
- → 「Shop 必须属于 Channel」目前**只有应用层校验，无 DB 兜底**。

### 11-7 · `Lead.source` 有两个死枚举值
`LeadSource.RPA` / `LeadSource.SYNC` **无任何代码路径写入**（仅存在于枚举定义、zod 枚举、i18n 标签、前端 SOURCE_META）。→ R-D9-1 违规（见 §7）。

---

## 12. 对其它 D 项的连带影响

| 项 | 原状态 | 本轮影响 |
|---|---|---|
| **D1** | CONFIRMED（含子冲突） | → **CONFIRMED（D1-A~E 已冻结）**；新增 R3-Q1 / R3-Q5-1 / R3-Q7 三项 |
| **D12** | **CONFLICT** | → **CONFLICT 已解除**；D12-A/D12-B 冻结；剩余为废弃节奏（R3-Q4/Q5） |
| **D2** | CONFIRMED（含 ACTION） | 新增约束：CONFIRMED 后需冻结 channelId/shopId（R3-D1-CH2） |
| **D3** | NEED REVIEW | 受影响：`Lead.intake*` 重命名清单需**排除** channelId/shopId（它们不是 intake，是 Lead 自身事实 —— 符合 D1-B） |
| **D9** | NEED REVIEW | **新增 3 项**：商机 `source` 幽灵字段（11-4）、`LeadSource.RPA/SYNC`（11-7）、`splitSourceKey` 重复（11-5） |
| **D10** | CONFIRMED（含 ACTION） | 无变化 |
| **D11** | CONFIRMED（含 ACTION） | 新增：渠道冻结需与状态机联动（CONFIRMED 状态触发冻结） |
| **D13** | NEED REVIEW | **升为高优先**：Customer 创建时机直接决定「首次获客事实」的权威事件（§8.4） |
| **D14** | CONFIRMED（含 ACTION） | 新增：Opportunity 渠道校验缺失（11-3）+ 在途字段（#3） |
| **D15** | CONFIRMED | 无变化（但 §5.1 的 Quotation/SampleOrder 渠道决策依赖其并行链路结论） |
| **D16** | NEED REVIEW | 无变化 |
| **D17** | NEED REVIEW | 新增：`splitSourceKey` 的归属（应入共享 util 层） |

---

## 13. 附录 · 本轮新增全局规则（供写入正式规范）

```
── SSOT-GLOBAL ──────────────────────────────────────────────
SSOT-GLOBAL-01  同一业务事实必须具有唯一权威来源。
SSOT-GLOBAL-02  不同业务事实即使名称相似，也不得强行合并。
                （例：Lead.source / Customer.source / Channel /
                  First Acquisition Channel / Sales Record Channel
                  不能因为都叫 source/channel 就视为同一事实）

── STRUCT-GLOBAL ────────────────────────────────────────────
STRUCT-GLOBAL-01  同一类关系使用统一字段结构（channelId → Channel,
                  shopId → Shop）。
                  禁止 leadChannel / customerChannel / salesChannel /
                  sourceChannel / acquisitionChannel / channelName / shopName
                  等仅为页面而产生的重复关系字段。
STRUCT-GLOBAL-02  不因页面、模块或前端组件不同而重复设计同一关系。
STRUCT-GLOBAL-03  展示名称通过 JOIN 获取，不在多个业务表重复保存。
STRUCT-GLOBAL-04  通用组件优先建立在稳定的数据结构之上，而不是为每个
                  业务页面创建专用字段。

── 由本轮冻结派生的实施规则 ─────────────────────────────────
R3-D1-CH1  Lead Draft 阶段 channelId/shopId 可补充与调整。
R3-D1-CH2  Lead 进入 CONFIRMED 后 channelId/shopId 冻结（服务端强制）。
R3-D1-CH3  Lead → Customer 传递必须保持一致（服务端事务内派生，
           不信任前端请求体）。
R3-D1-CH4  已存在 Customer 时新增不同渠道 Sales Record，
           不得改写 Customer.channelId/shopId。
R3-D1-CH5  任何同时填写 channelId 与 shopId 的业务对象，
           必须由服务端校验 shop.channelId === channelId
           （前端过滤不是权威）。
R3-SRC-1   Lead.source 保留，与 Lead.channelId 是两个不同事实。
R3-SRC-3   LeadSource.RPA / SYNC 无代码路径 → 删除或标注 Reserved。
```

---

## 14. 本轮零改动声明

```
CODE CHANGE      = 0
SCHEMA CHANGE    = 0
MIGRATION CHANGE = 0
DATABASE CHANGE  = 0
API CHANGE       = 0
FRONTEND CHANGE  = 0
COMMIT           = 0
PUSH             = 0
```

本轮仅新增本文件（`YSEM决策冻结-渠道归属最终规则.md`），未修改任何既有文件、代码或 Schema。

**等待下一轮人工 Decision Freeze。**
