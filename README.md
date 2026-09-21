# YSEM 外贸业务管理系统

面向外贸企业的全链路业务管理平台，覆盖「线索 → 客户 → 商机 → 报价 → 打样 → 订单 → 生产 → 采购 → 出货 → 质检 → 收付款」全流程，并包含产品库、审批、权限、设置等基础模块。

> **当前版本：V1.0 — CLOSED / CONTRACT FROZEN**
> 冻结基线：`1dc0b2beb3dd94dd70865dc5a276955ec7421c4a`（`HEAD == origin/master`，ahead/behind = `0/0`）
> 当前阶段：**Backend V1.0 Security Hardening 已完成** → 进入 **Frontend Sync / Full-Stack Development**
>
> 本文件同时承担两个职责：**项目使用说明** 与 **工程流程规范（Project Standard）**。
> 流程规范部分描述的是「本项目如何开发、审计、验证、提交与冻结版本」，与具体功能无关，长期有效。

---

## 1. 项目概览

| 维度 | 说明 |
| --- | --- |
| 定位 | 外贸企业全链路业务管理系统（线索到收款一体化） |
| 形态 | 前后端分离的 Web 应用（Monorepo：`client/` + `server/`） |
| 后端 | Node.js + Express + TypeScript + Prisma ORM（PostgreSQL） |
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 |
| 协作方式 | 前端 Vite 代理 `/api` → 后端 `http://localhost:3000`；后端提供 Swagger 与 SSE 实时通知 |
| 当前阶段 | 后端 V1.0 已冻结；进入前端同步开发 |

**前后端关系**：后端是唯一的业务与数据权威（数据范围、权限、状态机、编号分配全部在服务端收敛）。前端只消费后端已冻结的接口契约，不承载业务判定。

**当前阶段的意义**：后端契约已冻结（Contract Freeze），前端应基于该契约开发；如发现真正的后端契约问题，走 Finding → Decision 流程（见 §10），**不通过直接修改 V1.0 冻结代码来迁就前端**。

---

## 2. 当前版本状态（Current Status）

| 项 | 值 |
| --- | --- |
| Current Version | **V1.0** |
| Status | **CLOSED / CONTRACT FROZEN** |
| Contract Freeze | **PASS** |
| Final Baseline | `1dc0b2beb3dd94dd70865dc5a276955ec7421c4a` |
| Remote Sync | `HEAD == origin/master`，ahead/behind = `0/0`，worktree CLEAN |
| Current Phase | Frontend Sync / Full-Stack Development |
| Next Decision Gate | 前端影响面审计（Frontend Contract / Impact Audit） |

**V1.0 已完成的收口范围（摘要）**

- V1.0 目标 Schema 落地（`server/prisma/schema/` 按域分层拆分的 13 个领域文件）。
- 业务状态机与资格门（出货资格、生产/出货状态流转、审批唯一性等）。
- 权限与数据范围收敛：功能权限（RBAC）+ 数据范围（`ALL` / `DEPT` / `SELF`）统一由 `server/src/utils/scope.ts` 驱动。
- 跨 scope 业务引用加固（scoped 单条查询、宿主引用校验、存在性 oracle 消除）。
- Ownership Authorization 加固：`F-NEW-20`（更新侧目标归属人校验）、`F-NEW-20b`（创建侧目标归属人校验），Runtime Verification + Regression Verification + Commit Gate + Push 验证 + Final Contract Freeze 全部 PASS。

**维护约定**：本文件只记录**当前**版本状态与基线，不承担审计日志职责。历史细节以 `git log` / 提交信息与实际代码为准。

---

## 3. 技术栈

- **前端**：React 18 + TypeScript + Vite + Ant Design 5 + React Router 6 + Zustand + i18next（中英双语）
- **后端**：Node.js + Express + TypeScript + Prisma ORM + Zod（入参校验）
- **数据库**：PostgreSQL 16（开发与生产统一）
- **认证**：JWT（Access + Refresh Token）+ `bcryptjs`
- **其他服务端能力**：`helmet` / `cors` / `express-rate-limit` / `morgan` / `multer`（上传）/ `swagger-jsdoc` + `swagger-ui-express`（API 文档）/ `xlsx`（导入导出）
- **实时通知**：SSE（`server/src/utils/notify.ts`，端点 `/api/auth/events`；离线用户落库，下次连接拉取未读）
- **部署形态**：`docker-compose.yml`（db + server + client）、`nginx.conf`、`Dockerfile.server` / `Dockerfile.client`、`start.sh`（本地启动/停止/重启）

---

## 4. 仓库结构

