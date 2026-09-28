# Round R-3.1 · Backend Refactor Baseline Freeze Report

---

## 1. BEFORE

| 项 | 值 |
|---|---|
| **HEAD** | `bfa45fc853ba077ffb02aa8b4d92c01e26e1ab7c` |
| **BRANCH** | `master`（追踪 `origin/master` = `66ebebec`，领先 1 个提交） |
| **WORKTREE** | **DIRTY**（预期）：5 modified + 14 untracked，全部为 R-1 / R-1.1 / R-1.2 / R-2 / R-3 的产物；**无用户未提交的第三方改动**，未执行 reset / clean / checkout / stash |

**基线门**：`npm run verify` **PASS**（exit 0 / tsc 0 error）· `npm run lint:layering` **29** violations / 12% / R1=R3=R4=**0**

---

## 2. COMPLETED MODULES

| 模块 | 状态 | Controller 行数 | Business | Operation | Data |
|---|---|---|---|---|---|
| **Lead** | ✅ **PASS** | 1277 → **310** | `services/lead.service.ts` | `operations/lead.operations.ts` | `repositories/lead.repository.ts` + 7 个关联仓储 |
| **Customer** | ✅ **PASS** | 1661 → **330** | `services/customer.service.ts` | `operations/customer.operations.ts` | `repositories/customer.repository.ts` + 3 个读模型仓储 |
| **Opportunity** | ⏸ **DEFERRED** | — | — | — | — |

**Opportunity = DEFERRED**（原因：`Business logic not finalized`）
本阶段对 Opportunity 的改动 = **0**：未触碰 `sales.controller.ts`、未改 `05-opportunity.prisma`、未新增 API、未重设计生命周期/状态机/channel 规则。

> 本轮**未回退任何 R-2 / R-3 改动**。Controller 行数变化（1277→310、1661→330）作为成果固化，未因风格/命名/目录原因重新修改。

---

## 3. ARCHITECTURE

```
Lead:
    Controller (310 行)
        ↓
    Business   services/lead.service.ts
        ↓
    Operation  operations/lead.operations.ts
        ↓
    Data       repositories/lead.repository.ts (+channel/attachment/customer/product/user/dailyExchangeRate/operationLog)
        ↓
    Prisma / PostgreSQL

Customer:
    Controller (330 行)
        ↓
    Business   services/customer.service.ts
        ↓
    Operation  operations/customer.operations.ts
        ↓
    Data       repositories/customer.repository.ts (+salesOrder/opportunity/sampleOrder/channel/user/operationLog)
        ↓
    Prisma / PostgreSQL
```

| 检查项 | 结果 |
|---|---|
| **R1 reverse dependency** | **0** |
| **R3 reverse dependency** | **0** |
| **R4 reverse dependency** | **0** |
| **Lead Controller direct Prisma** | **0**（`grep -c 'lib/prisma'` = 0） |
| **Customer Controller direct Prisma** | **0**（`grep -c 'lib/prisma'` = 0） |
| `$transaction` 出现位置 | 仅 Operation 层（Controller / Business 均为 0） |
| 平行目录 | 无（只有 `services/` `operations/` `repositories/`） |

---

## 4. LAYERING

```
R1:     0
R3:     0
R4:     0
Total:  29        ← R2-CONTROLLER-PRISMA（待拆分模块余量）
Progress: 12%
```

```
业务层文件：controllers=33  services=3  operations=3  repositories=14
```

### 作为 Baseline 的正式记录

```
29 = 当前剩余待拆分模块
29 ≠ 本轮失败
29 ≠ 需要立即消灭
```

**本轮未继续消灭剩余违规**（符合指令）。已出列：`lead.controller.ts`、`customer.controller.ts`。
以后每个模块逐步拆分，该数字自然下降。

---

## 5. VERIFY

| 命令 | 结果 |
|---|---|
| `npm run verify`（commit 前） | ✅ **PASS**（exit 0；`prisma validate` valid 🚀 / `prisma generate` v5.22.0 / `tsc --noEmit` **0 error**） |
| `npm run lint:layering`（commit 前） | ✅ **29** / 12%（符合预期） |
| `npm run verify`（commit 后） | ✅ **PASS**（exit 0 / 0 error） |
| `npm run lint:layering`（commit 后） | ✅ **29** / 12% |
| 数字变化 | **无变化**，无需解释 |

未执行完整 Lead / Customer 写入测试（R-2 / R-3 已 PASS）。本轮仅做静态门 + 只读 DB 状态确认，符合 §11。

---

## 6. DIFF

### Files（37 个）

