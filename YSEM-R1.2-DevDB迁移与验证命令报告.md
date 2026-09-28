# Round R-1.2 · Dev DB Migration + Verify Script Report

> 本轮为 **Implementation Only**，只执行 R-1.1 已冻结的技术决策，不进入 R-2、不做任何业务规则重构。
> **未 commit、未 push。**

> ⚠️ 你的消息在 `§一 硬性基线门` 之后被截断。本轮严格按开头明确列出的 **10 项目标** 执行；若截断部分还包含 `§二` 及后续要求，请重新发送，我再补充执行。

---

## 1. BASELINE GATE（硬性门，已通过）

```
$ git status --short
 M server/package.json
 M server/prisma/schema/03-customer.prisma
 M server/src/middleware/errorHandler.ts
?? YSEM-R1-后端分层基座报告.md
?? YSEM-R1.1-Prisma关系修复报告.md
?? YSEM全域数据架构审计.md
?? YSEM决策冻结-渠道归属最终规则.md
?? YSEM架构决策冻结登记册.md
?? server/src/lib/errors.ts
?? server/src/operations/
?? server/src/repositories/
?? server/src/scripts/check-layering.ts
?? server/src/services/

$ git rev-parse HEAD
bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c

$ git rev-parse --abbrev-ref HEAD
master

$ git log -1 --oneline
bfa45fc refactor: 商机列表/详情/筛选栏全面重构为线索式（移除看板）

origin/master = 66ebebec42e1937482f6753ff92703310cb49d2f   （本地领先 1 个提交）
```

门禁判定：

| 项 | 判定 |
|---|---|
| HEAD 与 R-1.1 结束时一致 | ✅ `bfa45fc`（未变化） |
| 工作树改动均为前几轮产物 | ✅ 无新增未预期改动 |
| 是否可安全开始 | ✅ 通过 |

---

## 2. 执行动作（4 项，逐项对应目标）

### 2.1 目标 1 · 对本地开发数据库应用现有迁移 ✅

**应用前安全复核**（先读 SQL，确认纯增量）：

```sql
-- 20260928120000_add_channel_to_opportunity/migration.sql
ALTER TABLE "Opportunity" ADD COLUMN "channelId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Opportunity_channelId_idx" ON "Opportunity"("channelId");
CREATE INDEX "Opportunity_shopId_idx" ON "Opportunity"("shopId");
```

复核结论：**纯增量** —— 仅 2 列（可空 TEXT、无默认值）、2 个 FK（`ON DELETE SET NULL`）、2 个索引。
**无 `DROP`、无类型变更、无数据改写、无 `NOT NULL` 加列**。可安全应用。

**执行命令**（选择 `migrate deploy` 而非 `migrate dev`）：

```bash
npx prisma migrate deploy
```
```
18 migrations found in prisma/migrations
Applying migration `20260928120000_add_channel_to_opportunity`
The following migration(s) have been applied:
migrations/
  └─ 20260928120000_add_channel_to_opportunity/
    └─ migration.sql
All migrations have been successfully applied.
```

> **为什么用 `deploy` 而不是 `dev`**：`prisma migrate dev` 在检测到 drift 时可能提示**重置数据库**，且可能**生成新迁移** —— 两者都与本轮「只应用现有 migration / 不创建 migration」冲突。`migrate deploy` 只应用待执行迁移，不做其它任何事。

### 2.2 目标 2 + 3 · 新增统一验证命令 `npm run verify` ✅

`server/package.json`（新增 1 行）：

```json
    "build": "tsc",
    "verify": "prisma validate && prisma generate && tsc --noEmit",
    "start": "node dist/index.js",
```

包含且仅包含目标要求的 3 个步骤，顺序与依赖关系一致：

| 顺序 | 步骤 | 为什么必须在这一步 |
|---|---|---|
| 1 | `prisma validate` | 先确认 schema 合法；失败则后续无意义 |
| 2 | `prisma generate` | 必须重新生成 Client，否则第 3 步会基于过期类型误报 |
| 3 | `tsc --noEmit` | 捕获「生成物与调用点不一致」（R-1.1 的 `TS2353` 正是这一类） |

特点：三步**均不连接数据库**，可离线运行；`&&` 串联保证**失败即停**且退出码非 0。

### 2.3 目标 4 · 明确禁止 `prisma format` 作为 Schema 验证工具 ✅

新增 `docs/prisma-schema-rules.md`（与既有 `docs/ui-standard.md` 同为仓库根标准文档）。其中第 2 节为该禁令的正式条文，含 R-1.1 的实测证据：

