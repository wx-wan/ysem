# Round R-1.1 · Prisma Relation Repair Report

> 本轮属 **Architecture Repair**（非 Business Refactor）。
> 仅处理 Prisma schema relation 完整性、`prisma validate`、`prisma generate`。
> **未 commit、未 push。**

---

## 1. BASELINE

| 项 | 值 |
|---|---|
| HEAD | `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`（本轮结束时**未变化**） |
| origin/master | `66ebebec42e1937482f6753ff92703310cb49d2f` |
| branch | `master`（本地领先 origin/master 1 个提交） |
| working tree（开工） | R-1 遗留：2 modified（`server/package.json`、`server/src/middleware/errorHandler.ts`）+ 分层基座新文件 + 4 个 md；**无用户未提交的代码改动** |
| working tree（收工） | 上表 + **1 个新增 modified**：`server/prisma/schema/03-customer.prisma` |
| Prisma CLI | 5.22.0 |

修复前基线：

```
$ npx prisma validate
Error code: P1012
error: ... field `channel` on model `Opportunity` is missing an opposite relation field
       on the model `Channel`.   --> prisma/schema/05-opportunity.prisma:43
error: ... field `shop` on model `Opportunity` is missing an opposite relation field
       on the model `Channel`.   --> prisma/schema/05-opportunity.prisma:45
Validation Error Count: 2
```

---

## 2. ROOT CAUSE

提交 `bfa45fc` 在 `Opportunity` 上声明的两条关系**缺少 `Channel` 侧的反向 relation 字段**：

| 侧 | 现状（修复前） |
|---|---|
| `Opportunity`（FK 侧，`05-opportunity.prisma:41-45`） | `channel Channel? @relation("OpportunityChannel", …)`<br>`shop Channel? @relation("OpportunityShop", …)` |
| `Channel`（反向侧，`03-customer.prisma:166-169`） | 只有 `leads` / `leadShops` / `customers` / `customerShops` —— **缺** `OpportunityChannel` / `OpportunityShop` 的反向字段 |

Prisma 要求**具名关系的两端都必须声明字段**。缺一即 P1012，导致：
`validate` 失败 → `generate` 失败 → 生成物停留在改动前（Sep 27 18:33） → `tsc` 报 `TS2353`（`'channelId' does not exist in … OpportunityUncheckedCreateInput`） → **`npm run build` 与 `Dockerfile.server` 构建流水线均被阻断**。

> 上一轮审计（R-0 §11-3）曾把该问题记录为「Opportunity 的关系未在 `Channel` 上声明反向（**不对称**）」。实际后果比「不对称」严重：**schema 不可编译**。

---

## 3. FIX（唯一改动）

**文件**：`server/prisma/schema/03-customer.prisma`（`model Channel`，反向 relation 分组内）
**性质**：纯 schema 关系声明；**不产生任何数据库列、约束或索引变更**

```167:178:server/prisma/schema/03-customer.prisma
  leads     Lead[] @relation("LeadChannel")
  leadShops Lead[] @relation("LeadShop")
  customers     Customer[] @relation("CustomerChannel")
  customerShops Customer[] @relation("CustomerShop")
  // 商机来源渠道 / 平台的反向 relation（真实外键在 Opportunity 一侧：channelId / shopId）。
  // 两条字段名必须互异（opportunities / opportunityShops），与上方 customers / customerShops 同模式；
  // 缺失任一都会导致 Prisma schema 校验失败（P1012，Round R-1.1 修复项）。
  // 纯 schema 关系声明：不产生任何数据库列、约束或索引变更。
  opportunities    Opportunity[] @relation("OpportunityChannel")
  opportunityShops Opportunity[] @relation("OpportunityShop")
```

**命名依据**：与既有模式一一对齐 ——
`LeadChannel → leads` / `LeadShop → leadShops` / `CustomerChannel → customers` / `CustomerShop → customerShops`
→ `OpportunityChannel → opportunities` / `OpportunityShop → opportunityShops`。
（字段名必须互异，否则同一 model 上出现重名字段。）

完整 diff：

```diff
@@ -167,6 +167,12 @@ model Channel {
   leadShops Lead[] @relation("LeadShop")
   customers     Customer[] @relation("CustomerChannel")
   customerShops Customer[] @relation("CustomerShop")
+  // 商机来源渠道 / 平台的反向 relation（真实外键在 Opportunity 一侧：channelId / shopId）。
+  // 两条字段名必须互异（opportunities / opportunityShops），与上方 customers / customerShops 同模式；
+  // 缺失任一都会导致 Prisma schema 校验失败（P1012，Round R-1.1 修复项）。
+  // 纯 schema 关系声明：不产生任何数据库列、约束或索引变更。
+  opportunities    Opportunity[] @relation("OpportunityChannel")
+  opportunityShops Opportunity[] @relation("OpportunityShop")
```

**未改动**：`05-opportunity.prisma` 一行未动（其关系声明本身是正确的）。

---

## 4. VALIDATION

### 4.1 核心三项（本轮目标）

