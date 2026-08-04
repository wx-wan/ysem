# 义乌寿春企业管理系统 (YSEM)

义乌寿春企业管理系统，涵盖用户权限管理、客户关系管理 (CRM)、订单管理、销售管理、数据报告等核心业务模块。

## 功能模块

| 模块 | 说明 |
|------|------|
| 仪表盘 | 系统概览、关键指标展示 |
| 用户管理 | 用户 CRUD，支持角色分配与部门归属 |
| 部门管理 | 组织架构管理，支持树形层级 |
| 角色管理 | 角色 CRUD，灵活分配菜单与接口权限 |
| 权限管理 | 权限树配置，细粒度访问控制 |
| 客户管理 | 公海/私海客户管理，支持导入导出、转交、标签、重点客户标记、阶段流转（线索→商机→样品单→订单） |
| 订单管理 | 订单 CRUD，关联客户与金额，多币种支持 |
| 销售管理 | 销售全生命周期追踪，阶段联动表单（线索→商机→样品单→订单→成交/流失） |
| 生产管理 | 生产任务跟踪 |
| 发货管理 | 发货物流管理 |
| 数据报告 | 12 项核心指标看板（线索量/商机量/样品单数/订单数/新老客户数/转化率/成交金额/新老客户成交占比环形图/意向分布（准成交→高意向→中意向→低意向）） |
| 多语言 | 中/英文切换 |
| 货币 | 多币种汇率自动同步与展示 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Ant Design 6 + Zustand + React Router 6 + i18next |
| 后端 | Node.js + Express + TypeScript + Prisma ORM |
| 数据库 | SQLite (开发) / PostgreSQL (生产) |
| 认证 | JWT (Access Token + Refresh Token) |
| 部署 | Docker + Docker Compose + Nginx |

## 项目结构

```
.
├── client/                 # 前端项目
│   ├── src/
│   │   ├── api/           # API 接口封装
│   │   ├── assets/
│   │   │   └── fonts/     # 自定义字体 (Montserrat + SourceHanSansCN 子集化)
│   │   ├── components/    # 公共组件 & 弹窗组件
│   │   │   ├── customer/  # 客户相关组件 (表单/导入/转交/统计/工具栏/卡片/列表/动效)
│   │   │   ├── sales/     # 销售相关组件 (表单/导入/详情抽屉/看板卡片/看板视图/阶段按钮)
│   │   │   ├── order/     # 订单相关组件 (表单/详情)
│   │   │   ├── user/      # 用户表单组件
│   │   │   ├── role/      # 角色表单/权限分配组件
│   │   │   ├── dept/      # 部门表单组件
│   │   │   └── perm/      # 权限表单组件
│   │   ├── data/          # 静态数据 (国家列表等)
│   │   ├── i18n/          # 多语言配置
│   │   ├── layouts/       # 布局组件 (主布局/头部工具栏)
│   │   ├── pages/         # 页面组件 (13 个页面)
│   │   ├── stores/        # 状态管理 (Zustand)
│   │   └── styles/        # 全局样式
│   ├── index.html
│   └── package.json
├── server/                 # 后端项目
│   ├── src/
│   │   ├── controllers/   # 控制器
│   │   ├── middleware/     # 中间件 (认证/错误处理)
│   │   ├── routes/        # 路由
│   │   ├── lib/           # 工具库 (Prisma / 活动日志)
│   │   ├── scripts/       # 脚本 (种子数据等)
│   │   └── utils/         # 工具函数
│   ├── prisma/
│   │   ├── schema.prisma  # 数据模型
│   │   └── seed.ts        # 种子数据
│   └── package.json
├── docker-compose.yml      # Docker 编排
├── Dockerfile.server       # 后端 Docker 镜像
├── Dockerfile.client       # 前端 Docker 镜像
├── start.sh                # 一键启动脚本
└── README.md
```

## 快速开始 (本地开发)

### 1. 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install
```

### 2. 初始化数据库

```bash
cd server
npx prisma generate      # 生成 Prisma Client
npx prisma db push       # 同步数据库
npx tsx prisma/seed.ts   # 初始化种子数据
```

### 3. 启动开发服务器

```bash
# 终端 1: 启动后端 (端口 3000)
cd server && npm run dev

# 终端 2: 启动前端 (端口 5173)
cd client && npm run dev
```

### 4. 访问系统

- 前端: http://localhost:5173
- 后端 API: http://localhost:3000/api
- 默认管理员: `admin` / `admin123`

## Docker 部署

### 开发环境 (快速启动)

```bash
# 使用 docker-compose 一键启动
docker-compose up -d