```text
ysem/
├── client/                      # 前端应用
│   ├── docs/i18n.md             # 前端国际化开发约定（开发新页面前必读）
│   ├── DESIGN.md / PRODUCT.md   # 前端设计系统与产品说明（design/product schema）
│   ├── nginx.conf
│   └── src/
│       ├── api/                 # 接口封装（axios 实例 + 各模块 API）
│       ├── assets/  config/  data/
│       ├── components/          # 公共组件（AppModal / CapsuleSwitch / SegmentedTabBar / CountrySelect / common/ ...）
│       ├── hooks/
│       ├── i18n/                # 中英文文案
│       ├── layouts/             # 主布局（菜单渲染、权限控制）
│       ├── pages/               # 页面（SalesLeads / Customers / Products / Sales / SalesOrders / Shipment / Setting* ...）
│       ├── stores/              # Zustand 全局状态（auth / currency / customerType / notification / user）
│       ├── styles/              # global.css 等全局样式
│       ├── utils/
│       └── zIndex.ts            # 浮层层级统一取值入口
├── server/                      # 后端应用
│   ├── prisma/
│   │   ├── schema/              # 数据模型（13 个领域文件 + 聚合入口）
│   │   │   ├── 00-enums.prisma  01-system.prisma  02-support.prisma  03-customer.prisma
│   │   │   ├── 04-product.prisma  05-opportunity.prisma  06-quotation.prisma  07-sample.prisma
│   │   │   ├── 08-sales-order.prisma  09-production.prisma  10-purchase.prisma  11-shipment.prisma
│   │   │   ├── 12-quality.prisma  13-finance.prisma
│   │   │   └── schema.prisma    # 聚合入口（datasource / generator）
│   │   ├── migrations/          # Prisma 迁移
│   │   ├── migrations_legacy/   # 历史迁移（归档，勿手工改动）
│   │   └── seed.ts              # 系统基线种子数据（不含业务数据）
│   └── src/
│       ├── app.ts               # 中间件链与全部路由挂载
│       ├── index.ts             # 进程入口（端口、监听、API Docs 提示）
│       ├── controllers/         # 路由处理函数（30 个）
│       ├── routes/              # 路由定义（29 个）
│       ├── middleware/          # authenticate / authorize / requirePerm
│       ├── lib/                 # prisma 客户端、编号序列、活动日志、SKU、业务类型等
│       ├── utils/               # scope（数据范围）、response、query、notify、deptTree、currency 等
│       ├── scripts/             # 辅助脚本（如编号序列自测）
│       └── swagger.ts           # Swagger 定义
├── docs/V1.0目标Schema设计/      # V1.0 目标 Schema 分层设计文档（00 总览 … 06 待修订项）
├── DESIGN.md                    # 设计系统（颜色 / 字体 / 布局 / 组件规范）
├── docker-compose.yml  nginx.conf  Dockerfile.server  Dockerfile.client  start.sh
└── README.md                    # 本文件（使用说明 + 工程流程规范）
```

---

## 5. 快速开始

### 5.1 环境要求

- Node.js 20.x（`start.sh` 中硬编码了本机 Node 路径，克隆到新环境时请按实际路径调整或直接用 `npm` 命令）
- PostgreSQL 16（本地安装或使用 `docker-compose` 中的 `db` 服务）

### 5.2 数据库与环境变量

准备 PostgreSQL 实例（默认 `localhost:5432`，库名 `ysem`），复制 `server/.env.example` 为 `server/.env` 并填写：

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ysem?schema=public"

JWT_SECRET=...
JWT_REFRESH_SECRET=...
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

ADMIN_USERNAME=admin
ADMIN_PASSWORD=...      # 必填，缺失时 seed 直接失败
ADMIN_EMAIL=admin@ysem.com
```

> 仓库中另有 `server/.env.production`（部署用），生产环境务必替换全部密钥。

### 5.3 安装依赖

```bash
cd server && npm install
cd ../client && npm install
```

### 5.4 初始化数据库与系统基线

```bash
cd server

npm run db:generate      # 生成 Prisma Client
npm run db:migrate       # 应用迁移（首次等价于 prisma migrate dev --name init）
npm run db:seed          # 写入系统基线数据
```

**`db:seed` 的真实行为（重要）**

- 只初始化「系统运行必需」的基线数据：部门（总部 + 5 个业务部门）、角色（`admin` / `business` / `purchaser` / `user`）、权限与角色-权限授予、**1 个管理员账号**、编号序列（15 个 code）、获客渠道（3 平台 + 6 店铺）、客户类型 / 产品工艺 / 受众 / 分类等主数据。
- **不产生任何业务数据**（不创建客户、线索、订单、产品等），**不初始化** `ApprovalConfig` 与 `DailyExchangeRate`。
- **不内置任何默认密码**：管理员密码由 `ADMIN_PASSWORD` 环境变量注入；变量缺失时 `seed` 直接失败。除管理员外**不会创建** `business` / `purchaser` 等业务账号（这些是**角色**，账号需在系统内创建）。
- 幂等：可反复执行，不产生重复数据，不重置管理员密码、不重置编号序列计数、不执行 `deleteMany`。
- 全流程包裹在单个 Prisma 交互式事务中：全部成功才 `COMMIT`，任一失败 `ROLLBACK`。

### 5.5 启动开发

```bash
# 终端 1：后端（tsx watch）
cd server && npm run dev