| 检查 | 修复前 | 修复后 |
|---|---|---|
| `npx prisma validate` | ❌ `P1012`，Validation Error Count: **2** | ✅ **`The schemas at prisma/schema are valid 🚀`**（exit 0） |
| `npx prisma generate` | ❌ 失败（未生成） | ✅ **`✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 2.35s`**（exit 0） |
| `npx tsc --noEmit` | ⚠️ **1 error**：`sales.controller.ts(412,11) TS2353` | ✅ **error count = 0** |
| `npm run build`（= `tsc`） | ❌ 失败 | ✅ 通过（同上） |

### 4.2 运行时级验证（DMMF，Prisma 运行时正是据此校验入参）

生成客户端已重新生成，`Prisma.dmmf.datamodel` 实测：

```
Opportunity 关系/外键字段 : channelId(String), channel(Channel / OpportunityChannel),
                            shopId(String), shop(Channel / OpportunityShop)
Channel 反向 Opportunity 字段: opportunities[OpportunityChannel], opportunityShops[OpportunityShop]
Channel 反向 relationName 全集:
  ChannelTree, ChannelTree, LeadChannel, LeadShop,
  CustomerChannel, CustomerShop, OpportunityChannel, OpportunityShop
```

→ **双向关系已完整接线**；`Channel` 上 8 条关系全部齐备。
→ R-1 报告中「运行时 `Unknown argument 'channelId'`」的问题**已消除**。

生成物标识符命名说明（避免误判）：Prisma 生成的 `.d.ts` 标识符**由字段名派生**（如 `ChannelCountOutputTypeCountOpportunityShopsArgs`），**不使用 relation 名**。因此以 `grep OpportunityChannel` 判断生成物新旧**不可靠** —— 正确代理是字段名（`opportunities` / `opportunityShops` / `channelId`）。

### 4.3 回归检查（不受影响，已复跑）

| 检查 | 结果 |
|---|---|
| `npx tsx src/scripts/check-layering.ts` | 31 处违规（与 R-1 完全一致，本轮未涉业务层） |
| Controller 去 Prisma 化进度 | 6%（不变） |
| `src/` 文件总数 | 96（不变） |

---

## 5. 新发现（NEW FINDING · 需裁决）

> **迁移 `20260928120000_add_channel_to_opportunity` 尚未应用到数据库 → 该功能目前仍不可用。**

### 证据 1 · 迁移状态（只读查询）

```
$ npx prisma migrate status
Datasource "db": PostgreSQL database "ysem", schema "public" at "localhost:5432"
18 migrations found in prisma/migrations
Following migration have not yet been applied:
20260928120000_add_channel_to_opportunity
```

### 证据 2 · 数据库列实测（只读查询，无任何写入）

```js
prisma.opportunity.findMany({ select: { id: true, channelId: true, shopId: true }, take: 1 })
```
```
PrismaClientKnownRequestError | code = P2022
The column `Opportunity.channelId` does not exist in the current database.
```

### 影响与当前状态链

| 环节 | 状态 |
|---|---|
| Prisma schema | ✅ 有效（本轮修复） |
| Prisma Client | ✅ 已生成，含 `channelId` / `shopId` 与双向关系 |
| **数据库表** | ❌ **缺 `Opportunity.channelId` / `shopId` 两列** |
| 结果 | 商机渠道（`convertLead.ts:166-167` 转商机时传 `channelId`/`shopId`）**仍会在运行时失败**，只是错误从「未知参数」变为「列不存在（P2022）」 |

**本轮未处理**：应用迁移会修改数据库结构，与本轮「禁止创建 migration / 禁止修改数据库结构」冲突 → 列入 §7 DECISION REQUIRED。

---

## 6. 附带发现 · `prisma format` 的副作用（安全提示）

调查初期我用 `npx prisma format --schema=prisma/schema` 作为「全量缺失关系扫描」手段，得到一条与 `validate` 不同的报错：

```
Error: Field "Opportunity" is already defined on model "Channel".
--> prisma/schema/03-customer.prisma:171
170 |  Opportunity   Opportunity[]
171 |  Opportunity   Opportunity[]
```

**这说明 `prisma format` 会在内存中自动补全缺失的反向 relation 字段**，并把两条关系都命名为默认的 `Opportunity` → 触发重名错误 → 校验失败 → **本次未写盘**。

已做安全核验（三重确认文件未被改动）：

| 核验 | 结果 |
|---|---|
| `git diff -- server/prisma/schema/03-customer.prisma` | 空 |
| 工作区 vs `git show HEAD:` 同区域 | 完全一致 |
| 文件 mtime | 仍是 `Sep 27 18:33`（未更新） |

**风险提示**：若当时**只缺一条**反向关系，`prisma format` 会**静默写入**一个默认命名的字段（无人察觉的 schema 变更）。建议团队约定：**不要用 `prisma format` 作为校验/扫描手段**（用 `prisma validate`），且对 `prisma/schema/` 目录执行 `format` 前必须先 `git status` 干净。