# 初始化数据库
docker exec -it ysem-server npx prisma db push
docker exec -it ysem-server npx tsx prisma/seed.ts
```

### 生产环境

```bash
# 1. 创建环境变量文件
cp server/.env.production .env

# 2. 修改 .env 中的敏感信息
#    - DB_PASSWORD: 数据库密码
#    - JWT_SECRET: JWT 密钥
#    - JWT_REFRESH_SECRET: 刷新令牌密钥
#    - CORS_ORIGIN: 前端域名

# 3. 启动服务
docker-compose -f docker-compose.yml --env-file .env up -d

# 4. 初始化数据库
docker exec -it ysem-server npx prisma db push
docker exec -it ysem-server npx tsx prisma/seed.ts
```

## 云服务器部署建议

1. 复制项目到服务器
2. 安装 Docker 和 Docker Compose
3. 修改 `server/.env.production` 密钥
4. 运行 `docker-compose up -d`
5. 配置 Nginx 反向代理 (可选，如需 HTTPS)
6. 配置防火墙开放 80 和 443 端口

## API 接口

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 认证 | POST | /api/auth/login | 登录 |
| 认证 | GET | /api/auth/profile | 获取用户信息 |
| 用户 | GET | /api/users | 用户列表 |
| 用户 | POST | /api/users | 创建用户 |
| 用户 | PUT | /api/users/:id | 更新用户 |
| 用户 | DELETE | /api/users/:id | 删除用户 |
| 角色 | GET | /api/roles | 角色列表 |
| 角色 | POST | /api/roles | 创建角色 |
| 角色 | PUT | /api/roles/:id | 更新角色 |
| 角色 | DELETE | /api/roles/:id | 删除角色 |
| 角色 | POST | /api/roles/:id/permissions | 分配权限 |
| 部门 | GET | /api/departments | 部门列表 |
| 部门 | POST | /api/departments | 创建部门 |
| 部门 | PUT | /api/departments/:id | 更新部门 |
| 部门 | DELETE | /api/departments/:id | 删除部门 |
| 权限 | GET | /api/permissions/tree | 权限树 |
| 权限 | POST | /api/permissions | 创建权限 |
| 权限 | PUT | /api/permissions/:id | 更新权限 |
| 权限 | DELETE | /api/permissions/:id | 删除权限 |
| 客户 | GET | /api/customers | 客户列表（支持公海/私海筛选） |
| 客户 | POST | /api/customers | 创建客户 |
| 客户 | PUT | /api/customers/:id | 更新客户 |
| 客户 | DELETE | /api/customers/:id | 删除客户 |
| 客户 | POST | /api/customers/import | 批量导入客户 |
| 客户 | POST | /api/customers/:id/transfer | 转交客户 |
| 客户 | GET | /api/customers/report | 获取报告统计数据 |
| 客户 | PATCH | /api/customers/:id/tags | 单独更新客户标签 |
| 订单 | GET | /api/orders | 订单列表 |
| 订单 | POST | /api/orders | 创建订单 |
| 订单 | PUT | /api/orders/:id | 更新订单 |
| 订单 | DELETE | /api/orders/:id | 删除订单 |
| 订单 | GET | /api/orders/customer/:customerId | 按客户查询订单 |
| 销售 | GET | /api/sales | 销售记录列表 |
| 销售 | POST | /api/sales | 创建销售记录 |
| 销售 | PUT | /api/sales/:id | 更新销售记录 |
| 销售 | DELETE | /api/sales/:id | 删除销售记录 |
| 汇率 | GET | /api/exchange | 获取汇率数据 |
| 健康 | GET | /api/health | 健康检查 |

## 更新日志

### 2026-08-04（补充）

- **销售列表顶部新增「添加」区块**：将列表表格整体下移、每页默认条数 `pageSize` 由 20 减为 19（少显示一栏），腾出的位置在表格上方插入一个风格统一的"新建销售记录"区块（`borderRadius:12`、主色 `#1677ff` 虚线边框 + 渐变底、hover 变实线并加阴影），内含「线索/商机/样品单/订单」四个阶段色点快捷入口，点击直接以对应阶段打开新增表单；**不改动原 Table 的 dataSource / 分页 / 筛选逻辑**
- `SalesFormModal` 在销售页场景由父级 `Sales.tsx` 负责落库（`handleFormSuccess` 调 `salesApi.create/update` 后 `refresh`），与详情页的缓存模式分工一致

