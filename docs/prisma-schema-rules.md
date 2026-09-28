# Prisma Schema 规范

> 适用范围：`server/prisma/schema/**`（多文件 schema，`prismaSchemaFolder` preview feature）
> 相关轮次：Round R-1.1（Relation Repair）、Round R-1.2（Dev DB Migration + Verify Script）

---

## 1. 唯一验证入口：`npm run verify`

在 `server/` 目录下执行：

```bash
npm run verify
# 等价于：prisma validate && prisma generate && tsc --noEmit
```

三步全部**不连接数据库**，可离线运行：

| 步骤 | 作用 |
|---|---|
| `prisma validate` | 校验 schema 语法与关系完整性（多文件 schema 会被整体解析） |
| `prisma generate` | 从 schema 生成 Prisma Client（生成失败即 schema 不可用） |
| `tsc --noEmit` | 类型检查，捕获「生成物与调用点不一致」 |

**改动 schema 后必须运行 `npm run verify` 并通过。**
原因：`prisma validate` 只校验 schema 自身，`tsc` 才能发现调用点（如 `prisma.xxx.create({ data: {...} })`）不再匹配生成类型；而 `prisma generate` 是二者的必要中间步骤。

---

## 2. 禁止使用 `prisma format` 作为 Schema 验证工具

**禁止**把 `prisma format`（`npx prisma format`）当作「校验」或「扫描缺失关系」的手段。

### 原因（Round R-1.1 实测）

`prisma format` 在格式化时会**尝试自动补全缺失的反向 relation 字段**：

- 若某个具名关系**两端不完整**，它会自动生成缺失一侧的字段；
- 自动生成的字段使用**默认名**（模型名），因此当同一模型缺两条关系时会生成两个**同名字段** → 触发 `Field "X" is already defined on model "Y"`，校验失败，**不写盘**（此时无副作用）；
- 但若**只缺一条**关系，`prisma format` 会**校验通过并静默写盘**，插入一个默认命名的关系字段 —— 即产生一次**未被察觉的 schema 变更**。

### 正确做法

| 目的 | 正确命令 |
|---|---|
| 校验 schema 是否合法 | `npx prisma validate`（或 `npm run verify`） |
| 检查是否缺少反向关系 | `npx prisma validate` 的 P1012 报错会同时列出字段名与行号 |
| 确认 schema 与数据库是否同步 | `npx prisma migrate status`（只读） |
| 格式化（仅在明确需要时） | 先确保 `git status` 干净，执行后**必须 review `git diff`** 再决定是否保留 |

---

## 3. 关系（relation）声明规则

Prisma 要求**具名关系的两端都必须声明字段**。

```prisma
// 一侧（持有外键）
model Opportunity {
  channelId String?
  channel   Channel? @relation("OpportunityChannel", fields: [channelId], references: [id], onDelete: SetNull)
}

// 另一侧（必须存在；字段名不可与同模型其它字段重名）
model Channel {
  opportunities Opportunity[] @relation("OpportunityChannel")
}
```

约定：

1. **relation 名统一使用 `<Entity><Role>` 形式**，且与既有命名对齐：
   `LeadChannel` / `LeadShop` / `CustomerChannel` / `CustomerShop` / `OpportunityChannel` / `OpportunityShop`
2. **反向字段名**对齐既有模式：`LeadChannel → leads`、`LeadShop → leadShops`、
   `CustomerChannel → customers`、`CustomerShop → customerShops`、
   `OpportunityChannel → opportunities`、`OpportunityShop → opportunityShops`
3. **同一模型内反向字段名必须互异**（这是 `prisma format` 自动补全最容易违反的一点）。
4. 反向 relation 字段是**虚拟字段**：不产生任何数据库列、约束或索引，**不需要也不应为此新增 migration**。

---

## 4. 迁移（migration）规则

1. 迁移文件**只应用、不修改**：已提交的 `prisma/migrations/**` 视为不可变历史。
2. 应用待执行迁移：

   ```bash
   npx prisma migrate deploy   # 只应用待执行迁移；不会生成新迁移、不会 reset
   ```

3. **不要**用 `prisma migrate dev` 处理「只需应用已有迁移」的场景：它在检测到 drift 时可能提示重置数据库。
4. 应用前**必须复核迁移 SQL 是否纯增量**（优先只读 `cat migration.sql`，确认无 `DROP` / 无类型变更 / 无数据改写）。
5. 执行后会验证数据库侧：

   ```bash
   npx prisma migrate status   # 期望：Database schema is up to date!
   ```

6. 新增 migration 属独立决策，不得与 schema 结构变更混在同一次交付中。

---

## 5. 变更后的最小验收清单

```bash
cd server
git status --short            # ① 确认改动范围仅限预期文件
npm run verify                # ② prisma validate + prisma generate + tsc --noEmit 全部通过
npx prisma migrate status     # ③ 若含 migration：确认 Database schema is up to date!
npm run lint:layering         # ④ 后端分层依赖检查（报告模式）
```