> **禁止把 `prisma format` 当作「校验」或「扫描缺失关系」的手段。**
> 它在格式化时会**尝试自动补全缺失的反向 relation 字段**：
> - 缺两条 → 生成两个同名字段 → 校验失败 → 不写盘（无副作用）；
> - **只缺一条 → 校验通过并静默写盘**，插入一个默认命名的关系字段 → **一次未被察觉的 schema 变更**。

并给出正确做法对照表（校验用 `prisma validate` / 状态用 `migrate status` / 格式化前须 `git status` 干净且事后 review `git diff`）。

文档另含：`verify` 入口说明、relation 声明规则（含本轮 `opportunities` / `opportunityShops` 命名对齐）、migration 规则（只应用不修改、`deploy` 优先、应用前复核 SQL 纯增量）、最小验收清单。

### 2.4 目标 5–10 · 边界遵守 ✅

见 §6 逐条对照。

---

## 3. VALIDATION

### 3.1 数据库侧（迁移结果）

| 检查 | 结果 |
|---|---|
| `npx prisma migrate status` | ✅ **`Database schema is up to date!`**（18 migrations，全部已应用） |
| 只读运行时查询 | ✅ **OK** |

```
$ node -e "prisma.opportunity.findMany({ select: { id, channelId, shopId }, take: 3 })"
READ-ONLY QUERY OK :: channelId/shopId 已在数据库中可用；返回行数 = 2
```

→ **R-1.1 报告的 `P2022: The column 'Opportunity.channelId' does not exist` 已消除。**
→ 至此 R-1.1 的三段状态链全部转绿：schema ✅ / Prisma Client ✅ / **数据库表 ✅**。

### 3.2 统一验证命令

```
$ npm run verify
> ysem-server@1.0.0 verify
> prisma validate && prisma generate && tsc --noEmit

Environment variables loaded from .env
Prisma schema loaded from prisma/schema
The schemas at prisma/schema are valid 🚀
Environment variables loaded from .env
Prisma schema loaded from prisma/schema

✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 2.36s
```

| 项 | 结果 |
|---|---|
| `verify` 退出码 | ✅ **0** |
| `tsc` 错误数 | ✅ **0** |
| `prisma validate` | ✅ `The schemas at prisma/schema are valid 🚀` |
| `prisma generate` | ✅ `Generated Prisma Client (v5.22.0) in 2.36s` |

### 3.3 回归（确认本轮未影响 R-1 基座）

| 检查 | R-1 时 | 本轮 | 判定 |
|---|---|---|---|
| `lint:layering` 违规总数 | 31 | **31** | ✅ 不变 |
| Controller 去 Prisma 化进度 | 6% | **6%** | ✅ 不变 |
| `src/` 文件总数 | 96 | **96** | ✅ 不变 |
| controllers / services / operations / repositories | 33 / 1 / 1 / 3 | 33 / 1 / 1 / 3 | ✅ 不变 |

---

## 4. DIFF SCOPE

### 4.1 本轮实际改动

| 文件 | 类型 | 改动 |
|---|---|---|
| `server/package.json` | 修改 | **+1 行**（`verify` 脚本） |
| `docs/prisma-schema-rules.md` | 新增 | Schema 规范文档（含 `prisma format` 禁令） |

### 4.2 工作树全量（含前几轮未提交产物）

```
 M server/package.json                     ← 本轮 +1 行（另含 R-1 的 lint:layering）
 M server/prisma/schema/03-customer.prisma ← R-1.1（+6 行）
 M server/src/middleware/errorHandler.ts   ← R-1（+13 行）
?? docs/prisma-schema-rules.md             ← 本轮新增
?? server/src/{lib/errors.ts,operations/,repositories/,scripts/check-layering.ts,services/}  ← R-1
?? YSEM-*.md、YSEM全域数据架构审计.md 等 5 个报告/登记册
```

`git diff --stat`（tracked）：`3 files changed, 23 insertions(+), 1 deletion(-)`

| 边界 | 状态 | 证据 |
|---|---|---|
| 新增 migration | ✅ **无** | `git status --short server/prisma/migrations` → 空 |
| 修改 `prisma/migrations/**` | ✅ **无** | 同上 |
| `server/prisma/` 下改动文件 | ✅ **仅 1 个** | `git diff --name-only server/prisma` → `schema/03-customer.prisma`（R-1.1 产物，本轮未再动） |
| Frontend | ✅ **无** | `server/` 与 `docs/` 之外无改动；`client/**` 未触碰 |
| API Contract | ✅ **无** | 未改任何 route / DTO / 响应结构 |
| Controller / Service / Operation / Repository 业务代码 | ✅ **无** | `git diff --name-only server/src` → 仅 `middleware/errorHandler.ts`（R-1 产物，本轮未再动） |
| 业务规则 | ✅ **无** | 未改 Lead / Customer / Opportunity 规则、`Customer.source`、`channelId`/`shopId` 语义 |
| 进入 R-2 | ✅ **未进入** | — |