---

## 7. DIFF SCOPE

| 边界 | 状态 | 证据 |
|---|---|---|
| 业务规则 | ✅ 无变更 | 未改任何 controller 逻辑 |
| API contract | ✅ 无变更 | 无 route / DTO / 响应结构改动；新增的反向关系**无任何 controller 读取**（全仓无 `channel.opportunities` / `opportunityShops` 引用） |
| Frontend | ✅ 无变更 | `git diff --name-only \| grep client/` → 空 |
| Controller 逻辑 | ✅ 无变更 | 本轮 diff 不含 `server/src/controllers/**` |
| Lead / Customer / Opportunity 生命周期 | ✅ 无变更 | — |
| `channelId` / `shopId` 业务语义 | ✅ 无变更 | 仅补反向声明，未改字段、未改 relation 名 |
| 新增业务字段 / 删除业务字段 | ✅ 无 | 见上 diff（仅 2 行 relation 声明 + 4 行注释） |
| 创建 migration | ✅ **未创建** | `git status --short server/prisma/migrations` → 空 |
| 修改数据库结构 | ✅ **未修改** | 未执行 `migrate dev` / `migrate deploy` / `db push`；仅执行了只读的 `migrate status` 与一条只读 `findMany` |

`git status --short`（收工）：

```
 M server/package.json
 M server/prisma/schema/03-customer.prisma     ← 本轮唯一新增改动（+6 行）
 M server/src/middleware/errorHandler.ts
?? YSEM-R1-后端分层基座报告.md
?? YSEM全域数据架构审计.md
?? YSEM决策冻结-渠道归属最终规则.md
?? YSEM架构决策冻结登记册.md
?? server/src/lib/errors.ts
?? server/src/operations/
?? server/src/repositories/
?? server/src/scripts/check-layering.ts
?? server/src/services/
```

`git diff --stat`（tracked）：`3 files changed, 22 insertions(+), 1 deletion(-)`
→ 其中本轮的贡献：`server/prisma/schema/03-customer.prisma | 6 ++++++`（其余 2 个文件为 R-1 遗留）

`server/prisma/` 下改动文件：**仅** `schema/03-customer.prisma`（1 个）

---

## 8. COMMIT STATUS

**未 commit、未 push。**

- HEAD 仍为 `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`
- `origin/master` 未做任何写入
- 所有改动留在工作树待人工裁决

---

## 9. DECISION REQUIRED

### D1（最高优先）· 是否应用迁移 `20260928120000_add_channel_to_opportunity`？

这是「商机渠道」功能真正可用的**唯一剩余前置条件**（schema ✅ / client ✅ / DB ❌）。

- 命令：`npx prisma migrate deploy`（或开发环境 `npx prisma migrate dev`）
- 本轮**未执行**（与「禁止修改数据库结构」冲突）
- 需确认：目标库（`localhost:5432/ysem`）是开发库还是共享库？是否授权应用？

### D2 · 反向关系字段名是否认可？

本轮采用 `opportunities` / `opportunityShops`（对齐既有 `customers` / `customerShops`）。
请确认命名；若希望改名（例如 `opportunitySources` / `opportunityShops`），需在迁移前决定（改名纯 schema 层，代价极低）。

### D3 · 是否把 schema/构建校验纳入门禁？

当前 `validate` / `generate` / `tsc` 均无自动化门禁，导致 `bfa45fc` 这类「schema 不可编译」的提交可以进入 master。建议（需授权）：
- **A** 新增 `npm run verify`（= `prisma validate && prisma generate && tsc --noEmit`），并纳入提交前/CI
- **B** 仅新增脚本，不设门禁
- **C** 保持现状

### D4 · 是否约定「禁止用 `prisma format` 做校验」（见 §6）？

- **A** 写入团队规范（`docs/` 或 `server/src/ARCHITECTURE.md`）
- **B** 不约定

---

## 10. 本轮执行顺序

| # | 动作 | 结果 |
|---|---|---|
| 1 | BASELINE（`git status` / `branch` / `HEAD` / `origin/master`） | ✅ §1 |
| 2 | 修复前基线取证（`prisma validate`） | ✅ P1012 ×2 |
| 3 | 全量确认缺失范围（未用 `format` 写入；经三重核验确认文件未被动过） | ✅ 仅 `channel` / `shop` 两条 |
| 4 | 补 `Channel` 反向 relation（字段名互异） | ✅ +6 行 |
| 5 | `prisma validate` | ✅ valid 🚀 |
| 6 | `prisma generate` | ✅ Generated v5.22.0 (2.35s) |
| 7 | `tsc --noEmit` + 分层检查器回归 | ✅ 0 error / 31 违规（不变） |
| 8 | 运行时级验证（DMMF / 只读 findMany） | ✅ 双向关系完整；⚠️ 发现迁移未应用（P2022） |
| 9 | 边界确认（无 migration / 无 DB 改动 / 无 API / 无前端） | ✅ §7 |

**本轮结束。未 commit。等待 D1 授权。**
