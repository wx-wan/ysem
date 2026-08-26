# YSEM 外贸业务管理系统

面向外贸企业的全链路业务管理平台，覆盖「线索 → 客户 → 商机 → 订单 → 生产 → 出货」全流程，并包含产品库、权限、设置等基础模块。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Ant Design 5 + React Router 6 + Zustand + React i18n
- **后端**：Node.js + Express + TypeScript + Prisma ORM
- **数据库**：PostgreSQL
- **认证**：JWT（Access + Refresh Token）

## 目录结构

```
ysem/
├── client/                # 前端应用
│   └── src/
│       ├── api/           # 接口封装（axios 实例 + 各模块 API）
│       ├── pages/         # 页面（SalesLeads / Customers / Orders / Products / Setting* ...）
│       ├── components/    # 公共组件（AppModal / SegmentedTabBar / CountrySelect ...）
│       ├── store/         # Zustand 全局状态（auth / permission / menu）
│       ├── i18n/          # 中英文文案
│       └── styles/        # global.css 等全局样式
└── server/                # 后端应用
    ├── src/
    │   ├── controllers/   # 路由处理函数
    │   ├── middleware/    # 鉴权 / 权限校验 / 数据权限作用域
    │   ├── routes/        # 路由定义
    │   └── scripts/       # 辅助脚本（seed-customers 等）
    └── prisma/
        ├── schema.prisma  # 数据模型
        ├── seed.ts        # 种子数据
        └── migrations/    # 数据库迁移
```

## 环境准备

### 1. 数据库（PostgreSQL）

- 准备一个 PostgreSQL 实例（默认 `localhost:5432`，库名 `ysem`）。
- 在 `server/.env` 中配置连接串：

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/ysem?schema=public"
JWT_SECRET="your-secret"
PORT=3001
```

### 2. 安装依赖

```bash
# 根目录（如有 workspace 配置）
# 前后端分别安装
cd server && npm install
cd ../client && npm install
```

### 3. 初始化数据库与种子数据

```bash
cd server

# 生成 Prisma Client 并应用迁移
npm run db:generate
npm run db:migrate        # 首次：prisma migrate dev --name init

# 写入种子数据（角色/部门/管理员/客户类型/产品分类/获客渠道）
npm run db:seed
```

默认账号（seed 写入）：

| 角色   | 用户名      | 密码        |
| ------ | ----------- | ----------- |
| 管理员 | admin       | admin123    |
| 业务员 | business    | business123 |
| 采购员 | purchaser   | purchaser123 |

> 环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` 可覆盖默认管理员账号。

### 4. 启动开发

```bash
# 终端 1：后端
cd server && npm run dev

# 终端 2：前端
cd client && npm run dev
```

前端默认 `http://localhost:5173`，后端默认 `http://localhost:3001`。

## 常用脚本

| 命令                    | 说明                               |
| ----------------------- | ---------------------------------- |
| `server: npm run dev`   | 后端开发（tsx watch）              |
| `server: npm run build` | 后端 tsc 编译                      |
| `server: npm run db:migrate` | 生成并应用迁移               |
| `server: npm run db:seed`    | 写入种子数据                  |
| `server: npm run db:studio`  | Prisma Studio                  |
| `client: npm run dev`   | 前端开发                          |
| `client: npm run build` | 前端构建                          |

## 核心业务说明

### 线索（Sales Leads）
- **线索名称**由前端按规则自动生成：`目标国家 + 产品名称 + 数量`（如 `美国-搪胶公仔-500`），新建/编辑时随字段变化实时预览，后端仅负责保存。
- **负责人**：新建时默认当前登录用户，可在弹窗标题栏选择。
- **获客渠道**：树形结构（渠道 → 平台/店铺），来源渠道录入为 `渠道 / 平台` 路径。

### 设置模块
- 系统设置下的数据类页面（客户类型、角色、部门、权限、证书等）首帧直接进入加载态（骨架屏/表格遮罩），避免空白态闪烁。
- 菜单切换路径：`/setting` 重定向到第一个子页（`/setting/customerType`）。

## 开发文档

- [前端国际化（i18n）开发约定](client/docs/i18n.md) — 多语言文案结构、key 命名规范、新增功能的完整步骤，开发新页面/新功能前必读。

## 权限与数据范围设计