# 终端 2：前端（Vite，端口 5173）
cd client && npm run dev
```

### 5.6 端口与入口

| 项 | 地址 |
| --- | --- |
| 后端 API | `http://localhost:3000`（`PORT` 默认 3000） |
| API 文档（Swagger） | `http://localhost:3000/api/docs` |
| 上传文件静态服务 | `http://localhost:3000/api/uploads`（目录 `server/uploads`） |
| SSE 实时通知 | `http://localhost:3000/api/auth/events` |
| 前端开发服务器 | `http://localhost:5173`（`/api` 代理到 `http://localhost:3000`） |
| 容器部署 | `server` 容器映射 `3000:3000`，`client` 容器映射 `80:80` |

### 5.7 常用脚本

| 命令 | 说明 |
| --- | --- |
| `server: npm run dev` | 后端开发（`tsx watch`） |
| `server: npm run build` | 后端编译（`tsc` → `dist/`） |
| `server: npm run start` | 以 `node dist/index.js` 运行编译产物 |
| `server: npm run db:generate` | 生成 Prisma Client |
| `server: npm run db:migrate` | 生成并应用迁移 |
| `server: npm run db:seed` | 写入系统基线数据 |
| `server: npm run db:studio` | Prisma Studio |
| `server: npx prisma validate` | 校验 schema（**静态验证必跑项**） |
| `server: npx tsc --noEmit` | 后端类型检查（**静态验证必跑项**） |
| `client: npm run dev` | 前端开发（Vite） |
| `client: npm run build` | 前端构建（`tsc -b && vite build`） |
| `client: npx tsc --noEmit` | 前端类型检查（**静态验证必跑项**） |
| 根目录 `./start.sh [start|stop|restart]` | 本地一键启动 / 停止 / 重启前后端 |

> `server: npm run db:push` 与 `client: npm run lint` 存在但**不作为流程入口**：schema 变更必须走迁移；ESLint 当前未配置（详见 §14）。

---

## 6. 权限与数据范围设计

系统权限分为两层：**功能权限**（能访问哪些菜单 / 操作）与**数据权限**（能看哪些数据），统一由「用户 → 角色 → 权限 / 数据范围」模型驱动。

### 6.1 功能权限（RBAC）

- 模型：`User（用户）— Role（角色）— Permission（权限）`，角色可多权限、用户单角色。
- 权限类型：
  - `MENU`：菜单权限，控制侧边栏可见性与路由可访问性（如 `orders`、`purchase`、`system:role`）。
  - `BUTTON`：操作权限，控制页面内按钮显隐（如 `customer:create`、`system:role:edit`）。
- 校验链路（前后端双重校验）：
  - 登录 → 后端 `authenticate` 解析 JWT，查询用户角色与权限集合挂载到请求（`req.userId` / `req.roleCode` / `req.dataScope`）；
  - 接口层 `requirePerm(perm)` 校验操作权限，无权限返回 403；
  - 前端按权限集合动态渲染菜单，路由由 `PermRoute` 组件保护，未授权访问重定向到无权限页。
- 超级管理员（`admin` 角色）自动拥有全部权限并跳过数据范围限制，不允许被编辑。

### 6.2 数据范围（Data Scope）

每个角色可在「设置 → 角色管理」中配置数据范围 `Role.dataScope`，共三档：

| dataScope | 名称 | 可见数据 |
| --- | --- | --- |
| `ALL` | 全部数据 | 企业全部业务数据（管理员恒为 `ALL`） |
| `DEPT` | 本部门数据 | 本部门所有成员负责的数据（用户无部门时退化为仅本人） |
| `SELF` | 仅本人数据 | 仅本人负责的数据（默认） |

各业务列表 / 详情 / 变更接口均按当前用户的角色数据范围过滤，负责人（ownership）字段映射如下：

| 业务实体 | 负责人字段 | 说明 |
| --- | --- | --- |
| 客户 | `Customer.ownerId` | |
| 线索 | `Lead.assignedTo` | |
| 商机 | `SalesPipeline.assignedTo` | |
| 报价 / 打样 / 销售订单 | 跟随关联客户负责人 | 订单类数据以客户 `ownerId` 为准 |
| 生产 / 采购 | 对应单据 `ownerId` | |
| 出货 / 质检 / 收付款 / 利润 | 跟随宿主单据（如销售订单） | 宿主引用校验见 §7.5 |

### 6.3 公海 / 公开数据规则

