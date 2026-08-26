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

## 数据权限

后端基于 JWT 中的角色，对「客户 / 订单 / 线索 / 商机 / 生产 / 出货」按负责人做数据作用域过滤（owner scope），管理员不受限。

## 注意事项

- 数据库 schema 变更请走 `prisma migrate dev` 生成迁移，勿直接 `db push` 到生产。
- `prisma seed` 中的「获客渠道」会清理旧版废弃名称（如 `线下渠道` → `展会`，`寿春平台` → `寿春店`），执行前请确保环境下可重建该部分数据。