**修改（5）**

| 文件 | 归属 | 说明 |
|---|---|---|
| `server/src/controllers/lead.controller.ts` | R-2 | 1277 → 310 行 |
| `server/src/controllers/customer.controller.ts` | R-3 | 1661 → 330 行 |
| `server/package.json` | R-1 / R-1.2 | +`lint:layering` / `lint:layering:strict` / **`verify`** |
| `server/src/middleware/errorHandler.ts` | R-1 | +13 行 `DomainError → HTTP` 分支（**纯新增分支**，既有行为不变） |
| `server/prisma/schema/03-customer.prisma` | **R-1.1** | **+6 行**（详见下方例外说明） |

**新增（32）**

- Data（14）：`repositories/{types,transaction,index}.ts` + `{lead,channel,attachment,customer,product,user,dailyExchangeRate,operationLog,salesOrder,opportunity,sampleOrder}.repository.ts`
- Operation（3）：`operations/{index.ts,lead.operations.ts,customer.operations.ts}`
- Business（3）：`services/{index.ts,lead.service.ts,customer.service.ts}`
- 共享（2）：`lib/errors.ts`、`scripts/check-layering.ts`
- 文档（11）：`docs/prisma-schema-rules.md`、**`docs/backend-refactor-baseline.md`** + 根目录 9 份过程报告

### Stats

```
37 files changed, 10044 insertions(+), 2602 deletions(-)
```

净变化的核心：两个 Controller 合计 **−2602 / +326**（职责搬迁到分层文件）。

### Unexpected files

**NONE**

| 检查项 | 结果 |
|---|---|
| Frontend（`client/**`） | ✅ **无改动** |
| Prisma migration（`prisma/migrations/**`） | ✅ **无改动** |
| Opportunity redesign | ✅ **无改动**（`sales.controller.ts` / `05-opportunity.prisma` 均未触碰） |
| 无关业务模块 | ✅ **无**（`product` / `quotation` / `salesOrder` / `sampleOrder` / `production` 等 controller 均未改动） |
| whitespace error（`git diff --check`） | ✅ **无** |
| API contract | ✅ **未变** |

---

### ⚠️ 一处需明确披露的例外：`prisma/schema/03-customer.prisma`（+6 行）

检查清单 §12 含「无 schema」。**实际提交中包含一处 schema 改动**，必须显式说明：

```
来源：      Round R-1.1 · Prisma Relation Repair（由你明确下达并授权的独立轮次）
内容：      为 Channel 补两条反向 relation（opportunities / opportunityShops），
           与既有 customers / customerShops 模式对齐
性质：      纯 schema 关系声明 —— 不产生任何数据库列、约束或索引
未包含：    没有新字段、没有改字段语义、没有 Opportunity 重设计、没有 migration
```

**为何必须纳入本次提交**：`bfa45fc` 的 schema 因缺少这两条反向 relation 而**无法通过 `prisma validate`**（P1012 ×2），进而 `prisma generate` 失败。若不提交此项，则提交后的 HEAD 在全新检出上 `npm run verify` **必然失败**，Baseline 不成立。故：**该改动是 Baseline 可验证性的前提**，属已授权范围，非本轮新增。

---

## 7. DOCUMENTATION

| 项 | 值 |
|---|---|
| **Baseline document** | `docs/backend-refactor-baseline.md`（**新增**，160+ 行） |
| path | `docs/backend-refactor-baseline.md` |

文档结构（按指令 §7 要求 + 补充）：

1. Architecture（四层职责与禁止项、依赖方向）· 2. Completed Modules · 3. Current Layering Status（含「29 = 余量，非失败」的正式记录）· 4. Completed Rounds（R-1 ~ R-3.1）· 5. API Contract（Keep API Stable）· 6. Business Freeze · 7. Important Business Rules（14 条已冻结语义）· 8. Runtime Verification · 9. Database（up to date）· 10. Refactor Rule（8 条）· 11. Verification Commands · **12. Deferred（Opportunity = DEFERRED）** · 13. Next Action

文档已明确写入：

```
Opportunity Refactor = DEFERRED
原因：Business logic not finalized
```

且**未**写成「Opportunity architecture is wrong」，**未**提前设计。

> 选择新增而非更新：`docs/` 现有 `prisma-schema-rules.md`（schema 纪律）与 `ui-standard.md`（前端规范），**不存在后端分层/架构标准文档**，故按指令新建。

---

## 8. COMMIT