- **公海数据**（负责人字段为 `null`，如未认领客户、未指派线索 / 商机）对集团内**所有登录用户开放**，属系统内置规则，不占用数据范围档位、无需单独控制。
- 客户池（公海）提供独立入口，任何拥有客户权限的用户均可浏览、认领；释放（归还公海）后同样全员可见。
- 产品等带 `visibility`（`PUBLIC`）的公开数据对整个集团开放。
- **可见 ≠ 可操作**：公海 / 部门可见只决定「能读到」，具体操作（释放、转交、改归属）仍受独立的 actor 规则约束（如线索的 release / transfer 仅限 `owner` 或 `admin`）。

### 6.4 实现方式

后端统一收敛在 `server/src/utils/scope.ts`：

- `roleScope(req, { field?, relation? })`：生成 Prisma 可见范围条件（异步，`DEPT` 需查询部门成员）；管理员 / `ALL` 返回空条件（不限）；`SELF` / `DEPT` 自动并入公海（负责人为 `null`）条件。
- `applyScope(where, scope)`：以 `AND` 形式合并进查询条件。
- `publicSeaScope(field?)` / `includePublicSea(...)`：公海（无负责人）条件，供客户池等独立公海入口使用。
- `isAdmin(req)` / `DATA_SCOPES` / `DATA_SCOPE_LABELS` / `DEFAULT_DATA_SCOPE`：档位定义与判定。
- 产品可见性：`productVisibilityWhere` / `canReadProduct` / `projectProductRow(s)`（`PRIVATE` 产品仅 owner 与 `visibleUsers` 可见，投影时剥离 `visibility` 等敏感字段）。
- 业务单据旁挂：`approvalRecord.controller.ts` 内的 `hasBusinessAccess` + `loadBusinessRef`（8 类 bizType 的统一访问判定与存在性装载）。
- 各列表查询统一复用上述 helper，避免在每个控制器中重复编写 `ownerId` 判断。

> 旧档位「本部门及下级（`DEPT_AND_CHILD`）」「本人 + 公海（`SELF_PUBLIC_SEA`）」已废弃；执行 `npm run db:seed` 会将存量旧档位自动归一为 `SELF`。

### 6.5 前端权限接入

- 侧边栏菜单按当前用户权限集合动态渲染（`MainLayout` 内 `hasPerm` 控制）。
- 路由统一使用 `PermRoute perm="xxx"` 包裹，未授权跳转无权限页。
- 页面内按钮通过 `hasPerm` / `can` 控制显隐。
- 数据范围在「设置 → 角色管理 → 编辑」弹窗中选择，展示为「全部数据 / 本部门数据 / 仅本人数据」。

---

## 7. 工程流程规范（Development Lifecycle）

以下是本项目**已经在 V1.0 安全收口阶段实际执行并验证有效**的工作方法，作为后续开发（含前端阶段）的标准流程。

流程与「轮次编号」（如 Round 3C-x）无关：轮次编号只用于追溯，阶段顺序与门禁才是约束。

### 7.0 生命周期总览

```text
Observation / Finding
        ↓
Read-only Audit            （只读审计，不修复）
        ↓
Decision Freeze            （冻结范围/契约/验收标准/文件白名单）
        ↓
Implementation             （最小 diff，严格文件范围）
        ↓
Static Verification        （类型 / schema / diff 检查）
        ↓
Runtime Verification       （真实执行授权与业务路径）
        ↓
Regression Verification    （证明原有行为未被改变）
        ↓
Commit Gate                （只读门禁：基线/范围/指纹/证据）
        ↓
Commit                     （显式路径 staging，一次性提交）
        ↓
Push
        ↓
Post-Push Verification     （远端同步核验）
        ↓
Contract Freeze / 基线推进  （版本边界冻结）
```

**核心原则**：先审计 → 后决策 → 再实施；每一阶段只做该阶段被授权的事，**不越阶段行动**。

### 7.1 阶段 1 · Observation / Finding

- 任何可疑点先记录为 **Finding / Observation（OBS）**，附带：文件、位置、端点 / 函数、对象、失败路径、当前行为、期望行为、证据、严重级别、置信度。
- 记录阶段**不改代码**。发现的问题不会自动进入当前实施范围。
- 严重级别统一使用 `P0 / P1 / P2 / P3`。
- 纯风格问题（命名、格式、重复代码、写法偏好）**不得**单独作为安全 finding，除非能证明：授权边界破坏 / 数据泄露 / 存在性 oracle / 未授权写入 / scope 绕过 / 权限提升。

### 7.2 阶段 2 · Read-only Audit

审计必须是**只读**的：

```text
不修改代码
不修复发现的问题
不扩大 scope
不产生 commit
不 push
不因为发现问题就直接进入 implementation
```

- 审计工具：源码阅读、语义检索、`git diff/log/show`、只读的静态检查命令、只读数据库探测（如 `SELECT 1`）。
- 发现异常时：**STOP**，记录 finding，等待 Decision。
- 审计结束后给出明确的 `PASS / FAIL` 判定与逐项证据；不得用「看起来没问题」替代证据。

### 7.3 阶段 3 · Decision Freeze