- **商机表单 (`SalesFormModal`) 阶段联动重构与首次赋值修复**：
  - 「预计成交日期」改用 Ant Design `DatePicker`（原为原生 `input[type=date]`），并加 `disabledDate` 限制，只可选当日及之后的日期，不可选之前的日期
  - 按阶段（线索 / 商机 / 样品单 / 订单）分块渲染条件字段：线索→感兴趣产品+备注；商机→预估金额+采购意向+预计成交日期；样品单→样品类型+数量+状态；订单→订单金额+下单/交付日期+付款条件+状态
  - 修复「首次打开编辑弹窗时预计成交金额/预计成交时间未赋值」：原 `setTimeout(0)` 在条件字段（经 `Form.useWatch` 异步挂载）尚未渲染即赋值导致丢失，改为按 stage 轮询 `requestAnimationFrame` + `getFieldInstance` 等待字段实例挂载后再 `setFieldsValue`
  - 保存逻辑下沉父级：组件仅负责校验与数字类型转换，通过 `onSuccess(values)` 回传；持久化与前端缓存统一由 `Customers.tsx` 处理（先乐观更新 `detailCustomer` 缓存保持一致，再 `salesApi` 落库，最后回源详情）
  - 移除打开编辑时的 `salesApi.get`（直接复用父级传入的完整 `SalesItem`）与保存后的列表刷新（`fetchData`），整条数据流统一来自缓存
- **详情弹窗「销售记录」模块新增顶部添加区块**：将销售记录列表每页 `pageSize` 由 6 减为 5（首栏留给添加块），在列表第一条之前插入"新建销售记录"区块；**背景/边框/图标主题色遵循客户卡片分级主题色 `ct.primary`（与卡片视图一致，不再固定主色）**，hover 时边框变实线并加主题色阴影；**移除右侧线索/商机/订单 标签**，整块点击逻辑待定（默认 `onAddPipeline`）；不改动原列表 dataSource / 分页 / 筛选逻辑
- **商机转订单弹窗**：新增「转为订单」确认弹窗，支持选择订单类型（正式订单 / 样品单），预计成交金额自动作为订单金额
- **订单/销售模型扩展（schema）**：`Order` 新增 `orderType`(SAMPLE/FORMAL)、`sampleAmountCNY`(样品单金额)、`moldFeeCNY`(模具费)、`moldFeeRefundable`(模具费可退)；`SalesPipeline` 新增 `orderType`；后端 `order.controller` 完善 `create`/`update` 字段写入
- **客户卡片新增「首次合作日期」**：在头部展示 `customer.firstOrderDate`；新增 `server/src/scripts/backfill-firstOrderDate.ts` 脚本回填老数据的首次合作日期（取客户最早订单 `orderDate` 写入 `firstOrderDate`）
- **浏览器标签页标题**：`MainLayout` 按当前路由动态设置 `document.title`（如「客户管理 - Joylifetoy」），`index.html` 与 `i18n` 应用名统一为 `Joylifetoy`
- **数据报告 (`Reports`)**：图表与卡片样式优化（金额卡片 `token.colorText`、阶段卡片 `stage.color` 等主题色对齐）

### 2026-08-01

- **自定义字体**：引入 Montserrat（英文）+ 思源黑体 SourceHanSansCN（中文），字体子集化压缩至 ~368KB
  - OTF 源文件 → WOFF2 转换（压缩率 ~25%）
  - 字重精简：仅保留 400 / 700 字重，移除 Hairline/Light/ExtraLight
  - 子集化：扫描项目源码提取实际用字，从 31MB 压缩至 ~368KB
  - 全局覆盖：`html, body` + `[class*="ant-"]` 双保险，Ant Design 所有组件字体统一
- **海浪动画优化**：
  - 波浪层从 4 层精简为 2 层（涌浪 + 近岸波浪），下层可翻涌盖过上层，模拟真实海面
  - 动画速度整体放缓，关键帧位移幅度降低
  - Mulberry32 确定性伪随机 + useMemo 缓存波浪参数
- **客户卡片**：每页展示数量从 9 调整为 6
- **数据库**：客户国家分布调整为 55% 美国、30% 中国、15% 欧洲各国随机分配
- **依赖**：React Router 添加 v7 过渡标志 (startTransition / relativeSplatPath)