---

## 5. DB CHANGE 声明（唯一一处，已授权）

本轮对**本地开发数据库**执行了 1 次 schema 变更（这是目标 1 的明确要求）：

| 项 | 值 |
|---|---|
| 目标库 | PostgreSQL `ysem` @ `localhost:5432`，schema `public`（来自 `.env`） |
| 执行命令 | `npx prisma migrate deploy` |
| 变更内容 | `Opportunity` 表新增 `channelId` / `shopId` 两列 + 2 个 FK + 2 个索引 |
| 变更性质 | **纯增量**（无 DROP / 无类型变更 / 无数据改写 / 无 `NOT NULL` 加列） |
| 数据影响 | **0 行被改写**（新列可空、无默认值回填） |
| 执行前复核 | ✅ 已逐行复核 `migration.sql`（见 §2.1） |
| 执行后核验 | ✅ `Database schema is up to date!` + 只读查询通过 |

> 未执行任何其它 DDL / DML。唯一其它既有 DB 操作是**只读**的 `migrate status` 与一次只读 `findMany`。

---

## 6. 禁止事项逐条对照（目标 5–10）

| # | 目标原文 | 遵守 | 证据 |
|---|---|---|---|
| 5 | 本轮不进入 R-2 | ✅ | 未创建任何 Service / Operation / Repository 业务文件；业务层文件数仍为 33/1/1/3 |
| 6 | 不做任何业务规则重构 | ✅ | diff 不含任何业务逻辑变更 |
| 7 | 不修改 Controller / Service / Operation / Repository **业务代码** | ✅ | `git diff --name-only server/src` → 仅 `middleware/errorHandler.ts`（**R-1 遗留产物，本轮未触碰**） |
| 8 | 不修改 Frontend | ✅ | `client/**` 零改动 |
| 9 | 不修改 API Contract | ✅ | 无 route / DTO / 响应结构变更 |
| 10 | 不提交、不 push | ✅ | HEAD 仍为 `bfa45fc`；见 §7 |

---

## 7. COMMIT STATUS

**未 commit、未 push。**

- HEAD 仍为 `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c`（与开工时一致）
- `origin/master`（`66ebebec`）未做任何写入
- 所有改动留在工作树待人工裁决

---

## 8. 风险提示 / 待确认

### 8.1 `verify` 尚未接入任何自动门禁

`npm run verify` 目前**只能手动执行**。R-1.1 的教训（`bfa45fc` 带着「schema 不可编译」进入了 master）表明：不接入门禁，同类问题会再次发生。

候选（需授权，本轮未做）：
- **A** pre-commit hook 运行 `npm run verify`
- **B** CI 流水线增加 verify 步骤（`Dockerfile.server:10` 已有 `prisma generate`，可扩展为 `prisma validate && prisma generate`）
- **C** 仅保留手动执行

### 8.2 `lint` 脚本仍不可用（R-1 遗留）

`server/package.json` 的 `"lint": "eslint src/"` 因 eslint **未安装且无配置**而必然失败。`verify` **有意不包含** lint（它不是 lint 的替代）。R-1 的 D2 仍未裁决。

### 8.3 其它环境（生产 / 共享库）尚未应用该迁移

本轮**只作用于本地开发库**（`localhost:5432/ysem`，按目标 1 的原文「本地开发数据库」）。若存在 CI / 测试 / 生产环境，需各自执行 `npx prisma migrate deploy`（`Dockerfile.server` 目前**不包含** `migrate deploy`，仅含 `prisma generate` —— 这可能是另一次部署时的手工步骤或缺口，**本轮未改动**）。

---

## 9. 本轮执行顺序

| # | 动作 | 结果 |
|---|---|---|
| 1 | 硬性基线门（`git status` / `rev-parse HEAD` / `branch` / `log -1`） | ✅ §1 |
| 2 | 应用前安全复核迁移 SQL（纯增量确认） | ✅ §2.1 |
| 3 | `npx prisma migrate deploy` | ✅ `All migrations have been successfully applied.` |
| 4 | `npx prisma migrate status` | ✅ `Database schema is up to date!` |
| 5 | 只读运行时验证（`findMany`） | ✅ OK（2 行）；P2022 已消除 |
| 6 | 新增 `verify` 脚本（3 步骤） | ✅ §2.2 |
| 7 | 新增 Schema 规范文档（含 `prisma format` 禁令） | ✅ §2.3 |
| 8 | `npm run verify` | ✅ 退出码 0 |
| 9 | 回归：`lint:layering` | ✅ 31（不变） |
| 10 | 边界确认 | ✅ §4 / §6 |

**本轮结束。未 commit。**