进入 Implementation 之前必须先冻结以下内容（缺一不可）：

| 冻结项 | 说明 |
| --- | --- |
| Scope | 本次要解决的 finding 集合（不多不少） |
| Contract | 精确到错误码 / 文案 / 字段 / 查询形态 / 顺序要求 |
| Acceptance Criteria | 可逐条勾选的验收项 |
| Allowed Files | 允许修改的文件白名单 |
| Forbidden Files | 明确禁止触碰的路径（如 `prisma/`、`routes/`、`middleware/`、`client/`、`package.json`） |
| Runtime Expectations | 预期运行时行为（happy path / 边界 / 越权 / 失败语义） |
| Regression Expectations | 必须证明未被改变的既有行为 |

**Decision Freeze 之后**：

- 未经新的 Decision，**不允许扩大实施范围**；实施过程中若发现必须修改白名单外的第 5 个文件 → **STOP**，不得自行扩权。
- **发现新问题 ≠ 自动进入当前实施范围**。新问题走：`Independent Finding → Independent Decision → 进入当前版本 或 进入 POST-VERSION BACKLOG`。

### 7.4 阶段 4 · Implementation

必须遵守：

1. 只实施已冻结的 Decision，严格限制在白名单文件内。
2. 不修改 forbidden surfaces；不做顺手修复、不做无关重构、不自动格式化整文件。
3. 保持最小 diff：只做必要修改，保留原始缩进；改动应逐处可归属到某个 finding。
4. 遵守 §7.5 的**安全不变量**。
5. 完成后立即做**本轮局部事实核验**（确认没有扩大修改范围），再进入下一项。
6. 执行静态验证（见 §7.6），出现新增类型 / schema 错误 → STOP。

**安全不变量（Security Invariants）**：以下为 V1.0 已验证的强制规则，新代码必须遵守。

| # | 不变量 | 说明 |
| --- | --- | --- |
| 1 | 授权先于写入 | scope / 权限门必须位于任何 `update` / `create` / `delete` / `$transaction` / 日志之前（authorization before mutation） |
| 2 | 敏感宿主引用先鉴权 | 读取宿主对象（如 `Profit → SalesOrder`、`Shipment → SalesOrder`）用于业务判定前，同样必须过 scope |
| 3 | 单条引用必须 scoped | 禁止裸 `findUnique({ where: { id } })` 作为对象授权入口；统一 `findFirst({ where: applyScope({ id }, await roleScope(req, { field: ... })) })` |
| 4 | 不可见 == 不存在 | scope 外目标与不存在目标返回**同一响应**（通常 404），消除存在性 oracle；不得出现「存在→403 / 不存在→404」的可区分差异 |
| 5 | 可见 ≠ 可操作 | 数据范围只决定可见性；写操作另受 actor 规则约束（如 `owner OR admin`），且文案与状态码不得泄露归属信息 |
| 6 | 请求可控归属校验 | 请求中显式传入的 `ownerId` / `assignedTo` 等归属字段，目标用户必须满足「存在 + ACTIVE + ∈ 调用方 dataScope」，否则拒绝（且先于事务） |
| 7 | admin / ALL 只放开范围 | 管理员与 `ALL` 档位仅放开数据范围，**不豁免**存在性、状态（如 `ACTIVE`）、业务状态机校验 |
| 8 | 不可变字段保持不可变 | 已有不可变约束（如利润单的宿主订单不可更换）不得因新改动被绕过 |
| 9 | 状态机与资格门只收紧不松动 | 状态流转、可出货状态白名单、审批唯一性等既有资格判定不得被削弱；业务校验失败保持原有错误码（如资格不满足仍为 400），不要误改为 404 |

### 7.5 阶段 5 · Runtime Verification

**代码「能编译」不等于功能「验证完成」。** Runtime Verification 必须真实执行目标代码路径，并按功能覆盖：

```text
Happy Path
Boundary Cases
Invalid Input
Authorization（有权限用户 / 无权限用户 / admin）
Error Semantics（状态码 + 文案逐字）
Mutation Order（拒绝路径必须零写入 / 零事务 / 零日志）
Regression
```

本仓库的现实条件与**允许的替代验证方式**（不得把 Static Verification 冒充 Runtime Verification）：

- 仓库当前**没有测试框架**（无 jest / vitest 配置与用例）。因此 runtime 验证优先使用：
  1. 真实开发环境的手工 / 脚本化接口调用；
  2. **只读 stub runtime**：用 `tsx` 直跑修改后的真实 TS 源码（真实执行 controller 与 `server/src/utils/scope.ts`），仅对 prisma / 日志 / 编号序列等外围做桩，逐用例断言状态码、文案、查询形态、写入次数 —— 临时脚本必须放在**仓库外**（如 `/tmp`），验证完成后删除，**不得进入版本库**；
  3. 真实数据库**只读**探测。