### 2026-08-01 (续)

- **标签组件统一**：卡片 (`CustomerCard`)、列表 (`CustomerList`) 与客户详情抽屉统一复用同一套标签组件
  - 展示：`CustomerTags`（标签渲染，自动过滤系统标签：重点客户/未成交客户/本年度新客/往年老客）
  - 编辑：`TagSelector`（新增/删除/选色，数据格式 `"name#color"`）
  - 新增 `CustomerTags.tsx` 作为共享展示组件，抽离 `filterCustomTags` / `parseAllTags` 工具函数
- **标签更新后端接口**：新增 `PATCH /api/customers/:id/tags`，仅更新标签字段并写入操作日志，前端对应 `customerApi.updateTags()`
- **客户详情抽屉交互优化**：
  - 移除抽屉内的内联编辑表单（展示/编辑两态切换），点击"编辑客户"改为弹出 `CustomerFormModal` 弹窗，编辑成功后自动刷新详情并停留在卡片所在页面
  - 进入抽屉时自动拉取最新客户数据
  - 文件位置从 `components/CustomerDetailDrawer.tsx` 移至 `components/customer/CustomerDetailDrawer.tsx`，与其他客户组件归类一致

### 2026-08-02

- **客户详情弹窗 (`CustomerDetailModal`)**：
  - 新建手写弹窗组件 `AppModal`（原生 div + Portal），统一系统弹窗样式逻辑，脱离 antd Modal 默认样式限制
  - 头部右侧操作栏：交换「负责人」与「操作图标」模块的顺序（负责人在前、操作图标在后）
  - 移除负责人与操作图标之间的 `Divider` 竖线
  - 国家字段支持下拉选择（编辑态复用 `CountrySelect`，`value` 绑定 `draft.country` 修复选中不生效问题）
  - 新建 `InlineEditInput` 组件替代 antd Input，提供边框下沉样式，编辑态文字与图标遵循卡片白色渐变风格
  - 保存时按 `EDITABLE_FIELDS` 比对，无变化则不触发后端更新
  - 打开详情改为同步触发，详情数据通过 `getById` 异步补全，消除点击卡顿
- **重点客户星标 (`KeyAccountStar`)**：点击星标切换重点客户时不再弹出确认/提示框（移除 Tooltip 与 message 提示），仅通过星标状态静默反馈

### 2026-08-03

- **前端样式降噪与架构优化**：
  - 新增设计 token `ds.ts`，统一卡片圆角、高度、间距、文字层级，消除硬编码色偏离主题问题
  - `CountrySelect` 支持双形态：卡片内只读展示（`readOnly`）、编辑页下拉选择
  - 前端缓存机制：列表 (`listCache`) 与客户详情 (`detailCache`) 缓存于内存，新增 `customerCache.ts`；差异更新 `pickChanged` / `diffList`（`diff.ts`），仅合并变化字段以保持引用稳定
  - 缓存失效策略改为「视图离开即失效」：切换标签 / 页面隐藏 / 关闭页面时通过 `visibilitychange` / `pagehide` / `beforeunload` 触发 `invalidateAll()`
  - 移除闪烁及装饰性特效：卡片星光动画、浮点圆、海浪 SVG、`backdropFilter` 模糊、`AppModal` 入场动画；删除 `CustomerCardSparkle.tsx`
  - 移除卡片右上角国旗与金色星光点缀，重点客户星标位置保留
  - 统一中意向 (C) / 低意向 (D) 卡片文字与星标样式，与高意向 (B) / 准成交 (A) 视觉一致
  - 修复缓存命中后列表排序失效（缓存存未排序列表 + 字段变更不重排）及 React 无限循环（`Maximum update depth exceeded`）问题

### 历史更新

- **数据报告增强**：意向分布按"准成交 → 高意向 → 中意向 → 低意向"排序；累计成交金额卡片新增新老客户成交占比环形图
- **客户卡片视觉体系重构**：未成交客户按采购意向分级配色；已成交客户保持金/紫主题；粒子动画改为纯 CSS
- **客户列表排序规则**：重点客户 → 意向等级(A→D) → 预计商机金额(降序) → 成交金额(降序) → 创建时间(倒序)
- **性能优化**：React.memo / useMemo / useCallback / GPU 合成层
- **组件重构**：抽取 CustomerCard/CustomerList/StageButtons/KanbanCard 等组件，Customers.tsx 精简 50%

## Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 代码重构
chore: 构建/工具变更
```