系统权限分为两层：**功能权限**（能访问哪些菜单 / 操作）与**数据权限**（能看哪些数据），统一由「用户 → 角色 → 权限 / 数据范围」模型驱动。

### 1. 功能权限（RBAC）

- 模型：`User（用户）— Role（角色）— Permission（权限）`，角色可多权限、用户单角色。
- 权限类型：
  - `MENU`：菜单权限，控制侧边栏可见性与路由可访问性（如 `orders`、`purchase`、`system:role`）。
  - `BUTTON`：操作权限，控制页面内按钮显隐（如 `customer:create`、`system:role:edit`）。
- 校验链路（前后端双重校验）：
  - 登录 → 后端 `authenticate` 解析 JWT，查询用户角色与权限集合挂载到请求；
  - 接口层 `requirePerm(perm)` 校验操作权限，无权限返回 403；
  - 前端按权限集合动态渲染菜单，路由由 `PermRoute` 组件保护，未授权访问重定向到无权限页。
- 超级管理员（`admin` 角色）自动拥有全部权限并跳过数据范围限制，不允许被编辑。

### 2. 数据范围（Data Scope）

每个角色可在「设置 → 角色管理」中配置数据范围 `Role.dataScope`，共三档：

| dataScope | 名称     | 可见数据                                             |
| --------- | -------- | ---------------------------------------------------- |
| `ALL`     | 全部数据 | 企业全部业务数据（管理员恒为 `ALL`）                 |
| `DEPT`    | 本部门数据 | 本部门所有成员负责的数据（用户无部门时退化为仅本人） |
| `SELF`    | 仅本人数据 | 仅本人负责的数据（默认）                             |

各业务列表 / 详情 / 变更接口均按当前用户的角色数据范围过滤，负责人字段映射如下：

| 业务实体 | 负责人字段                 | 说明                         |
| -------- | -------------------------- | ---------------------------- |
| 客户     | `customer.ownerId`         |                              |
| 订单     | `customer.ownerId`         | 订单跟随关联客户的负责人     |
| 线索     | `lead.assignedTo`          |                              |
| 商机     | `salesPipeline.assignedTo` |                              |
| 采购单   | `purchaseOrder.ownerId`    |                              |

### 3. 公海 / 公开数据规则

- **公海数据**（负责人字段为 `null`，如未认领客户、未指派线索 / 商机）对集团内**所有登录用户开放**，属系统内置规则，不占用数据范围档位、无需单独控制。
- 客户池（公海）提供独立入口，任何拥有客户权限的用户均可浏览、认领；释放（归还公海）后同样全员可见。
- 产品等带 `visibility`（`PUBLIC`）的公开数据对整个集团开放。

### 4. 实现方式

后端统一收敛在 `server/src/utils/scope.ts`：

- `roleScope(req, { field?, relation? })`：生成 Prisma 可见范围条件（异步，`DEPT` 需查询部门成员）；管理员 / `ALL` 返回空条件（不限）；`SELF` / `DEPT` 自动并入公海（负责人为 `null`）条件。
- `applyScope(where, scope)`：以 `AND` 形式合并进查询条件。
- `publicSeaScope(req)`：公海（无负责人）条件，供客户池等独立公海入口使用。
- 各列表查询统一复用 `roleScope`，避免在每个控制器中重复编写 `ownerId` 判断。

> 旧档位「本部门及下级（`DEPT_AND_CHILD`）」「本人 + 公海（`SELF_PUBLIC_SEA`）」已废弃；执行 `npm run db:seed` 会将存量旧档位自动归一为 `SELF`。

### 5. 前端权限接入

- 侧边栏菜单按当前用户权限集合动态渲染（`MainLayout` 内 `hasPerm` 控制）。
- 路由统一使用 `PermRoute perm="xxx"` 包裹，未授权跳转无权限页。
- 页面内按钮通过 `hasPerm` / `can` 控制显隐。
- 数据范围在「设置 → 角色管理 → 编辑」弹窗中选择，展示为「全部数据 / 本部门数据 / 仅本人数据」。

## 注意事项

- 数据库 schema 变更请走 `prisma migrate dev` 生成迁移，勿直接 `db push` 到生产。
- `prisma seed` 中的「获客渠道」会清理旧版废弃名称（如 `线下渠道` → `展会`，`寿春平台` → `寿春店`），执行前请确保环境下可重建该部分数据。