- **禁止**为了验证而向真实业务数据库写入持久数据、修改 seed / fixture、或改动 schema。
- 无法构造的场景必须**如实标注**（例如「该拒绝路径在真实数据下不可达，仅以机制测试证明 fail-closed 接线」），不得伪造 PASS。
- 静态验证（§7.6）与 runtime 验证必须分别汇报，两者不可互相替代。

### 7.6 阶段 6 · 静态验证与回归验证

**静态验证**（每轮必跑，repo 当前可用命令）：

```bash
cd server && npx tsc --noEmit     # 后端类型检查
cd ../client && npx tsc --noEmit  # 前端类型检查
cd ../server && npx prisma validate
cd .. && git diff --check         # 空白 / 冲突标记检查
```

约定：

- 任何**新增** TypeScript / Prisma 错误 = STOP。
- 不为通过检查而临时安装依赖、修改配置或伪造 PASS；若项目未启用某工具（如 ESLint），必须明确记录为 `NOT CONFIGURED`。
- 禁止执行 `lint --fix`、自动格式化等会自动改写代码的命令（除非该轮 Decision 明确授权）。

**回归验证**：

修改一个功能时，必须同时验证：

```text
New Behavior
+
Existing Behavior
```

- 权限、安全、归属、数据范围相关改动**必须证明原有行为没有被无意改变**：优先用可复现的静态证据（例如同一基线的逐区间逐字比对、契约行计数比对、blob 哈希比对），必要时辅以 runtime 回归。
- 拒绝路径需确认**零副作用**：无 `update` / `create` / `$transaction` / 日志产生。

### 7.7 阶段 7 · Commit Gate

Commit 之前必须通过只读门禁：

```bash
git rev-parse HEAD
git rev-parse origin/master           # 或对应远端分支
git status --short
git diff --check
git diff --name-only
git diff --stat
git diff --numstat
git diff --cached --stat
```

门禁检查清单：

| 检查项 | 要求 |
| --- | --- |
| Git baseline | 与 Decision Freeze 记录的基线一致（HEAD / 远端均未漂移） |
| Worktree state | 只存在被授权的未提交修改；`staged = 0`、`untracked = 0` |
| Diff scope | 变更文件**恰好**等于 Allowed Files；无第 5 个文件、无新增 / 删除文件 |
| Diff stat | 与审计通过的 `+X / -Y`、hunk 数一致 |
| Forbidden surface | `prisma/`、`schema`、`migration`、`routes/`、`middleware/`、`client/`、`package.json`、`config`、`tests` 零变更 |
| Runtime evidence | 本轮 runtime 验证结论可用且与代码结构一致 |
| Regression evidence | 回归证据可用 |
| Static | `tsc` / `prisma validate` / `git diff --check` 全 PASS |

**内容指纹（推荐做法）**：staging 后对每个文件比对三方哈希 —— 工作树内容、index（staged）内容、审计时确认过的内容，三者必须逐字一致：

```bash
git hash-object <file>                                    # 工作树
git ls-files -s -- <file> | awk '{print $2}'              # index（staged）
git rev-parse <audited-commit>:<file>                     # 审计基线 / 提交后
```

**原则**：不允许用「方便」替代「精确」。不要为了让检查通过而修改代码；不要用 `git add .` 之类的宽范围命令。

### 7.8 阶段 8/9 · Commit 与 Push

只有 Commit Gate 全 PASS 才允许提交：

```bash
# 只允许显式路径（禁止 git add . / -A / -u / -p / -e）
git add -- <explicit-file-1> <explicit-file-2>

git diff --cached --name-only     # 必须恰好是授权文件
git diff --cached --numstat       # 必须与冻结值一致
git diff --cached --check

git commit -m "<type>(<scope>): <summary>"
git push origin <branch>
```

约定：

- 每轮**只提交一次**；不 `amend`、不 `rebase`、不 `reset` 覆盖已审计内容（如需修正如实说明并重新走门禁）。
- 提交信息遵循 Conventional Commits，与既有历史一致，例如：
  `fix(security): harden scoped references and approval visibility`、`fix(security): enforce scoped customer owner authorization on create`。
- 提交后核验：`git show --name-status --format="" HEAD`、`git show --numstat --format="" HEAD` 必须与冻结的 diff 一致。
- Push 后必须验证远端同步：

```text
HEAD == origin/<branch>
ahead/behind = 0/0
worktree = CLEAN
git ls-remote origin refs/heads/<branch>  ==  HEAD
```

- **禁止 force push**（除非未来有独立、明确的高等级 Decision）。
- 若远端未反映提交（`ls-remote` 仍为旧值）：如实报告 `REMOTE SYNC = FAIL` 并 STOP，**不要**自行 `push --force` / `pull` / `reset` / `rebase`。

### 7.9 阶段 10 · 版本冻结（Contract Freeze）

当一轮/一个版本范围内的审计、实施、验证、提交、推送全部 PASS 且同步完成后，可将当前 HEAD 冻结为该版本的基线，并在 §2 记录：