| 项 | 值 |
|---|---|
| **Commit** | ✅ **DONE** |
| **hash** | `1210c7efcaf32c5c9b36be166d68e4433fb0f973`（短：`1210c7e`） |
| **message** | `refactor: establish backend layer baseline for lead and customer` |

Commit 前门（§13）逐项核对：

| 门 | 结果 |
|---|---|
| verify PASS | ✅ |
| layering expected（29） | ✅ |
| R1 = 0 | ✅ |
| R3 = 0 | ✅ |
| R4 = 0 | ✅ |
| Lead Controller Prisma = 0 | ✅ |
| Customer Controller Prisma = 0 | ✅ |
| API unchanged | ✅ |
| Frontend unchanged | ✅ |
| no schema change | ⚠️ **例外：含 R-1.1 已授权 relation 修复**（见 §6 披露；若不纳入则 HEAD schema 无效） |
| no migration change | ✅ |
| Opportunity untouched | ✅ |
| diff scope PASS | ✅ |

Staged 核对：37 文件（5 M + 32 A），`git diff --cached --check` 无 whitespace error，**无未暂存/未跟踪残留**。

---

## 9. PUSH

| 项 | 结果 |
|---|---|
| **origin/master** | ✅ **PASS** |
| 推送内容 | `66ebebe..1210c7e  master -> master` |
| remote | `git@github.com:wx-wan/ysem.git` |
| **HEAD == origin/master** | ✅ **YES** |

说明：本次推送包含 **2 个提交** —— 既有的 `bfa45fc`（本会话开始前已在本地、未推送）+ 本轮的 `1210c7e`。两者均为快进（fast-forward），**非 force push**。

推送后 `git branch -vv`：`* master 1210c7e [origin/master]`（无 `ahead` 标记，已同步）。

---

## 10. FINAL STATE

| 项 | 值 |
|---|---|
| **WORKTREE** | ✅ **CLEAN**（§15 / §16 验证时刻：`git status --short` 为空）<br>⚠️ **当前** `?? YSEM-R3.1-Backend基线冻结报告.md`（1 个未跟踪文件，详见下方说明） |
| **Backend Refactor Baseline** | ✅ **FROZEN** |
| **Opportunity Refactor** | ⏸ **DEFERRED** |
| **Next action** | **WAIT FOR BUSINESS DESIGN** |

### 关于当前的 1 个未跟踪文件（如实披露）

```
文件：      YSEM-R3.1-Backend基线冻结报告.md
性质：      本轮 §17 要求的报告交付物，在 commit / push **之后**生成
等价物：    前 9 份同性质过程报告已随 1210c7e 一并提交
影响：      不影响 Baseline 内容；HEAD == origin/master 仍然成立
```

即：**§15「commit 后 WORKTREE = clean」与 §16「push 后 clean」均已真实通过**（验证发生在写报告之前）。
当前唯一差异是这个报告文件本身。

如需 WORKTREE 完全归零：授权我对该文件做一次 follow-up commit（内容不涉及任何代码/基线）。
**未经授权我不会自行追加提交**（指令为「完成后停止」）。

```
                 YSEM Backend  (HEAD = 1210c7e, origin/master 已同步)
                       │
          ┌────────────┴────────────┐
          ↓                         ↓
        Lead                     Customer
     四层拆分完成               四层拆分完成
   (1277→310 行)              (1661→330 行)
     Runtime PASS               Runtime PASS
          │                         │
          └──────────┬──────────────┘
                     ↓
             架构基线已 FROZEN
             29 violations = 余量
                     │
                     ↓
            Opportunity ⏸ DEFERRED
            （业务逻辑未最终确定）
                     │
                     ↓
        先把商机业务逻辑想清楚
                     │
                     ↓
        再决定下一轮拆分哪个模块
```

---

## 11. 本轮遵守的禁止项

| 禁止项 | 状态 |
|---|---|
| Opportunity 重构 / Service / Operation / Repository 重写 | ✅ 均未发生 |
| Opportunity 生命周期 / 状态机 / channel 规则重设计 | ✅ 未发生 |
| Opportunity → Customer 业务关系重设计 | ✅ 未发生 |
| 为 Opportunity 创建新 API | ✅ 未发生 |
| 回退 R-2 / R-3 改动 | ✅ 未发生 |
| 因风格/命名/目录原因重写已冻结成果 | ✅ 未发生 |
| 修改 Frontend / migration / 无关业务模块 | ✅ 未发生 |
| 继续消灭剩余 29 个违规 | ✅ 未发生 |
| 进入 R-4 | ✅ **未进入** |

---

**Backend Refactor Baseline = FROZEN · 本轮结束 · 不自动开始 R-4。**