```text
Version / Status / Contract Freeze / Final Baseline / Remote Sync / Next Phase
```

---

## 8. Contract Freeze 与版本边界

**Contract Freeze 的含义**：当前版本已经完成规定范围内的审计、实施、验证与发布，后续开发不得直接破坏该版本边界。

冻结之后发现问题时：

```text
不要直接修改 frozen version
        ↓
创建新的 Finding / Decision
        ↓
决定进入下一版本（V1.1+）或进入 BACKLOG
```

这也就是 **V1.0 与未来 V1.1 的边界**：

```text
V1.0
Current Frozen Baseline
        ↓
POST-V1.0 BACKLOG
        ↓
Future Decision
        ↓
V1.1+
```

- 前端同步开发**不得**以「前端需要」为由直接改动 V1.0 冻结的后端行为。
- 冻结基线一旦推进（例如发布 V1.1），必须在 §2 同步更新 `Final Baseline` 与状态，保持本文件与仓库真实状态一致。

---

## 9. Finding / OBS 状态流与 Backlog

所有发现都必须有明确状态，不允许「悬空」：

```text
OBSERVED
   ↓
AUDITED
   ↓
DECIDED
   ↓
IMPLEMENTED
   ↓
VERIFIED
   ↓
FROZEN
```

未进入当前版本的发现，必须有明确去向：

```text
OBSERVED
   ↓
POST-VERSION BACKLOG      ← 不是「遗忘」，而是已登记、待独立决策
```

约定：

- 未被当前版本明确冻结、且未完成实施的 OBS，**不进入当前版本**，也不构成当前版本的 FAIL 条件。
- 不得因为发现 OBS 而重新打开已冻结版本的 implementation scope。
- 进入 BACKLOG 的条目再次实施时，必须重新走完整的 Decision → Implementation → Verification → Commit Gate 流程。
- 当前 BACKLOG 中已登记的条目（示例类别）：其他域的 CREATE 归属人 `ACTIVE` 校验缺口、部分计数类接口的存在性/计数泄露、组合产品与产品组的写侧引用校验、历史产品快照（read-side projection）等。具体清单以当轮审计记录为准，本文件不复述逐条历史。

---

## 10. 前端同步阶段规范（Frontend Sync）

后端 V1.0 已冻结，下一阶段是前端同步开发。推荐流程：

```text
Backend Contract Freeze
        ↓
Frontend Contract / Impact Audit     （只读：前端影响面 + 后端契约核对）
        ↓
Frontend Decision                    （冻结范围、文件白名单、验收标准）
        ↓
Frontend Implementation
        ↓
Frontend Runtime / Regression        （页面级手工 / 自动化验证 + 既有功能回归）
        ↓
Frontend Commit / Push               （走 §7.7–§7.9 同一套门禁）
```

原则：

- **前端基于已冻结的 Backend Contract 开发**，而不是通过修改后端来迁就前端。
- 前端开发中发现真正的后端契约问题：

```text
记录 Finding
    ↓
重新进入 Decision
    ↓
必要时进入 V1.1
```

  不得直接破坏 V1.0 frozen backend。
- 前端的权限接入必须复用 §6.5 的既有机制；数据范围判定不复制到前端（前端只做展示层控制，服务端仍是权威）。
- 前端验证现状：`client` 的 devDependencies 中已存在 `playwright` / `@playwright/test`，但仓库内**尚无 Playwright 配置文件与用例**。若要在前端阶段引入端到端自动化，需作为独立 Decision 处理（新增配置文件属于本轮白名单之外的内容）。
- 前端 UI 与文案改动需遵守 §11 与 `client/docs/i18n.md`。

---

## 11. 前端 UI 与 i18n 约定

- **浮层层级统一管理**：所有弹窗 / 抽屉 / 浮层的 z-index 从 `client/src/zIndex.ts` 的 `Z_INDEX` 取值，禁止散落魔法数字。
- **自定义浮层必须挂载到 `document.body`**：`AppModal`、自定义抽屉（如 `CustomerEditDrawer`）需用 `createPortal` 渲染到 body。页面容器 `.page-container` 声明了 `contain: layout style`，会创建独立层叠上下文，直接渲染在页面内的 `position: fixed` 浮层会被困住，导致被先打开的弹窗遮挡（z-index 失效）。
- **交互组件统一**：列表 / 详情页的筛选、切换等使用自定义 `CapsuleSwitch`（胶囊切换）、`SegmentedTabBar`、`ViewModeSwitch`，与客户页风格保持一致。
- **视觉规范对齐客户 / 产品页**：列表卡片阴影（`token.boxShadowSecondary`）、弹窗大圆角（`borderRadius: 20`）、链接色（`token.colorPrimary`）等在新页面 / 新组件中保持统一；整体设计令牌见 `DESIGN.md` 与 `client/DESIGN.md`。
- **国际化**：新增页面 / 文案前必读 [前端国际化（i18n）开发约定](client/docs/i18n.md)。

---

## 12. 业务与交互说明（要点）

### 线索（Sales Leads）

- **线索名称**由前端按规则自动生成：`目标国家 + 产品名称 + 数量`（如 `美国-搪胶公仔-500`），新建 / 编辑时随字段变化实时预览，后端仅负责保存。
- **负责人**：新建时默认当前登录用户，可在弹窗标题栏选择；列表与详情中的负责人为只读展示文本（同客户详情交互）。
- **获客渠道**：树形结构（渠道 → 平台 / 店铺），来源渠道录入为 `渠道 / 平台` 路径。
- **我的线索 / 公海切换**：列表顶部胶囊切换（`CapsuleSwitch`）。「我的」展示当前用户负责的线索，「公海」展示无负责人（`assignedTo` 为 `null`）的线索，公海线索可认领归为自己。
- **释放线索**：将负责人置空，线索回到公海；**转交线索**：选择新负责人后，会同步把该线索对应的**客户**与**产品**的指定人更新为被选择的人。

> 这两类操作的权限与错误语义遵循 §7.4 不变量 4 / 5：不可见目标与不存在目标返回同一响应（`404 线索不存在`），`owner OR admin` 之外不可执行，已在海中的线索仍返回 `400 该线索已在公海`。

### 设置模块

- 系统设置下的数据类页面（客户类型、角色、部门、权限、证书等）首帧直接进入加载态（骨架屏 / 表格遮罩），避免空白态闪烁。
- 菜单切换路径：`/setting` 重定向到第一个子页（`/setting/customerType`）。

### 审批

- 业务单据（报价、打样、销售订单、生产订单、出货、采购、收付款、利润）可发起审批，审批配置与记录由「设置 → 审批」维护。
- 越权发起审批与对象不存在返回同一响应（`404 <业务对象名>不存在`），不泄露对象是否存在。

---

## 13. 开发文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/V1.0目标Schema设计/](docs/V1.0目标Schema设计/) | V1.0 目标 Schema 分层设计（00 总览与设计原则、01 公共支撑层、02 主数据层、03 销售层、04 履约层、05 新旧模型映射与迁移、06 待修订项清单） |
| [client/docs/i18n.md](client/docs/i18n.md) | 前端国际化约定（文案结构、key 命名、新增功能步骤） |
| `DESIGN.md` / `client/DESIGN.md` | 设计系统：颜色、字体、布局、组件规范（设计令牌） |
| `client/PRODUCT.md` | 前端产品说明（YSEM CRM 后台管理系统：平台与页面） |
| `http://localhost:3000/api/docs` | Swagger API 文档（运行时） |

---

## 14. 注意事项与已知事实

- **数据库 schema 变更必须走迁移**（`prisma migrate dev`），禁止直接 `db push` 到生产；`server/prisma/migrations_legacy/` 为归档目录，勿手工改动。
- `prisma/seed.ts` 的「获客渠道」会清理旧版废弃名称（如 `线下渠道` → `展会`，`寿春平台` → `寿春店`），执行前请确保该部分数据可重建。
- **后端端口为 3000**（`server/.env.example`、`src/index.ts`、`client/vite.config.ts` 代理目标、`docker-compose.yml` 一致）。若本地 `.env` 覆盖为其他端口，需同步前端代理。
- **ESLint 未配置**：`server` / `client` 的 `package.json` 中虽有 `lint` 脚本，但仓库无 ESLint 配置文件、依赖中也未安装 ESLint，因此 `npm run lint` 当前**不可作为验证门**；静态验证以 §7.6 的命令为准。
- **无自动化测试框架**：仓库内无 jest / vitest 配置与用例；验证策略见 §7.5（禁止把静态检查当作 runtime 验证）。
- **禁止为验证而污染数据**：不得向真实业务库写入持久数据、不得修改 seed / fixture 绕过验证。
- **禁止 force push**；冻结基线不得被直接改写（见 §8）。

---

## 15. 版本冻结记录（V1.0）

| 项 | 值 |
| --- | --- |
| 版本 | V1.0 |
| 状态 | CLOSED / CONTRACT FROZEN |
| 冻结基线 | `1dc0b2beb3dd94dd70865dc5a276955ec7421c4a` |
| 远端同步 | `origin/master` 与之相同，ahead/behind = `0/0` |
| 收口案例 | `F-NEW-20`（更新侧 ownership 授权，提交 `5f74c51`）→ `F-NEW-20b`（创建侧 ownership 授权，提交 `1dc0b2b`），均经 Read-only Audit → Decision Freeze → Implementation → Runtime Verification（25/25）→ Regression → Commit Gate → Push 验证 → Contract Freeze |

后续版本的冻结记录追加于本表下方或更新 §2，保持「当前状态」唯一且准确。
